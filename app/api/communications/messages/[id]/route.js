// ============================================================
// /api/communications/messages/[id]
// ------------------------------------------------------------
// GET — full message + attachments + classifications + extractions
// for the triage detail view. Also returns the active list of
// tag_definitions so the tag picker stays in sync with seeds.
//
// Company scoping mirrors /messages: a NISLA user can't read
// Acuere's messages.
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function GET(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id } = params || {};
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('*')
    .eq('id', id)
    .single();

  if (msgErr || !message) {
    return NextResponse.json(
      { error: msgErr?.message || 'message not found' },
      { status: 404 }
    );
  }

  // Company scoping enforcement.
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  if (!isMultiCompany && user.company !== message.company) {
    return NextResponse.json(
      { error: 'forbidden: cross-company access' },
      { status: 403 }
    );
  }

  // Parallel fetches: attachments, classifications, extractions, tag library, drafts.
  const [
    { data: attachments },
    { data: classifications },
    { data: extractions },
    { data: tagDefs },
    { data: drafts },
  ] = await Promise.all([
    supabaseAdmin
      .from('message_attachments')
      .select('id, filename, mime_type, size_bytes, storage_path, sha256_hash, is_image, created_at')
      .eq('message_id', id)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('message_classifications')
      .select('id, tag, confidence, classifier_model, reasoning, classified_at, classified_by, is_active, override_reason')
      .eq('message_id', id)
      .order('classified_at', { ascending: false }),
    supabaseAdmin
      .from('extraction_results')
      .select('id, classification_id, tag, extracted_data, validation_errors, is_valid, edited_by_user, edited_at, edited_by, created_at')
      .eq('message_id', id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('tag_definitions')
      .select('tag, display_label, short_code, description, guidance, ui_color, extraction_required, extraction_schema, auto_route_threshold, sort_order')
      .eq('enabled', true)
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('email_drafts')
      .select('id, to_address, subject, body, body_edited, status, generated_by, llm_provider, llm_cost_inr, sent_at, sent_by, created_at, updated_at')
      .eq('message_id', id)
      .order('created_at', { ascending: false }),
  ]);

  // Mint signed download URLs for each attachment so the browser can
  // view/download them without ever needing the storage bucket to be public.
  const ATTACHMENT_BUCKET = 'comms-attachments';
  const SIGNED_URL_EXPIRY = 3600; // 1 hour
  const enrichedAttachments = await Promise.all(
    (attachments || []).map(async (a) => {
      if (!a.storage_path) return { ...a, download_url: null };
      const { data: signed } = await supabaseAdmin.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(a.storage_path, SIGNED_URL_EXPIRY);
      return { ...a, download_url: signed?.signedUrl || null };
    })
  );

  return NextResponse.json({
    message,
    attachments: enrichedAttachments,
    classifications: classifications || [],
    extractions: extractions || [],
    tags: tagDefs || [],
    drafts: drafts || [],
  });
}
