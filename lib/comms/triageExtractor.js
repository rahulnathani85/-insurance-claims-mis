// ============================================================
// lib/comms/triageExtractor.js
// ------------------------------------------------------------
// Stage 3c — runs the OCR + LLM extraction pipeline on a single
// human-triaged inbox_messages row.
//
// Preconditions (set by /api/communications/triage POST):
//   - inbox_messages.status = 'classifying'
//   - one row in message_classifications with is_active = true,
//     classifier_model = 'human', classified_by = 'manual:<email>'
//
// Pipeline:
//   1. Load message + active human classification + tag definition
//   2. If extraction_schema is empty (e.g. internal_admin):
//        skip OCR/LLM, status -> pending_review, done.
//   3. Run OCR on each attachment (Mistral OCR by default)
//   4. Build extraction prompt with body + OCR text + tag schema
//   5. Call LLM (Claude by default) through the PII masker
//   6. Parse JSON, run per-tag validators (extractFor)
//   7. Insert extraction_results row with extracted_data,
//      validation_errors, is_valid
//   8. Set inbox_messages.status = 'pending_review'
//
// Failure modes:
//   - OCR error on individual attachment: continue with whatever
//     text we got (logged to ai_call_log)
//   - LLM error: status -> 'error', operator can retry via SQL or
//     a future re-extract endpoint
//   - JSON parse error: status -> 'error'
//   - Validation errors: still 'pending_review', validation_errors
//     stored on the extraction_results row for review
//
// All AI calls (OCR + LLM) are recorded in ai_call_log via the
// aiClients layer, so cost dashboards can query that table.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { wrapCallLLM } from './piiMasker';
import { buildExtractPrompt, parseExtractJson } from './prompts/extractPrompt';
import { extractFor } from './extractors';
import { readAttachmentsForMessage } from './attachmentReader';

// Cache tag_definitions for a cron tick (1 min TTL).
let _tagCache = null;
let _tagCachedAt = 0;
const TAG_CACHE_TTL_MS = 60_000;

async function loadTagDefinition(tag) {
  const now = Date.now();
  if (!_tagCache || now - _tagCachedAt > TAG_CACHE_TTL_MS) {
    const { data, error } = await supabaseAdmin
      .from('tag_definitions')
      .select('tag, display_label, classifier_prompt, extraction_schema, auto_route_threshold, enabled');
    if (error) throw new Error(`tag_definitions fetch failed: ${error.message}`);
    _tagCache = (data || []).reduce((acc, row) => {
      acc[row.tag] = row;
      return acc;
    }, {});
    _tagCachedAt = now;
  }
  return _tagCache[tag] || null;
}

// ------------------------------------------------------------
// extractTriagedMessage({ messageId, triggeredBy })
// ------------------------------------------------------------
export async function extractTriagedMessage({ messageId, triggeredBy = 'auto' }) {
  if (!messageId) return { ok: false, error: 'messageId required' };

  // 1. Load message
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, status, company, from_address, subject, body_plain')
    .eq('id', messageId)
    .single();
  if (msgErr || !message) {
    return { ok: false, error: `message not found: ${msgErr?.message || 'null'}` };
  }
  if (message.status !== 'classifying') {
    return { ok: true, skipped: true, reason: `status is '${message.status}', expected 'classifying'`, messageId };
  }

  // 2. Load active classification (must be human-picked)
  const { data: cls, error: clsErr } = await supabaseAdmin
    .from('message_classifications')
    .select('id, tag, classifier_model, classified_by, confidence')
    .eq('message_id', messageId)
    .eq('is_active', true)
    .maybeSingle();
  if (clsErr || !cls) {
    await markError(messageId, 'no active classification found');
    return { ok: false, error: 'no active classification', messageId };
  }
  if (cls.classifier_model !== 'human') {
    // Stage 3 design: only human-triaged messages get extracted via this path.
    // Legacy auto-classifications shouldn't be here, but if one slipped through,
    // skip it cleanly.
    return {
      ok: true,
      skipped: true,
      reason: `classifier_model is '${cls.classifier_model}', not human`,
      messageId,
    };
  }

  // 3. Idempotency: if extraction already exists for this classification, skip.
  const { data: existing } = await supabaseAdmin
    .from('extraction_results')
    .select('id')
    .eq('message_id', messageId)
    .eq('classification_id', cls.id)
    .limit(1);
  if (existing && existing.length > 0) {
    // Move forward — extraction was done; just bump status if still classifying.
    await supabaseAdmin
      .from('inbox_messages')
      .update({ status: 'pending_review' })
      .eq('id', messageId)
      .eq('status', 'classifying');
    return {
      ok: true,
      skipped: true,
      reason: 'extraction already exists',
      messageId,
      extractionId: existing[0].id,
    };
  }

  // 4. Tag definition + schema check
  const tagDef = await loadTagDefinition(cls.tag);
  if (!tagDef) {
    await markError(messageId, `tag definition '${cls.tag}' not found`);
    return { ok: false, error: `tag definition '${cls.tag}' not found`, messageId };
  }

  const schemaKeys = Object.keys(tagDef.extraction_schema || {});
  if (schemaKeys.length === 0) {
    // No fields to extract (e.g. internal_admin). Insert an empty
    // extraction_results row to record that we processed it, then
    // flip to pending_review.
    await supabaseAdmin
      .from('extraction_results')
      .insert([{
        message_id: messageId,
        classification_id: cls.id,
        tag: cls.tag,
        extracted_data: {},
        validation_errors: [],
        is_valid: true,
      }]);
    await supabaseAdmin
      .from('inbox_messages')
      .update({ status: 'pending_review' })
      .eq('id', messageId)
      .eq('status', 'classifying');
    return {
      ok: true,
      messageId,
      tag: cls.tag,
      classificationId: cls.id,
      skippedExtraction: true,
      reason: 'tag has empty extraction_schema',
    };
  }

  // 5. OCR attachments
  let ocrSummary;
  try {
    ocrSummary = await readAttachmentsForMessage({ messageId, triggeredBy });
  } catch (err) {
    // If even the LIST of attachments fails, we still try LLM on the body alone.
    console.warn('[triageExtractor] attachment read failed (continuing with body only):', err?.message);
    ocrSummary = {
      perAttachment: [],
      combinedText: '',
      totalPages: 0,
      totalCostInr: 0,
      skippedCount: 0,
      errorCount: 1,
    };
  }

  // 6. Build prompt
  const attachmentFilenames = (ocrSummary.perAttachment || [])
    .map((a) => a.filename)
    .filter(Boolean);

  const { systemPrompt, userMessage } = buildExtractPrompt({
    tagDef,
    message,
    ocrText: ocrSummary.combinedText,
    attachmentFilenames,
  });

  // 7. Call LLM (PII-masked)
  let llmResult;
  try {
    llmResult = await wrapCallLLM({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
      messageId,
      triggeredBy,
    });
  } catch (err) {
    await markError(messageId, `LLM call failed: ${err?.message || err}`);
    return {
      ok: false,
      error: `LLM call failed: ${err?.message || err}`,
      messageId,
      ocrPages: ocrSummary.totalPages,
      ocrCostInr: ocrSummary.totalCostInr,
    };
  }

  // 8. Parse JSON
  let parsed;
  try {
    parsed = parseExtractJson(llmResult.text);
  } catch (err) {
    await markError(messageId, `parse failed: ${err?.message || err}`);
    return {
      ok: false,
      error: `parse failed: ${err?.message || err}`,
      messageId,
      llmProvider: llmResult.provider,
    };
  }

  // 9. Run per-tag validators (extractFor returns null for unregistered tags)
  const validation = extractFor(cls.tag, parsed);
  const data = validation ? validation.data : parsed;
  const validationErrors = validation ? validation.errors : [];
  const isValid = validation ? validation.isValid : true;

  // 10. Insert extraction_results
  const { data: insertedExt, error: extErr } = await supabaseAdmin
    .from('extraction_results')
    .insert([{
      message_id: messageId,
      classification_id: cls.id,
      tag: cls.tag,
      extracted_data: data,
      validation_errors: validationErrors,
      is_valid: isValid,
    }])
    .select('id')
    .single();
  if (extErr) {
    await markError(messageId, `extraction insert failed: ${extErr.message}`);
    return { ok: false, error: `extraction insert failed: ${extErr.message}`, messageId };
  }

  // 11. Status -> pending_review
  await supabaseAdmin
    .from('inbox_messages')
    .update({ status: 'pending_review' })
    .eq('id', messageId)
    .eq('status', 'classifying');

  return {
    ok: true,
    messageId,
    tag: cls.tag,
    classificationId: cls.id,
    extractionId: insertedExt?.id,
    isValid,
    ocrPages: ocrSummary.totalPages,
    ocrCostInr: Number((ocrSummary.totalCostInr || 0).toFixed(6)),
    llmProvider: llmResult.provider,
    llmModel: llmResult.model,
    llmTokensIn: llmResult.tokensIn,
    llmTokensOut: llmResult.tokensOut,
    llmCostInr: llmResult.costInr,
    redactions: llmResult.redactions,
  };
}

async function markError(messageId, reason) {
  console.warn('[triageExtractor] marking message error:', messageId, reason);
  await supabaseAdmin
    .from('inbox_messages')
    .update({ status: 'error' })
    .eq('id', messageId)
    .eq('status', 'classifying');
}

// ------------------------------------------------------------
// extractPendingBatch({ limit, triggeredBy })
// Picks messages with status='classifying' that have no
// extraction_results yet, runs them in series. Caller is the
// extract-pending cron route.
// ------------------------------------------------------------
export async function extractPendingBatch({ limit = 10, triggeredBy = 'auto' } = {}) {
  const summary = {
    attempted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    totalOcrPages: 0,
    totalCostInr: 0,
    providersUsed: { llm: new Set(), ocr: new Set() },
    firstError: null,
    perMessage: [],
  };

  // Candidate pool: status='classifying' AND human-picked classification
  // AND no extraction_results yet.
  const { data: candidates, error: pickErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, triaged_at')
    .eq('status', 'classifying')
    .order('triaged_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (pickErr) {
    summary.firstError = `candidate fetch failed: ${pickErr.message}`;
    return summary;
  }
  if (!candidates || candidates.length === 0) return summary;

  // Filter out any that already have extraction_results.
  const ids = candidates.map((c) => c.id);
  const { data: existing } = await supabaseAdmin
    .from('extraction_results')
    .select('message_id')
    .in('message_id', ids);
  const doneSet = new Set((existing || []).map((r) => r.message_id));

  for (const { id } of candidates) {
    if (doneSet.has(id)) {
      summary.skipped += 1;
      continue;
    }
    summary.attempted += 1;
    try {
      const r = await extractTriagedMessage({ messageId: id, triggeredBy });
      if (r.ok) {
        if (r.skipped) {
          summary.skipped += 1;
        } else {
          summary.successful += 1;
          if (r.llmProvider) summary.providersUsed.llm.add(r.llmProvider);
          summary.totalOcrPages += r.ocrPages || 0;
          summary.totalCostInr +=
            (r.llmCostInr || 0) + (r.ocrCostInr || 0);
        }
      } else {
        summary.failed += 1;
        if (!summary.firstError) summary.firstError = r.error;
      }
      summary.perMessage.push(r);
    } catch (err) {
      summary.failed += 1;
      const msg = err?.message || String(err);
      if (!summary.firstError) summary.firstError = msg;
      summary.perMessage.push({ ok: false, messageId: id, error: msg });
    }
  }

  // Set→Array for JSON-friendly summary.
  summary.providersUsed.llm = [...summary.providersUsed.llm];
  summary.providersUsed.ocr = [...summary.providersUsed.ocr];
  summary.totalCostInr = Number(summary.totalCostInr.toFixed(6));

  return summary;
}
