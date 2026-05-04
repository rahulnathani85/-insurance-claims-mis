// =============================================================================
// /api/claims/manual
// =============================================================================
// POST — Creates a manual claim shell for a clerk who's starting registration
// from documents (not from an inbound email). Mirrors the placeholder-ref
// pattern used by the comms pipeline's actionCreateClaim:
//
//   ref_number       = 'MANUAL/<company>/<8-char-uuid>'
//   phase            = 'intimation'
//   intake_message_id = NULL  (no source email)
//   status           = 'Open'
//
// The clerk lands on /claim-registration/<id>, uploads documents, runs the
// Registration Agent, fills the form, and submits. At submit time the existing
// PUT /api/claims/[id] route promotes the MANUAL/ placeholder to a real ref
// (counter increment, folder_path, phase flip — all generic and prefix-
// agnostic via lib/refNumber.js isPlaceholderRef).
//
// Auth: requireUser (x-app-user-email header). Company defaults to the user's
// session company; admins ('all'/'development') can override via body.
//
// Body (all optional):
//   { company?: 'NISLA' | 'ACUERE' }
//
// Response (200):
//   { id: number, ref_number: string }
// =============================================================================

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { recordPortalActivity } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function POST(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  let body = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }

  // Resolve company.
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  const requestedCompany = body?.company ? String(body.company).trim() : null;
  let company;
  if (isMultiCompany) {
    company = requestedCompany || 'NISLA';
  } else {
    if (requestedCompany && requestedCompany !== user.company) {
      return NextResponse.json(
        { error: 'forbidden: cross-company claim creation' },
        { status: 403 }
      );
    }
    company = user.company || 'NISLA';
  }

  // Build the placeholder ref. crypto.randomUUID() gives us a v4 UUID; the
  // first 8 chars are unique enough that collisions on (company, prefix) are
  // negligible. Same shape as INTAKE/<co>/<8-char-msg-id>.
  const shortId = crypto.randomUUID().split('-')[0];
  const refNumber = `MANUAL/${company}/${shortId}`;

  const { data: created, error } = await supabaseAdmin
    .from('claims')
    .insert([{
      ref_number: refNumber,
      lob: null,                // clerk fills via the registration form
      phase: 'intimation',
      status: 'Open',
      company,
      intake_message_id: null,  // no source email
    }])
    .select('id, ref_number')
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: error?.message || 'failed to create manual claim' },
      { status: 500 }
    );
  }

  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name || user.email,
    action: 'claim_created_manually',
    entity_type: 'claim',
    entity_id: created.id,
    claim_id: created.id,
    ref_number: created.ref_number,
    company,
    details: { ref_number: created.ref_number },
  });

  return NextResponse.json({
    id: created.id,
    ref_number: created.ref_number,
  });
}
