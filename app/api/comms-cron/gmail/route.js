// ============================================================
// /api/comms-cron/gmail
// ------------------------------------------------------------
// Scheduled endpoint invoked by Vercel Cron every 5 minutes
// (see vercel.json). Iterates every row in gmail_tokens where
// is_comms_mailbox = true OR is_comms_opted_in = true and runs
// ingestFromMailbox on each in series.
//
// Auth: Authorization: Bearer ${CRON_SECRET}
//   (Vercel Cron injects this automatically when CRON_SECRET
//    is set as a project env var. See requireCronSecret.)
//
// Runtime: Node.js (not edge) because it uses Buffer and the
// service-role Supabase client.
// ============================================================

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/comms/session';
import { ingestAllCommsMailboxes } from '@/lib/comms/ingestGmail';
import { assertCommsEnabled } from '@/lib/comms/killSwitch';
import { recordCronRun } from '@/lib/comms/auditLog';

// Force Node runtime — we rely on Buffer and service-role access.
export const runtime = 'nodejs';
// Cron runs are write-heavy; never cache.
export const dynamic = 'force-dynamic';
// Allow up to ~5 min so that 2 shared mailboxes x 25 messages each
// with attachment downloads fit comfortably within one cron tick.
export const maxDuration = 300;

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const startedAt = new Date().toISOString();

  // Kill-switch gate: if an admin paused ingestion, return early
  // without touching Gmail or the DB. The audit row records the skip.
  const gate = await assertCommsEnabled('ingestion_paused');
  if (gate.paused) {
    await recordCronRun({
      cron: 'gmail_ingest',
      result: 'paused',
      summary: { since: gate.since },
    });
    return NextResponse.json({
      ok: true,
      skipped: 'paused',
      pausedSince: gate.since,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  }

  try {
    const result = await ingestAllCommsMailboxes();
    await recordCronRun({
      cron: 'gmail_ingest',
      result: result.ok ? 'ok' : 'error',
      summary: {
        mailboxes: (result.mailboxes || []).length,
        error: result.error || null,
      },
    });
    return NextResponse.json({
      ok: result.ok,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: result.error || null,
      mailboxes: result.mailboxes || [],
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[comms-cron/gmail] fatal', message);
    await recordCronRun({
      cron: 'gmail_ingest',
      result: 'error',
      summary: { error: message },
    });
    return NextResponse.json(
      {
        ok: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: message,
      },
      { status: 500 }
    );
  }
}

// POST is accepted too so ops can trigger a run manually via curl.
// Auth is identical (Bearer CRON_SECRET) — no app-user header path.
export async function POST(request) {
  return GET(request);
}
