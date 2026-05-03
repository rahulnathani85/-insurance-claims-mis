// ============================================================
// /api/claims/intimations
// ------------------------------------------------------------
// GET — List claims sitting at phase='intimation' (auto-created
// from the comms pipeline, not yet formally registered).
//
// Company-scoped same way as the messages list endpoint.
//
// Returns: { total, claims: [{ id, ref_number, lob,
//   insured_name, policy_number, date_of_loss, loss_location,
//   company, created_at }] }
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function GET(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { searchParams } = new URL(request.url);
  const companyParam = searchParams.get('company');
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  const scopeCompany = isMultiCompany ? (companyParam || null) : user.company;

  // Use the service-role client. requireUser() above is the auth gate;
  // scopeCompany below is the tenant gate. RLS on `claims` (added in
  // Phase 3b for the insurer-readonly role) was silently dropping rows
  // for portal-internal callers that don't set the insurer GUC — using
  // supabaseAdmin bypasses RLS so all 'intimation'-phase claims for the
  // user's company come back.
  let q = supabaseAdmin
    .from('claims')
    .select(
      `id, ref_number, lob, insured_name, policy_number, claim_number,
       date_loss, loss_location, company, created_at,
       intake_email_from, intake_received_at, intake_message_id`,
      { count: 'exact' }
    )
    .eq('phase', 'intimation')
    .order('created_at', { ascending: false })
    .limit(200);

  if (scopeCompany) q = q.eq('company', scopeCompany);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compute "missing fields" hints so the UI can surface what each
  // intimation still needs before it can be properly registered.
  // Anything that's an INTAKE/* placeholder ref_number flags as needing
  // a real ref number too.
  const claims = (data || []).map((c) => {
    const missing = [];
    if (!c.insured_name) missing.push('insured_name');
    if (!c.policy_number) missing.push('policy_number');
    if (!c.claim_number) missing.push('claim_number');
    if (!c.date_loss) missing.push('date_loss');
    if (!c.loss_location) missing.push('loss_location');
    if (!c.ref_number || c.ref_number.startsWith('INTAKE/')) missing.push('ref_number');
    return { ...c, missing_fields: missing };
  });

  return NextResponse.json({
    total: count ?? claims.length,
    claims,
  });
}
