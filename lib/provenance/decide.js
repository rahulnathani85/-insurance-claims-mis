// =============================================================================
// lib/provenance/decide.js
// =============================================================================
// Pure decision engine — spec §5.
//
// Given:
//   - the new candidate value (with source + extraction confidence)
//   - the current authoritative value (or null)
//   - an authority lookup (sourceType → rank, lower = higher authority)
//   - a policy lookup ((field, scenario) → action override)
//
// Returns one of five Decisions:
//   { kind: 'auto_update_safe',     reason }              — promote new
//   { kind: 'corroborate',          reason }              — record evidence
//   { kind: 'raise_conflict',       reason, severity }    — flag for human
//   { kind: 'ignore_lower_authority', reason }            — record only
//   { kind: 'no_change',            reason }              — policy says skip
//
// No DB calls, no API calls. Caller wraps in a transaction.
// =============================================================================

import { valuesEqual } from './values.js';

export const SCENARIOS = [
  'empty_to_value',
  'equal_value',
  'higher_authority',
  'lower_authority',
  'equal_authority_conflict',
];

export const ACTIONS = [
  'auto_update',
  'corroborate',
  'raise_conflict',
  'ignore_with_log',
];

// Default policy applied when a (field, scenario) row is missing from the
// field_change_policy table. Mirrors the seed defaults in the migration so
// the engine has sane behaviour even with an empty policy table.
const DEFAULT_POLICY = {
  empty_to_value: 'auto_update',
  equal_value: 'corroborate',
  higher_authority: 'raise_conflict',
  lower_authority: 'ignore_with_log',
  equal_authority_conflict: 'raise_conflict',
};

// Severity heuristic for raise_conflict on monetary or date fields. Used by
// the UI to colour-code the conflict. Pure of side effects.
//
// fieldName     — string
// currentValue  — FieldValue | null
// newValue      — FieldValue
// → 'low' | 'medium' | 'high'
export function severityFor(fieldName, currentValue, newValue) {
  // Money: compute relative delta. ≥50% drift = high; ≥10% = medium; else low.
  if (currentValue?.kind === 'money' && newValue?.kind === 'money') {
    const cur = Number(currentValue.amount) || 0;
    const next = Number(newValue.amount) || 0;
    if (cur === 0) return 'high';
    const drift = Math.abs(next - cur) / cur;
    if (drift >= 0.5) return 'high';
    if (drift >= 0.1) return 'medium';
    return 'low';
  }
  // Date: any difference > 30 days is high; > 7 days is medium; else low.
  if (currentValue?.kind === 'date' && newValue?.kind === 'date') {
    const cur = new Date(currentValue.value);
    const next = new Date(newValue.value);
    const days = Math.abs((next - cur) / 86_400_000);
    if (days > 30) return 'high';
    if (days > 7) return 'medium';
    return 'low';
  }
  // Peril classification disagreements: always high (regulatory implications).
  if (fieldName === 'peril_type') return 'high';
  // Default: medium.
  return 'medium';
}

// Pick a scenario from the (current, new) authority comparison. No DB / no IO.
export function classifyScenario({ currentValue, currentRank, newValue, newRank }) {
  if (!currentValue) return 'empty_to_value';
  if (valuesEqual(currentValue, newValue)) return 'equal_value';
  // Lower rank number = higher authority.
  if (newRank < currentRank) return 'higher_authority';
  if (newRank > currentRank) return 'lower_authority';
  return 'equal_authority_conflict';
}

// Resolves a policy for (field, scenario) using:
//   1. policy[field][scenario]
//   2. policy['__default__'][scenario]
//   3. DEFAULT_POLICY[scenario]
function resolveAction(policy, fieldName, scenario) {
  return policy?.[fieldName]?.[scenario]
      || policy?.__default__?.[scenario]
      || DEFAULT_POLICY[scenario];
}

// The main entry. All five branches modeled per spec §5.
//
// Inputs:
//   fieldName              — e.g. 'sum_insured'
//   newValue               — FieldValue (built via buildFieldValue)
//   newSource              — { documentType, label, type? } — type is
//                             one of 'email'|'document'|'manual'|...
//   newConfidence          — number 0..1 (or null for human)
//   current                — { value, sourceDocumentType } | null
//   authorityRank          — fn(documentType) → number (lower = higher authority)
//   policy                 — nested map { fieldName: { scenario: action } }
//                             (use { __default__: {...} } for fallback)
//
// Returns { kind, reason, scenario, severity? }
export function decideFieldAction({
  fieldName,
  newValue,
  newSource,
  newConfidence,
  current,
  authorityRank,
  policy = {},
}) {
  if (!fieldName) throw new Error('decideFieldAction: fieldName is required');
  if (!newValue || !newValue.kind) throw new Error('decideFieldAction: newValue must be a FieldValue');
  if (!newSource || !newSource.documentType) {
    throw new Error('decideFieldAction: newSource.documentType is required');
  }
  if (typeof authorityRank !== 'function') {
    throw new Error('decideFieldAction: authorityRank must be a function');
  }

  const newRank = numericRank(authorityRank(newSource.documentType));
  const curRank = current
    ? numericRank(authorityRank(current.sourceDocumentType))
    : Number.POSITIVE_INFINITY;

  const scenario = classifyScenario({
    currentValue: current?.value || null,
    currentRank: curRank,
    newValue,
    newRank,
  });

  const action = resolveAction(policy, fieldName, scenario);

  switch (action) {
    case 'auto_update':
      return {
        kind: 'auto_update_safe',
        scenario,
        reason: scenario === 'empty_to_value'
          ? 'Field was empty'
          : `Policy auto-updates on ${scenario}`,
      };
    case 'corroborate':
      return {
        kind: 'corroborate',
        scenario,
        reason: `Confirmed by additional source: ${newSource.label || newSource.documentType}`,
      };
    case 'raise_conflict':
      return {
        kind: 'raise_conflict',
        scenario,
        severity: severityFor(fieldName, current?.value || null, newValue),
        reason: scenario === 'higher_authority'
          ? `Higher-authority source (${newSource.documentType}) shows different value. Current value from ${current?.sourceDocumentType || 'unknown'} may be outdated.`
          : `Two equal-authority sources (${newSource.documentType}) disagree on ${fieldName}.`,
      };
    case 'ignore_with_log':
      return {
        kind: 'ignore_lower_authority',
        scenario,
        reason: `Lower-authority source (${newSource.documentType}) disagrees with ${current?.sourceDocumentType || 'unknown'}. Recorded as evidence only.`,
      };
    default:
      // Should not happen if seed data is in place; default to safe no-op.
      return { kind: 'no_change', scenario, reason: `Unknown action '${action}' for ${fieldName}/${scenario}` };
  }
}

function numericRank(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  return n;
}
