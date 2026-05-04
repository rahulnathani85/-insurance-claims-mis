// =============================================================================
// /api/comms-cron/cleanup-abandoned-manual-claims
// =============================================================================
// Daily cron that auto-discards empty MANUAL/* draft shells the clerk
// abandoned. Pairs with the per-row "Discard draft" button on
// /communications/intimations: the button is the manual escape hatch, this
// cron is the safety net for clerks who close the tab and forget.
//
// What it deletes (every condition must hold):
//   1. ref_number LIKE 'MANUAL/%'         — only manual drafts. INTAKE/*
//                                            placeholders trace back to a real
//                                            email and are owned by triage.
//   2. phase = 'intimation'                — never registered.
//   3. created_at < now() - INTERVAL '48h' — soak time so a clerk who is
//                                            actively working on the form
//                                            (just clicked New) isn't surprised
//                                            by the row vanishing under them.
//   4. Truly empty: insured_name IS NULL
//                   AND policy_number IS NULL
//                   AND claim_number IS NULL
//                   AND date_loss IS NULL
//                   AND loss_location IS NULL
//      Any non-null mandatory field signals the clerk has actually done work,
//      so we leave it alone — they can finish or hit Discard themselves.
//   5. No claim_documents rows attached (clerk hasn't uploaded anything).
//
// What it does NOT do:
//   - Touch INTAKE/ placeholders (those have a real source email and need
//     triage / dismissal, not silent deletion).
//   - Decrement any ref counter (MANUAL placeholders never bumped one — the
//     counter only increments at submit-time placeholder→real promotion).
//   - Rely on `updated_at` for staleness (some auto-extracts mutate
//     extraction rows, not the claim row, so updated_at is unreliable here).
//     `created_at + 48h` is the simple, predictable signal.
//
// Auth: Bearer CRON_SECRET — same gate as every other comms-cron route.
// Schedule: 0 4 * * *  (4:00 AM UTC = 9:30 AM IST). Off-peak; runs after the
//           gmail watch refresh (3:00 UTC) so neither cron contends.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCronSecret } from '@/lib/comms/session';
import { recordCronRun, recordPortalActivity } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 48 hours of soak time — enough that a clerk who started a draft yesterday
// and comes back today still finds it. Configurable via env if a stricter
// (or laxer) cleanup window becomes useful operationally.
const STALENESS_HOURS = Number(
  process.env.MANUAL_DRAFT_CLEANUP_HOURS || 48
);

export async function GET(request) {
  const authFail = requireCronSecret(request);
  if (authFail) return authFail;

  const startedAt = new Date().toISOString();
  const cutoffIso = new Date(
    Date.now() - STALENESS_HOURS * 3600 * 1000
  ).toISOString();

  // 1. Pull candidate rows: MANUAL/, intimation phase, older than the cutoff,
  //    with all mandatory fields still null. We DON'T filter on claim_documents
  //    here — that's a join we'll do per-row to keep the query simple and
  //    avoid teaching PostgREST about the relationship.
  //
  //    Note: claims.claim_amount_intimated, claims.peril_type, claims.sum_insured
  //    are provenance-only ghost columns (CLAUDE.md §13a) and absent from the
  //    table, so we can't include them in the IS NULL filter. The five fields
  //    we do check are real columns on the live schema.
  const { data: candidates, error: fetchErr } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, company, created_at')
    .like('ref_number', 'MANUAL/%')
    .eq('phase', 'intimation')
    .lt('created_at', cutoffIso)
    .is('insured_name', null)
    .is('policy_number', null)
    .is('claim_number', null)
    .is('date_loss', null)
    .is('loss_location', null);

  if (fetchErr) {
    await recordCronRun({
      cron: 'cleanup_abandoned_manual_claims',
      result: 'error',
      summary: { error: fetchErr.message },
    });
    return NextResponse.json(
      { ok: false, error: fetchErr.message },
      { status: 500 }
    );
  }

  let scanned = (candidates || []).length;
  let deleted = 0;
  let skippedHasDocuments = 0;
  let failed = 0;
  const results = [];

  for (const row of candidates || []) {
    // 2. Per-row guard: skip if the clerk uploaded any document.
    const { count: docCount, error: countErr } = await supabaseAdmin
      .from('claim_documents')
      .select('id', { head: true, count: 'exact' })
      .eq('claim_id', row.id);

    if (countErr) {
      console.warn(
        '[cleanup-abandoned-manual-claims] doc count failed for',
        row.id,
        countErr.message
      );
      // Treat count failure as "skip this row" — better to leave a draft
      // alive one more day than to delete a row whose document state we
      // couldn't verify.
      failed += 1;
      results.push({ id: row.id, ref_number: row.ref_number, ok: false, reason: 'doc_count_failed' });
      continue;
    }

    if ((docCount || 0) > 0) {
      skippedHasDocuments += 1;
      results.push({
        id: row.id,
        ref_number: row.ref_number,
        ok: false,
        reason: 'has_documents',
        document_count: docCount,
      });
      continue;
    }

    // 3. Delete. Child tables with ON DELETE CASCADE
    //    (claim_registration_extractions, claim_lifecycle*, etc.) are wiped
    //    automatically.
    const { error: delErr } = await supabaseAdmin
      .from('claims')
      .delete()
      .eq('id', row.id);

    if (delErr) {
      failed += 1;
      results.push({
        id: row.id,
        ref_number: row.ref_number,
        ok: false,
        reason: delErr.message,
      });
      continue;
    }

    // 4. Audit trail. The row is gone but activity_log keeps the breadcrumb.
    await recordPortalActivity({
      user_email: null, // cron, no human actor
      user_name: 'cleanup-abandoned-manual-claims (cron)',
      action: 'manual_claim_draft_auto_discarded',
      entity_type: 'claim',
      entity_id: row.id,
      claim_id: row.id,
      ref_number: row.ref_number,
      company: row.company || 'NISLA',
      details: {
        created_at: row.created_at,
        cutoff_iso: cutoffIso,
        staleness_hours: STALENESS_HOURS,
      },
    });

    deleted += 1;
    results.push({ id: row.id, ref_number: row.ref_number, ok: true });
  }

  await recordCronRun({
    cron: 'cleanup_abandoned_manual_claims',
    result: failed > 0 ? 'partial' : 'ok',
    summary: {
      scanned,
      deleted,
      skipped_has_documents: skippedHasDocuments,
      failed,
      staleness_hours: STALENESS_HOURS,
    },
  });

  return NextResponse.json({
    ok: failed === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    cutoff_iso: cutoffIso,
    staleness_hours: STALENESS_HOURS,
    scanned,
    deleted,
    skipped_has_documents: skippedHasDocuments,
    failed,
    results,
  });
}

// POST mirrors GET so manual triggers (curl/PowerShell) work.
export async function POST(request) {
  return GET(request);
}
