// =============================================================================
// /api/claims/[id]/documents/[docId]/rename
// =============================================================================
// PATCH — Rename a document. Mutates claim_documents.file_name only.
// Per the unified-documents architecture (see plan), claim_documents is
// the single source of truth for document names; downstream consumers
// (FSR annexure list when it ships, future email-reply re-attachment
// flow) read from this table and inherit renames automatically.
//
// Body: { file_name: '<new name>' }
// Returns: 200 with the updated row, or 4xx with an error.
//
// Tenant safety: matches both id (docId) AND claim_id so an attacker
// can't rename another company's documents by guessing UUIDs.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { recordPortalActivity } from '@/lib/comms/auditLog';
import { sanitiseDisplayName } from '@/lib/claimDocuments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function PATCH(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id, docId } = params || {};
  if (!id || !docId) {
    return NextResponse.json({ error: 'id and docId are required' }, { status: 400 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const sanitised = sanitiseDisplayName(body?.file_name);
  if (!sanitised) {
    return NextResponse.json(
      { error: 'file_name is required and must be a non-empty string after sanitisation' },
      { status: 400 }
    );
  }

  // Tenant scope: load the doc + its claim to verify access.
  const { data: doc, error: docErr } = await supabaseAdmin
    .from('claim_documents')
    .select('id, claim_id, file_name, source, document_type')
    .eq('id', docId)
    .eq('claim_id', id)
    .maybeSingle();

  if (docErr || !doc) {
    return NextResponse.json({ error: 'document not found for this claim' }, { status: 404 });
  }

  // Pull the claim's company for the scope check.
  const { data: claim } = await supabaseAdmin
    .from('claims')
    .select('id, company, ref_number')
    .eq('id', id)
    .maybeSingle();
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  if (claim && !isMultiCompany && user.company !== claim.company) {
    return NextResponse.json({ error: 'forbidden: cross-company access' }, { status: 403 });
  }

  const oldName = doc.file_name;

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('claim_documents')
    .update({ file_name: sanitised, updated_at: new Date().toISOString() })
    .eq('id', docId)
    .eq('claim_id', id)
    .select('id, file_name, document_name, document_type, source, file_type')
    .single();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Audit the rename — non-fatal on failure.
  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name || user.email,
    action: 'claim_document_renamed',
    entity_type: 'claim_document',
    claim_id: Number(id),
    ref_number: claim?.ref_number || null,
    company: claim?.company || 'NISLA',
    details: {
      document_id: docId,
      old_file_name: oldName,
      new_file_name: sanitised,
      source: doc.source,
      document_type: doc.document_type,
    },
  });

  return NextResponse.json({ ok: true, document: updated });
}
