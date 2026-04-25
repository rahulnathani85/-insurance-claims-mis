// ============================================================
// /api/communications/classify
// ------------------------------------------------------------
// Manual / ad-hoc classification endpoint. Admin-only.
//
// Accepts either:
//   { "message_id": "<uuid>" }                 — classify one
//   { "message_ids": ["<uuid>", "<uuid>"] }    — classify many in series
//
// The cron-driven classifier at /api/comms-cron/classify-pending
// is the expected hot path. This route exists so ops can re-run
// a failed classification or force a fresh pass after editing a
// tag definition.
//
// Bypasses the "skip if already classified" guard by passing
// triggeredBy: user.email (so even already-classified messages
// get a new active row, and the trigger retires the previous one).
// ============================================================

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/comms/session';
import { classifyMessage } from '@/lib/comms/classifier';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const gate = await requireAdmin(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ids = Array.isArray(body.message_ids)
    ? body.message_ids
    : body.message_id
    ? [body.message_id]
    : [];

  if (ids.length === 0) {
    return NextResponse.json(
      { error: 'Provide "message_id" or "message_ids" (array of UUIDs)' },
      { status: 400 }
    );
  }
  if (ids.length > 50) {
    return NextResponse.json(
      { error: 'Batch size capped at 50 messages per request' },
      { status: 400 }
    );
  }

  // Open a classification_runs row for this manual batch so the
  // metrics dashboard (Week 5) picks it up alongside cron runs.
  const { data: runRow } = await supabaseAdmin
    .from('classification_runs')
    .insert([{
      trigger: 'manual',
      triggered_by: user.email,
    }])
    .select('id')
    .single();
  const runId = runRow?.id || null;

  const results = [];
  let attempted = 0;
  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let providerPrimary = null;
  let providerFallbackUsed = 0;
  let firstError = null;

  for (const mid of ids) {
    attempted += 1;
    try {
      const r = await classifyMessage({ messageId: mid, triggeredBy: user.email });
      results.push(r);
      if (r.ok) {
        if (r.skipped) {
          skipped += 1;
        } else {
          successful += 1;
          if (!providerPrimary) providerPrimary = r.provider;
          if (r.provider === 'claude') providerFallbackUsed += 1;
        }
      } else {
        failed += 1;
        if (!firstError) firstError = r.error;
      }
    } catch (err) {
      failed += 1;
      const msg = err?.message || String(err);
      if (!firstError) firstError = msg;
      results.push({ ok: false, messageId: mid, error: msg });
    }
  }

  if (runId) {
    await supabaseAdmin
      .from('classification_runs')
      .update({
        completed_at: new Date().toISOString(),
        messages_attempted: attempted,
        messages_successful: successful,
        messages_failed: failed,
        messages_skipped: skipped,
        error_message: firstError,
        provider_primary: providerPrimary,
        provider_fallback_used: providerFallbackUsed,
      })
      .eq('id', runId);
  }

  return NextResponse.json({
    ok: failed === 0,
    runId,
    attempted,
    successful,
    failed,
    skipped,
    providerPrimary,
    providerFallbackUsed,
    firstError,
    results,
  });
}
