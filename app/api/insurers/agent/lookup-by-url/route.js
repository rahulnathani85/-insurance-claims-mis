// =============================================================================
// /api/insurers/agent/lookup-by-url
// =============================================================================
// POST { url: string } -> AI-extracted insurer profile + offices, scoped to
// what's actually on the page.
//
// Behaviour:
//   - Fetch URL with a 10-second hard timeout (AbortController) and a 1 MB
//     response cap (we don't need the whole site, just the visible HTML).
//   - Strip <script>, <style>, <noscript>, <svg>, <iframe>, then collapse
//     whitespace. The result is the "page text" passed to the model.
//   - Same JSON shape as /lookup-by-name.
//
// Per spec, this is intentionally a generic URL endpoint — no IRDAI
// auto-scrape. The user pastes whichever page they trust.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { callLLM } from '@/lib/aiClients';
import { buildLookupPrompt, parseInsurerJson } from '@/lib/insurerAgent/extractor';
import { assessConfidence } from '@/lib/insurerAgent/confidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024; // 1 MB

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const url = String(body?.url || '').trim();
  if (!isHttpUrl(url)) {
    return NextResponse.json(
      { error: 'url must be an absolute http(s) URL' },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // 1. Fetch HTML with timeout + size cap.
  // -------------------------------------------------------------------------
  let pageText = '';
  try {
    pageText = await fetchAndStrip(url);
  } catch (err) {
    return NextResponse.json(
      { error: `fetch failed: ${err?.message || err}` },
      { status: 502 }
    );
  }

  if (pageText.trim().length === 0) {
    return NextResponse.json(
      { error: 'URL returned no readable content' },
      { status: 422 }
    );
  }

  // -------------------------------------------------------------------------
  // 2. LLM extraction with the page text as evidence.
  // -------------------------------------------------------------------------
  const { systemPrompt, userMessage } = buildLookupPrompt({
    mode: 'url',
    url,
    htmlText: pageText,
  });

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
    source_url: url,
    page_chars: pageText.length,
    llm: {
      provider: llmResult.provider,
      model: llmResult.model,
      latencyMs: llmResult.latencyMs,
      costInr: llmResult.costInr,
    },
  });
}

// ---------------------------------------------------------------------------
// fetchAndStrip(url) -> string
// AbortController-bound fetch + script/style stripping + whitespace collapse.
// Throws on network error or non-2xx status.
// ---------------------------------------------------------------------------
async function fetchAndStrip(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some IRDAI / insurer sites refuse the default Node UA.
        'User-Agent':
          'Mozilla/5.0 (compatible; NISLA-Insurer-Agent/1.0; +https://portal.nisla.in)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  // Read up to MAX_RESPONSE_BYTES.
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return stripHtml(text.slice(0, MAX_RESPONSE_BYTES));
  }
  const decoder = new TextDecoder();
  let received = 0;
  let raw = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      // Truncate to cap; abort the rest.
      raw += decoder.decode(value);
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  return stripHtml(raw);
}

function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')          // strip remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isHttpUrl(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
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

