// ============================================================
// /api/comms-webhooks/gmail
// ------------------------------------------------------------
// Stage 4 — Gmail Push receiver.
//
// Cloud Pub/Sub POSTs here whenever any subscribed mailbox has
// new history. The body is a Pub/Sub envelope:
//
//   {
//     "message": {
//       "data": "<base64-encoded JSON>",
//       "messageId": "...",
//       "publishTime": "..."
//     },
//     "subscription": "projects/<id>/subscriptions/..."
//   }
//
// The base64-decoded data is JSON like:
//   { "emailAddress": "claim.intimation@nisla.in", "historyId": "12345" }
//
// Authentication:
//   - We require Authorization: Bearer <jwt>, where <jwt> is a
//     Google OIDC token signed with RS256, issued by
//     https://accounts.google.com, with aud equal to our
//     GMAIL_PUBSUB_VERIFIER_AUDIENCE env var.
//   - The Pub/Sub subscription must be configured to attach this
//     OIDC token. See docs/communications/STAGE_4_DEPLOY.md.
//
// Behavior:
//   - Look up the gmail_tokens row by emailAddress.
//   - Call processGmailWebhookEvent(tokenRow, historyId) which
//     diffs history.list → ingestOneGmailMessage per new message.
//   - Updates last_history_id atomically at the end.
//
// Kill switch: respects comms_config.ingestion_paused — if ON,
// we ACK the Pub/Sub message (200 OK) WITHOUT processing. This
// prevents Pub/Sub from retrying and stops ingest cleanly.
// (Returning non-2xx would cause Pub/Sub to retry and back off,
//  potentially flooding logs during a long pause.)
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyPubsubJwt, extractBearerToken } from '@/lib/comms/pubsubVerify';
import { assertCommsEnabled } from '@/lib/comms/killSwitch';
import { processGmailWebhookEvent } from '@/lib/comms/ingestGmail';
import { recordCronRun } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // single-mailbox event; should finish quickly

export async function POST(request) {
  // 1. Verify the OIDC token Google attached.
  let token;
  try {
    token = extractBearerToken(request);
  } catch (err) {
    console.warn('[gmail-webhook] auth header missing/malformed:', err.message);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const expectedAudience = process.env.GMAIL_PUBSUB_VERIFIER_AUDIENCE;
  if (!expectedAudience) {
    console.error('[gmail-webhook] GMAIL_PUBSUB_VERIFIER_AUDIENCE not configured');
    return NextResponse.json(
      { error: 'server misconfigured' },
      { status: 500 }
    );
  }

  try {
    await verifyPubsubJwt(token, expectedAudience);
  } catch (err) {
    console.warn('[gmail-webhook] JWT verify failed:', err.message);
    return NextResponse.json(
      { error: `JWT invalid: ${err.message}` },
      { status: 401 }
    );
  }

  // 2. Parse the envelope.
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const dataB64 = body?.message?.data;
  const pubsubMessageId = body?.message?.messageId;
  if (!dataB64) {
    return NextResponse.json({ error: 'missing message.data' }, { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf-8'));
  } catch {
    return NextResponse.json({ error: 'malformed pubsub data' }, { status: 400 });
  }

  const emailAddress = payload?.emailAddress;
  const historyId = payload?.historyId;
  if (!emailAddress || !historyId) {
    return NextResponse.json(
      { error: 'pubsub data missing emailAddress / historyId' },
      { status: 400 }
    );
  }

  // 3. Kill-switch gate. ACK the message so Pub/Sub doesn't retry.
  const gate = await assertCommsEnabled('ingestion_paused');
  if (gate.paused) {
    await recordCronRun({
      cron: 'gmail_webhook',
      result: 'paused',
      summary: { since: gate.since, emailAddress, historyId, pubsubMessageId },
    });
    return NextResponse.json({ ok: true, skipped: 'paused' });
  }

  // 4. Look up the mailbox (by gmail_address; only Comms-flagged rows).
  const { data: tokenRow, error: tokErr } = await supabaseAdmin
    .from('gmail_tokens')
    .select('*')
    .eq('gmail_address', emailAddress)
    .or('is_comms_mailbox.eq.true,is_comms_opted_in.eq.true')
    .maybeSingle();

  if (tokErr) {
    console.error('[gmail-webhook] token lookup failed:', tokErr);
    return NextResponse.json({ error: tokErr.message }, { status: 500 });
  }
  if (!tokenRow) {
    // Unknown / disconnected mailbox — ACK without processing.
    // (Could happen if a mailbox is disconnected but the watch
    // hadn't been stopped yet.)
    await recordCronRun({
      cron: 'gmail_webhook',
      result: 'no_match',
      summary: { emailAddress, historyId, pubsubMessageId },
    });
    return NextResponse.json({ ok: true, skipped: 'no matching gmail_tokens row' });
  }

  // 5. Process the event.
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await processGmailWebhookEvent(tokenRow, historyId);
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[gmail-webhook] processing failed:', message);
    await recordCronRun({
      cron: 'gmail_webhook',
      result: 'error',
      summary: { error: message, emailAddress, historyId, pubsubMessageId },
    });
    // Return non-2xx so Pub/Sub retries the delivery (with backoff).
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }

  await recordCronRun({
    cron: 'gmail_webhook',
    result: 'ok',
    summary: {
      emailAddress,
      historyId,
      processed: result.processed,
      inserted: result.inserted,
      failed: result.failed,
      skipped: result.skipped,
      pubsubMessageId,
    },
  });

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    emailAddress,
    historyId,
    processed: result.processed,
    inserted: result.inserted,
    failed: result.failed,
    skipped: result.skipped,
  });
}

// Convenience GET for the Pub/Sub Push subscription "verification"
// step. Returns 200 OK with a hint so a human visiting the URL
// in a browser sees something useful instead of a 405.
export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'POST-only webhook for Cloud Pub/Sub Gmail notifications.',
  });
}
