// =============================================================================
// /api/fsr-drafts/[id]
// =============================================================================
// GET    — fetch single draft
// PUT    — autosave / explicit save. Blocks edits on approved/superseded.
// DELETE — soft delete (status='superseded')
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sanitiseDraftPayload } from '@/lib/fsr';

export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
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
    updates = sanitiseDraftPayload(body);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from('claim_fsr_drafts')
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

  const { data, error } = await supabaseAdmin
    .from('claim_fsr_drafts')
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
    .from('claim_fsr_drafts')
    .update({ status: 'superseded' })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
