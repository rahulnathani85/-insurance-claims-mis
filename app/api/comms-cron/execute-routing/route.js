// ============================================================
// /api/comms-cron/execute-routing
// ------------------------------------------------------------
// Stage 5 — Auto-routing sweep cron.
//
// Picks pending_review messages that have a valid extraction
// and a classification confidence >= the tag's auto_route_threshold,
// then calls executeRouting() on each.
//
// Messages below threshold or with invalid extractions are left
// in pending_review for the human review queue at /communications/review.
//
// Auth:  Authorization: Bearer ${CRON_SECRET}
// Runtime: nodejs (uses Supabase admin + DB writes)
// Schedule: vercel.json — typically */5 * * * * (or same as extract-pending)
// ============================================================

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/comms/session';
import { assertCommsEnabled } from '@/lib/comms/killSwitch';
import { recordCronRun } from '@/lib/comms/auditLog';
import { routePendingBatch } from '@/lib/comms/executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_LIMIT = 20;

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const startedAt = new Date().toISOString();

  const gate = await assertCommsEnabled('execution_paused');
  if (gate.paused) {
    await recordCronRun({
      cron: 'execute_routing',
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
    const summary = await routePendingBatch({ limit: BATCH_LIMIT, triggeredBy: 'auto' });

    await recordCronRun({
      cron: 'execute_routing',
      result: summary.firstError ? 'error' : 'ok',
      summary: {
        attempted: summary.attempted,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
      },
    });

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      attempted: summary.attempted,
      succeeded: summary.succeeded,
      failed: summary.failed,
      skipped: summary.skipped,
      firstError: summary.firstError,
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[comms-cron/execute-routing] fatal', message);
    await recordCronRun({
      cron: 'execute_routing',
      result: 'error',
      summary: { error: message },
    });
    return NextResponse.json(
      { ok: false, startedAt, finishedAt: new Date().toISOString(), error: message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  return GET(request);
}
