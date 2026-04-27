// ============================================================
// /api/communications/messages/[id]/revert
// ------------------------------------------------------------
// Admin-only. Reverses the triage / extraction / routing
// pipeline on a single message and puts it back in the Triage
// queue (status='received'), so the user can re-categorise.
//
// What this does:
//   - Marks every active message_classifications row inactive.
//   - Clears inbox_messages.claim_id, triaged_by/at,
//     dismissed_by/at, dismiss_reason.
//   - Sets status back to 'received'.
//   - Records the reversal in activity_log so we have an
//     audit trail.
//
// What this does NOT do (intentionally):
//   - Delete claims that were created via create_claim.
//   - Roll back update_claim_settlement / mark_claim_closed
//     side-effects on the claims table.
//   - Delete claim_documents created via attach_photos /
//     file_to_claim_folder.
//
// The response surfaces those side-effects so the admin knows
// what manual cleanup may still be required.
//
// POST body: { reason?: string }  (optional free-text)
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function POST(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  if (!ADMIN_ROLES.has(String(user.role || '').toLowerCase())) {
    return NextResponse.json({ error: 'admin role required' }, { status: 403 });
  }

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }
  const reason = body?.reason ? String(body.reason).trim() : null;

  // Load + scope-check.
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, status, company, claim_id')
    .eq('id', id)
    .single();
  if (msgErr || !message) {
    return NextResponse.json({ error: msgErr?.message || 'message not found' }, { status: 404 });
  }

  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  if (!isMultiCompany && user.company !== message.company) {
    return NextResponse.json({ error: 'forbidden: cross-company access' }, { status: 403 });
  }

  if (message.status === 'received') {
    return NextResponse.json({ error: 'message is already in received state — nothing to revert' }, { status: 409 });
  }

  // Identify side-effects that can't be reversed automatically so
  // we can return them to the caller.
  const { data: routingRows } = await supabaseAdmin
    .from('routing_executions')
    .select('action_type, claim_id, status')
    .eq('message_id', id)
    .eq('status', 'success');
  const sideEffects = (routingRows || [])
    .filter((r) => ['create_claim', 'update_claim_settlement', 'mark_claim_closed', 'attach_photos_to_claim', 'file_to_claim_folder'].includes(r.action_type))
    .map((r) => ({ action_type: r.action_type, claim_id: r.claim_id }));

  // 1. Deactivate all classifications.
  const { error: clsErr } = await supabaseAdmin
    .from('message_classifications')
    .update({ is_active: false })
    .eq('message_id', id)
    .eq('is_active', true);
  if (clsErr) {
    return NextResponse.json({ error: `failed to deactivate classifications: ${clsErr.message}` }, { status: 500 });
  }

  // 2. Reset the inbox_messages row.
  const { error: msgUpdErr } = await supabaseAdmin
    .from('inbox_messages')
    .update({
      status: 'received',
      triaged_by: null,
      triaged_at: null,
      dismissed_by: null,
      dismissed_at: null,
      dismiss_reason: null,
      claim_id: null,
    })
    .eq('id', id);
  if (msgUpdErr) {
    return NextResponse.json({ error: `failed to reset message: ${msgUpdErr.message}` }, { status: 500 });
  }

  // 3. Audit trail.
  await supabaseAdmin
    .from('activity_log')
    .insert([{
      action: 'comms_message_reverted',
      entity_type: 'inbox_message',
      entity_id: id,
      user_email: user.email,
      user_name: user.name || user.email,
      company: message.company,
      details: JSON.stringify({
        reason,
        previous_status: message.status,
        previous_claim_id: message.claim_id,
        side_effects: sideEffects,
      }),
    }]);

  return NextResponse.json({
    ok: true,
    message_id: id,
    previous_status: message.status,
    new_status: 'received',
    side_effects: sideEffects,
    note: sideEffects.length > 0
      ? 'Message reset to triage. The listed downstream actions on claims were NOT reversed automatically — please verify them.'
      : 'Message reset to triage. No downstream claim modifications to clean up.',
  });
}
