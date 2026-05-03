// =============================================================================
// /api/ai/claim-chat/apply
// =============================================================================
// Slice 7 — applies one proposed change from a chat assistant message.
//
// POST { message_id, change_index, decision: 'accepted' | 'rejected', user_email? }
//
// Looks up the chat message, picks the proposedChanges[change_index] item,
// and:
//
//   - decision='accepted':
//       Routes the change to the right write path based on its `type`:
//
//         field       → claim columns. Goes through
//                       lib/provenance/dualWrite so the change carries
//                       proper source metadata + appears in the ledger.
//                       The provenance source is stamped as
//                       type='ai', documentType='claim_chat',
//                       extractedBy='ai:claim-chat:<provider>'.
//
//         narrative   → claim_fsr_drafts.narrative_jsonb of the latest
//                       non-approved draft. The render endpoint will
//                       pick this up on the next render. Maps the
//                       AI-pack section names (causeOfLoss /
//                       surveyObservations / etc.) to the portal's
//                       narrative_jsonb keys (cause_of_loss /
//                       observations / etc.).
//
//         computation → marine_loss_sheets row for Marine claims;
//                       loss_sheets row for Fire / others. Updates
//                       the named field; does NOT recompute downstream
//                       totals (surveyor must hit the loss-sheet form
//                       to refresh those).
//
//         annexure    → not yet implemented; marks the apply as
//                       rejected with reason 'annexure changes are
//                       a Phase 2 feature' so the UI knows.
//
//   - decision='rejected':
//       Just marks the slot as rejected, no DB writes apart from the
//       message's applied_changes log.
//
// Either way, updates claim_chat_messages.applied_changes so the UI
// remembers the user's choice.
//
// Errors:
//   400 bad request, 404 message not found / index out of range,
//   500 write failure (the change is logged with status='accepted'
//   plus an error string so the UI can surface it).
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { dualWriteClaimFields, PROVENANCE_MANAGED_FIELDS } from '@/lib/provenance/dualWrite';
import { captureError } from '@/lib/observability';
import { requireSurveyorRequest } from '@/lib/auth/insurer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NARRATIVE_KEY_MAP = {
  causeOfLoss:        'cause_of_loss',
  surveyObservations: 'observations',
  policyAdmissibility: 'policy_admissibility',
  recommendation:     'recommendation',
};

const MARINE_LOBS = new Set(['Marine Cargo', 'Marine Hull']);

export async function POST(request) {
  // Phase 2 mutation guard
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const messageId = body?.message_id;
  const changeIndex = Number.isInteger(body?.change_index) ? body.change_index : null;
  const decision = body?.decision;
  const userEmail = typeof body?.user_email === 'string' ? body.user_email.trim() : null;

  if (!messageId) return NextResponse.json({ error: 'message_id is required' }, { status: 400 });
  if (changeIndex === null || changeIndex < 0) {
    return NextResponse.json({ error: 'change_index (non-negative integer) is required' }, { status: 400 });
  }
  if (decision !== 'accepted' && decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be "accepted" or "rejected"' }, { status: 400 });
  }

  // ---- Load the chat message + the change ----
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('claim_chat_messages')
    .select('id, claim_id, role, proposed_changes, applied_changes, ai_provider')
    .eq('id', messageId)
    .single();
  if (msgErr || !msg) return NextResponse.json({ error: 'Chat message not found' }, { status: 404 });

  const proposed = Array.isArray(msg.proposed_changes) ? msg.proposed_changes : [];
  if (changeIndex >= proposed.length) {
    return NextResponse.json({ error: 'change_index out of range' }, { status: 404 });
  }
  const change = proposed[changeIndex];

  // Already applied? Idempotent — return current state without redoing.
  const existingApplied = Array.isArray(msg.applied_changes) ? msg.applied_changes : [];
  const previous = existingApplied.find((a) => a.index === changeIndex);
  if (previous) {
    return NextResponse.json({ ok: true, change, applied: previous, alreadyApplied: true });
  }

  // ---- Apply (or skip if rejected) ----
  let applyError = null;
  if (decision === 'accepted') {
    try {
      await applyChange(msg.claim_id, change, { userEmail, aiProvider: msg.ai_provider });
    } catch (e) {
      applyError = e.message;
      captureError(e, {
        area: 'claim-chat-apply',
        claim_id: msg.claim_id,
        message_id: messageId,
        change_index: changeIndex,
        change_type: change?.type,
      });
    }
  }

  // ---- Append to applied_changes log ----
  const log = {
    index: changeIndex,
    status: applyError ? 'accepted_failed' : decision,
    applied_at: new Date().toISOString(),
    applied_by: userEmail,
    error: applyError,
  };
  const nextApplied = [...existingApplied, log];

  const { error: updateErr } = await supabaseAdmin
    .from('claim_chat_messages')
    .update({ applied_changes: nextApplied })
    .eq('id', messageId);
  if (updateErr) {
    captureError(updateErr, { area: 'claim-chat-apply-log', message_id: messageId });
  }

  if (applyError) {
    return NextResponse.json({ ok: false, error: applyError, change, applied: log }, { status: 500 });
  }
  return NextResponse.json({ ok: true, change, applied: log });
}

// -----------------------------------------------------------------------------
// applyChange — the actual write. Throws on failure so the caller logs.
// -----------------------------------------------------------------------------
async function applyChange(claimId, change, { userEmail, aiProvider }) {
  if (!change || typeof change !== 'object') throw new Error('change is empty');
  const type = change.type;

  switch (type) {
    case 'field':
      return applyFieldChange(claimId, change, { userEmail, aiProvider });
    case 'narrative':
      return applyNarrativeChange(claimId, change);
    case 'computation':
      return applyComputationChange(claimId, change);
    case 'annexure':
      throw new Error('annexure changes are a Phase 2 feature; record as a manual issue instead');
    default:
      throw new Error(`unknown proposed-change type: ${type}`);
  }
}

// -----------------------------------------------------------------------------
// applyFieldChange — provenance-managed field via dualWrite
// -----------------------------------------------------------------------------
async function applyFieldChange(claimId, change, { userEmail, aiProvider }) {
  const path = String(change.path || '').trim();
  if (!path) throw new Error('field change requires `path`');

  // The chat prompt uses dotted paths from the AI-pack JSON (e.g.
  // "marine.causeOfLoss" or "computation.netAdjustedLoss"). Translate
  // common ones back to the portal's flat claims-row column names.
  const column = mapPathToClaimColumn(path);
  if (!column) {
    throw new Error(`field change path "${path}" doesn't map to a known portal column`);
  }
  if (!PROVENANCE_MANAGED_FIELDS.includes(column)) {
    throw new Error(`column "${column}" is not provenance-managed`);
  }

  const result = await dualWriteClaimFields(supabaseAdmin, claimId, { [column]: change.newValue }, {
    type: 'ai',
    documentType: 'claim_chat',
    label: 'AI co-pilot proposed change accepted via chat',
    extractedBy: `ai:claim-chat:${aiProvider || 'unknown'}`,
    confidence: typeof change.confidence === 'number' ? change.confidence : 0.7,
    capturedBy: userEmail,
  });

  // dualWriteClaimFields returns per-field results — surface a useful error
  // if the single field we wrote didn't take.
  const fieldResult = (result?.provenance || []).find((p) => p.field_name === column);
  if (fieldResult?.error) throw new Error(`provenance write: ${fieldResult.error}`);
}

// -----------------------------------------------------------------------------
// applyNarrativeChange — patch claim_fsr_drafts.narrative_jsonb
// -----------------------------------------------------------------------------
async function applyNarrativeChange(claimId, change) {
  const sectionRaw = String(change.section || '').trim();
  if (!sectionRaw) throw new Error('narrative change requires `section`');
  const section = NARRATIVE_KEY_MAP[sectionRaw] || sectionRaw;
  const value = String(change.newValue || '');

  // Find the latest non-approved draft. If none exists, refuse — the
  // surveyor must render once first.
  const { data: latest } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('id, status, narrative_jsonb, version_number')
    .eq('claim_id', claimId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) throw new Error('no FSR draft exists yet — render one before applying narrative changes');
  if (latest.status === 'approved' || latest.status === 'superseded') {
    throw new Error(`latest draft is ${latest.status}; create a new version before applying narrative changes`);
  }

  const nextNarrative = { ...(latest.narrative_jsonb || {}), [section]: value };
  const { error } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .update({ narrative_jsonb: nextNarrative })
    .eq('id', latest.id);
  if (error) throw new Error('narrative_jsonb update failed: ' + error.message);
}

// -----------------------------------------------------------------------------
// applyComputationChange — patch the appropriate loss-sheet row
// -----------------------------------------------------------------------------
async function applyComputationChange(claimId, change) {
  const path = String(change.path || '').trim();
  if (!path) throw new Error('computation change requires `path` (e.g. "computation.grossLoss")');
  const value = Number(change.newValue);
  if (!Number.isFinite(value)) throw new Error('computation change `newValue` must be numeric');

  const { data: claim } = await supabaseAdmin.from('claims').select('lob').eq('id', claimId).maybeSingle();
  if (!claim) throw new Error('claim not found');

  const isMarine = MARINE_LOBS.has(claim.lob);
  const table = isMarine ? 'marine_loss_sheets' : 'loss_sheets';

  // Map AI-pack computation paths → portal column names.
  const column = mapComputationPathToColumn(path, isMarine);
  if (!column) throw new Error(`unknown computation path: ${path}`);

  // Find the loss-sheet row for the claim (1:1 by claim_id).
  const { data: sheet } = await supabaseAdmin
    .from(table)
    .select('id')
    .eq('claim_id', claimId)
    .maybeSingle();
  if (!sheet) {
    throw new Error(`no ${table} row exists for this claim — create the loss sheet first`);
  }

  const { error } = await supabaseAdmin
    .from(table)
    .update({ [column]: value })
    .eq('id', sheet.id);
  if (error) throw new Error(`${table}.${column} update failed: ${error.message}`);
}

// -----------------------------------------------------------------------------
// path → column mappings
// -----------------------------------------------------------------------------

function mapPathToClaimColumn(path) {
  // Direct claims-column paths (the chat prompt sometimes returns these)
  const direct = [
    'insured_name', 'insurer_name', 'policy_number',
    'date_loss', 'date_of_intimation', 'policy_period_from', 'policy_period_to',
    'lob', 'loss_location', 'sum_insured', 'gross_loss', 'estimated_loss_amount',
  ];
  if (direct.includes(path)) return path;

  // AI-pack dotted paths
  const map = {
    'claimNo':                    'claim_number',
    'insurer':                    'insurer_name',
    'insured':                    'insured_name',
    'placeOfLoss':                'loss_location',
    'dateOfLoss':                 'date_loss',
    'dateOfIntimation':           'date_of_intimation',
    'policy.policyNo':            'policy_number',
    'policy.fromDate':            'policy_period_from',
    'policy.toDate':              'policy_period_to',
    'policy.sumInsured':          'sum_insured',
    'marine.causeOfLoss':         null,  // narrative — not a column
    'computation.grossLoss':      'gross_loss',
  };
  return map[path] || null;
}

function mapComputationPathToColumn(path, isMarine) {
  const common = {
    'computation.grossLoss':         isMarine ? 'after_handling_total' : 'gross_loss',
    'computation.netAdjustedLoss':   isMarine ? 'net_adjusted_loss' : 'net_payable',
    'computation.lessSalvage':       isMarine ? 'salvage_amount' : 'total_salvage',
    'computation.lessExcess':        'excess_amount',
  };
  return common[path] || null;
}
