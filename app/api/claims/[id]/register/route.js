// ============================================================
// /api/claims/[id]/register
// ------------------------------------------------------------
// POST — Promotes a claim from phase='intimation' to
// phase='registered'. Captures who registered and when, and
// optionally a free-text registration note.
//
// Auth: any authenticated user with access to the claim's
// company. Admins can register across companies.
//
// Body: { note?: string }
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function POST(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id } = params || {};
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  let body = {};
  try { body = await request.json(); } catch { /* no-op */ }
  const note = body?.note ? String(body.note).trim() : null;

  // Load + scope-check.
  const { data: claim, error: loadErr } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, phase, company, insured_name')
    .eq('id', id)
    .single();
  if (loadErr || !claim) {
    return NextResponse.json({ error: loadErr?.message || 'claim not found' }, { status: 404 });
  }

  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  if (!isMultiCompany && user.company !== claim.company) {
    return NextResponse.json({ error: 'forbidden: cross-company access' }, { status: 403 });
  }

  if (claim.phase !== 'intimation') {
    return NextResponse.json(
      { error: `claim is in phase '${claim.phase}' — only intimation-phase claims can be registered` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  const { error: upErr } = await supabaseAdmin
    .from('claims')
    .update({
      phase: 'registered',
      registered_by: user.email,
      registered_at: now,
      registration_note: note,
    })
    .eq('id', id)
    .eq('phase', 'intimation'); // race-safe

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Audit trail in activity_log so the registration shows up in the
  // claim's history view.
  await supabaseAdmin
    .from('activity_log')
    .insert([{
      action: 'claim_registered',
      entity_type: 'claim',
      entity_id: String(id),
      claim_id: id,
      ref_number: claim.ref_number,
      user_email: user.email,
      user_name: user.name || user.email,
      company: claim.company,
      details: JSON.stringify({ note, insured_name: claim.insured_name }),
    }]);

  return NextResponse.json({
    ok: true,
    claim_id: id,
    ref_number: claim.ref_number,
    phase: 'registered',
    registered_by: user.email,
    registered_at: now,
  });
}
