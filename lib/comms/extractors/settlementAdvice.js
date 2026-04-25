// ============================================================
// lib/comms/extractors/settlementAdvice.js
// ------------------------------------------------------------
// Extractor + validator for the 'settlement_advice' workflow tag.
//
// Schema (from migration_comms_3_tag_seeds.sql):
//   claim_ref        string  required
//   settled_amount   string  required   — stored as-is (e.g. "INR 1,85,400")
//   settlement_date  date    required   — ISO 8601
//   deductions       string  optional
//   mode_of_payment  string  optional
//
// Extra domain checks:
//   - claim_ref: looks like a claim reference (contains a hyphen
//     or slash plus digits — very loose, just catches empty/1-char).
//   - settled_amount: contains at least one digit.
//   - settlement_date: not more than 365 days in the future (clear
//     parse error) and not absurdly old (>5 years).
// ============================================================

import { validateAgainstSchema, isIsoDate } from './validators';

const SETTLEMENT_SCHEMA = {
  claim_ref:       { type: 'string', required: true },
  settled_amount:  { type: 'string', required: true },
  settlement_date: { type: 'date',   required: true },
  deductions:      { type: 'string', required: false },
  mode_of_payment: { type: 'string', required: false },
};

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS   = 365 * 24 * 60 * 60 * 1000;

export function extractSettlementAdvice(extracted) {
  const base = validateAgainstSchema(extracted, SETTLEMENT_SCHEMA);
  const errors = [...base.errors];
  const data = { ...base.data };

  if (data.claim_ref) {
    // Heuristic: a real claim ref has digits AND is ≥ 4 chars.
    const hasDigit = /\d/.test(data.claim_ref);
    if (!hasDigit || data.claim_ref.length < 4) {
      errors.push({ field: 'claim_ref', error: 'claim_ref_looks_invalid' });
    }
  }

  if (data.settled_amount) {
    if (!/\d/.test(data.settled_amount)) {
      errors.push({ field: 'settled_amount', error: 'no_digits_in_amount' });
    }
  }

  if (isIsoDate(data.settlement_date)) {
    const t = Date.parse(data.settlement_date);
    if (Number.isFinite(t)) {
      const drift = t - Date.now();
      if (drift > ONE_YEAR_MS) {
        errors.push({ field: 'settlement_date', error: 'date_far_in_future' });
      } else if (-drift > FIVE_YEARS_MS) {
        errors.push({ field: 'settlement_date', error: 'date_over_5_years_old', severity: 'warn' });
      }
    }
  }

  const nonWarn = errors.filter((e) => e.severity !== 'warn');
  return { data, errors, isValid: nonWarn.length === 0 };
}

export const settlementSchema = SETTLEMENT_SCHEMA;
