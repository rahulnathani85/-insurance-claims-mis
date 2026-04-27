// ============================================================
// /api/communications/messages/[id]/reprocess-attachments
// ------------------------------------------------------------
// Admin-only recovery endpoint: re-fetches attachments for one
// inbox_message from Gmail and (re)inserts them into
// message_attachments. Use when the original ingest dropped
// attachments due to a transient Gmail API or storage error.
//
// Flow:
//   1. Load inbox_message + the gmail_tokens row that ingested it
//   2. Get a valid access token
//   3. Fetch full Gmail message
//   4. Collect attachment parts
//   5. Wipe any existing message_attachments rows (clean slate)
//   6. Re-run downloadAndStoreAttachments
//   7. Return counts so the UI can show what was recovered
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/comms/session';
import {
  getValidCommsToken,
  getGmailMessageFull,
  collectAttachmentParts,
} from '@/lib/comms/gmailClient';
import { downloadAndStoreAttachments } from '@/lib/comms/ingestGmail';
import { recordPortalActivity } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request, { params }) {
  const gate = await requireAdmin(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id } = params || {};
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // 1. Load message
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, source_msg_id, mailbox_user_email, company, attachments_count')
    .eq('id', id)
    .single();
  if (msgErr || !message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  if (!message.source_msg_id) {
    return NextResponse.json({ error: 'Message has no Gmail source_msg_id' }, { status: 422 });
  }

  // 2. Find the gmail_tokens row that ingested this message
  let tokenQuery = supabaseAdmin
    .from('gmail_tokens')
    .select('*')
    .eq('company', message.company);
  if (message.mailbox_user_email) {
    tokenQuery = tokenQuery.eq('user_email', message.mailbox_user_email);
  } else {
    // Fall back to the shared comms mailbox for the company.
    tokenQuery = tokenQuery.eq('is_comms_mailbox', true);
  }
  const { data: tokenRow, error: tokenErr } = await tokenQuery.maybeSingle();
  if (tokenErr || !tokenRow) {
    return NextResponse.json({
      error: `No Gmail token found for ${message.mailbox_user_email || 'company ' + message.company}`,
    }, { status: 422 });
  }

  // 3. Refresh access token
  let accessToken;
  try {
    accessToken = await getValidCommsToken(tokenRow);
  } catch (err) {
    return NextResponse.json({ error: `Token refresh failed: ${err?.message}` }, { status: 502 });
  }

  // 4. Fetch full Gmail message
  let full;
  try {
    full = await getGmailMessageFull(accessToken, message.source_msg_id);
  } catch (err) {
    return NextResponse.json({ error: `Gmail fetch failed: ${err?.message}` }, { status: 502 });
  }

  const attachmentParts = collectAttachmentParts(full.payload);
  const gmailReportedCount = attachmentParts.length;

  // 5. Count what we have now, then wipe for a clean re-run
  const { count: existingCount } = await supabaseAdmin
    .from('message_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('message_id', message.id);

  if (existingCount && existingCount > 0) {
    await supabaseAdmin
      .from('message_attachments')
      .delete()
      .eq('message_id', message.id);
  }

  // 6. Re-fetch and store — capture per-attachment results
  let perAttachment = [];
  if (attachmentParts.length > 0) {
    try {
      perAttachment = await downloadAndStoreAttachments({
        accessToken,
        gmailMessageId: message.source_msg_id,
        dbMessageId: message.id,
        attachmentParts,
        company: message.company,
      });
    } catch (err) {
      return NextResponse.json({ error: `Reprocess failed: ${err?.message}` }, { status: 500 });
    }
  }

  // Group failures by stage for quick diagnostic readout
  const failures = perAttachment.filter((r) => r.status === 'failed');
  const failuresByStage = failures.reduce((acc, r) => {
    acc[r.stage] = acc[r.stage] || [];
    acc[r.stage].push({ filename: r.filename, error: r.error });
    return acc;
  }, {});

  // 7. Count what landed
  const { count: newCount } = await supabaseAdmin
    .from('message_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('message_id', message.id);

  // Also bring the cached attachments_count on the message in line
  // with reality, so the queue badge reflects what's actually stored.
  if (newCount !== message.attachments_count) {
    await supabaseAdmin
      .from('inbox_messages')
      .update({ attachments_count: newCount || 0 })
      .eq('id', message.id);
  }

  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name,
    action: 'comms_attachments_reprocessed',
    entity_type: 'inbox_message',
    details: {
      message_id: message.id,
      gmail_reported: gmailReportedCount,
      previous_count: existingCount || 0,
      new_count: newCount || 0,
    },
    company: message.company || 'NISLA',
  });

  return NextResponse.json({
    ok: true,
    message_id: message.id,
    gmail_reported: gmailReportedCount,
    previous_count: existingCount || 0,
    new_count: newCount || 0,
    succeeded: perAttachment.filter((r) => r.status === 'success').length,
    failed: failures.length,
    failures_by_stage: failuresByStage,
    per_attachment: perAttachment,
  });
}
