// =============================================================================
// lib/lossSheet/calculate.js
// =============================================================================
// Pure math for the Loss Sheet (CLAUDE.md §7 + §11).
//
// All money values are INR rupees as JS Numbers (kept consistent with the
// existing claims schema's NUMERIC(15,2) rupee convention). Provenance Phase B
// will eventually convert to integer paise — until then, callers should round
// to 2 decimals when persisting.
//
// All functions are pure. No DB / no IO. Caller wraps in a transaction.
// =============================================================================

import { computeDepreciation } from '../../config/depreciation.js';

// -----------------------------------------------------------------------------
// computeItem — derive an item's depreciation_pct + depreciated_value + net_loss
// -----------------------------------------------------------------------------
// Inputs (caller decides which of dep_pct or auto-from-category wins):
//   replacement_value          number   RV in rupees, ≥ 0
//   age_years                  number   may be null (then dep is 0 unless override)
//   category                   string   key into config/depreciation.js
//   depreciation_pct           number   manual % override; null = auto from category+age
//   depreciation_pct_override  boolean  whether the manual % was used
//   salvage_value              number   default 0
//
// Returns:
//   { depreciation_pct, depreciated_value, net_loss, depreciation_source }
//
// depreciation_source: 'override' | 'auto' | 'fallback_zero'
// -----------------------------------------------------------------------------
export function computeItem({
  replacement_value,
  age_years = null,
  category,
  depreciation_pct = null,
  depreciation_pct_override = false,
  salvage_value = 0,
} = {}) {
  const rv = nonNeg(replacement_value);
  const sal = nonNeg(salvage_value);

  let depPct;
  let depSource;
  if (depreciation_pct_override && depreciation_pct !== null && depreciation_pct !== undefined) {
    depPct = clamp01(Number(depreciation_pct) / 100) * 100;
    depSource = 'override';
  } else {
    const auto = computeDepreciation(category, age_years);
    if (auto === null) {
      // Unknown category → treat as zero depreciation rather than fail.
      depPct = 0;
      depSource = 'fallback_zero';
    } else {
      depPct = round2(auto * 100);
      depSource = 'auto';
    }
  }

  const depFraction = clamp01(depPct / 100);
  const depreciated = round2(rv * (1 - depFraction));
  // Salvage cannot exceed depreciated value (you can't recover more than the
  // damaged item is worth post-depreciation).
  const cappedSalvage = Math.min(sal, depreciated);
  const netLoss = round2(depreciated - cappedSalvage);

  return {
    depreciation_pct: round2(depPct),
    depreciated_value: depreciated,
    net_loss: netLoss,
    depreciation_source: depSource,
    salvage_value: cappedSalvage,
  };
}

// -----------------------------------------------------------------------------
// summariseLossSheet — compute claim-level totals from a list of items
// -----------------------------------------------------------------------------
// Each item must already have replacement_value + net_loss (e.g. computed
// via computeItem first).
//
// CLAUDE.md §7:
//   Underinsurance = (SI / Value at Risk) × Assessed Loss. Always shown,
//   even at 100%
//
// Returns:
//   {
//     value_at_risk,
//     gross_loss,
//     underinsurance_factor,    // null when SI or VAR not set; else clamped to [0,1]
//     adjusted_loss,            // gross_loss × factor (or gross_loss if no factor)
//     net_payable,              // max(0, adjusted_loss − excess)
//     underinsurance_pct        // (1 − factor) × 100; null if factor null
//   }
// -----------------------------------------------------------------------------
export function summariseLossSheet({
  items = [],
  sum_insured = null,
  excess_amount = 0,
} = {}) {
  let var_total = 0;
  let gross = 0;
  for (const item of items) {
    var_total += nonNeg(item.replacement_value);
    gross += nonNeg(item.net_loss);
  }
  var_total = round2(var_total);
  gross = round2(gross);

  const si = sum_insured === null || sum_insured === undefined || sum_insured === ''
    ? null
    : Math.max(0, Number(sum_insured));
  const excess = Math.max(0, Number(excess_amount) || 0);

  let underins_factor = null;
  let underins_pct = null;
  let adjusted = gross;

  if (si !== null && var_total > 0) {
    underins_factor = Math.min(1, si / var_total);
    underins_factor = round6(underins_factor);
    underins_pct = round2((1 - underins_factor) * 100);
    adjusted = round2(gross * underins_factor);
  }

  const net_payable = Math.max(0, round2(adjusted - excess));

  return {
    value_at_risk: var_total,
    gross_loss: gross,
    underinsurance_factor: underins_factor,
    underinsurance_pct: underins_pct,
    adjusted_loss: round2(adjusted),
    net_payable,
    excess_applied: excess,
  };
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function nonNeg(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function round6(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}
