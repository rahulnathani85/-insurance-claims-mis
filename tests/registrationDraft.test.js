// =============================================================================
// tests/registrationDraft.test.js
// =============================================================================
// Unit tests for lib/registrationDraft.js — Slice E pure helpers.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  confidenceBand,
  fieldFromExtraction,
  mergeDraftWithClaim,
  summariseDraft,
  hasMeaningfulDiff,
  CONFIDENCE_BANDS,
} from '../lib/registrationDraft.js';

describe('confidenceBand', () => {
  it('returns "unknown" for null / undefined / NaN', () => {
    expect(confidenceBand(null)).toBe('unknown');
    expect(confidenceBand(undefined)).toBe('unknown');
    expect(confidenceBand('not a number')).toBe('unknown');
  });

  it('returns "high" at and above 0.85', () => {
    expect(confidenceBand(0.85)).toBe('high');
    expect(confidenceBand(0.99)).toBe('high');
    expect(confidenceBand(1.0)).toBe('high');
  });

  it('returns "medium" at and above 0.6', () => {
    expect(confidenceBand(0.6)).toBe('medium');
    expect(confidenceBand(0.84)).toBe('medium');
  });

  it('returns "low" below 0.6', () => {
    expect(confidenceBand(0.59)).toBe('low');
    expect(confidenceBand(0)).toBe('low');
  });

  it('thresholds match CONFIDENCE_BANDS table', () => {
    expect(CONFIDENCE_BANDS.high.min).toBe(0.85);
    expect(CONFIDENCE_BANDS.medium.min).toBe(0.6);
  });
});

describe('fieldFromExtraction', () => {
  it('handles { field: { value, confidence } } shape', () => {
    const extracted = { policy_number: { value: 'XYZ', confidence: 0.92 } };
    const r = fieldFromExtraction(extracted, 'policy_number');
    expect(r.value).toBe('XYZ');
    expect(r.confidence).toBeCloseTo(0.92);
  });

  it('handles flat { field: value } + sibling _confidence map', () => {
    const extracted = { policy_number: 'XYZ', _confidence: { policy_number: 0.42 } };
    const r = fieldFromExtraction(extracted, 'policy_number');
    expect(r.value).toBe('XYZ');
    expect(r.confidence).toBeCloseTo(0.42);
  });

  it('handles flat field with no confidence', () => {
    const r = fieldFromExtraction({ policy_number: 'XYZ' }, 'policy_number');
    expect(r.value).toBe('XYZ');
    expect(r.confidence).toBeNull();
  });

  it('returns nulls for missing field', () => {
    expect(fieldFromExtraction({ other: 'x' }, 'policy_number')).toEqual({ value: null, confidence: null });
  });

  it('handles non-object input safely', () => {
    expect(fieldFromExtraction(null, 'x')).toEqual({ value: null, confidence: null });
    expect(fieldFromExtraction('string', 'x')).toEqual({ value: null, confidence: null });
  });

  it('also accepts __confidence (double-underscore) map', () => {
    const extracted = { policy_number: 'XYZ', __confidence: { policy_number: 0.7 } };
    expect(fieldFromExtraction(extracted, 'policy_number').confidence).toBeCloseTo(0.7);
  });
});

describe('mergeDraftWithClaim', () => {
  it('overlays draft over claim', () => {
    const claim = { insured_name: 'Acme', policy_number: 'OLD', sum_insured: 1000 };
    const draft = { policy_number: 'NEW', date_loss: '2026-04-01' };
    const merged = mergeDraftWithClaim(claim, draft);
    expect(merged.insured_name).toBe('Acme');     // from claim
    expect(merged.policy_number).toBe('NEW');     // overlaid
    expect(merged.sum_insured).toBe(1000);        // from claim
    expect(merged.date_loss).toBe('2026-04-01');  // from draft
  });

  it('only includes whitelisted form fields', () => {
    const merged = mergeDraftWithClaim({ random_extra: 'should not appear' }, {});
    expect('random_extra' in merged).toBe(false);
  });

  it('keeps explicit null in draft (clerk cleared a field)', () => {
    const merged = mergeDraftWithClaim({ insured_name: 'Acme' }, { insured_name: null });
    expect(merged.insured_name).toBeNull();
  });
});

describe('summariseDraft', () => {
  const fullForm = {
    insurer_name: 'NIAC',
    policy_number: 'P-1',
    policy_period_from: '2026-01-01',
    policy_period_to: '2027-01-01',
    sum_insured: 1000000,
    insured_name: 'Acme',
    lob: 'Fire',
    date_loss: '2026-04-01',
    date_of_intimation: '2026-04-02',
    loss_location: 'Mumbai',
    loss_location_pin: '400001',
  };

  it('reports ready=true when all mandatory present', () => {
    const r = summariseDraft(fullForm);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.filled).toBe(r.total);
  });

  it('lists missing mandatory fields', () => {
    const r = summariseDraft({});
    expect(r.ready).toBe(false);
    expect(r.missing.length).toBe(r.total);
    expect(r.missing).toContain('policy_number');
    expect(r.missing).toContain('date_loss');
  });

  it('treats empty / whitespace-only strings as missing', () => {
    const r = summariseDraft({ ...fullForm, insured_name: '   ', policy_number: '' });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('insured_name');
    expect(r.missing).toContain('policy_number');
  });

  it('treats NaN numbers as missing', () => {
    const r = summariseDraft({ ...fullForm, sum_insured: NaN });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('sum_insured');
  });
});

describe('hasMeaningfulDiff', () => {
  it('returns false on identical refs', () => {
    const a = { x: 1 };
    expect(hasMeaningfulDiff(a, a)).toBe(false);
  });

  it('returns true when prev is null', () => {
    expect(hasMeaningfulDiff(null, { x: 1 })).toBe(true);
  });

  it('returns false for shallow-equal objects', () => {
    expect(hasMeaningfulDiff({ x: 1, y: 'a' }, { x: 1, y: 'a' })).toBe(false);
  });

  it('returns true for any value change', () => {
    expect(hasMeaningfulDiff({ x: 1 }, { x: 2 })).toBe(true);
  });

  it('treats undefined and null as equivalent', () => {
    expect(hasMeaningfulDiff({ x: undefined }, { x: null })).toBe(false);
  });

  it('detects added or removed keys', () => {
    expect(hasMeaningfulDiff({ x: 1 }, { x: 1, y: 2 })).toBe(true);
    expect(hasMeaningfulDiff({ x: 1, y: 2 }, { x: 1 })).toBe(true);
  });
});
