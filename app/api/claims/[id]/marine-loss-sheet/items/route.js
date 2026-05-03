// =============================================================================
// /api/claims/[id]/marine-loss-sheet/items
// =============================================================================
// POST — create a new marine line item. Auto-assigns item_no, computes
//        amount/insurance/line_total via lib helpers, recomputes parent.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { computeItem, sanitiseItemPayload, recomputeSheet } from '@/lib/marineLossSheet';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  const { data: sheet } = await supabaseAdmin
    .from('marine_loss_sheets')
    .select('*')
    .eq('claim_id', id)
    .maybeSingle();
  if (!sheet) {
    return NextResponse.json({ error: 'Marine loss sheet not found — call GET first to auto-create' }, { status: 404 });
  }

  const payload = sanitiseItemPayload(body);
  if (!payload.description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  if (!payload.item_no) {
    const { data: maxRow } = await supabaseAdmin
      .from('marine_loss_sheet_items')
      .select('item_no')
      .eq('marine_sheet_id', sheet.id)
      .order('item_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    payload.item_no = (maxRow?.item_no || 0) + 1;
  }

  const computed = computeItem({
    damaged_qty: payload.damaged_qty ?? 1,
    rate: payload.rate ?? 0,
    insurance_rate_pct: payload.insurance_rate_pct,
    sheet_insurance_rate_pct: sheet.insurance_rate_pct,
  });

  const insert = {
    marine_sheet_id: sheet.id,
    claim_id: parseInt(id, 10),
    item_no: payload.item_no,
    lr_no: payload.lr_no || null,
    invoice_no: payload.invoice_no || null,
    code: payload.code || null,
    description: payload.description,
    pack_size: payload.pack_size || null,
    unit: payload.unit || null,
    damaged_qty: payload.damaged_qty ?? 1,
    rate: payload.rate ?? 0,
    amount: computed.amount,
    insurance_rate_pct: computed.insurance_rate_pct,
    insurance_value: computed.insurance_value,
    line_total: computed.line_total,
    notes: payload.notes || null,
  };

  const { data: created, error } = await supabaseAdmin
    .from('marine_loss_sheet_items')
    .insert([insert])
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `Item #${payload.item_no} already exists` }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await recomputeSheet(supabaseAdmin, sheet.id);

  return NextResponse.json({ item: created }, { status: 201 });
}
