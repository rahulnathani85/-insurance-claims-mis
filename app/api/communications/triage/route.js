// ============================================================
// /api/communications/triage
// ------------------------------------------------------------
// Stage 3b — human-first triage endpoint. The user picks a
// workflow tag for an inbox_messages row, OR dismisses it
// (skip / not relevant).
//
// POST body:
//   {
//     message_id:  uuid,
//     action:      'classify' | 'dismiss',
//     tag:         workflow_tag enum value      (required if action='classify')
//     reason:      free text dismiss reason     (optional, action='dismiss' only)
//   }
//
// Behavior:
//   action='classify':
//     - Validates the tag exists in tag_definitions and is enabled
//     - Inserts a message_classifications row with
//       classified_by = 'manual:<user.email>', is_active=true.
//       The DB trigger flips any prior active classification to
//       inactive.
//     - Updates inbox_messages: status='classifying',
//       triaged_by=user.email, triaged_at=now()
//     - Audits a 'comms_message_triaged' event
//     - Stage 3c will pick the message up via the new extractor
//       cron and run OCR+LLM extraction. For now the message just
//       sits in 'classifying' until 3c lands.
//
//   action='dismiss':
//     - Updates inbox_messages: status='dismissed',
//       dismissed_by=user.email, dismissed_at=now(),
//       dismiss_reason=reason
//     - Audits a 'comms_message_dismissed' event
//     - No classification, no AI work — terminal.
//
// Company scoping: a NISLA user can't triage Acuere messages.
// 'All' / 'Development' role can triage anything.
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { recordTriageEvent } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ACTIONS = new Set(['classify', 'dismiss']);
const MULTI_COMPANY_ROLES = new Set(['all', 'development']);

export async function POST(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messageId = body.message_id;
  const action = String(body.action || '').toLowerCase();
  const tag = body.tag ? String(body.tag).trim() : null;
  const reason = body.reason ? String(body.reason).trim() : null;

  if (!messageId) {
    return NextResponse.json({ error: 'message_id is required' }, { status: 400 });
  }
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` },
      { status: 400 }
    );
  }

  // 1. Load message + verify access.
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, status, company, subject, from_address')
    .eq('id', messageId)
    .single();
  if (msgErr || !message) {
    return NextResponse.json(
      { error: msgErr?.message || 'message not found' },
      { status: 404 }
    );
  }

  // Company scoping.
  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = MULTI_COMPANY_ROLES.has(userCompanyKey);
  if (!isMultiCompany && user.company !== message.company) {
    return NextResponse.json(
      { error: 'forbidden: cross-company access' },
      { status: 403 }
    );
  }

  // Idempotency guard: only allow triage on a message in 'received'
  // status. Re-classifying an already-triaged message is a separate
  // operation we'll add later (manual reclassify endpoint).
  if (message.status !== 'received') {
    return NextResponse.json(
      {
        error: `message status is '${message.status}'; triage only allowed on 'received'`,
      },
      { status: 409 }
    );
  }

  if (action === 'dismiss') {
    return handleDismiss({ message, user, reason });
  }

  return handleClassify({ message, user, tag });
}

// ------------------------------------------------------------
// Dismiss handler — terminal state, no AI work.
// ------------------------------------------------------------
async function handleDismiss({ message, user, reason }) {
  const now = new Date().toISOString();

  const { error: upErr } = await supabaseAdmin
    .from('inbox_messages')
    .update({
      status: 'dismissed',
      dismissed_by: user.email,
      dismissed_at: now,
      dismiss_reason: reason,
    })
    .eq('id', message.id)
    .eq('status', 'received'); // race-safe: only flip if still 'received'

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await recordTriageEvent({
    action: 'dismissed',
    message_id: message.id,
    reason,
    actor: user.email,
    company: message.company,
  });

  return NextResponse.json({
    ok: true,
    action: 'dismissed',
    message_id: message.id,
    dismissed_at: now,
  });
}

// ------------------------------------------------------------
// Classify handler — inserts message_classifications, flips
// status to 'classifying'. Stage 3c's extractor cron picks it up.
// ------------------------------------------------------------
async function handleClassify({ message, user, tag }) {
  if (!tag) {
    return NextResponse.json(
      { error: 'tag is required when action=classify' },
      { status: 400 }
    );
  }

  // Validate tag exists in tag_definitions + is enabled.
  const { data: tagRow } = await supabaseAdmin
    .from('tag_definitions')
    .select('tag, enabled')
    .eq('tag', tag)
    .eq('enabled', true)
    .maybeSingle();
  if (!tagRow) {
    return NextResponse.json(
      { error: `tag '${tag}' not found or disabled` },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // Insert classification (active). The DB trigger
  // ensure_single_active_classification will flip any prior active row
  // to inactive — useful if we ever expose a re-triage flow.
  const { data: insertedCls, error: clsErr } = await supabaseAdmin
    .from('message_classifications')
    .insert([{
      message_id: message.id,
      tag,
      confidence: 1.00, // human-picked = full confidence
      classifier_model: 'human',
      reasoning: 'Human triage',
      classified_by: `manual:${user.email}`,
      is_active: true,
      company: message.company,
    }])
    .select('id')
    .single();
  if (clsErr || !insertedCls) {
    return NextResponse.json(
      { error: clsErr?.message || 'classification insert failed' },
      { status: 500 }
    );
  }

  // Flip status — race-safe: only if still 'received'.
  const { error: upErr } = await supabaseAdmin
    .from('inbox_messages')
    .update({
      status: 'classifying',
      triaged_by: user.email,
      triaged_at: now,
    })
    .eq('id', message.id)
    .eq('status', 'received');
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await recordTriageEvent({
    action: 'triaged',
    message_id: message.id,
    tag,
    actor: user.email,
    company: message.company,
  });

  return NextResponse.json({
    ok: true,
    action: 'classified',
    message_id: message.id,
    tag,
    classification_id: insertedCls.id,
    triaged_at: now,
    note: 'Stage 3c extractor cron will pick this up and run OCR+LLM on the next tick.',
  });
}
