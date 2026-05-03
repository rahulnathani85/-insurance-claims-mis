// =============================================================================
// /api/claims/[id]/intimation-context
// =============================================================================
// GET — Returns the source data that pre-fills the registration form's left
// pane: the originating intimation email, its attachments, the latest LLM
// extraction, and any duplicate-claim hints.
//
// Joining path:
//   claim.id → routing_actions.destination_id (text)
//                where destination_table = 'claims'
//             → routing_actions.message_id
//             → inbox_messages
//             → message_attachments
//             → message_classifications (active)
//             → extraction_results (latest)
//
// If no source email can be found (claim was created manually, not from
// inbox), returns 200 with { source: null, ... }.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(_request, { params }) {
  const { id } = params;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Find a routing_action that points back to a comms message for this claim.
  const { data: routing } = await supabaseAdmin
    .from('routing_actions')
    .select('id, message_id, classification_id, action_type, created_at')
    .eq('destination_table', 'claims')
    .eq('destination_id', String(id))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!routing?.message_id) {
    return NextResponse.json({ source: null, attachments: [], extraction: null });
  }

  const [{ data: message }, { data: attachments }, { data: extraction }] = await Promise.all([
    supabaseAdmin
      .from('inbox_messages')
      .select('id, gmail_message_id, gmail_thread_id, mailbox_email, subject, sender, sender_name, recipients, received_at, body_plain, body_html, snippet, has_attachments')
      .eq('id', routing.message_id)
      .maybeSingle(),
    supabaseAdmin
      .from('message_attachments')
      .select('id, file_name, mime_type, size_bytes, storage_path, ocr_text')
      .eq('message_id', routing.message_id)
      .order('id', { ascending: true }),
    supabaseAdmin
      .from('extraction_results')
      .select('id, extracted_data, validation_errors, is_valid, edited_by_user, created_at')
      .eq('message_id', routing.message_id)
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
