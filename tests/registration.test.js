// =============================================================================
// tests/registration.test.js
// =============================================================================
// Unit tests for lib/registration.js helpers (spec §6, §10).
// Run via:  npm test
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  computeComplexityTier,
  computeIlaDueAt,
  computeFsrDueAt,
  validateRegistration,
  COMPLEXITY_THRESHOLDS,
  FSR_TAT_DAYS,
  ILA_TAT_HOURS,
} from '../lib/registration.js';

// -----------------------------------------------------------------------------
// computeComplexityTier (spec §6)
// -----------------------------------------------------------------------------
describe('computeComplexityTier', () => {
  it('returns null when no loss signal is provided', () => {
    expect(computeComplexityTier({})).toBe(null);
    expect(computeComplexityTier({ estimated_loss: null })).toBe(null);
    expect(computeComplexityTier({ estimated_loss: 0, gross_loss: 0 })).toBe(null);
  });

  it('returns "small" for loss < 1L', () => {
    expect(computeComplexityTier({ estimated_loss: 50_000 })).toBe('small');
    expect(computeComplexityTier({ estimated_loss: 99_999 })).toBe('small');
  });

  it('returns "standard" for loss 1L–50L', () => {
    expect(computeComplexityTier({ estimated_loss: 100_000 })).toBe('standard');
    expect(computeComplexityTier({ estimated_loss: 4_999_999 })).toBe('standard');
  });

  it('returns "large" for loss 50L–5Cr', () => {
    expect(computeComplexityTier({ estimated_loss: 5_000_000 })).toBe('large');
    expect(computeComplexityTier({ estimated_loss: 49_999_999 })).toBe('large');
  });

  it('returns "cat" for loss > 5Cr', () => {
    expect(computeComplexityTier({ estimated_loss: 50_000_000 })).toBe('cat');
    expect(computeComplexityTier({ estimated_loss: 500_000_000 })).toBe('cat');
  });

  it('forces "cat" when is_catastrophe=true regardless of loss amount', () => {
    expect(computeComplexityTier({ estimated_loss: 1, is_catastrophe: true })).toBe('cat');
    expect(computeComplexityTier({ is_catastrophe: true })).toBe('cat');
  });

  it('falls back through estimated_loss → gross_loss → claim_amount_intimated', () => {
    expect(computeComplexityTier({ estimated_loss: null, gross_loss: 200_000 })).toBe('standard');
    expect(computeComplexityTier({ estimated_loss: null, gross_loss: null, claim_amount_intimated: 60_000_000 })).toBe('cat');
  });
});

// -----------------------------------------------------------------------------
// computeIlaDueAt (spec §6: registered_at + 72h)
// -----------------------------------------------------------------------------
describe('computeIlaDueAt', () => {
  it('adds 72 hours to the registration timestamp', () => {
    const base = '2026-04-29T10:00:00.000Z';
    const dueAt = new Date(computeIlaDueAt(base));
    const expected = new Date('2026-05-02T10:00:00.000Z');
    expect(dueAt.getTime()).toBe(expected.getTime());
  });

  it('returns an ISO 8601 string', () => {
    const dueAt = computeIlaDueAt('2026-04-29T10:00:00.000Z');
    expect(typeof dueAt).toBe('string');
    expect(dueAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('throws on invalid input', () => {
    expect(() => computeIlaDueAt('not-a-date')).toThrow();
  });
});

// -----------------------------------------------------------------------------
// computeFsrDueAt (spec §6)
// -----------------------------------------------------------------------------
describe('computeFsrDueAt', () => {
  const base = '2026-04-29T10:00:00.000Z';

  it('returns 30 days for small claims', () => {
    const dueAt = new Date(computeFsrDueAt(base, 'small'));
    const expected = new Date('2026-05-29T10:00:00.000Z');
    expect(dueAt.getTime()).toBe(expected.getTime());
  });

  it('returns 30 days for standard claims', () => {
    const dueAt = new Date(computeFsrDueAt(base, 'standard'));
    const expected = new Date('2026-05-29T10:00:00.000Z');
    expect(dueAt.getTime()).toBe(expected.getTime());
  });

  it('returns 45 days for large claims', () => {
    const dueAt = new Date(computeFsrDueAt(base, 'large'));
    const expected = new Date('2026-06-13T10:00:00.000Z');
    expect(dueAt.getTime()).toBe(expected.getTime());
  });

  it('returns 90 days for cat claims', () => {
    const dueAt = new Date(computeFsrDueAt(base, 'cat'));
    const expected = new Date('2026-07-28T10:00:00.000Z');
    expect(dueAt.getTime()).toBe(expected.getTime());
  });

  it('returns null when complexity tier is unknown', () => {
    expect(computeFsrDueAt(base, null)).toBe(null);
    expect(computeFsrDueAt(base, 'invalid')).toBe(null);
  });
});

// -----------------------------------------------------------------------------
// validateRegistration (spec §10)
// -----------------------------------------------------------------------------
describe('validateRegistration', () => {
  // The "today" anchor used by the helper for relative-date checks
  const today = '2026-04-29T00:00:00.000Z';

  // Build a baseline valid claim once per test
  function baseClaim() {
    return {
      ref_number: '237/26-27/Fire',
      policy_number: 'POL-12345',
      insured_name: 'M/s Test Industries',
      lob: 'Fire',
      date_of_loss: '2026-04-15',
      policy_period_from: '2025-04-01',
      policy_period_to: '2026-03-31',
    };
  }

  it('passes with all required fields and valid dates', () => {
    const claim = baseClaim();
    claim.policy_period_to = '2026-12-31'; // ensure DoL is inside
    const r = validateRegistration(claim, { today });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('fails when date_of_loss is missing', () => {
    const claim = baseClaim();
    claim.date_of_loss = null;
    const r = validateRegistration(claim, { today });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('date_of_loss is required and must be a valid date');
  });

  it('fails when date_of_loss is in the future', () => {
    const claim = baseClaim();
    claim.date_of_loss = '2026-05-30'; // future relative to today=Apr 29
    const r = validateRegistration(claim, { today });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('future'))).toBe(true);
  });

  it('warns when loss is more than 1 year old (but does not fail)', () => {
    const claim = baseClaim();
    claim.date_of_loss = '2025-01-01'; // ~16 months before today
    claim.policy_period_from = '2024-04-01';
    claim.policy_period_to   = '2025-03-31';
    const r = validateRegistration(claim, { today });
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.includes('time-barred'))).toBe(true);
  });

  it('fails when date_of_loss is outside policy period', () => {
    const claim = baseClaim();
    claim.date_of_loss = '2026-04-15';
    claim.policy_period_from = '2025-01-01';
    claim.policy_period_to   = '2025-12-31'; // DoL is AFTER period
    const r = validateRegistration(claim, { today });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('outside policy period'))).toBe(true);
  });

  it('warns when policy_period is not set (period validation skipped)', () => {
    const claim = baseClaim();
    claim.policy_period_from = null;
    claim.policy_period_to   = null;
    const r = validateRegistration(claim, { today });
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.includes('policy_period'))).toBe(true);
  });

  it('fails when required fields are missing', () => {
    const claim = baseClaim();
    claim.ref_number   = '';
    claim.insured_name = null;
    const r = validateRegistration(claim, { today });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('reference number is required');
    expect(r.errors).toContain('insured name is required');
  });
});

// -----------------------------------------------------------------------------
// Constants — guard against accidental edits
// -----------------------------------------------------------------------------
describe('exported constants', () => {
  it('FSR_TAT_DAYS matches spec §6', () => {
    expect(FSR_TAT_DAYS).toEqual({
      small:    30,
      standard: 30,
      large:    45,
      cat:      90,
    });
  });

  it('ILA_TAT_HOURS is 72 per IRDAI', () => {
    expect(ILA_TAT_HOURS).toBe(72);
  });

  it('COMPLEXITY_THRESHOLDS use the spec-stated INR cutoffs', () => {
    expect(COMPLEXITY_THRESHOLDS.small_max).toBe(100_000);
    expect(COMPLEXITY_THRESHOLDS.standard_max).toBe(5_000_000);
    expect(COMPLEXITY_THRESHOLDS.large_max).toBe(50_000_000);
  });
});
