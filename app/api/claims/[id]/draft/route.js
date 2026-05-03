// =============================================================================
// /api/claims/[id]/draft
// =============================================================================
// GET — current saved draft (or { draft_data: {} } if none)
// PUT — upsert draft. Body: { draft_data, updated_by? }
// DELETE — discard draft (called after successful registration submit)
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabaseAdmin
    .from('claim_drafts')
    .select('*')
    .eq('claim_id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || { claim_id: parseInt(id, 10), draft_data: {}, updated_at: null });
}

export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();
  if (!body || typeof body.draft_data !== 'object' || body.draft_data === null) {
    return NextResponse.json({ error: 'draft_data (object) is required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('claim_drafts')
    .upsert(
      {
        claim_id: parseInt(id, 10),
        draft_data: body.draft_data,
        updated_at: new Date().toISOString(),
        updated_by: typeof body.updated_by === 'string' ? body.updated_by : null,
      },
      { onConflict: 'claim_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(_request, { params }) {
  const { id } = params;
  const { error } = await supabaseAdmin.from('claim_drafts').delete().eq('claim_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
