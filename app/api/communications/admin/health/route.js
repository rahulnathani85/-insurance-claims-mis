// ============================================================
// /api/communications/admin/health
// ------------------------------------------------------------
// Admin-only kill-switch + health surface.
//
// GET   - returns:
//   {
//     config: { ...comms_config row... },
//     ingestion_runs:      [last 20],
//     classification_runs: [last 20],
//     audit:               [last 30 mailbox_audit rows]
//   }
//
// PATCH - body:
//   { scope: 'ingestion' | 'classification' | 'execution' | 'auto_create_claim',
//     paused: bool }
//   Updates comms_config, busts the in-process cache, records
//   an audit + activity-log entry, returns the updated config.
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/comms/session';
import { bustCommsConfigCache } from '@/lib/comms/killSwitch';
import { recordMailboxEvent } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCOPES = ['ingestion', 'classification', 'execution', 'auto_create_claim'];

export async function GET(request) {
  const gate = await requireAdmin(request);
  if (gate.errorResponse) return gate.errorResponse;

  const [
    { data: config },
    { data: ingestRuns },
    { data: classifyRuns },
    { data: audit },
    { data: cronActivity },
  ] = await Promise.all([
    supabaseAdmin.from('comms_config').select('*').eq('id', 1).single(),
    supabaseAdmin
      .from('ingestion_runs')
      .select(
        'id, source, mailbox_user_email, company, started_at, completed_at, messages_fetched, messages_new, messages_failed, error_message'
      )
      .order('started_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('classification_runs')
      .select(
        'id, trigger, started_at, completed_at, messages_attempted, messages_successful, messages_failed, messages_skipped, provider_primary, provider_fallback_used, error_message'
      )
      .order('started_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('mailbox_audit')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30),
    // Stage 2 enhancement: surface cron + kill-switch activity from
    // activity_log so operators can see paused/ok/error transitions
    // without leaving the page or running SQL.
    supabaseAdmin
      .from('activity_log')
      .select('id, created_at, action, details, user_email')
      .or('action.like.comms_cron_%,action.like.comms_%paused,action.like.comms_%resumed')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  return NextResponse.json({
    config: config || null,
    ingestion_runs: ingestRuns || [],
    classification_runs: classifyRuns || [],
    audit: audit || [],
    cron_activity: cronActivity || [],
  });
}

export async function PATCH(request) {
  const gate = await requireAdmin(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const scope = String(body.scope || '').toLowerCase();
  if (!SCOPES.includes(scope)) {
    return NextResponse.json(
      { error: `scope must be one of ${SCOPES.join(', ')}` },
      { status: 400 }
    );
  }
  const paused = !!body.paused;
  const flagCol = `${scope}_paused`;
  const tsCol = `${scope}_paused_at`;

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('comms_config')
    .update({
      [flagCol]: paused,
      [tsCol]: paused ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
      updated_by: user.email,
    })
    .eq('id', 1)
    .select()
    .single();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Force the next cron tick to re-read fresh state.
  bustCommsConfigCache();

  // Audit + activity-log mirror.
  await recordMailboxEvent({
    event: paused ? `${scope}_paused` : `${scope}_resumed`,
    actor_email: user.email,
    details: { scope, paused },
  });

  return NextResponse.json({ ok: true, config: updated });
}
