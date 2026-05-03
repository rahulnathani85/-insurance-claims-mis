// =============================================================================
// /api/claims/[id]/documents
// =============================================================================
// GET — Unified list of all documents associated with this claim. Reads
// only from claim_documents (which after the unify-claim-documents migration
// is the single source of truth for: email attachments materialized from
// the intimation, manual uploads via the Documents tab, and generated
// LOR/ILA/FSR artifacts).
//
// For each row we attach:
//   - source_badge:  human-readable label ('Email' | 'Upload' | 'Generated · LOR' | …)
//   - download_url:  1-hour signed URL when storage_path is set, else file_url, else null
//
// Query params (optional):
//   include_legacy=1   — also include rows where storage_path is null but
//                        file_url is set (LOR/ILA generated content stored
//                        as HTML in generated_documents.content; the URL
//                        often points to that lookup endpoint).
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MULTI_COMPANY_ROLES = new Set(['all', 'development']);
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

// (source, document_type) → user-facing badge label.
function badgeFor(row) {
  const source = String(row.source || '').toLowerCase();
  const docType = String(row.document_type || '').toUpperCase();
  if (source === 'gmail') return 'Email';
  if (source === 'generated') {
    if (docType === 'LOR') return 'Generated · LOR';
    if (docType === 'ILA') return 'Generated · ILA';
    if (docType === 'FSR') return 'Generated · FSR';
    return 'Generated';
  }
  return 'Upload';
}

// Map storage_path → bucket. Email attachments live in comms-attachments;
// manual uploads in claim-documents. Generated FSR PDFs (when persisted)
// also land in claim-documents per the FSR submit hook.
function bucketFor(row) {
  const source = String(row.source || '').toLowerCase();
  if (source === 'gmail') return 'comms-attachments';
  return 'claim-documents';
}

export async function GET(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id } = params || {};
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Tenant scope: first fetch the claim's company so we can enforce.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('id, company')
    .eq('id', id)
    .maybeSingle();
  if (claimErr || !claim) {
    return NextResponse.json(
      { error: claimErr?.message || 'claim not found' },
      { status: 404 }
    );
  }

  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  if (!isMultiCompany && user.company !== claim.company) {
    return NextResponse.json({ error: 'forbidden: cross-company access' }, { status: 403 });
  }

  const { data: rows, error } = await supabaseAdmin
    .from('claim_documents')
    .select(
      'id, file_name, document_name, document_type, file_type, ' +
      'mime_type, file_size, storage_path, file_url, ' +
      'source, status, attachment_id, ' +
      'gmail_message_id, gmail_from, gmail_date, ' +
      'uploaded_by, created_at'
    )
    .eq('claim_id', id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sign URLs in parallel — bucket selected per row by source.
  const enriched = await Promise.all(
    (rows || []).map(async (row) => {
      let downloadUrl = null;
      if (row.storage_path) {
        const bucket = bucketFor(row);
        const { data: signed } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)
          .catch(() => ({ data: null }));
        downloadUrl = signed?.signedUrl || null;
      }
      // Fall back to file_url for legacy LOR/ILA rows that point at the
      // generated_documents endpoint instead of a Storage path.
      if (!downloadUrl && row.file_url) {
        downloadUrl = row.file_url;
      }

      return {
        id: row.id,
        file_name: row.file_name || row.document_name || '(unnamed)',
        document_name: row.document_name,
        document_type: row.document_type,
        file_type: row.file_type,
        mime_type: row.mime_type,
        file_size: row.file_size,
        source: row.source,
        source_badge: badgeFor(row),
        status: row.status,
        attachment_id: row.attachment_id,
        gmail_message_id: row.gmail_message_id,
        gmail_from: row.gmail_from,
        gmail_date: row.gmail_date,
        uploaded_by: row.uploaded_by,
        created_at: row.created_at,
        download_url: downloadUrl,
        can_rename: row.source !== 'generated' || true, // user can rename anything
      };
    })
  );

  return NextResponse.json({
    claim_id: id,
    total: enriched.length,
    documents: enriched,
  });
}
