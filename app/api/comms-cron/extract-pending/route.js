// ============================================================
// /api/comms-cron/extract-pending
// ------------------------------------------------------------
// Stage 3c — runs the OCR + LLM extraction pipeline on messages
// that a human has triaged (status='classifying'). Replaces the
// retired /api/comms-cron/classify-pending endpoint.
//
// Auth: Authorization: Bearer ${CRON_SECRET}
// Runtime: Node.js (uses Buffer + service-role Supabase + AI SDKs).
// Schedule: declared in vercel.json — typically */5 * * * *.
// Kill switch: respects comms_config.classification_paused (we
// reuse the same flag since "extraction" replaces "classification"
// in the new design — semantically still the AI step).
// ============================================================

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/comms/session';
import { assertCommsEnabled } from '@/lib/comms/killSwitch';
import { recordCronRun } from '@/lib/comms/auditLog';
import { extractPendingBatch } from '@/lib/comms/triageExtractor';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 5-min budget: ~10 messages × (a few OCR calls + 1 LLM call).
// Each OCR call ~1-3s, LLM ~3-8s. Generous cap.
export const maxDuration = 300;

const BATCH_LIMIT = 10;

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const startedAt = new Date().toISOString();

  // Kill switch (same flag as classification — extraction is the new "AI step").
  const gate = await assertCommsEnabled('classification_paused');
  if (gate.paused) {
    await recordCronRun({
      cron: 'extract_pending',
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

  // Open a classification_runs row at the top so even a thrown
  // error is captured against a known run id. We reuse the existing
  // table (rather than introducing extraction_runs) since semantically
  // it tracks the same "AI on a message" step.
  const { data: runRow } = await supabaseAdmin
    .from('classification_runs')
    .insert([{ trigger: 'cron', triggered_by: 'auto' }])
    .select('id')
    .single();
  const runId = runRow?.id || null;

  try {
    const summary = await extractPendingBatch({
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
          provider_primary: summary.providersUsed.llm[0] || null,
        })
        .eq('id', runId);
    }

    await recordCronRun({
      cron: 'extract_pending',
      result: summary.firstError ? 'error' : 'ok',
      summary: {
        attempted: summary.attempted,
        successful: summary.successful,
        failed: summary.failed,
        skipped: summary.skipped,
        ocr_pages: summary.totalOcrPages,
        cost_inr: summary.totalCostInr,
        llm_providers: summary.providersUsed.llm,
        ocr_providers: summary.providersUsed.ocr,
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
      totalOcrPages: summary.totalOcrPages,
      totalCostInr: summary.totalCostInr,
      providersUsed: summary.providersUsed,
      firstError: summary.firstError,
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[comms-cron/extract-pending] fatal', message);
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
      cron: 'extract_pending',
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

// POST accepted for manual triggers via curl/PowerShell.
export async function POST(request) {
  return GET(request);
}
