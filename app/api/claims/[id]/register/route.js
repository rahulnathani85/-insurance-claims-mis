// ============================================================
// /api/claims/[id]/register
// ------------------------------------------------------------
// POST — Promotes a claim from phase='intimation' to
// phase='registered'. Captures who registered and when, and
// optionally a free-text registration note.
//
// Spec § wiring (registration-module-spec.md):
//   §6  Auto-computes complexity_tier, ila_due_at, fsr_due_at
//       from the claim's loss amount + is_catastrophe flag.
//   §10 Validation gates:
//        - required fields (ref_number, policy_number, insured_name, lob)
//        - date_of_loss not future
//        - date_of_loss inside policy_period (if set)
//        - duplicate detection (same insurer + policy + DoL within 7 days)
//          — by default warns + requires explicit `override_duplicate: true`
//
// Auth: any authenticated user with access to the claim's company.
// Admins can register across companies.
//
// Body: {
//   note?: string
//   override_duplicate?: boolean   // bypass §10 duplicate warning
//   override_warnings?: boolean    // bypass §10 non-blocking warnings
// }
//
// Response (success):
//   { ok: true, claim_id, ref_number, phase, registered_by, registered_at,
//     complexity_tier, ila_due_at, fsr_due_at, warnings: string[] }
//
// Response (validation error):
//   422 with { error, errors: string[], warnings: string[],
//              duplicates?: [...] }
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import {
  computeComplexityTier,
  computeIlaDueAt,
  computeFsrDueAt,
  validateRegistration,
  findDuplicateClaims,
} from '@/lib/registration';

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
  const overrideDuplicate = body?.override_duplicate === true;
  const overrideWarnings  = body?.override_warnings  === true;

  // -------------------------------------------------------------------------
  // 1. Load + scope-check the claim
  // -------------------------------------------------------------------------
  const { data: claim, error: loadErr } = await supabaseAdmin
    .from('claims')
    .select(`
      id, ref_number, phase, company, lob, status,
      insured_name, insurer_name, policy_number,
      date_of_loss, policy_period_from, policy_period_to,
      gross_loss, estimated_loss_amount, claim_amount_intimated,
      is_catastrophe
    `)
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

  // -------------------------------------------------------------------------
  // 2. Validation gates (spec §10)
  // -------------------------------------------------------------------------
  const validation = validateRegistration(claim);

  if (!validation.ok) {
    return NextResponse.json({
      error: 'validation failed',
      errors: validation.errors,
      warnings: validation.warnings,
    }, { status: 422 });
  }

  if (validation.warnings.length > 0 && !overrideWarnings) {
    return NextResponse.json({
      error: 'registration has warnings — pass override_warnings=true to proceed',
      errors: [],
      warnings: validation.warnings,
    }, { status: 422 });
  }

  // -------------------------------------------------------------------------
  // 3. Duplicate detection (spec §10)
  // -------------------------------------------------------------------------
  const duplicates = await findDuplicateClaims(supabaseAdmin, {
    insurerName: claim.insurer_name,
    policyNumber: claim.policy_number,
    dateOfLoss: claim.date_of_loss,
    excludeId: claim.id,
    windowDays: 7,
  });

  if (duplicates.length > 0 && !overrideDuplicate) {
    return NextResponse.json({
      error: 'possible duplicate claim(s) found — pass override_duplicate=true to proceed',
      duplicates,
      warnings: validation.warnings,
    }, { status: 422 });
  }

  // -------------------------------------------------------------------------
  // 4. Compute TAT (spec §6)
  // -------------------------------------------------------------------------
  const now = new Date();
  const nowIso = now.toISOString();

  const complexityTier = computeComplexityTier({
    estimated_loss: claim.estimated_loss_amount,
    gross_loss: claim.gross_loss,
    claim_amount_intimated: claim.claim_amount_intimated,
    is_catastrophe: claim.is_catastrophe === true,
  });

  const ilaDueAt = computeIlaDueAt(nowIso);
  const fsrDueAt = complexityTier ? computeFsrDueAt(nowIso, complexityTier) : null;

  // -------------------------------------------------------------------------
  // 5. Persist (single UPDATE — trigger captures field-level audit)
  // -------------------------------------------------------------------------
  const { error: upErr } = await supabaseAdmin
    .from('claims')
    .update({
      phase: 'registered',
      registered_by: user.email,
      registered_at: nowIso,
      registration_note: note,
      complexity_tier: complexityTier,
      ila_due_at: ilaDueAt,
      fsr_due_at: fsrDueAt,
    })
    .eq('id', id)
    .eq('phase', 'intimation'); // race-safe

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // -------------------------------------------------------------------------
  // 6. High-level user-action audit row (separate from trigger's field-diffs)
  // -------------------------------------------------------------------------
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
      details: JSON.stringify({
        note,
        insured_name: claim.insured_name,
        complexity_tier: complexityTier,
        ila_due_at: ilaDueAt,
        fsr_due_at: fsrDueAt,
        warnings: validation.warnings,
        duplicates_overridden: overrideDuplicate && duplicates.length > 0,
      }),
    }]);

  return NextResponse.json({
    ok: true,
    claim_id: id,
    ref_number: claim.ref_number,
    phase: 'registered',
    registered_by: user.email,
    registered_at: nowIso,
    complexity_tier: complexityTier,
    ila_due_at: ilaDueAt,
    fsr_due_at: fsrDueAt,
    warnings: validation.warnings,
    duplicates_overridden: overrideDuplicate ? duplicates : undefined,
  });
}
