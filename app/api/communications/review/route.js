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
  const linkedClaimIds = [...new Set(messages.map((m) => m.claim_id).filter(Boolean))];

  // Fetch active classifications + extraction results + linked claim refs.
  const [{ data: clsRows }, { data: extRows }, { data: claimRows }] = await Promise.all([
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
    linkedClaimIds.length > 0
      ? supabaseAdmin.from('claims').select('id, ref_number').in('id', linkedClaimIds)
      : Promise.resolve({ data: [] }),
  ]);
  const claimRefMap = Object.fromEntries((claimRows || []).map((c) => [c.id, c.ref_number]));

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
      linked_ref_number: m.claim_id ? (claimRefMap[m.claim_id] || null) : null,
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

  const {
    message_id,
    action,
    override_claim_id,
    // Approve-time additions (modifications 30-04-2026 §2):
    override_lob,            // M2: clerk-picked LOB
    assigned_surveyor_id,    // M3: lead surveyor assignment on intimation tag
    link_to_ref_number,      // M4: tag message to existing claim by ref_number (any tag)
  } = body;
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

  // M4: tag-to-existing-ref. Bypasses executor — directly link the message to
  // the claim with the matching ref_number (modifications 30-04-2026 §2). Used
  // for non-intimation tags (claim docs, follow-ups, etc.) where the clerk
  // knows which claim this email belongs to.
  if (link_to_ref_number) {
    const ref = String(link_to_ref_number).trim();
    const { data: target } = await supabaseAdmin
      .from('claims')
      .select('id, ref_number, company')
      .eq('ref_number', ref)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: `No claim found with ref ${ref}` }, { status: 404 });
    }

    await supabaseAdmin
      .from('inbox_messages')
      .update({ status: 'auto_routed', claim_id: target.id })
      .eq('id', message_id);

    // File any image attachments under the claim, mirroring actionAttachPhotosToClaim.
    const { data: atts } = await supabaseAdmin
      .from('message_attachments')
      .select('id, filename, mime_type, size_bytes, is_image, storage_path')
      .eq('message_id', message_id);

    if (atts && atts.length > 0) {
      const docRows = atts.map((a) => ({
        claim_id: target.id,
        ref_number: target.ref_number || null,
        file_name: a.filename || 'attachment',
        file_type: a.is_image ? 'survey_photo' : 'other',
        mime_type: a.mime_type || null,
        file_size: a.size_bytes || null,
        storage_path: a.storage_path || null,
        source: 'gmail',
        company: target.company || message.company || 'NISLA',
      }));
      await supabaseAdmin.from('claim_documents').insert(docRows);
    }

    await recordPortalActivity({
      user_email: user.email,
      user_name: user.name,
      action: 'comms_message_linked_to_ref',
      entity_type: 'inbox_message',
      details: { message_id, ref_number: ref, claim_id: target.id, attachment_count: atts?.length || 0 },
      company: target.company || message.company || 'NISLA',
    });

    return NextResponse.json({
      ok: true,
      action: 'linked',
      message_id,
      claim_id: target.id,
      ref_number: target.ref_number,
      attachments_filed: atts?.length || 0,
    });
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

  // M2: pass clerk-picked LOB (and any future overrides) into executor.
  const overrides = {};
  if (override_lob) overrides.lob = override_lob;

  const result = await executeRouting(message_id, {
    triggeredBy: `human:${user.email}`,
    overrides: Object.keys(overrides).length > 0 ? overrides : null,
  });

  // M3: lead-surveyor assignment on a freshly-created claim.
  // We pull the claim_id from the executor result (set when create_claim ran).
  // Failures here are non-fatal — claim is registered; assignment can be retried.
  let assignmentRow = null;
  if (assigned_surveyor_id && result?.ok && result.claimId) {
    try {
      const { data: surveyor } = await supabaseAdmin
        .from('surveyors')
        .select('id, name, email, active, license_expiry_date')
        .eq('id', assigned_surveyor_id)
        .maybeSingle();
      if (surveyor && surveyor.active) {
        const { data: ins } = await supabaseAdmin
          .from('claim_assignments')
          .insert([{
            claim_id: result.claimId,
            surveyor_id: surveyor.id,
            assigned_to: surveyor.email || null,
            assigned_to_name: surveyor.name || null,
            assigned_by: user.email,
            role: 'lead_surveyor',
            assignment_type: 'lead',
            status: 'Assigned',
            assigned_date: new Date().toISOString().slice(0, 10),
            company: message.company || 'NISLA',
            assignment_basis: 'review_queue_intimation_tag',
          }])
          .select()
          .single();
        assignmentRow = ins;
      }
    } catch (e) {
      // Don't fail the approve — record and move on.
      assignmentRow = { error: e.message };
    }
  }

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
    details: { message_id, routing_result: result, override_lob, assigned_surveyor_id, assignment: assignmentRow },
    company: message.company || 'NISLA',
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    action: 'approved',
    message_id,
    routing: result,
    assignment: assignmentRow,
  });
}
