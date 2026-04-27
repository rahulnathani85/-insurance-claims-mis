// ============================================================
// /api/communications/drafts/[id]
// ------------------------------------------------------------
// PATCH — update body_edited (human edits) or status (mark sent).
// DELETE — discard the draft (sets status='discarded' for audit).
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/comms/session';
import { recordPortalActivity } from '@/lib/comms/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id } = params || {};
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const allowed = {};
  if (typeof body.body_edited === 'string') allowed.body_edited = body.body_edited;
  if (typeof body.subject === 'string') allowed.subject = body.subject;
  if (body.status === 'sent') {
    allowed.status = 'sent';
    allowed.sent_at = new Date().toISOString();
    allowed.sent_by = user.email;
  } else if (body.status === 'discarded') {
    allowed.status = 'discarded';
  }
  allowed.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('email_drafts')
    .update(allowed)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name,
    action: `comms_draft_${allowed.status || 'edited'}`,
    entity_type: 'email_draft',
    details: { draft_id: id, message_id: data.message_id },
    company: 'NISLA',
  });

  return NextResponse.json(data);
}

export async function DELETE(request, { params }) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate.errorResponse;
  const user = gate.user;

  const { id } = params || {};
  const { error } = await supabaseAdmin
    .from('email_drafts')
    .update({ status: 'discarded', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordPortalActivity({
    user_email: user.email,
    user_name: user.name,
    action: 'comms_draft_discarded',
    entity_type: 'email_draft',
    details: { draft_id: id },
    company: 'NISLA',
  });

  return NextResponse.json({ ok: true });
}
