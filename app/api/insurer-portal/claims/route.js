// =============================================================================
// /api/insurer-portal/claims
// =============================================================================
// Phase 2 read-only claims listing for the insurer portal.
//
// GET — returns the claims for the logged-in insurer's company.
//        Authentication: X-User-Email header. The header identifies
//        the session principal; we look up the user, verify role +
//        insurer_id, and filter claims accordingly.
//
//        If the principal isn't an insurer_readonly user, returns 403.
//        Phase 3 RLS will enforce this same predicate at the DB level.
//
// Response:
//   {
//     ok: true,
//     insurer:  { id, name, ... }    | null,
//     claims:   [{ id, ref_number, claim_number, insured_name, lob,
//                  status, date_loss, gross_loss, ... }, ...]
//   }
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isInsurerUser, getInsurerId, scopeClaimsForInsurer, loadInsurer } from '@/lib/auth/insurer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  // Resolve principal from the X-User-Email header.
  const userEmail = request.headers.get('x-user-email') || '';
  if (!userEmail) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { data: user } = await supabaseAdmin
    .from('app_users')
    .select('id, email, role, insurer_id, is_active')
    .ilike('email', userEmail.trim())
    .maybeSingle();

  if (!user || !user.is_active) {
    return NextResponse.json({ error: 'Account not found or inactive' }, { status: 401 });
  }

  if (!isInsurerUser(user)) {
    return NextResponse.json(
      { error: 'Endpoint is restricted to insurer-portal users' },
      { status: 403 }
    );
  }

  // Load the insurer for the dashboard header
  const insurer = await loadInsurer(user);

  // Fetch the scoped list. scopeClaimsForInsurer adds the insurer_name
  // filter; surveyor users would get the unfiltered query (we already
  // 403'd those above so this branch is just defence in depth).
  let q = supabaseAdmin
    .from('claims')
    .select(`
      id, ref_number, claim_number, insured_name, lob, lob_subcategory,
      policy_number, status, phase, date_loss, date_of_intimation,
      gross_loss, sum_insured, loss_location, registered_at, created_at
    `)
    .order('date_of_intimation', { ascending: false, nullsFirst: false });
  q = await scopeClaimsForInsurer(q, user);

  const { data: claims, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    insurer,
    claims: claims || [],
  });
}
