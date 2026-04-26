// ============================================================
// /api/comms-cron/classify-pending  ⚠️ DEPRECATED in Stage 3c
// ------------------------------------------------------------
// This cron used to run the Week-2 auto-classifier on every
// `received` message. Stage 3 redesign replaced auto-classification
// with human-first triage:
//   - Humans pick a tag at /communications/triage
//   - The new /api/comms-cron/extract-pending cron runs OCR + LLM
//     extraction on triaged messages
//
// This route is kept as a no-op so:
//   - vercel.json's cron registration doesn't break if it lingers
//   - any external monitoring still gets a healthy 200
//   - operators get a clear "this is gone, look at extract-pending"
//     signal in the response body
//
// Bearer-secret auth still required so the route can't be hit by
// random callers.
// ============================================================

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/comms/session';
import { recordCronRun } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const startedAt = new Date().toISOString();

  // Mark the no-op tick in activity_log so dashboards see the
  // deprecated cron is still being invoked (if it is) and the
  // operator can stop calling it.
  await recordCronRun({
    cron: 'classify_pending',
    result: 'deprecated',
    summary: {
      replacement: '/api/comms-cron/extract-pending',
      message: 'Auto-classification was retired in Stage 3c. Triage is human-first; extraction runs via the new cron.',
    },
  });

  return NextResponse.json({
    ok: true,
    deprecated: true,
    replacement: '/api/comms-cron/extract-pending',
    message:
      'classify-pending was retired in Stage 3c. The new pipeline is human-first triage at /communications/triage, ' +
      'with OCR+LLM extraction handled by /api/comms-cron/extract-pending.',
    startedAt,
    finishedAt: new Date().toISOString(),
  });
}

export async function POST(request) {
  return GET(request);
}
