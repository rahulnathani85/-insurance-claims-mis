// =============================================================================
// /api/ila-drafts/[id]
// =============================================================================
// GET    — fetch single draft (with claim header for the editor)
// PUT    — autosave / explicit save. Body matches ila_drafts editable fields.
// DELETE — soft delete by setting status='superseded' (drafts are not hard-deleted).
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sanitiseDraftPayload } from '@/lib/ila';

export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabaseAdmin
    .from('ila_drafts')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  let updates;
  try {
    updates = sanitiseDraftPayload(body, { skipUndefined: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Block edits on submitted drafts.
  const { data: existing } = await supabaseAdmin
    .from('ila_drafts')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (existing.status === 'approved' || existing.status === 'superseded') {
    return NextResponse.json(
      { error: `Draft is ${existing.status} — create a new version to edit` },
      { status: 409 }
    );
  }

  updates.updated_at = new Date().toISOString();
  if (body.updated_by) updates.updated_by = body.updated_by;

  const { data, error } = await supabaseAdmin
    .from('ila_drafts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(_request, { params }) {
  const { id } = params;
  const { error } = await supabaseAdmin
    .from('ila_drafts')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
