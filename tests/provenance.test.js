// =============================================================================
// tests/provenance.test.js
// =============================================================================
// Unit tests for lib/provenance — typed values, decision engine, severity.
//
// The decision engine has 5 scenarios × 4 actions = 20-ish edge cases. We
// cover all of them so a careless edit to either values.js or decide.js
// surfaces immediately.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildFieldValue,
  valuesEqual,
  VALUE_KINDS,
  decideFieldAction,
  classifyScenario,
  severityFor,
  SCENARIOS,
  ACTIONS,
} from '../lib/provenance/index.js';

// -----------------------------------------------------------------------------
// values.js — buildFieldValue
// -----------------------------------------------------------------------------

describe('buildFieldValue', () => {
  describe('money', () => {
    it('parses plain number rupees', () => {
      const r = buildFieldValue('money', 50000);
      expect(r.value).toEqual({ kind: 'money', amount: 5_000_000, currency: 'INR' });
      expect(r.normalized).toBe('5000000');
    });

    it('parses ₹50,00,000 string', () => {
      const r = buildFieldValue('money', '₹50,00,000');
      expect(r.value.amount).toBe(500_000_000);
    });

    it('parses "5 lakhs"', () => {
      const r = buildFieldValue('money', '5 lakhs');
      expect(r.value.amount).toBe(50_000_000); // 5L rupees = 50M paise
    });

    it('parses "1.5 crores"', () => {
      const r = buildFieldValue('money', '1.5 crores');
      expect(r.value.amount).toBe(1_500_000_000); // 1.5 Cr rupees = 1.5B paise
    });

    it('accepts pre-built { amount, currency }', () => {
      const r = buildFieldValue('money', { amount: 1234, currency: 'INR' });
      expect(r.value).toEqual({ kind: 'money', amount: 1234, currency: 'INR' });
    });

    it('throws on garbage', () => {
      expect(() => buildFieldValue('money', 'oops')).toThrow();
      expect(() => buildFieldValue('money', null)).toThrow();
    });
  });

  describe('date', () => {
    it('passes YYYY-MM-DD through', () => {
      const r = buildFieldValue('date', '2026-04-30');
      expect(r.value).toEqual({ kind: 'date', value: '2026-04-30' });
      expect(r.normalized).toBe('2026-04-30');
    });

    it('parses DD/MM/YYYY (Indian convention)', () => {
      const r = buildFieldValue('date', '30/04/2026');
      expect(r.value.value).toBe('2026-04-30');
    });

    it('parses DD-MM-YYYY', () => {
      const r = buildFieldValue('date', '30-04-2026');
      expect(r.value.value).toBe('2026-04-30');
    });

    it('accepts Date object', () => {
      const r = buildFieldValue('date', new Date('2026-04-30T10:00:00Z'));
      expect(r.value.value).toBe('2026-04-30');
    });

    it('throws on garbage', () => {
      expect(() => buildFieldValue('date', 'never')).toThrow();
    });
  });

  describe('string / enum / pin / phone / email / gps / address', () => {
    it('string normalizes via trim + lowercase', () => {
      const r = buildFieldValue('string', '  Acme Industries  ');
      expect(r.normalized).toBe('acme industries');
      expect(r.value.value).toBe('  Acme Industries  ');
    });

    it('enum requires { value, enumType }', () => {
      const r = buildFieldValue('enum', { value: 'fire', enumType: 'peril_type' });
      expect(r.normalized).toBe('peril_type:fire');
      expect(() => buildFieldValue('enum', { value: 'x' })).toThrow();
    });

    it('pin must be 6 digits', () => {
      const r = buildFieldValue('pin', '400 001');
      expect(r.value.value).toBe('400001');
      expect(() => buildFieldValue('pin', '12345')).toThrow();
    });

    it('phone canonicalises to E.164', () => {
      const r = buildFieldValue('phone', '9999999999');
      expect(r.value.e164).toBe('+919999999999');
      expect(buildFieldValue('phone', '+91-99999-99999').value.e164).toBe('+919999999999');
      expect(() => buildFieldValue('phone', '12345')).toThrow();
    });

    it('email lowercases + validates shape', () => {
      const r = buildFieldValue('email', '  Foo@BAR.com  ');
      expect(r.value.value).toBe('foo@bar.com');
      expect(() => buildFieldValue('email', 'not-an-email')).toThrow();
    });

    it('gps requires lat/lng numbers', () => {
      const r = buildFieldValue('gps', { lat: 19.0760, lng: 72.8777 });
      expect(r.normalized).toBe('19.076000,72.877700');
      expect(() => buildFieldValue('gps', { lat: 'oops' })).toThrow();
    });

    it('address normalizes + lowercases parts', () => {
      const r = buildFieldValue('address', { line: '123 Main St', city: 'Mumbai', pin: '400001' });
      expect(r.normalized).toBe('123 main st | mumbai | 400001');
    });
  });

  it('VALUE_KINDS lists all supported kinds', () => {
    expect(VALUE_KINDS).toEqual([
      'money', 'date', 'datetime', 'string', 'enum',
      'pin', 'phone', 'email', 'gps', 'address',
    ]);
  });
});

// -----------------------------------------------------------------------------
// values.js — valuesEqual
// -----------------------------------------------------------------------------

describe('valuesEqual', () => {
  it('returns false for different kinds', () => {
    const m = buildFieldValue('money', 100).value;
    const s = buildFieldValue('string', '100').value;
    expect(valuesEqual(m, s)).toBe(false);
  });

  it('money: same paise = equal', () => {
    expect(valuesEqual(
      buildFieldValue('money', 100).value,
      buildFieldValue('money', 100).value,
    )).toBe(true);
  });

  it('money: different paise = unequal', () => {
    expect(valuesEqual(
      buildFieldValue('money', 100).value,
      buildFieldValue('money', 101).value,
    )).toBe(false);
  });

  it('money: equivalent representations match (₹50,00,000 == 5000000)', () => {
    expect(valuesEqual(
      buildFieldValue('money', '₹50,00,000').value,
      buildFieldValue('money', 5_000_000).value,
    )).toBe(true);
  });

  it('date: ISO equality', () => {
    expect(valuesEqual(
      buildFieldValue('date', '2026-04-30').value,
      buildFieldValue('date', '30/04/2026').value,
    )).toBe(true);
  });

  it('string: case-insensitive + trim equality', () => {
    expect(valuesEqual(
      buildFieldValue('string', '  ACME  ').value,
      buildFieldValue('string', 'acme').value,
    )).toBe(true);
  });

  it('phone: same E.164 = equal regardless of input format', () => {
    expect(valuesEqual(
      buildFieldValue('phone', '99999-99999').value,
      buildFieldValue('phone', '+91 99999 99999').value,
    )).toBe(true);
  });

  it('gps: equal within ~10m (4 decimals)', () => {
    expect(valuesEqual(
      buildFieldValue('gps', { lat: 19.0760, lng: 72.8777 }).value,
      buildFieldValue('gps', { lat: 19.07601, lng: 72.87772 }).value,
    )).toBe(true);
  });

  it('address: case-insensitive equality', () => {
    expect(valuesEqual(
      buildFieldValue('address', { line: '123 MAIN ST', city: 'mumbai' }).value,
      buildFieldValue('address', { line: '123 main st', city: 'Mumbai' }).value,
    )).toBe(true);
  });

  it('handles null / non-object inputs safely', () => {
    expect(valuesEqual(null, null)).toBe(false);
    expect(valuesEqual(null, buildFieldValue('string', 'x').value)).toBe(false);
    expect(valuesEqual('not-a-value', buildFieldValue('string', 'x').value)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// decide.js — classifyScenario + decideFieldAction
// -----------------------------------------------------------------------------

const RANK = {
  endorsement: 1,
  policy_schedule: 2,
  policy_certificate: 3,
  intimation_letter: 4,
  email_body: 5,
};
const auth = (t) => RANK[t] !== undefined ? RANK[t] : Number.POSITIVE_INFINITY;

describe('SCENARIOS / ACTIONS lists', () => {
  it('SCENARIOS matches the 5 spec scenarios', () => {
    expect(SCENARIOS).toEqual([
      'empty_to_value', 'equal_value', 'higher_authority',
      'lower_authority', 'equal_authority_conflict',
    ]);
  });
  it('ACTIONS matches the 4 spec actions', () => {
    expect(ACTIONS).toEqual([
      'auto_update', 'corroborate', 'raise_conflict', 'ignore_with_log',
    ]);
  });
});

describe('classifyScenario', () => {
  const v50L = buildFieldValue('money', 5_000_000).value;
  const v75L = buildFieldValue('money', 7_500_000).value;

  it('empty_to_value when no current value', () => {
    expect(classifyScenario({
      currentValue: null,
      newValue: v50L,
      newRank: 2,
      currentRank: Number.POSITIVE_INFINITY,
    })).toBe('empty_to_value');
  });

  it('equal_value when typed equality matches', () => {
    expect(classifyScenario({
      currentValue: v50L,
      newValue: v50L,
      newRank: 1,
      currentRank: 2,
    })).toBe('equal_value');
  });

  it('higher_authority when newRank < currentRank', () => {
    expect(classifyScenario({
      currentValue: v50L,
      newValue: v75L,
      newRank: 1,
      currentRank: 4,
    })).toBe('higher_authority');
  });

  it('lower_authority when newRank > currentRank', () => {
    expect(classifyScenario({
      currentValue: v50L,
      newValue: v75L,
      newRank: 5,
      currentRank: 2,
    })).toBe('lower_authority');
  });

  it('equal_authority_conflict when ranks tie + values differ', () => {
    expect(classifyScenario({
      currentValue: v50L,
      newValue: v75L,
      newRank: 2,
      currentRank: 2,
    })).toBe('equal_authority_conflict');
  });
});

describe('decideFieldAction', () => {
  const v50L = buildFieldValue('money', 5_000_000).value;
  const v75L = buildFieldValue('money', 7_500_000).value;

  function call({ current, newValue = v75L, doc = 'endorsement', policy = {} } = {}) {
    return decideFieldAction({
      fieldName: 'sum_insured',
      newValue,
      newSource: { documentType: doc, label: `Test ${doc}`, type: 'document' },
      newConfidence: 0.9,
      current,
      authorityRank: auth,
      policy,
    });
  }

  it('auto_update_safe when field is empty', () => {
    const d = call({ current: null });
    expect(d.kind).toBe('auto_update_safe');
    expect(d.scenario).toBe('empty_to_value');
  });

  it('corroborate when same value from another source', () => {
    const d = call({
      current: { value: v50L, sourceDocumentType: 'policy_schedule' },
      newValue: v50L,
      doc: 'intimation_letter',
    });
    expect(d.kind).toBe('corroborate');
    expect(d.scenario).toBe('equal_value');
  });

  it('raise_conflict when higher authority shows different value', () => {
    const d = call({
      current: { value: v50L, sourceDocumentType: 'policy_schedule' }, // rank 2
      newValue: v75L,
      doc: 'endorsement',                                                // rank 1 (higher)
    });
    expect(d.kind).toBe('raise_conflict');
    expect(d.scenario).toBe('higher_authority');
    expect(['low', 'medium', 'high']).toContain(d.severity);
  });

  it('ignore_lower_authority when new source is weaker', () => {
    const d = call({
      current: { value: v50L, sourceDocumentType: 'policy_schedule' }, // rank 2
      newValue: v75L,
      doc: 'email_body',                                                 // rank 5
    });
    expect(d.kind).toBe('ignore_lower_authority');
    expect(d.scenario).toBe('lower_authority');
  });

  it('raise_conflict when two equal-authority sources disagree', () => {
    const d = call({
      current: { value: v50L, sourceDocumentType: 'policy_schedule' }, // rank 2
      newValue: v75L,
      doc: 'policy_schedule',                                            // same rank
    });
    expect(d.kind).toBe('raise_conflict');
    expect(d.scenario).toBe('equal_authority_conflict');
  });

  it('honours policy override (e.g. auto_update on equal_authority_conflict)', () => {
    const d = call({
      current: { value: v50L, sourceDocumentType: 'policy_schedule' },
      newValue: v75L,
      doc: 'policy_schedule',
      policy: { sum_insured: { equal_authority_conflict: 'auto_update' } },
    });
    expect(d.kind).toBe('auto_update_safe');
  });

  it('falls back to __default__ policy when field-specific row missing', () => {
    const d = call({
      current: { value: v50L, sourceDocumentType: 'policy_schedule' },
      newValue: v75L,
      doc: 'policy_schedule',
      policy: { __default__: { equal_authority_conflict: 'corroborate' } },
    });
    expect(d.kind).toBe('corroborate');
  });

  it('treats unknown doc types as lowest authority', () => {
    const d = call({
      current: { value: v50L, sourceDocumentType: 'policy_schedule' }, // rank 2
      newValue: v75L,
      doc: 'made_up_doc_type',                                            // rank ∞
    });
    expect(d.scenario).toBe('lower_authority');
    expect(d.kind).toBe('ignore_lower_authority');
  });

  it('throws on missing required inputs', () => {
    expect(() => decideFieldAction({})).toThrow(/fieldName/);
    expect(() => decideFieldAction({ fieldName: 'x' })).toThrow(/newValue/);
  });
});

describe('severityFor', () => {
  const v50L = buildFieldValue('money', 5_000_000).value;
  const v75L = buildFieldValue('money', 7_500_000).value;
  const v55L = buildFieldValue('money', 5_500_000).value;
  const v50_05L = buildFieldValue('money', 5_005_000).value;

  it('money: ≥50% drift = high', () => {
    expect(severityFor('sum_insured', v50L, v75L)).toBe('high');
    expect(severityFor('sum_insured', v50L, buildFieldValue('money', 10_000_000).value)).toBe('high');
  });

  it('money: 10–50% drift = medium', () => {
    expect(severityFor('sum_insured', v50L, v55L)).toBe('medium');
  });

  it('money: <10% drift = low', () => {
    expect(severityFor('sum_insured', v50L, v50_05L)).toBe('low');
  });

  it('money: zero current = high (no baseline)', () => {
    expect(severityFor('sum_insured', buildFieldValue('money', 0).value, v50L)).toBe('high');
  });

  it('peril_type disagreement is always high', () => {
    expect(severityFor('peril_type',
      buildFieldValue('enum', { value: 'fire', enumType: 'peril_type' }).value,
      buildFieldValue('enum', { value: 'theft', enumType: 'peril_type' }).value,
    )).toBe('high');
  });

  it('date: >30 days = high', () => {
    expect(severityFor('date_loss',
      buildFieldValue('date', '2026-01-01').value,
      buildFieldValue('date', '2026-04-01').value,
    )).toBe('high');
  });

  it('date: ≤7 days = low', () => {
    expect(severityFor('date_loss',
      buildFieldValue('date', '2026-04-30').value,
      buildFieldValue('date', '2026-05-02').value,
    )).toBe('low');
  });

  it('falls back to medium for unknown kinds', () => {
    expect(severityFor('insured_name',
      buildFieldValue('string', 'A').value,
      buildFieldValue('string', 'B').value,
    )).toBe('medium');
  });
});
