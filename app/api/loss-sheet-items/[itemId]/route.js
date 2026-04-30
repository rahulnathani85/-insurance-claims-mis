// =============================================================================
// /api/loss-sheet-items/[itemId]
// =============================================================================
// PUT    — update a single line item. Recomputes derived columns + parent
//          sheet totals on every change.
// DELETE — remove an item. Re-summarises parent.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { computeItem, sanitiseItemPayload, recomputeSheet } from '@/lib/lossSheet';

export const runtime = 'nodejs';

export async function PUT(request, { params }) {
  const { itemId } = params;
  const body = await request.json().catch(() => ({}));

  const { data: existing, error } = await supabaseAdmin
    .from('loss_sheet_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (error || !existing) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  const patch = sanitiseItemPayload(body);
  const merged = { ...existing, ...patch };

  // Recompute derived columns based on the merged inputs.
  const computed = computeItem({
    replacement_value: merged.replacement_value,
    age_years: merged.age_years,
    category: merged.category,
    depreciation_pct: merged.depreciation_pct,
    depreciation_pct_override: merged.depreciation_pct_override,
    salvage_value: merged.salvage_value,
  });

  patch.depreciation_pct = computed.depreciation_pct;
  patch.depreciated_value = computed.depreciated_value;
  patch.salvage_value = computed.salvage_value;
  patch.net_loss = computed.net_loss;
  patch.updated_at = new Date().toISOString();

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('loss_sheet_items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  await recomputeSheet(supabaseAdmin, existing.loss_sheet_id);

  return NextResponse.json({ item: updated });
}

export async function DELETE(_request, { params }) {
  const { itemId } = params;

  const { data: existing } = await supabaseAdmin
    .from('loss_sheet_items')
    .select('loss_sheet_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('loss_sheet_items')
    .delete()
    .eq('id', itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await recomputeSheet(supabaseAdmin, existing.loss_sheet_id);

  return NextResponse.json({ ok: true });
}
