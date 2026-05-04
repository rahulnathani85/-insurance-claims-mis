// =============================================================================
// /api/claims/[id]/discard-draft
// =============================================================================
// DELETE — Discards a manual-claim draft that was created via "+ New Manual
// Claim" but never registered. Lets the clerk clean up empty placeholder
// shells that pollute the Pending Registration queue.
//
// Strict guards (all must hold):
//   - Caller is signed in (x-app-user-email)
//   - Claim row exists
//   - ref_number starts with 'MANUAL/' — the discard flow is intentionally
//     scoped to manual drafts only. INTAKE/* placeholders trace back to a
//     real inbound email and must be triaged via the comms pipeline (or
//     dismissed via the review queue), not deleted here. Real registered
//     claims (no placeholder prefix) are untouchable from this endpoint.
//   - phase = 'intimation' — once a manual draft is registered (phase flips
//     to 'registered'), the placeholder ref is replaced and this endpoint
//     refuses to touch it. Use the legacy DELETE /api/claims/[id] flow for
//     post-registration deletes (which decrements the counter).
//
// Cascade behaviour:
//   - claim_documents, claim_registration_extractions, claim_lifecycle*,
//     site_visits, ila_*, loss_sheet_*, claim_drafts, notifications,
//     claim_chat_messages, claim_field_values are all FK'd with ON DELETE
//     CASCADE — they go away with the parent row.
//   - ila_data, email_drafts, routing_executions FK without CASCADE, but
//     for a freshly-created MANUAL placeholder these tables are empty by
//     construction (no ILA composed, no email drafted, no routing run on
//     a hand-created claim with no inbound email).
//   - No counter decrement: MANUAL/ placeholders never bumped a counter
//     (counters only bump at submit-time placeholder→real promotion in
//     PUT /api/claims/[id]).
//
// Audit:
//   activity_log row written with action='manual_claim_draft_discarded'
//   so the deletion is traceable even though the claim row is gone.
//
// Response:
//   200 { ok: true, ref_number }
//   401 not signed in
//   403 not a MANUAL/ draft, or already registered
//   404 claim not found
//   500 underlying delete error
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { recordPortalActivity } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MANUAL_PREFIX = 'MANUAL/';

export async function DELETE(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: 'claim id required' }, { status: 400 });
  }

  // Fetch the claim and assert the invariants before deleting.
  const { data: claim, error: fetchErr } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, phase, company')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!claim) {
    return NextResponse.json({ error: 'claim not found' }, { status: 404 });
  }

  const refNumber = String(claim.ref_number || '');
  if (!refNumber.startsWith(MANUAL_PREFIX)) {
    return NextResponse.json(
      {
        error:
          'Discard only allowed on manual drafts (ref_number must start with MANUAL/). ' +
          'For real claims use the legacy delete flow.',
      },
      { status: 403 }
    );
  }
  if (claim.phase !== 'intimation') {
    return NextResponse.json(
      {
        error:
          'This manual claim has already been registered (phase != intimation). ' +
          'Discard is only allowed before registration.',
      },
      { status: 403 }
    );
  }

  // Tenant scope: a clerk can only discard drafts in their own company,
  // unless they belong to a multi-company role ('all' / 'development').
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = userCompanyKey === 'all' || userCompanyKey === 'development';
  if (!isMultiCompany && claim.company && claim.company !== user.company) {
    return NextResponse.json(
      { error: 'forbidden: cross-company discard' },
      { status: 403 }
    );
  }

  // Delete via supabaseAdmin so RLS doesn't block. Most child tables CASCADE;
  // any non-CASCADE child row would surface as a 23503 FK violation here —
  // we let that bubble up so the clerk knows the row isn't actually empty.
  const { error: delErr } = await supabaseAdmin
    .from('claims')
    .delete()
    .eq('id', id);

  if (delErr) {
    return NextResponse.json(
      {
        error:
          delErr.message || 'failed to discard draft (likely has dependent rows)',
      },
      { status: 500 }
    );
  }

  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name || user.email,
    action: 'manual_claim_draft_discarded',
    entity_type: 'claim',
    entity_id: Number(id),
    claim_id: Number(id),
    ref_number: refNumber,
    company: claim.company || user.company || 'NISLA',
    details: { discarded_at: new Date().toISOString() },
  });

  return NextResponse.json({ ok: true, ref_number: refNumber });
}
