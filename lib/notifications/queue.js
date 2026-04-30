// =============================================================================
// lib/notifications/queue.js
// =============================================================================
// Helpers for inserting rows into notification_queue. Routes call these from
// /api/claims/[id]/register and /api/claims/[id]/team-assign.
//
// Errors here are swallowed (logged via observability) so a notification
// failure never blocks the caller's primary action — that's the contract
// from registration spec §11: "Failures retry; never block registration."
// =============================================================================

import { renderTemplate } from './templates.js';
import { captureError } from '../observability.js';

const ILA_REMINDER_24H_OFFSET_MS = -24 * 60 * 60 * 1000;
const ILA_REMINDER_6H_OFFSET_MS  = -6 * 60 * 60 * 1000;

export async function enqueue(supabase, params) {
  if (!params?.notification_type || !params?.recipient_email) return null;

  let rendered;
  try {
    rendered = renderTemplate(params.notification_type, params.context || {});
  } catch (e) {
    captureError(e, { area: 'notifications-queue', notification_type: params.notification_type });
    return null;
  }

  const insert = {
    notification_type: params.notification_type,
    channel: params.channel || 'email',
    claim_id: params.claim_id || null,
    recipient_email: params.recipient_email,
    recipient_name: params.recipient_name || null,
    recipient_phone: params.recipient_phone || null,
    subject: rendered.subject,
    body_text: rendered.body_text,
    body_html: rendered.body_html,
    context: params.context || {},
    scheduled_at: params.scheduled_at || new Date().toISOString(),
    status: 'pending',
    company: params.company || 'NISLA',
    created_by: params.created_by || null,
    max_attempts: params.max_attempts || 3,
  };

  const { data, error } = await supabase
    .from('notification_queue')
    .insert([insert])
    .select()
    .single();

  if (error) {
    captureError(error, { area: 'notifications-queue', notification_type: params.notification_type });
    return null;
  }
  return data;
}

// Caller-friendly wrappers — encapsulate the var contract per template.

export async function enqueueRegistrationAck(supabase, { claim, dealing_officer, lead_surveyor, portal_url }) {
  if (!dealing_officer?.email) return null;
  return enqueue(supabase, {
    notification_type: 'registration_ack',
    claim_id: claim.id,
    recipient_email: dealing_officer.email,
    recipient_name: dealing_officer.name,
    company: claim.company,
    context: {
      recipient_name: dealing_officer.name,
      claim_ref: claim.ref_number || claim.id,
      insured_name: claim.insured_name,
      insurer_name: claim.insurer_name,
      complexity_tier: claim.complexity_tier,
      ila_due_at: claim.ila_due_at,
      fsr_due_at: claim.fsr_due_at,
      lead_name: lead_surveyor?.name,
      lead_email: lead_surveyor?.email,
      lead_phone: lead_surveyor?.phone,
      portal_url,
      company: claim.company,
    },
  });
}

export async function enqueueAssignmentNotify(supabase, { claim, surveyor, role, portal_url }) {
  if (!surveyor?.email) return null;
  return enqueue(supabase, {
    notification_type: 'assignment_notify',
    claim_id: claim.id,
    recipient_email: surveyor.email,
    recipient_name: surveyor.name,
    company: claim.company,
    context: {
      recipient_name: surveyor.name,
      role,
      claim_ref: claim.ref_number || claim.id,
      insured_name: claim.insured_name,
      insurer_name: claim.insurer_name,
      peril: claim.peril_type || claim.lob,
      date_loss: claim.date_loss,
      sum_insured: claim.sum_insured,
      loss_location: claim.loss_location,
      ila_due_at: claim.ila_due_at,
      portal_url,
      company: claim.company,
    },
  });
}

export async function enqueueIlaReminders(supabase, { claim, lead_surveyor, portal_url }) {
  if (!claim?.ila_due_at || !lead_surveyor?.email) return [];
  const due = new Date(claim.ila_due_at);
  if (Number.isNaN(due.getTime())) return [];

  const make = (offsetMs, type) => ({
    notification_type: type,
    claim_id: claim.id,
    recipient_email: lead_surveyor.email,
    recipient_name: lead_surveyor.name,
    company: claim.company,
    scheduled_at: new Date(due.getTime() + offsetMs).toISOString(),
    context: {
      recipient_name: lead_surveyor.name,
      claim_ref: claim.ref_number || claim.id,
      insured_name: claim.insured_name,
      ila_due_at: claim.ila_due_at,
      hours_remaining: Math.round(-offsetMs / (60 * 60 * 1000)),
      portal_url,
      company: claim.company,
    },
  });

  const inserts = [
    make(ILA_REMINDER_24H_OFFSET_MS, 'ila_reminder_24h'),
    make(ILA_REMINDER_6H_OFFSET_MS, 'ila_reminder_6h'),
    make(0, 'ila_overdue'),  // fires at the deadline; sender treats it as overdue
  ];

  const out = [];
  for (const i of inserts) {
    out.push(await enqueue(supabase, i));
  }
  return out.filter(Boolean);
}

// -----------------------------------------------------------------------------
// Pluggable sender. The cron worker calls send(notification) and expects
// { ok, error?, provider_id? }. The default implementation logs to the
// `last_error` column with a clear "no sender configured" message — this is
// safe and fully observable until SMTP/Gmail-send is wired.
// -----------------------------------------------------------------------------

export const DEFAULT_SENDER = {
  async send(notification) {
    return {
      ok: false,
      error: 'No outbound sender configured. Wire lib/notifications/queue.js DEFAULT_SENDER to SMTP / Gmail OAuth before notifications can leave the queue.',
    };
  },
};

// Mark a row sent and stamp sent_at.
export async function markSent(supabase, id, providerId = null) {
  const { error } = await supabase
    .from('notification_queue')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      last_error: providerId ? `provider_id=${providerId}` : null,
    })
    .eq('id', id);
  if (error) captureError(error, { area: 'notifications-queue', op: 'markSent', id });
}

// Mark a row failed/retry. Bumps attempt_count; fail-permanent if at max.
export async function markFailed(supabase, id, errorMessage) {
  const { data: row } = await supabase
    .from('notification_queue')
    .select('id, attempt_count, max_attempts')
    .eq('id', id)
    .single();
  if (!row) return;

  const nextAttempt = (row.attempt_count || 0) + 1;
  const exhausted = nextAttempt >= (row.max_attempts || 3);

  await supabase
    .from('notification_queue')
    .update({
      status: exhausted ? 'failed' : 'pending',
      attempt_count: nextAttempt,
      last_attempt_at: new Date().toISOString(),
      last_error: String(errorMessage || '').slice(0, 1000),
    })
    .eq('id', id);
}
