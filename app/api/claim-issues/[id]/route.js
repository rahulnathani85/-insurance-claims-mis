// =============================================================================
// /api/claim-issues/[id]
// =============================================================================
// Slice 10 — resolve / dismiss / re-open / delete a single issue.
//
// PATCH  { status: 'resolved' | 'dismissed' | 'open', resolution_note?, resolved_by? }
//        Transitions an issue's lifecycle. resolved_at is auto-set
//        when status moves to resolved/dismissed; cleared when re-opened.
//
// DELETE Hard-delete an issue. Used sparingly — typical flow is dismiss.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireSurveyorRequest } from '@/lib/auth/insurer';

const VALID_STATUS = new Set(['open', 'resolved', 'dismissed']);

async function checkSurveyor(request) {
  try {
    await requireSurveyorRequest(request);
  } catch (e) {
    if (e?.code === 'INSURER_FORBIDDEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }
  return null;
}

export async function PATCH(request, { params }) {
  const guard = await checkSurveyor(request);
  if (guard) return guard;

  const { id } = params;
  const body = await request.json().catch(() => ({}));

  const status = typeof body?.status === 'string' ? body.status.toLowerCase() : null;
  if (!status || !VALID_STATUS.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${Array.from(VALID_STATUS).join(', ')}` }, { status: 400 });
  }

  const updates = {
    status,
    resolution_note: typeof body?.resolution_note === 'string' ? body.resolution_note.trim() || null : null,
    resolved_by: typeof body?.resolved_by === 'string' ? body.resolved_by.trim() || null : null,
    updated_at: new Date().toISOString(),
  };
  if (status === 'open') {
    // Re-opening: clear the resolved_at marker.
    updates.resolved_at = null;
  } else {
    updates.resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('claim_issues')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(data);
}

export async function DELETE(request, { params }) {
  const guard = await checkSurveyor(request);
  if (guard) return guard;

  const { id } = params;
  const { error } = await supabaseAdmin
    .from('claim_issues')
    .delete()
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
