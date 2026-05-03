// =============================================================================
// /api/marine-loss-sheet-items/[itemId]
// =============================================================================
// PUT    — update a line. Recomputes amount/insurance/line_total + parent.
// DELETE — remove. Recomputes parent.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { computeItem, sanitiseItemPayload, recomputeSheet } from '@/lib/marineLossSheet';

export const runtime = 'nodejs';

export async function PUT(request, { params }) {
  const { itemId } = params;
  const body = await request.json().catch(() => ({}));

  const { data: existing, error } = await supabaseAdmin
    .from('marine_loss_sheet_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (error || !existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const { data: sheet } = await supabaseAdmin
    .from('marine_loss_sheets')
    .select('insurance_rate_pct')
    .eq('id', existing.marine_sheet_id)
    .maybeSingle();

  const patch = sanitiseItemPayload(body);
  const merged = { ...existing, ...patch };

  const computed = computeItem({
    damaged_qty: merged.damaged_qty,
    rate: merged.rate,
    insurance_rate_pct: merged.insurance_rate_pct,
    sheet_insurance_rate_pct: sheet?.insurance_rate_pct ?? 1,
  });

  patch.amount = computed.amount;
  patch.insurance_rate_pct = computed.insurance_rate_pct;
  patch.insurance_value = computed.insurance_value;
  patch.line_total = computed.line_total;
  patch.updated_at = new Date().toISOString();

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('marine_loss_sheet_items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  await recomputeSheet(supabaseAdmin, existing.marine_sheet_id);

  return NextResponse.json({ item: updated });
}

export async function DELETE(_request, { params }) {
  const { itemId } = params;

  const { data: existing } = await supabaseAdmin
    .from('marine_loss_sheet_items')
    .select('marine_sheet_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const { error } = await supabaseAdmin
    .from('marine_loss_sheet_items')
    .delete()
    .eq('id', itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await recomputeSheet(supabaseAdmin, existing.marine_sheet_id);

  return NextResponse.json({ ok: true });
}
