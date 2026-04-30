// =============================================================================
// /api/claims/[id]/loss-sheet/items
// =============================================================================
// POST — create a new line item. Auto-assigns item_no = max + 1.
//        Computes depreciation + depreciated_value + net_loss via lib helpers,
//        then re-summarises the parent sheet.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { computeItem, sanitiseItemPayload, recomputeSheet } from '@/lib/lossSheet';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  // Need parent sheet — caller must have loaded it via GET first.
  const { data: sheet } = await supabaseAdmin
    .from('loss_sheets')
    .select('*')
    .eq('claim_id', id)
    .maybeSingle();
  if (!sheet) {
    return NextResponse.json({ error: 'Loss sheet not found — call GET first to auto-create' }, { status: 404 });
  }

  const payload = sanitiseItemPayload(body);
  if (!payload.description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }
  if (!payload.category) {
    return NextResponse.json({ error: 'category is required' }, { status: 400 });
  }
  if (typeof payload.replacement_value !== 'number') {
    return NextResponse.json({ error: 'replacement_value is required' }, { status: 400 });
  }

  // Auto item_no.
  if (!payload.item_no) {
    const { data: maxRow } = await supabaseAdmin
      .from('loss_sheet_items')
      .select('item_no')
      .eq('loss_sheet_id', sheet.id)
      .order('item_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    payload.item_no = (maxRow?.item_no || 0) + 1;
  }

  const computed = computeItem({
    replacement_value: payload.replacement_value,
    age_years: payload.age_years,
    category: payload.category,
    depreciation_pct: payload.depreciation_pct,
    depreciation_pct_override: payload.depreciation_pct_override,
    salvage_value: payload.salvage_value,
  });

  const insert = {
    loss_sheet_id: sheet.id,
    claim_id: parseInt(id, 10),
    item_no: payload.item_no,
    description: payload.description,
    category: payload.category,
    quantity: payload.quantity ?? 1,
    unit: payload.unit || null,
    replacement_value: payload.replacement_value,
    age_years: payload.age_years ?? null,
    depreciation_pct: computed.depreciation_pct,
    depreciation_pct_override: payload.depreciation_pct_override === true,
    depreciated_value: computed.depreciated_value,
    salvage_value: computed.salvage_value,
    net_loss: computed.net_loss,
    notes: payload.notes || null,
  };

  const { data: created, error } = await supabaseAdmin
    .from('loss_sheet_items')
    .insert([insert])
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `Item #${payload.item_no} already exists` }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Re-summarise parent.
  await recomputeSheet(supabaseAdmin, sheet.id);

  return NextResponse.json({ item: created }, { status: 201 });
}
