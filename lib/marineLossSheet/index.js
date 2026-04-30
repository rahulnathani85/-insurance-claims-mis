// =============================================================================
// lib/marineLossSheet/index.js
// =============================================================================
// Public surface + DB-aware helpers for the Marine Cargo loss sheet.
// =============================================================================

export { computeItem, summariseMarineLossSheet } from './calculate.js';

import { summariseMarineLossSheet as _summarise } from './calculate.js';

// Sanitise a request body for marine_loss_sheet_items insert/update.
export function sanitiseItemPayload(body = {}) {
  const out = {};

  for (const [key, max] of [
    ['lr_no', 100], ['invoice_no', 100], ['code', 100],
    ['description', 500], ['pack_size', 50], ['unit', 50], ['notes', 2000],
  ]) {
    if (body[key] !== undefined) {
      const v = typeof body[key] === 'string' ? body[key].trim().slice(0, max) : null;
      out[key] = v === '' ? null : v;
    }
  }

  if (body.damaged_qty !== undefined) out.damaged_qty = positive(body.damaged_qty);
  if (body.rate !== undefined) out.rate = nonNeg(body.rate);

  if (body.insurance_rate_pct !== undefined) {
    if (body.insurance_rate_pct === null || body.insurance_rate_pct === '') {
      out.insurance_rate_pct = null;
    } else {
      const n = Number(body.insurance_rate_pct);
      out.insurance_rate_pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    }
  }

  if (body.item_no !== undefined) {
    const n = parseInt(body.item_no, 10);
    if (Number.isFinite(n) && n > 0) out.item_no = n;
  }

  return out;
}

// Sanitise the marine_loss_sheets header (rates / amounts / status / notes).
export function sanitiseSheetPayload(body = {}) {
  const out = {};

  for (const key of ['insurance_rate_pct', 'gst_rate_pct', 'handling_rate_pct']) {
    if (body[key] !== undefined) {
      const n = Number(body[key]);
      out[key] = Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
    }
  }

  for (const key of ['excess_amount', 'salvage_amount']) {
    if (body[key] !== undefined) {
      const n = Number(body[key]);
      out[key] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }

  if (body.status !== undefined) {
    const valid = ['draft', 'under_review', 'approved', 'superseded'];
    if (!valid.includes(body.status)) {
      throw new Error(`status must be one of: ${valid.join(', ')}`);
    }
    out.status = body.status;
  }

  if (body.notes !== undefined) {
    out.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : null;
  }
  if (body.updated_by !== undefined) out.updated_by = body.updated_by;

  return out;
}

// Refresh denormalised totals on the sheet from current items + header inputs.
export async function recomputeSheet(supabase, sheetId) {
  const { data: sheet } = await supabase
    .from('marine_loss_sheets')
    .select('*')
    .eq('id', sheetId)
    .single();
  if (!sheet) return null;

  const { data: items } = await supabase
    .from('marine_loss_sheet_items')
    .select('amount, insurance_value')
    .eq('marine_sheet_id', sheetId);

  const summary = _summarise({
    items: items || [],
    insurance_rate_pct: sheet.insurance_rate_pct,
    gst_rate_pct: sheet.gst_rate_pct,
    handling_rate_pct: sheet.handling_rate_pct,
    salvage_amount: sheet.salvage_amount,
    excess_amount: sheet.excess_amount,
  });

  await supabase
    .from('marine_loss_sheets')
    .update({
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
    })
    .eq('id', sheetId);

  return summary;
}

function nonNeg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function positive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
