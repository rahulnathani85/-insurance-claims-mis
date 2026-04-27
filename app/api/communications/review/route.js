// ============================================================
// /api/communications/review
// ------------------------------------------------------------
// Stage 5 — Human review queue API.
//
// GET  — lists pending_review messages that did NOT auto-route
//         (below confidence threshold or invalid extraction).
//         Includes classification confidence + extraction data
//         so the UI can show why it was held back.
//
// POST — human manually approves or rejects a message.
//   { message_id, action: 'approve' | 'reject', override_claim_id? }
//   approve → calls executeRouting() ignoring threshold guard
//   reject  → sets status = 'rejected'
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { recordPortalActivity } from '@/lib/comms/auditLog';
import { executeRouting } from '@/lib/comms/executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;

export async function GET(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const companyParam = searchParams.get('company');

  const userCompanyKey = String(user.company || '').toLowerCase();
  const isMultiCompany = ['all', 'development'].includes(userCompanyKey);
  const scopeCompany = isMultiCompany ? (companyParam || null) : user.company;

  let msgQuery = supabaseAdmin
    .from('inbox_messages')
    .select('id, from_address, from_display, subject, received_at, status, company, claim_id', { count: 'exact' })
    .eq('status', 'pending_review')
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (scopeCompany) msgQuery = msgQuery.eq('company', scopeCompany);

  const { data: messages, count, error } = await msgQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!messages || messages.length === 0) {
    return NextResponse.json({ total: 0, limit, offset, messages: [] });
  }

  const ids = messages.map((m) => m.id);

  // Fetch active classifications + extraction results in two queries.
  const [{ data: clsRows }, { data: extRows }] = await Promise.all([
    supabaseAdmin
      .from('message_classifications')
      .select('message_id, tag, confidence, classified_by')
      .in('message_id', ids)
      .eq('is_active', true),
    supabaseAdmin
      .from('extraction_results')
      .select('message_id, tag, extracted_data, validation_errors, is_valid')
      .in('message_id', ids)
      .order('created_at', { ascending: false }),
  ]);

  // Fetch auto_route_threshold for each tag.
  const tagSet = new Set((clsRows || []).map((c) => c.tag).filter(Boolean));
  const { data: tagDefs } = await supabaseAdmin
    .from('tag_definitions')
    .select('tag, auto_route_threshold, display_label')
    .in('tag', [...tagSet]);
  const tagMap = Object.fromEntries((tagDefs || []).map((t) => [t.tag, t]));

  const clsMap = {};
  for (const c of clsRows || []) clsMap[c.message_id] = c;

  // Keep only the latest extraction per message.
  const extMap = {};
  for (const e of extRows || []) {
    if (!extMap[e.message_id]) extMap[e.message_id] = e;
  }

  const enriched = messages.map((m) => {
    const cls = clsMap[m.id];
    const ext = extMap[m.id];
    const td = cls ? tagMap[cls.tag] : null;
    const threshold = td?.auto_route_threshold ?? null;
    const confidence = cls?.confidence ?? null;
    const belowThreshold = threshold !== null && confidence !== null && confidence < threshold;
    const invalidExtraction = ext ? !ext.is_valid : true;

    return {
      ...m,
      classification: cls || null,
      extraction: ext || null,
      tag_label: td?.display_label || cls?.tag || null,
      threshold,
      confidence,
      held_reason: belowThreshold
        ? `confidence ${confidence?.toFixed(2)} < threshold ${threshold}`
        : invalidExtraction
        ? 'extraction has validation errors'
        : 'pending review',
    };
  });

  return NextResponse.json({ total: count ?? messages.length, limit, offset, messages: enriched });
}

export async function POST(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { message_id, action, override_claim_id } = body;
  if (!message_id || !action) {
    return NextResponse.json({ error: 'message_id and action are required' }, { status: 400 });
  }
  if (!['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
  }

  // Load message to verify company scope.
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, status, company')
    .eq('id', message_id)
    .single();
  if (msgErr || !message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  if (message.status !== 'pending_review') {
    return NextResponse.json({ error: `Message is not in pending_review (status: ${message.status})` }, { status: 409 });
  }

  if (action === 'reject') {
    await supabaseAdmin
      .from('inbox_messages')
      .update({ status: 'rejected' })
      .eq('id', message_id);

    await recordPortalActivity({
      user_email: user.email,
      user_name: user.name,
      action: 'comms_message_rejected',
      entity_type: 'inbox_message',
      details: { message_id },
      company: message.company || 'NISLA',
    });

    return NextResponse.json({ ok: true, action: 'rejected', message_id });
  }

  // action === 'approve': run executeRouting, overriding the threshold guard.
  // Temporarily patch the message claim_id if human provided one.
  if (override_claim_id) {
    await supabaseAdmin
      .from('inbox_messages')
      .update({ claim_id: override_claim_id })
      .eq('id', message_id);
  }

  // Force-route by temporarily bumping the extraction's is_valid to true
  // and using a confidence of 1.0 (human override).
  // We handle this by calling executeRouting which re-reads the DB,
  // but we patch the classification confidence to meet threshold.
  const { data: cls } = await supabaseAdmin
    .from('message_classifications')
    .select('id, confidence, tag')
    .eq('message_id', message_id)
    .eq('is_active', true)
    .maybeSingle();

  // Temporarily set confidence = 1.0 so executeRouting's threshold guard passes.
  if (cls) {
    await supabaseAdmin
      .from('message_classifications')
      .update({ confidence: 1.0 })
      .eq('id', cls.id);
  }

  // Temporarily set is_valid = true on the latest extraction.
  const { data: ext } = await supabaseAdmin
    .from('extraction_results')
    .select('id')
    .eq('message_id', message_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ext) {
    await supabaseAdmin
      .from('extraction_results')
      .update({ is_valid: true, edited_by_user: true, edited_by: user.email })
      .eq('id', ext.id);
  }

  const result = await executeRouting(message_id, { triggeredBy: `human:${user.email}` });

  // Restore original confidence if we changed it.
  if (cls && cls.confidence !== null) {
    await supabaseAdmin
      .from('message_classifications')
      .update({ confidence: cls.confidence })
      .eq('id', cls.id);
  }

  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name,
    action: 'comms_message_approved',
    entity_type: 'inbox_message',
    details: { message_id, routing_result: result },
    company: message.company || 'NISLA',
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: 'approved', message_id, routing: result });
}
