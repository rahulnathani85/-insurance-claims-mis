// =============================================================================
// /api/insurers/agent/lookup-by-name
// =============================================================================
// POST { name: string } -> AI-extracted insurer profile + offices.
//
// The model has no document evidence in this mode — just its prior knowledge —
// so the prompt forbids 'high' confidences and the response is treated as a
// hint, not a source of truth. The Review screen makes the user confirm
// every field before commit.
//
// Response (200):
//   {
//     insurer:           { ...10 fields... },
//     offices:           [ {office_code,name,city,state,address,parent_name}, ... ],
//     field_confidences: { "insurer.<field>"|"offices[i].<field>": 'high'|'medium'|'low' },
//     extraction_notes:  string|null,
//     existing_match:    { id, company_name } | null,   // pre-existing record we found by name/code
//     llm:               { provider, model, latencyMs, costInr }
//   }
//
// 4xx — bad input. 5xx — LLM failure. Both still log to ai_call_log via callLLM.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { callLLM } from '@/lib/aiClients';
import { buildLookupPrompt, parseInsurerJson } from '@/lib/insurerAgent/extractor';
import { assessConfidence } from '@/lib/insurerAgent/confidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const name = String(body?.name || '').trim();
  if (name.length < 2) {
    return NextResponse.json(
      { error: 'name must be at least 2 characters' },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // 1. Pre-flight existing-match check. Cheap; runs in parallel with the LLM
  //    call would be nicer, but we want the LLM-extracted `code` to feed the
  //    second match attempt — so do match now (by typed name) and the
  //    extractor's own code below.
  // -------------------------------------------------------------------------
  const existingByTypedName = await findExistingInsurer({ name });

  // -------------------------------------------------------------------------
  // 2. LLM extraction.
  // -------------------------------------------------------------------------
  const { systemPrompt, userMessage } = buildLookupPrompt({ mode: 'name', name });

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

  // -------------------------------------------------------------------------
  // 3. Confidence overrides. The model rated each field; our heuristics
  //    promote/demote based on checkable facts (GSTIN checksum, pin format,
  //    pin↔state agreement, email format, etc).
  // -------------------------------------------------------------------------
  parsed.field_confidences = assessConfidence(parsed.insurer, parsed.field_confidences);

  // -------------------------------------------------------------------------
  // 4. Second-pass existing-match check (now we have a code from the LLM).
  // -------------------------------------------------------------------------
  let existingMatch = existingByTypedName;
  if (!existingMatch && parsed.insurer?.code) {
    existingMatch = await findExistingInsurer({ code: parsed.insurer.code });
  }
  if (!existingMatch && parsed.insurer?.company_name) {
    existingMatch = await findExistingInsurer({ name: parsed.insurer.company_name });
  }

  return NextResponse.json({
    insurer: parsed.insurer,
    offices: parsed.offices,
    field_confidences: parsed.field_confidences,
    extraction_notes: parsed.extraction_notes || null,
    existing_match: existingMatch,
    llm: {
      provider: llmResult.provider,
      model: llmResult.model,
      latencyMs: llmResult.latencyMs,
      costInr: llmResult.costInr,
    },
  });
}

// ---------------------------------------------------------------------------
// findExistingInsurer({ name?, code? })
// Returns { id, company_name, code } | null. Case-insensitive on both fields.
// ---------------------------------------------------------------------------
async function findExistingInsurer({ name, code }) {
  if (code) {
    const { data: byCode } = await supabaseAdmin
      .from('insurers')
      .select('id, company_name, code')
      .ilike('code', code.trim())
      .limit(1)
      .maybeSingle();
    if (byCode) return byCode;
  }
  if (name) {
    const term = name.trim();
    if (term.length < 2) return null;
    // Substring match on company_name. Pick the shortest match (most likely
    // exact) when there are multiples.
    const { data: rows } = await supabaseAdmin
      .from('insurers')
      .select('id, company_name, code')
      .ilike('company_name', `%${term}%`)
      .limit(5);
    if (Array.isArray(rows) && rows.length > 0) {
      rows.sort((a, b) => (a.company_name?.length || 0) - (b.company_name?.length || 0));
      return rows[0];
    }
  }
  return null;
}
