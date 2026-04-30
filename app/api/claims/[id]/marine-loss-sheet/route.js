// =============================================================================
// /api/claims/[id]/marine-loss-sheet
// =============================================================================
// GET — fetch the claim's Marine loss sheet (auto-creates if absent) +
//       all line items + computed summary.
// PUT — update header (rates, salvage, excess, status, notes) and recompute
//       denormalised totals from current items.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { summariseMarineLossSheet, sanitiseSheetPayload } from '@/lib/marineLossSheet';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  const { id } = params;

  // Note: claims.sum_insured doesn't exist on the live schema (sum_insured
  // lives on policies, joined via policy_number). The Marine loss sheet
  // header carries its own sum_insured input; surveyor types it in.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('claims')
    .select('id, ref_number, lob, company')
    .eq('id', id)
    .single();
  if (claimErr || !claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

  let sheet;
  {
    const { data: existing } = await supabaseAdmin
      .from('marine_loss_sheets')
      .select('*')
      .eq('claim_id', id)
      .maybeSingle();
    if (existing) {
      sheet = existing;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('marine_loss_sheets')
        .insert([{
          claim_id: parseInt(id, 10),
          insurance_rate_pct: 1,
          gst_rate_pct: 18,
          handling_rate_pct: 10,
          excess_amount: 0,
          salvage_amount: 0,
          company: claim.company || 'NISLA',
        }])
        .select()
        .single();
      if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
      sheet = created;
    }
  }

  const { data: items } = await supabaseAdmin
    .from('marine_loss_sheet_items')
    .select('*')
    .eq('marine_sheet_id', sheet.id)
    .order('item_no', { ascending: true });

  const summary = summariseMarineLossSheet({
    items: items || [],
    insurance_rate_pct: sheet.insurance_rate_pct,
    gst_rate_pct: sheet.gst_rate_pct,
    handling_rate_pct: sheet.handling_rate_pct,
    salvage_amount: sheet.salvage_amount,
    excess_amount: sheet.excess_amount,
  });

  return NextResponse.json({
    sheet,
    items: items || [],
    summary,
  });
}

export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  let updates;
  try {
    updates = sanitiseSheetPayload(body);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from('marine_loss_sheets')
    .select('*')
    .eq('claim_id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Marine loss sheet not found — call GET first to auto-create' }, { status: 404 });
  }

  const merged = { ...existing, ...updates };
  const { data: items } = await supabaseAdmin
    .from('marine_loss_sheet_items')
    .select('amount, insurance_value')
    .eq('marine_sheet_id', existing.id);
  const summary = summariseMarineLossSheet({
    items: items || [],
    insurance_rate_pct: merged.insurance_rate_pct,
    gst_rate_pct: merged.gst_rate_pct,
    handling_rate_pct: merged.handling_rate_pct,
    salvage_amount: merged.salvage_amount,
    excess_amount: merged.excess_amount,
  });

  Object.assign(updates, {
    subtotal_amount: summary.subtotal_amount,
    insurance_total: summary.insurance_total,
    pre_gst_total: summary.pre_gst_total,
    gst_amount: summary.gst_amount,
    after_gst_total: summary.after_gst_total,
    handling_amount: summary.handling_amount,
    after_handling_total: summary.after_handling_total,
    net_loss: summary.net_loss,
    net_adjusted_loss: summary.net_adjusted_loss,
    updated_at: new Date().toISOString(),
  });

  const { data: updated, error } = await supabaseAdmin
    .from('marine_loss_sheets')
    .update(updates)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ sheet: updated, items: items || [], summary });
}
