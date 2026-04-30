// =============================================================================
// lib/marineLossSheet/calculate.js
// =============================================================================
// Marine Cargo loss-sheet math. Source of truth: real working sheets shared
// by NISLA management:
//   - 4771-25-26 Kansai Nerolac (Jamshedpur)\4771-25-26.xlsx
//   - 4301-25-26 Qutone Ceramic ltd (Bhopal)\working.xlsx
//
// The flow differs from Fire (no depreciation; goods value is settled).
// Per item:
//   amount          = damaged_qty × rate
//   insurance_value = amount × (insurance_rate_pct / 100)
//   line_total      = amount + insurance_value
//
// Per claim:
//   subtotal        = Σ amount
//   insurance_total = Σ insurance_value
//   pre_gst         = subtotal + insurance_total
//   gst_amount      = pre_gst × (gst_rate_pct / 100)
//   after_gst       = pre_gst + gst_amount
//   handling_amount = after_gst × (handling_rate_pct / 100)
//   after_handling  = after_gst + handling_amount
//   net_loss        = after_handling − salvage_amount
//   net_adjusted    = max(0, net_loss − excess_amount)
//
// All money is INR rupees as JS numbers (matches the existing claims schema).
// =============================================================================

export function computeItem({
  damaged_qty,
  rate,
  insurance_rate_pct,        // per-line override; falls back to sheet default
  sheet_insurance_rate_pct = 1,
} = {}) {
  const qty = nonNeg(damaged_qty);
  const r = nonNeg(rate);
  const amount = round2(qty * r);

  const effective_rate = insurance_rate_pct !== null && insurance_rate_pct !== undefined
    ? clampPct(insurance_rate_pct)
    : clampPct(sheet_insurance_rate_pct);

  const insurance_value = round2(amount * (effective_rate / 100));
  const line_total = round2(amount + insurance_value);

  return {
    amount,
    insurance_value,
    line_total,
    insurance_rate_pct: effective_rate,
  };
}

export function summariseMarineLossSheet({
  items = [],
  insurance_rate_pct = 1,
  gst_rate_pct = 18,
  handling_rate_pct = 10,
  salvage_amount = 0,
  excess_amount = 0,
} = {}) {
  let subtotal = 0;
  let insurance_total = 0;
  for (const item of items) {
    subtotal += nonNeg(item.amount);
    insurance_total += nonNeg(item.insurance_value);
  }
  subtotal = round2(subtotal);
  insurance_total = round2(insurance_total);

  const pre_gst = round2(subtotal + insurance_total);
  const gst_amount = round2(pre_gst * (clampPct(gst_rate_pct) / 100));
  const after_gst = round2(pre_gst + gst_amount);
  const handling_amount = round2(after_gst * (clampPct(handling_rate_pct) / 100));
  const after_handling = round2(after_gst + handling_amount);

  const salvage = nonNeg(salvage_amount);
  const cappedSalvage = Math.min(salvage, after_handling);
  const net_loss = round2(after_handling - cappedSalvage);

  const excess = nonNeg(excess_amount);
  const net_adjusted = Math.max(0, round2(net_loss - excess));

  return {
    subtotal_amount: subtotal,
    insurance_total,
    pre_gst_total: pre_gst,
    gst_amount,
    after_gst_total: after_gst,
    handling_amount,
    after_handling_total: after_handling,
    net_loss,
    net_adjusted_loss: net_adjusted,
    salvage_applied: cappedSalvage,
    excess_applied: excess,
    insurance_rate_pct: clampPct(insurance_rate_pct),
    gst_rate_pct: clampPct(gst_rate_pct),
    handling_rate_pct: clampPct(handling_rate_pct),
  };
}

function nonNeg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
