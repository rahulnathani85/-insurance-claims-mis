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

  let q = supabaseAdmin
    .from('claims')
    .select('id, ref_number, lob, insured_name, policy_number, date_of_loss, loss_location, company, created_at, source', { count: 'exact' })
    .eq('phase', 'intimation')
    .order('created_at', { ascending: false })
    .limit(200);

  if (scopeCompany) q = q.eq('company', scopeCompany);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    total: count ?? (data?.length || 0),
    claims: data || [],
  });
}
