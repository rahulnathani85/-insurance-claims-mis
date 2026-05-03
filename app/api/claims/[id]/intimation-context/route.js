// =============================================================================
// /api/claims/[id]/intimation-context
// =============================================================================
// GET — Returns the source data that pre-fills the registration form's left
// pane: the originating intimation email, its attachments, the latest LLM
// extraction, and any duplicate-claim hints.
//
// Source resolution (in order):
//   1. routing_actions.destination_id = claim.id (legacy comms-pipeline path,
//      kept for any rows that might exist there).
//   2. claims.intake_message_id (set by actionCreateClaim when the comms
//      executor materialises a claim shell from an intimation email — the
//      authoritative back-pointer today).
//
// If neither yields a message, returns 200 with { source: null, ... }.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(_request, { params }) {
  const { id } = params;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // 1. Try routing_actions first (legacy / future executor path).
  const { data: routing } = await supabaseAdmin
    .from('routing_actions')
    .select('id, message_id, classification_id, action_type, created_at')
    .eq('destination_table', 'claims')
    .eq('destination_id', String(id))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let messageId = routing?.message_id || null;

  // 2. Fall back to claims.intake_message_id — the column actionCreateClaim
  // stamps when it materialises an intimation shell.
  if (!messageId) {
    const { data: claim } = await supabaseAdmin
      .from('claims')
      .select('intake_message_id')
      .eq('id', id)
      .maybeSingle();
    messageId = claim?.intake_message_id || null;
  }

  if (!messageId) {
    return NextResponse.json({ source: null, attachments: [], extraction: null });
  }

  // Aliases (LHS is the API-stable name the registration UI expects, RHS is
  // the actual column on inbox_messages / message_attachments).
  const [{ data: message }, { data: attachments }, { data: extraction }] = await Promise.all([
    supabaseAdmin
      .from('inbox_messages')
      .select(
        'id, source_msg_id, thread_id, ' +
        'mailbox_email:mailbox_user_email, subject, ' +
        'sender:from_address, sender_name:from_display, ' +
        'recipients:to_address, received_at, body_plain, body_html, attachments_count'
      )
      .eq('id', messageId)
      .maybeSingle(),
    supabaseAdmin
      .from('message_attachments')
      .select('id, file_name:filename, mime_type, size_bytes, storage_path, ocr_text')
      .eq('message_id', messageId)
      .order('id', { ascending: true }),
    supabaseAdmin
      .from('extraction_results')
      .select('id, extracted_data, validation_errors, is_valid, edited_by_user, created_at')
      .eq('message_id', messageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    source: message || null,
    attachments: attachments || [],
    extraction: extraction || null,
  });
}
