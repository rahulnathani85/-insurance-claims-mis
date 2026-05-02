// =============================================================================
// /api/insurer-portal/claims
// =============================================================================
// Phase 3 read-only claims listing for the insurer portal.
//
// Uses lib/supabaseScoped: an anon-key client that establishes a
// per-request session GUC via set_session_user(p_email). RLS policies
// on `claims` then filter to claims where insurer_name =
// current_user_insurer_name() — defence in depth on top of the user-
// space scoping that Phase 2 shipped.
//
// Phase 2 retained: the X-User-Email header lookup + role check happen
// before the scoped client is built so we 401 / 403 cleanly when the
// principal isn't an insurer_readonly user. Phase 3 RLS is the second
// line of defence — even if a typo in this route forgets to filter,
// the DB refuses to surface another insurer's rows.
//
// GET → { ok, insurer, claims }
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { scopedSupabaseFor } from '@/lib/supabaseScoped';
import { INSURER_ROLE, loadInsurer } from '@/lib/auth/insurer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  // ---- Auth: X-User-Email header ----
  const userEmail = request.headers.get('x-user-email') || '';
  if (!userEmail) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // ---- Establish the scoped client + verify role ----
  // scopedSupabaseFor calls set_session_user(p_email) at request start;
  // the GUC is then visible to every subsequent query through this
  // client (PostgREST runs each request in a single transaction).
  const { client: supabase, role, ok, error } = await scopedSupabaseFor({ email: userEmail });
  if (!ok) {
    return NextResponse.json({ error: error || 'Account not found or inactive' }, { status: 401 });
  }
  if (role !== INSURER_ROLE) {
    return NextResponse.json(
      { error: 'Endpoint is restricted to insurer-portal users' },
      { status: 403 }
    );
  }

  // ---- Load the insurer header (admin client — insurers table doesn't
  // have insurer-scoped RLS; it's just the lookup table) ----
  // We re-derive the user from app_users because we need insurer_id;
  // could also pull it via the GUC but cleaner this way.
  const { data: user } = await supabaseAdmin
    .from('app_users')
    .select('id, email, role, insurer_id, is_active')
    .ilike('email', userEmail.trim())
    .maybeSingle();
  const insurer = await loadInsurer(user);

  // ---- The claims query — RLS does the filtering ----
  // No user-space .eq('insurer_name', ...) needed; the policy refuses
  // anything that doesn't match. We KEEP the user-space filter as a
  // second line so a future RLS regression doesn't leak data —
  // belt-and-braces defence in depth.
  const { data: claims, error: claimsErr } = await supabase
    .from('claims')
    .select(`
      id, ref_number, claim_number, insured_name, lob, lob_subcategory,
      policy_number, status, phase, date_loss, date_of_intimation,
      gross_loss, sum_insured, loss_location, registered_at, created_at,
      insurer_name
    `)
    .eq('insurer_name', insurer?.company_name || '__no_match__')
    .order('date_of_intimation', { ascending: false, nullsFirst: false });

  if (claimsErr) return NextResponse.json({ error: claimsErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    insurer,
    claims: claims || [],
  });
}
