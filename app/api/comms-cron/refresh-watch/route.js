// ============================================================
// /api/comms-cron/refresh-watch
// ------------------------------------------------------------
// Stage 4 — daily cron that renews users.watch for every
// Comms-flagged Gmail mailbox.
//
// Background:
//   Gmail Push subscriptions (users.watch) expire after 7 days.
//   If we don't renew, notifications silently stop. We renew
//   daily so we always have ≥6 days of headroom.
//
// Behavior:
//   - For each gmail_tokens row with is_comms_mailbox OR
//     is_comms_opted_in:
//       * Refresh access token if needed
//       * Call users.watch with the configured Pub/Sub topic
//       * Persist the new historyId (as last_history_id) AND the
//         new expiration timestamp (watch_expires_at)
//   - First-time call also serves as initial provisioning — if
//     a mailbox has never been watched, this cron will set it up
//     on the next tick.
//
// Auth: same Bearer CRON_SECRET as the other crons.
// Schedule: 0 3 * * *  (3:00 AM UTC = 8:30 AM IST)
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCronSecret } from '@/lib/comms/session';
import { recordCronRun } from '@/lib/comms/auditLog';
import {
  getValidCommsToken,
  startGmailWatch,
} from '@/lib/comms/gmailClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const startedAt = new Date().toISOString();
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    return NextResponse.json(
      { ok: false, error: 'GMAIL_PUBSUB_TOPIC env var not configured' },
      { status: 500 }
    );
  }

  // Pull every Comms-flagged token row.
  const { data: tokens, error } = await supabaseAdmin
    .from('gmail_tokens')
    .select('*')
    .or('is_comms_mailbox.eq.true,is_comms_opted_in.eq.true');

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results = [];
  let renewed = 0;
  let failed = 0;

  for (const tokenRow of tokens || []) {
    const userEmail = tokenRow.user_email;
    try {
      const accessToken = await getValidCommsToken(tokenRow);
      if (!accessToken) {
        throw new Error('token refresh failed');
      }

      const watchResp = await startGmailWatch(accessToken, topicName);
      // watchResp: { historyId: "12345", expiration: "ms-epoch-string" }

      const expirationMs = Number(watchResp?.expiration);
      const expirationIso = Number.isFinite(expirationMs)
        ? new Date(expirationMs).toISOString()
        : null;

      // Persist the new baseline. We update last_history_id only if
      // the mailbox doesn't already have one (don't clobber a more
      // recent webhook-driven baseline).
      const updates = {
        watch_expires_at: expirationIso,
        updated_at: new Date().toISOString(),
      };
      if (!tokenRow.last_history_id && watchResp?.historyId) {
        updates.last_history_id = String(watchResp.historyId);
      }

      await supabaseAdmin
        .from('gmail_tokens')
        .update(updates)
        .eq('id', tokenRow.id);

      results.push({
        user_email: userEmail,
        gmail_address: tokenRow.gmail_address,
        ok: true,
        expiration: expirationIso,
        historyId: watchResp?.historyId,
        baselined: !tokenRow.last_history_id,
      });
      renewed += 1;
    } catch (err) {
      const message = err?.message || String(err);
      console.warn('[comms-cron/refresh-watch] failed for', userEmail, message);
      results.push({
        user_email: userEmail,
        gmail_address: tokenRow.gmail_address,
        ok: false,
        error: message,
      });
      failed += 1;
    }
  }

  await recordCronRun({
    cron: 'gmail_refresh_watch',
    result: failed > 0 ? 'partial' : 'ok',
    summary: {
      total: (tokens || []).length,
      renewed,
      failed,
    },
  });

  return NextResponse.json({
    ok: failed === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    total: (tokens || []).length,
    renewed,
    failed,
    results,
  });
}

// POST for manual triggers (curl/PowerShell).
export async function POST(request) {
  return GET(request);
}
