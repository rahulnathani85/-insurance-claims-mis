// =============================================================================
// lib/lossSheet/index.js
// =============================================================================
// Public surface of the loss-sheet module.
// =============================================================================

export { computeItem, summariseLossSheet } from './calculate.js';
export { DEPRECIATION_CATEGORIES, DEPRECIATION_OPTIONS, computeDepreciation } from '../../config/depreciation.js';

import { summariseLossSheet as _summarise } from './calculate.js';

// Re-summarises a loss sheet from current line items + header inputs and
// writes the totals back to the sheet row. Used after every item mutation.
//
// `supabase` must be a service-role client.
export async function recomputeSheet(supabase, sheetId) {
  const { data: sheet } = await supabase
    .from('loss_sheets')
    .select('id, sum_insured, excess_amount')
    .eq('id', sheetId)
    .single();
  if (!sheet) return null;
  const { data: items } = await supabase
    .from('loss_sheet_items')
    .select('replacement_value, net_loss')
    .eq('loss_sheet_id', sheetId);
  const summary = _summarise({
    items: items || [],
    sum_insured: sheet.sum_insured,
    excess_amount: sheet.excess_amount,
  });
  await supabase
    .from('loss_sheets')
    .update({
      value_at_risk: summary.value_at_risk,
      gross_loss: summary.gross_loss,
      underinsurance_factor: summary.underinsurance_factor,
      adjusted_loss: summary.adjusted_loss,
      net_payable: summary.net_payable,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sheetId);
  return summary;
}

// Sanitise an item payload from the API → DB-shaped row.
// Used by both POST and PUT on /api/loss-sheet-items.
export function sanitiseItemPayload(body = {}) {
  const out = {};

  if (typeof body.description === 'string') out.description = body.description.trim().slice(0, 500);
  if (typeof body.category === 'string') out.category = body.category.trim();
  if (typeof body.unit === 'string') out.unit = body.unit.trim().slice(0, 50) || null;
  if (typeof body.notes === 'string') out.notes = body.notes.trim().slice(0, 2000) || null;

  if (body.quantity !== undefined) out.quantity = positiveOrOne(body.quantity);
  if (body.replacement_value !== undefined) out.replacement_value = nonNeg(body.replacement_value);
  if (body.age_years !== undefined) {
    out.age_years = body.age_years === null || body.age_years === ''
      ? null
      : Math.max(0, Number(body.age_years) || 0);
  }
  if (body.salvage_value !== undefined) out.salvage_value = nonNeg(body.salvage_value);

  if (body.depreciation_pct !== undefined) {
    if (body.depreciation_pct === null || body.depreciation_pct === '') {
      out.depreciation_pct = null;
    } else {
      const n = Number(body.depreciation_pct);
      out.depreciation_pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    }
  }
  if (body.depreciation_pct_override !== undefined) {
    out.depreciation_pct_override = !!body.depreciation_pct_override;
  }

  if (body.item_no !== undefined) {
    const n = parseInt(body.item_no, 10);
    if (Number.isFinite(n) && n > 0) out.item_no = n;
  }

  return out;
}

function nonNeg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function positiveOrOne(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
