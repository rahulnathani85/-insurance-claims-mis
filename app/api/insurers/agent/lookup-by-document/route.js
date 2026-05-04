// =============================================================================
// /api/insurers/agent/lookup-by-document
// =============================================================================
// POST multipart/form-data { file: File } -> AI-extracted insurer profile +
// offices, scoped to what's in the document.
//
// Routing by mime / extension:
//   PDF + image/*   -> OCR via lib/aiClients (Mistral primary, Textract
//                      fallback per env). The OCR'd text feeds the LLM.
//   xlsx            -> XLSX.read + sheet_to_json -> pass rows as evidence.
//                      The model classifies each row's office_code.
//   anything else   -> 415 unsupported.
//
// Branches (RCH/CCH/BO) are stripped from the model output by the shared
// extractor (see lib/insurerAgent/extractor.js — ALLOWED_OFFICE_CODES_AT_AGENT_STAGE).
// =============================================================================

import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { callLLM, extractText } from '@/lib/aiClients';
import { buildLookupPrompt, parseInsurerJson } from '@/lib/insurerAgent/extractor';
import { assessConfidence } from '@/lib/insurerAgent/confidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min: OCR + LLM in series

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers send this for .xlsx
]);

export async function POST(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'expected multipart/form-data' },
      { status: 400 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `malformed form data: ${err?.message || err}` },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  const filename = (file.name && String(file.name)) || 'upload';
  const mimeType = (file.type && String(file.type)) || 'application/octet-stream';
  const isXlsx =
    XLSX_MIMES.has(mimeType.toLowerCase()) || /\.(xlsx|xlsm|xls|csv)$/i.test(filename);

  const buffer = Buffer.from(await file.arrayBuffer());

  // -------------------------------------------------------------------------
  // 1. Document -> evidence text. XLSX bypasses OCR.
  // -------------------------------------------------------------------------
  let promptArgs;
  let pageCount = null;
  let ocrProvider = null;

  if (isXlsx) {
    let rows;
    try {
      rows = readXlsxRows(buffer);
    } catch (err) {
      return NextResponse.json(
        { error: `xlsx parse failed: ${err?.message || err}` },
        { status: 400 }
      );
    }
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'spreadsheet has no readable rows' },
        { status: 422 }
      );
    }
    promptArgs = { mode: 'document', xlsxRows: rows };
  } else {
    // OCR everything else (PDF, image). The OCR client itself rejects
    // unsupported mimes with a clean error.
    let ocrResult;
    try {
      ocrResult = await extractText({
        buffer,
        mimeType,
        filename,
        triggeredBy: 'manual',
      });
    } catch (err) {
      return NextResponse.json(
        { error: `OCR failed: ${err?.message || err}` },
        { status: 502 }
      );
    }
    if (!ocrResult?.text || ocrResult.text.trim().length === 0) {
      return NextResponse.json(
        { error: 'OCR returned no text' },
        { status: 422 }
      );
    }
    pageCount = ocrResult.pages || null;
    ocrProvider = ocrResult.provider || null;
    promptArgs = { mode: 'document', ocrText: ocrResult.text };
  }

  // -------------------------------------------------------------------------
  // 2. LLM extraction.
  // -------------------------------------------------------------------------
  const { systemPrompt, userMessage } = buildLookupPrompt(promptArgs);

  let llmResult;
  try {
    llmResult = await callLLM({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2048,
      triggeredBy: 'manual',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `LLM call failed: ${err?.message || err}` },
      { status: 502 }
    );
  }

  let parsed;
  try {
    parsed = parseInsurerJson(llmResult.text);
  } catch (err) {
    return NextResponse.json(
      { error: `parse failed: ${err?.message || err}`, raw: llmResult.text?.slice(0, 1000) },
      { status: 502 }
    );
  }

  parsed.field_confidences = assessConfidence(parsed.insurer, parsed.field_confidences);

  const existingMatch = await findExistingInsurer({
    code: parsed.insurer?.code,
    name: parsed.insurer?.company_name,
  });

  return NextResponse.json({
    insurer: parsed.insurer,
    offices: parsed.offices,
    field_confidences: parsed.field_confidences,
    extraction_notes: parsed.extraction_notes || null,
    existing_match: existingMatch,
    source: {
      kind: isXlsx ? 'xlsx' : 'ocr',
      filename,
      mimeType,
      pages: pageCount,
      ocr_provider: ocrProvider,
    },
    llm: {
      provider: llmResult.provider,
      model: llmResult.model,
      latencyMs: llmResult.latencyMs,
      costInr: llmResult.costInr,
    },
  });
}

// ---------------------------------------------------------------------------
// readXlsxRows(buffer) -> row[]
// First sheet, header: 1, then convert array-of-arrays into array-of-objects
// with normalised header keys (lowercase, snake_case-ish). Empty rows dropped.
// ---------------------------------------------------------------------------
function readXlsxRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!Array.isArray(aoa) || aoa.length < 2) return [];

  const headers = aoa[0].map((h) =>
    String(h || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
  const out = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!Array.isArray(row)) continue;
    const obj = {};
    let hasAny = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col${c}`;
      const val = row[c];
      if (val !== '' && val !== null && val !== undefined) {
        obj[key] = String(val).trim();
        hasAny = true;
      }
    }
    if (hasAny) out.push(obj);
  }
  return out;
}

async function findExistingInsurer({ code, name }) {
  if (code) {
    const { data } = await supabaseAdmin
      .from('insurers')
      .select('id, company_name, code')
      .ilike('code', String(code).trim())
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  if (name && String(name).trim().length >= 2) {
    const { data: rows } = await supabaseAdmin
      .from('insurers')
      .select('id, company_name, code')
      .ilike('company_name', `%${String(name).trim()}%`)
      .limit(5);
    if (Array.isArray(rows) && rows.length > 0) {
      rows.sort((a, b) => (a.company_name?.length || 0) - (b.company_name?.length || 0));
      return rows[0];
    }
  }
  return null;
}
