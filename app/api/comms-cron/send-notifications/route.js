// =============================================================================
// /api/comms-cron/send-notifications
// =============================================================================
// Drains the notification_queue. Picks rows where status='pending' and
// scheduled_at <= now() and attempt_count < max_attempts. For each row, calls
// the configured sender; on success marks 'sent', on failure increments
// attempt_count and either retries (status='pending') or fails permanent
// (status='failed').
//
// Pluggable: the actual outbound-email send is in lib/notifications/queue.js
// DEFAULT_SENDER. Until that's wired to SMTP / Gmail OAuth-send, the sender
// returns ok=false with a clear message logged on the row, and rows
// eventually reach status='failed' after max_attempts. That's intentional —
// the queue is fully observable end-to-end without leaving the codebase.
//
// Auth: Authorization: Bearer ${CRON_SECRET}
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCronSecret } from '@/lib/comms/session';
import { DEFAULT_SENDER, markSent, markFailed } from '@/lib/notifications/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH_LIMIT = 25;

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const now = new Date().toISOString();

  // Pull a batch of due notifications. We skip rows already in 'sending' to
  // avoid double-claiming with a parallel run; if a row was left stuck in
  // 'sending' from a prior crash, an ops-time recovery query is required.
  const { data: pending, error: pendErr } = await supabaseAdmin
    .from('notification_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (pendErr) {
    return NextResponse.json({ error: pendErr.message }, { status: 500 });
  }

  const results = { picked: pending?.length || 0, sent: 0, failed: 0, errors: [] };

  for (const row of pending || []) {
    // Soft-claim so a parallel run doesn't pick the same row.
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from('notification_queue')
      .update({ status: 'sending', last_attempt_at: now })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select()
      .single();
    if (claimErr || !claim) continue;  // someone else got it

    try {
      const result = await DEFAULT_SENDER.send(claim);
      if (result?.ok) {
        await markSent(supabaseAdmin, claim.id, result.provider_id);
        results.sent += 1;
      } else {
        await markFailed(supabaseAdmin, claim.id, result?.error || 'sender returned ok=false');
        results.failed += 1;
        results.errors.push({ id: claim.id, error: result?.error });
      }
    } catch (e) {
      await markFailed(supabaseAdmin, claim.id, e.message);
      results.failed += 1;
      results.errors.push({ id: claim.id, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, ...results, finishedAt: new Date().toISOString() });
}
