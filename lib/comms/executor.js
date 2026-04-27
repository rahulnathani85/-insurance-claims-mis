// ============================================================
// lib/comms/executor.js
// ------------------------------------------------------------
// Stage 5 — Auto-routing engine.
//
// Takes a single inbox_messages row that has:
//   - status = 'pending_review'
//   - is_valid extraction_result
//   - classification confidence >= tag.auto_route_threshold
//
// Iterates the tag's routing_actions array and dispatches each
// action. Writes one routing_executions row per action, then
// sets inbox_messages.status = 'auto_routed'.
//
// If the guards are not met (below threshold, invalid extraction)
// the function returns { ok: true, skipped: true }. The message
// stays in pending_review for the human review queue.
//
// Exported:
//   executeRouting(messageId)  — single message
//   routePendingBatch({ limit, triggeredBy })  — cron batch
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { recordPortalActivity } from './auditLog';
import { captureError } from '@/lib/observability';
import { generateReplyDraft } from './replyGenerator';

// Tag cache (1-min TTL).
let _tagCache = null;
let _tagCachedAt = 0;
const TAG_CACHE_TTL_MS = 60_000;

async function getTagDefs() {
  const now = Date.now();
  if (!_tagCache || now - _tagCachedAt > TAG_CACHE_TTL_MS) {
    const { data, error } = await supabaseAdmin
      .from('tag_definitions')
      .select('tag, auto_route_threshold, routing_actions, extraction_schema');
    if (error) throw new Error(`tag_definitions fetch failed: ${error.message}`);
    _tagCache = Object.fromEntries((data || []).map((r) => [r.tag, r]));
    _tagCachedAt = now;
  }
  return _tagCache;
}

// ------------------------------------------------------------------
// Claim resolution helpers
// ------------------------------------------------------------------

async function lookupClaimByRef(refText, company) {
  if (!refText) return null;
  const clean = String(refText).trim();

  // Try exact match first.
  const { data: exact } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, lob, status, company')
    .eq('ref_number', clean)
    .maybeSingle();
  if (exact) return exact;

  // Try case-insensitive prefix (e.g. extracted "CLM/2025/001" vs stored "CLM/2025/001").
  const { data: fuzzy } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, lob, status, company')
    .ilike('ref_number', `%${clean}%`)
    .eq('company', company)
    .limit(1);
  return fuzzy?.[0] || null;
}

async function lookupClaimByPolicy(policyNo, company) {
  if (!policyNo) return null;
  const { data } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, lob, status, company')
    .ilike('policy_number', `%${String(policyNo).trim()}%`)
    .eq('company', company)
    .limit(1);
  return data?.[0] || null;
}

async function resolveClaimFromExtraction(extractedData, company) {
  if (!extractedData) return null;
  const claimRef = extractedData.claim_ref || extractedData.claim_number;
  const policyNo = extractedData.policy_no || extractedData.policy_number;

  const byRef = await lookupClaimByRef(claimRef, company);
  if (byRef) return byRef;
  return await lookupClaimByPolicy(policyNo, company);
}

// ------------------------------------------------------------------
// Action handlers
// ------------------------------------------------------------------

async function actionLinkToClaim({ message, claim, payload }) {
  if (!claim) return { status: 'skipped', error: 'no matching claim found' };
  await supabaseAdmin
    .from('inbox_messages')
    .update({ claim_id: claim.id })
    .eq('id', message.id);
  return { status: 'success', payload: { claim_id: claim.id, ref_number: claim.ref_number } };
}

async function actionCreateClaim({ message, extractedData }) {
  const lob = extractedData.lob || 'general';
  const company = message.company || 'NISLA';

  const newClaim = {
    lob,
    company,
    insured_name: extractedData.insured_name || null,
    policy_number: extractedData.policy_no || null,
    date_loss: extractedData.date_of_loss || null,
    loss_location: extractedData.location || null,
    // claim_status remains 'registered' for compatibility with the
    // legacy status filter on the claims list. Lifecycle phase is the
    // new field that distinguishes a freshly intimated claim from a
    // formally registered one — it always starts at 'intimation' for
    // claims auto-created by the comms pipeline.
    claim_status: 'registered',
    phase: 'intimation',
    source: 'comms_auto',
  };

  const { data: created, error } = await supabaseAdmin
    .from('claims')
    .insert([newClaim])
    .select('id, ref_number')
    .single();
  if (error) return { status: 'failed', error: `create_claim insert failed: ${error.message}` };

  // Link inbox_message to the newly created claim.
  await supabaseAdmin
    .from('inbox_messages')
    .update({ claim_id: created.id })
    .eq('id', message.id);

  return { status: 'success', payload: { claim_id: created.id, ref_number: created.ref_number, created: true } };
}

async function actionUpdateSettlement({ message, claim, extractedData }) {
  if (!claim) return { status: 'skipped', error: 'no matching claim found' };

  const updates = {};
  if (extractedData.settled_amount) updates.settled_amount = extractedData.settled_amount;
  if (extractedData.settlement_date) updates.settlement_date = extractedData.settlement_date;
  if (extractedData.mode_of_payment) updates.settlement_mode = extractedData.mode_of_payment;
  if (Object.keys(updates).length === 0) {
    return { status: 'skipped', error: 'no settlement fields in extraction' };
  }

  const { error } = await supabaseAdmin
    .from('claims')
    .update(updates)
    .eq('id', claim.id);
  if (error) return { status: 'failed', error: error.message };
  return { status: 'success', payload: { claim_id: claim.id, updates } };
}

async function actionMarkClaimClosed({ claim }) {
  if (!claim) return { status: 'skipped', error: 'no matching claim found' };
  await supabaseAdmin
    .from('claims')
    .update({ claim_status: 'closed' })
    .eq('id', claim.id);
  return { status: 'success', payload: { claim_id: claim.id } };
}

async function actionAttachPhotosToClaim({ message, claim, attachments }) {
  if (!claim) return { status: 'skipped', error: 'no matching claim found' };
  if (!attachments || attachments.length === 0) {
    return { status: 'skipped', error: 'no attachments to attach' };
  }

  const rows = attachments
    .filter((a) => a.is_image || a.mime_type?.startsWith('image/'))
    .map((a) => ({
      claim_id: claim.id,
      ref_number: claim.ref_number || null,
      file_name: a.filename || 'attachment',
      file_type: 'survey_photo',
      mime_type: a.mime_type || null,
      file_size: a.size_bytes || null,
      storage_path: a.storage_path || null,
      source: 'gmail',
      gmail_message_id: message.source_msg_id || null,
      gmail_from: message.from_address || null,
      company: claim.company || message.company || 'NISLA',
    }));

  if (rows.length === 0) return { status: 'skipped', error: 'no image attachments found' };

  const { error } = await supabaseAdmin.from('claim_documents').insert(rows);
  if (error) return { status: 'failed', error: error.message };
  return { status: 'success', payload: { claim_id: claim.id, attached_count: rows.length } };
}

async function actionDraftReply({ message, claim, extractedData }) {
  if (!message?.from_address) {
    return { status: 'skipped', error: 'no from_address — cannot draft a reply' };
  }

  // Idempotency: if a draft already exists for this message, don't generate another.
  const { data: existing } = await supabaseAdmin
    .from('email_drafts')
    .select('id')
    .eq('message_id', message.id)
    .neq('status', 'discarded')
    .maybeSingle();
  if (existing) {
    return { status: 'skipped', error: 'draft already exists', payload: { draft_id: existing.id } };
  }

  // Pull active classification tag (executor already loaded it but we
  // don't pass it to handlers; fetch quickly here).
  const { data: cls } = await supabaseAdmin
    .from('message_classifications')
    .select('tag')
    .eq('message_id', message.id)
    .eq('is_active', true)
    .maybeSingle();
  const tag = cls?.tag || 'default';

  try {
    const draft = await generateReplyDraft({
      message,
      tag,
      extractedData: extractedData || {},
      claim,
      triggeredBy: 'auto',
    });
    return { status: 'success', payload: draft };
  } catch (err) {
    return { status: 'failed', error: err?.message || String(err) };
  }
}

async function actionFileToClaimFolder({ message, claim, attachments }) {
  if (!claim) return { status: 'skipped', error: 'no matching claim found' };
  if (!attachments || attachments.length === 0) {
    return { status: 'skipped', error: 'no attachments' };
  }

  const rows = attachments.map((a) => ({
    claim_id: claim.id,
    ref_number: claim.ref_number || null,
    file_name: a.filename || 'attachment',
    file_type: 'other',
    mime_type: a.mime_type || null,
    file_size: a.size_bytes || null,
    storage_path: a.storage_path || null,
    source: 'gmail',
    gmail_message_id: message.source_msg_id || null,
    gmail_from: message.from_address || null,
    company: claim.company || message.company || 'NISLA',
  }));

  const { error } = await supabaseAdmin.from('claim_documents').insert(rows);
  if (error) return { status: 'failed', error: error.message };
  return { status: 'success', payload: { claim_id: claim.id, filed_count: rows.length } };
}

// Dispatch table — maps routing_action string → handler.
const HANDLERS = {
  link_to_claim:            actionLinkToClaim,
  create_claim:             actionCreateClaim,
  update_claim_settlement:  actionUpdateSettlement,
  mark_claim_closed:        actionMarkClaimClosed,
  attach_photos_to_claim:   actionAttachPhotosToClaim,
  file_to_claim_folder:     actionFileToClaimFolder,
  // Acknowledge-only actions: nothing to execute server-side yet.
  assign_surveyor:          async () => ({ status: 'skipped', error: 'not implemented' }),
  send_email:               async () => ({ status: 'skipped', error: 'not implemented' }),
  notify_whatsapp:          async () => ({ status: 'skipped', error: 'not implemented' }),
  draft_reply:              actionDraftReply,
  set_claim_flag:           async () => ({ status: 'skipped', error: 'not implemented' }),
  log_in_crm:               async () => ({ status: 'skipped', error: 'not implemented' }),
  route_to_assigned_surveyor: async () => ({ status: 'skipped', error: 'not implemented' }),
  run_vision_captioning:    async () => ({ status: 'skipped', error: 'not implemented' }),
  update_claim_gallery:     async () => ({ status: 'skipped', error: 'not implemented' }),
  extract_policy_fields_to_db: async () => ({ status: 'skipped', error: 'not implemented' }),
  cross_link_to_intimation: async () => ({ status: 'skipped', error: 'not implemented' }),
  archive_pdf_to_claim_folder: async () => ({ status: 'skipped', error: 'not implemented' }),
  trigger_fee_invoice:      async () => ({ status: 'skipped', error: 'not implemented' }),
  archive_email:            async () => ({ status: 'skipped', error: 'not implemented' }),
  generate_summary:         async () => ({ status: 'skipped', error: 'not implemented' }),
  file_under_internal:      async () => ({ status: 'skipped', error: 'not implemented' }),
};

// ------------------------------------------------------------------
// Core: executeRouting(messageId)
// ------------------------------------------------------------------
export async function executeRouting(messageId, { triggeredBy = 'auto' } = {}) {
  if (!messageId) return { ok: false, error: 'messageId required' };

  // Load message.
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, status, company, from_address, from_display, subject, source_msg_id, claim_id')
    .eq('id', messageId)
    .single();
  if (msgErr || !message) {
    return { ok: false, error: `message not found: ${msgErr?.message}` };
  }
  if (message.status !== 'pending_review') {
    return { ok: true, skipped: true, reason: `status is '${message.status}', expected 'pending_review'`, messageId };
  }

  // Load active classification.
  const { data: cls } = await supabaseAdmin
    .from('message_classifications')
    .select('id, tag, confidence')
    .eq('message_id', messageId)
    .eq('is_active', true)
    .maybeSingle();
  if (!cls) {
    return { ok: true, skipped: true, reason: 'no active classification', messageId };
  }

  // Load extraction result.
  const { data: ext } = await supabaseAdmin
    .from('extraction_results')
    .select('id, is_valid, extracted_data')
    .eq('message_id', messageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Guard: must have valid extraction.
  if (!ext || !ext.is_valid) {
    return { ok: true, skipped: true, reason: 'extraction invalid or missing', messageId };
  }

  // Guard: must meet confidence threshold.
  const tagDefs = await getTagDefs();
  const tagDef = tagDefs[cls.tag];
  const threshold = tagDef?.auto_route_threshold ?? 1.0;
  if ((cls.confidence || 0) < threshold) {
    return {
      ok: true,
      skipped: true,
      reason: `confidence ${cls.confidence} < threshold ${threshold}`,
      messageId,
    };
  }

  // Load attachments (needed by some actions).
  const { data: attachments } = await supabaseAdmin
    .from('message_attachments')
    .select('id, filename, mime_type, size_bytes, is_image, storage_path')
    .eq('message_id', messageId);

  // Resolve claim from extracted data.
  const extractedData = ext.extracted_data || {};
  const claim = await resolveClaimFromExtraction(extractedData, message.company);

  // Execute routing actions.
  const routingActions = tagDef?.routing_actions || [];
  const execResults = [];
  let resolvedClaimId = message.claim_id || claim?.id || null;

  for (const actionType of routingActions) {
    const handler = HANDLERS[actionType];
    if (!handler) {
      execResults.push({ actionType, status: 'skipped', error: 'unknown action' });
      continue;
    }

    let result;
    try {
      result = await handler({
        message,
        claim,
        extractedData,
        attachments: attachments || [],
        payload: {},
      });
    } catch (err) {
      captureError(err, {
        area: 'comms-executor',
        action_type: actionType,
        message_id: messageId,
        tag: cls.tag,
        company: message.company,
      });
      result = { status: 'failed', error: err?.message || String(err) };
    }

    // Capture any claim_id from action result.
    if (result.payload?.claim_id) {
      resolvedClaimId = result.payload.claim_id;
    }

    execResults.push({ actionType, ...result });

    // Insert routing_executions row.
    await supabaseAdmin.from('routing_executions').insert([{
      message_id: messageId,
      action_type: actionType,
      claim_id: result.payload?.claim_id || claim?.id || null,
      payload: result.payload || null,
      status: result.status,
      error: result.error || null,
    }]);
  }

  // Mark message as auto_routed.
  await supabaseAdmin
    .from('inbox_messages')
    .update({
      status: 'auto_routed',
      claim_id: resolvedClaimId || null,
    })
    .eq('id', messageId)
    .eq('status', 'pending_review');

  // Activity log.
  await recordPortalActivity({
    action: 'comms_auto_routed',
    entity_type: 'inbox_message',
    details: {
      message_id: messageId,
      tag: cls.tag,
      confidence: cls.confidence,
      claim_id: resolvedClaimId,
      actions_executed: execResults.length,
    },
    company: message.company || 'NISLA',
  });

  return {
    ok: true,
    messageId,
    tag: cls.tag,
    confidence: cls.confidence,
    claimId: resolvedClaimId,
    actionsExecuted: execResults.length,
    results: execResults,
  };
}

// ------------------------------------------------------------------
// Batch: routePendingBatch({ limit, triggeredBy })
// ------------------------------------------------------------------
export async function routePendingBatch({ limit = 20, triggeredBy = 'auto' } = {}) {
  const summary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    firstError: null,
    perMessage: [],
  };

  // Candidates: pending_review messages with a valid extraction and active classification.
  const { data: candidates, error: pickErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id')
    .eq('status', 'pending_review')
    .order('received_at', { ascending: true })
    .limit(limit);

  if (pickErr) {
    summary.firstError = `candidate fetch failed: ${pickErr.message}`;
    return summary;
  }
  if (!candidates || candidates.length === 0) return summary;

  // Filter to those that actually have a valid is_valid extraction.
  const ids = candidates.map((c) => c.id);
  const { data: validExts } = await supabaseAdmin
    .from('extraction_results')
    .select('message_id')
    .in('message_id', ids)
    .eq('is_valid', true);
  const validSet = new Set((validExts || []).map((r) => r.message_id));

  for (const { id } of candidates) {
    if (!validSet.has(id)) {
      summary.skipped += 1;
      continue;
    }
    summary.attempted += 1;
    try {
      const r = await executeRouting(id, { triggeredBy });
      if (r.ok && r.skipped) {
        summary.skipped += 1;
      } else if (r.ok) {
        summary.succeeded += 1;
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

  return summary;
}
