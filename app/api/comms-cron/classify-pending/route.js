// ============================================================
// /api/comms-cron/classify-pending
// ------------------------------------------------------------
// Scheduled endpoint (Vercel Cron */5 * * * *) that picks up any
// inbox_messages rows still in status='received' with no active
// classification and runs them through the Week-2 classifier.
//
// Auth: Authorization: Bearer ${CRON_SECRET}
//   (Vercel Cron auto-injects this; same secret the ingest cron
//    uses. See lib/comms/session.requireCronSecret.)
//
// Runtime: Node.js (service-role Supabase + AI SDKs).
// ============================================================

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/comms/session';
import { classifyPendingBatch } from '@/lib/comms/classifier';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { assertCommsEnabled } from '@/lib/comms/killSwitch';
import { recordCronRun } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 5 min budget: up to ~25 messages × ~3–5 s each with room for the
// Gemini primary + Claude fallback on the slow ones.
export const maxDuration = 300;

// Per-tick cap. Kept modest so one tick never monopolises the AI
// quota; if the queue backs up, subsequent ticks drain it.
const BATCH_LIMIT = 25;

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const startedAt = new Date().toISOString();

  // Kill-switch gate: skip the run entirely if classification is paused.
  const gate = await assertCommsEnabled('classification_paused');
  if (gate.paused) {
    await recordCronRun({
      cron: 'classify_pending',
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

  // Open classification_runs row at the top so even a thrown error
  // is captured against a known run id.
  const { data: runRow } = await supabaseAdmin
    .from('classification_runs')
    .insert([{ trigger: 'cron', triggered_by: 'auto' }])
    .select('id')
    .single();
  const runId = runRow?.id || null;

  try {
    const summary = await classifyPendingBatch({
      limit: BATCH_LIMIT,
      triggeredBy: 'auto',
    });

    if (runId) {
      await supabaseAdmin
        .from('classification_runs')
        .update({
          completed_at: new Date().toISOString(),
          messages_attempted: summary.attempted,
          messages_successful: summary.successful,
          messages_failed: summary.failed,
          messages_skipped: summary.skipped,
          error_message: summary.firstError,
          provider_primary: summary.providerPrimary,
          provider_fallback_used: summary.providerFallbackUsed,
        })
        .eq('id', runId);
    }

    await recordCronRun({
      cron: 'classify_pending',
      result: summary.firstError ? 'error' : 'ok',
      summary: {
        attempted: summary.attempted,
        successful: summary.successful,
        failed: summary.failed,
        skipped: summary.skipped,
        provider: summary.providerPrimary,
        fallbacks: summary.providerFallbackUsed,
      },
    });

    return NextResponse.json({
      ok: true,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      attempted: summary.attempted,
      successful: summary.successful,
      failed: summary.failed,
      skipped: summary.skipped,
      providerPrimary: summary.providerPrimary,
      providerFallbackUsed: summary.providerFallbackUsed,
      firstError: summary.firstError,
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[comms-cron/classify-pending] fatal', message);
    if (runId) {
      await supabaseAdmin
        .from('classification_runs')
        .update({
          completed_at: new Date().toISOString(),
          error_message: message,
        })
        .eq('id', runId);
    }
    await recordCronRun({
      cron: 'classify_pending',
      result: 'error',
      summary: { error: message },
    });
    return NextResponse.json(
      {
        ok: false,
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: message,
      },
      { status: 500 }
    );
  }
}

// Allow manual trigger via POST too (same auth). Useful for
// `curl -X POST …/classify-pending -H "Authorization: Bearer $CRON_SECRET"`
// during Week 2 smoke testing.
export async function POST(request) {
  return GET(request);
}
