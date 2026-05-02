// =============================================================================
// /api/insurer-portal/claims/[id]
// =============================================================================
// Phase 2 read-only single-claim view for the insurer portal.
//
// GET — returns one claim that belongs to the logged-in insurer's
//        company. Insurers can only fetch their own claims; an attempt
//        to fetch another insurer's claim returns 404 (not 403, so we
//        don't leak existence). Includes:
//
//          - claim:           the merged claim row (provenance overlay applied)
//          - provenance:      per-field provenance map for FieldWithProvenance
//          - data_quality:    score + mandatory-filled count from the
//                             merge-read helper
//          - submitted_fsr:   the latest claim_fsr_drafts row with
//                             status='approved' (signed FSR PDF), if any
//          - submitted_ila:   the latest ila_submissions row, if any
//          - timeline:        recent activity_log entries scoped to
//                             status changes / submissions / settlements
//                             (filters out internal surveyor notes)
//
// What's deliberately NOT returned:
//   - In-progress FSR drafts (claim_fsr_drafts where status != 'approved')
//   - Internal surveyor / NISLA chat (claim_messages, claim_chat_messages)
//   - Survey fee bills (those are between NISLA and insurer's accounts
//     team, not the dealing officer's view)
//
// Authentication: X-User-Email header → app_users lookup → role check.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isInsurerUser, loadInsurer } from '@/lib/auth/insurer';
import { getClaimWithProvenance } from '@/lib/provenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMELINE_ACTIONS = new Set([
  'claim_created',
  'claim_registered',
  'phase_change',
  'status_change',
  'site_visit_added',
  'ila_submitted',
  'fsr_submitted',
  'claim_closed',
  'claim_reopened',
]);

export async function GET(request, { params }) {
  const { id } = params;

  const userEmail = request.headers.get('x-user-email') || '';
  if (!userEmail) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { data: user } = await supabaseAdmin
    .from('app_users')
    .select('id, email, role, insurer_id, is_active')
    .ilike('email', userEmail.trim())
    .maybeSingle();
  if (!user || !user.is_active) {
    return NextResponse.json({ error: 'Account not found or inactive' }, { status: 401 });
  }
  if (!isInsurerUser(user)) {
    return NextResponse.json({ error: 'Endpoint is restricted to insurer-portal users' }, { status: 403 });
  }

  const insurer = await loadInsurer(user);
  if (!insurer?.name) {
    return NextResponse.json({ error: 'Insurer linkage misconfigured' }, { status: 500 });
  }

  // Load the merged claim. We don't pass the user's filter to
  // getClaimWithProvenance — instead we check ownership AFTER and
  // 404 if the claim doesn't belong to this insurer. That way the
  // ownership check is the same shape as scopeClaimsForInsurer.
  let merged;
  try {
    const out = await getClaimWithProvenance(supabaseAdmin, id);
    merged = out;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
  if (merged?.claim?.insurer_name !== insurer.name) {
    // Don't leak existence — the insurer mustn't be able to probe other
    // insurers' claim id ranges.
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  // Latest approved FSR draft — only signed FSRs are visible
  const { data: submittedFsr } = await supabaseAdmin
    .from('claim_fsr_drafts')
    .select('id, version_number, status, approved_by, approved_at, draft_content')
    .eq('claim_id', id)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Latest ILA submission
  let submittedIla = null;
  try {
    const { data } = await supabaseAdmin
      .from('ila_submissions')
      .select('id, draft_id, signed_by_email, signed_by_name, submitted_at, signer_irdai_license_no')
      .eq('claim_id', id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    submittedIla = data || null;
  } catch {
    submittedIla = null;
  }

  // Filtered timeline — only the milestones the insurer cares about
  const { data: timelineRows } = await supabaseAdmin
    .from('activity_log')
    .select('id, action, entity_type, details, created_at, user_name')
    .eq('claim_id', id)
    .order('created_at', { ascending: false })
    .limit(200);
  const timeline = (timelineRows || []).filter((row) => TIMELINE_ACTIONS.has(row.action));

  return NextResponse.json({
    ok: true,
    insurer,
    claim: merged.claim,
    merged: merged.merged,
    provenance: merged.provenance,
    data_quality: merged.data_quality,
    submitted_fsr: submittedFsr || null,
    submitted_ila: submittedIla,
    timeline,
  });
}
