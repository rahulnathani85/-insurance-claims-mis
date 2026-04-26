// ============================================================
// lib/comms/auditLog.js
// ------------------------------------------------------------
// Server-side audit helpers for the Comms module.
//
// Two surfaces:
//   1) recordMailboxEvent(...) — writes to mailbox_audit
//      (Comms-scoped, append-only) AND mirrors to the portal-wide
//      activity_log so admins see it next to other portal events.
//   2) recordPortalActivity(...) — direct write to activity_log.
//      The existing lib/activityLogger.js uses fetch() with a
//      relative URL and only works client-side; this is the
//      server-side equivalent.
//   3) recordCronRun(...) — convenience for cron summary entries.
//
// All helpers are best-effort: on failure they log a warning and
// return without throwing, so an audit-log outage never breaks
// the actual ingest/classify path.
// ============================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

// ------------------------------------------------------------
// recordPortalActivity
// Direct write to activity_log via supabaseAdmin (server-only).
// ------------------------------------------------------------
export async function recordPortalActivity({
  user_email = null,
  user_name = null,
  action,
  entity_type = null,
  entity_id = null,
  claim_id = null,
  ref_number = null,
  details = null,
  company = 'NISLA',
}) {
  if (!action) return;
  try {
    await supabaseAdmin.from('activity_log').insert([{
      user_email,
      user_name,
      action,
      entity_type,
      entity_id: typeof entity_id === 'number' ? entity_id : null,
      claim_id: typeof claim_id === 'number' ? claim_id : null,
      ref_number,
      details:
        details == null
          ? null
          : typeof details === 'string'
          ? details
          : JSON.stringify(details),
      company,
    }]);
  } catch (err) {
    console.warn(
      '[comms/auditLog] activity_log insert failed (non-fatal):',
      err?.message || err
    );
  }
}

// ------------------------------------------------------------
// recordMailboxEvent
// Writes to mailbox_audit AND mirrors to activity_log.
//
// Common events:
//   'connected'          — shared mailbox OAuth callback succeeded
//   'disconnected'       — admin disconnected a shared mailbox
//   'opted_in'           — user opted their personal Gmail in
//   'revoked'            — user revoked their opt-in
//   'ingestion_paused'   — admin toggled the kill switch on
//   'ingestion_resumed'  — admin toggled the kill switch off
//   ...same for classification_/execution_
// ------------------------------------------------------------
export async function recordMailboxEvent({
  event,
  mailbox_email = null,
  company = null,
  actor_email = null,
  details = null,
}) {
  if (!event) return;
  try {
    await supabaseAdmin.from('mailbox_audit').insert([{
      event,
      mailbox_email,
      company,
      actor_email,
      details: details ?? null,
    }]);
  } catch (err) {
    console.warn(
      '[comms/auditLog] mailbox_audit insert failed (non-fatal):',
      err?.message || err
    );
  }

  // Mirror to portal-wide activity log.
  await recordPortalActivity({
    user_email: actor_email,
    action: `comms_${event}`,
    entity_type: 'comms_mailbox',
    details: { mailbox_email, company, ...(details || {}) },
    company: company || 'NISLA',
  });
}

// ------------------------------------------------------------
// recordCronRun
// Convenience: one-liner from cron handlers to mark a tick.
//   cron     - 'gmail_ingest' | 'classify_pending' | 'execute_routing' | ...
//   result   - 'ok' | 'paused' | 'error'
//   summary  - any JSON-serialisable object
// ------------------------------------------------------------
export async function recordCronRun({ cron, result, summary = {} }) {
  await recordPortalActivity({
    action: `comms_cron_${cron}`,
    entity_type: 'comms_cron',
    details: { result, ...summary },
  });
}

// ------------------------------------------------------------
// recordTriageEvent
// Stage 3b: convenience for human-triage events on a single
// inbox_messages row.
//
//   action     - 'triaged' (human picked a tag) | 'dismissed' (skip)
//   message_id - inbox_messages.id
//   tag        - workflow_tag enum value (only for action='triaged')
//   reason     - free text (typically only for 'dismissed')
//   actor      - email of the user who triaged
//   company    - propagated for filtering in the activity feed
// ------------------------------------------------------------
export async function recordTriageEvent({
  action,
  message_id,
  tag = null,
  reason = null,
  actor,
  company = null,
}) {
  if (!action || !message_id) return;
  await recordPortalActivity({
    user_email: actor,
    action: `comms_message_${action}`,
    entity_type: 'inbox_message',
    details: { message_id, tag, reason },
    company: company || 'NISLA',
  });
}
