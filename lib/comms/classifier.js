// ============================================================
// lib/comms/classifier.js
// ------------------------------------------------------------
// Week 2 classifier + extractor orchestrator.
//
// Exports:
//   classifyMessage({ messageId, triggeredBy })
//     - classify a single inbox_messages row
//   classifyPendingBatch({ limit, triggeredBy })
//     - fetch up to `limit` messages in status='received' with no
//       active classification, classify each in series, return a
//       run summary suitable for writing to classification_runs.
//
// Workflow:
//   1. Load the message + attachment filenames.
//   2. Flip status -> 'classifying' (best-effort; doesn't block).
//   3. Load enabled tag_definitions rows.
//   4. Build prompt -> callAI -> parse JSON.
//   5. Validate tag is a known enum value; clamp confidence to [0,1].
//   6. Insert message_classifications (trigger flips older rows).
//   7. If the returned tag has a non-empty extraction_schema and
//      we have a plumbed extractor, validate & insert
//      extraction_results.
//   8. Flip message status to 'pending_review' (Week 5 will add
//      'auto_routed' when confidence >= auto_route_threshold).
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { wrapCallAI } from './piiMasker';
import { buildClassifyPrompt, parseClassifierJson } from './prompts/classifyPrompt';
import { extractFor } from './extractors';

// Source-of-truth tag list — must mirror the workflow_tag ENUM.
const KNOWN_TAGS = new Set([
  'intimation',
  'surveyor_photos',
  'site_visit_report',
  'insurer_query',
  'settlement_advice',
  'client_followup',
  'policy_doc',
  'internal_admin',
  'unclassified',
]);

// Cache tag_definitions for the lifetime of one cron tick.
let _tagRowCache = null;
let _tagRowCacheAt = 0;
const TAG_ROW_TTL_MS = 60_000; // 1 minute is plenty — cron runs every 5

async function loadTagDefinitions() {
  const now = Date.now();
  if (_tagRowCache && now - _tagRowCacheAt < TAG_ROW_TTL_MS) {
    return _tagRowCache;
  }
  const { data, error } = await supabaseAdmin
    .from('tag_definitions')
    .select('tag, display_label, classifier_prompt, extraction_schema, auto_route_threshold, enabled')
    .eq('enabled', true);
  if (error) throw new Error(`tag_definitions fetch failed: ${error.message}`);
  _tagRowCache = data || [];
  _tagRowCacheAt = now;
  return _tagRowCache;
}

// ------------------------------------------------------------
// classifyMessage({ messageId, triggeredBy })
// ------------------------------------------------------------
export async function classifyMessage({ messageId, triggeredBy = 'auto' }) {
  if (!messageId) return { ok: false, error: 'messageId required' };

  // 1. Load the message.
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, source, from_address, subject, body_plain, company, status')
    .eq('id', messageId)
    .single();
  if (msgErr || !message) {
    return { ok: false, error: `message not found: ${msgErr?.message || 'null'}` };
  }

  // Idempotency: if there's already an active classification, don't
  // spend tokens unless explicitly retried.
  const { data: existing } = await supabaseAdmin
    .from('message_classifications')
    .select('id')
    .eq('message_id', messageId)
    .eq('is_active', true)
    .limit(1);
  if (existing && existing.length > 0 && triggeredBy === 'auto') {
    return { ok: true, skipped: true, reason: 'already_classified', messageId };
  }

  // 2. Attachment filenames (for prompt context).
  const { data: attachments } = await supabaseAdmin
    .from('message_attachments')
    .select('filename, mime_type')
    .eq('message_id', messageId);
  const attachmentFilenames = (attachments || []).map((a) => a.filename).filter(Boolean);

  // 3. Mark message classifying (best-effort).
  await supabaseAdmin
    .from('inbox_messages')
    .update({ status: 'classifying' })
    .eq('id', messageId);

  // 4. Load tag library + build prompt.
  const tagRows = await loadTagDefinitions();
  const { systemPrompt, userMessage } = buildClassifyPrompt({
    tagRows,
    message,
    attachmentFilenames,
  });

  // 5. Call the model. wrapCallAI strips Indian PII (PAN/Aadhaar/mobile)
  // from the system prompt + user message before forwarding to callAI().
  let aiResult;
  try {
    aiResult = await wrapCallAI({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
    });
  } catch (err) {
    await supabaseAdmin
      .from('inbox_messages')
      .update({ status: 'error' })
      .eq('id', messageId);
    return { ok: false, error: `classifier call failed: ${err?.message || err}`, messageId };
  }

  // 6. Parse + normalize.
  let parsed;
  try {
    parsed = parseClassifierJson(aiResult.text);
  } catch (err) {
    await supabaseAdmin
      .from('inbox_messages')
      .update({ status: 'error' })
      .eq('id', messageId);
    return {
      ok: false,
      error: `parse failed: ${err?.message || err}`,
      provider: aiResult.provider,
      messageId,
    };
  }

  let tag = parsed.tag;
  let confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  if (!KNOWN_TAGS.has(tag)) {
    // Unknown tag -> fall back to internal_admin, penalize confidence.
    parsed.reasoning = `[unknown tag "${tag}" returned; coerced to internal_admin] ${parsed.reasoning}`;
    tag = 'internal_admin';
    confidence = Math.min(confidence, 0.3);
  }

  // 7. Insert classification row. The trigger flips older rows to inactive.
  const { data: classification, error: clsErr } = await supabaseAdmin
    .from('message_classifications')
    .insert([{
      message_id: messageId,
      tag,
      confidence: Number(confidence.toFixed(3)),
      classifier_model: aiResult.provider || 'unknown',
      reasoning: parsed.reasoning || null,
      classified_by: triggeredBy === 'auto' ? 'auto' : `manual:${triggeredBy}`,
      is_active: true,
      company: message.company,
    }])
    .select('id')
    .single();

  if (clsErr || !classification) {
    await supabaseAdmin
      .from('inbox_messages')
      .update({ status: 'error' })
      .eq('id', messageId);
    return {
      ok: false,
      error: `classification insert failed: ${clsErr?.message || 'null'}`,
      provider: aiResult.provider,
      messageId,
    };
  }

  // 8. If this tag has an extractor in the registry, run it.
  let extractionRow = null;
  const extractionResult = extractFor(tag, parsed.extracted);
  if (extractionResult) {
    const { data, errors, isValid } = extractionResult;
    const { data: insertedExtraction, error: exErr } = await supabaseAdmin
      .from('extraction_results')
      .insert([{
        message_id: messageId,
        classification_id: classification.id,
        tag,
        extracted_data: data,
        validation_errors: errors,
        is_valid: isValid,
      }])
      .select('id')
      .single();
    if (exErr) {
      console.warn('[comms/classifier] extraction insert failed', messageId, exErr.message);
    } else {
      extractionRow = insertedExtraction;
    }
  }

  // 9. Move the message into pending_review. Week 5 will split this
  // into auto_routed when confidence >= tag's auto_route_threshold.
  await supabaseAdmin
    .from('inbox_messages')
    .update({ status: 'pending_review' })
    .eq('id', messageId);

  return {
    ok: true,
    messageId,
    provider: aiResult.provider,
    tag,
    confidence,
    classificationId: classification.id,
    extractionId: extractionRow?.id || null,
  };
}

// ------------------------------------------------------------
// classifyPendingBatch({ limit, triggeredBy })
// Pulls messages in status='received' with no active classification,
// runs them one at a time, returns a run summary.
// ------------------------------------------------------------
export async function classifyPendingBatch({ limit = 25, triggeredBy = 'auto' } = {}) {
  const summary = {
    attempted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    providerPrimary: null,
    providerFallbackUsed: 0,
    firstError: null,
    perMessage: [],
  };

  // Candidate pool: status='received' AND no active classification.
  // A left-join via RPC isn't available without a view, so we use
  // the NOT EXISTS pattern via two queries.
  const { data: candidates, error: pickErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id')
    .eq('status', 'received')
    .order('received_at', { ascending: true })
    .limit(limit);

  if (pickErr) {
    summary.firstError = `candidate fetch failed: ${pickErr.message}`;
    return summary;
  }
  if (!candidates || candidates.length === 0) return summary;

  // Filter out any that somehow already have an active classification.
  const { data: alreadyClassified } = await supabaseAdmin
    .from('message_classifications')
    .select('message_id')
    .in('message_id', candidates.map((c) => c.id))
    .eq('is_active', true);
  const classifiedSet = new Set((alreadyClassified || []).map((r) => r.message_id));

  for (const { id } of candidates) {
    if (classifiedSet.has(id)) {
      summary.skipped += 1;
      continue;
    }
    summary.attempted += 1;
    try {
      const result = await classifyMessage({ messageId: id, triggeredBy });
      if (result.ok) {
        if (result.skipped) {
          summary.skipped += 1;
        } else {
          summary.successful += 1;
          if (!summary.providerPrimary) summary.providerPrimary = result.provider;
          if (result.provider === 'claude') summary.providerFallbackUsed += 1;
        }
      } else {
        summary.failed += 1;
        if (!summary.firstError) summary.firstError = result.error;
      }
      summary.perMessage.push(result);
    } catch (err) {
      summary.failed += 1;
      const msg = err?.message || String(err);
      if (!summary.firstError) summary.firstError = msg;
      summary.perMessage.push({ ok: false, messageId: id, error: msg });
    }
  }

  return summary;
}
