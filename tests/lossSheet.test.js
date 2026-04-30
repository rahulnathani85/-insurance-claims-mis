// =============================================================================
// tests/lossSheet.test.js
// =============================================================================
// Unit tests for lib/lossSheet — depreciation, line-item math,
// underinsurance, summary roll-up, payload sanitiser.
//
// CLAUDE.md §7 binds the formulae:
//   Underinsurance = (SI / Value at Risk) × Assessed Loss. Always shown,
//   even at 100%
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  computeItem,
  summariseLossSheet,
  sanitiseItemPayload,
  computeDepreciation,
  DEPRECIATION_OPTIONS,
} from '../lib/lossSheet/index.js';

describe('computeDepreciation (config)', () => {
  it('building_rcc: 1% per year, capped at 50%', () => {
    expect(computeDepreciation('building_rcc', 0)).toBe(0);
    expect(computeDepreciation('building_rcc', 10)).toBeCloseTo(0.10, 5);
    expect(computeDepreciation('building_rcc', 60)).toBeCloseTo(0.50, 5);  // capped
    expect(computeDepreciation('building_rcc', 200)).toBeCloseTo(0.50, 5); // capped
  });

  it('computers_it: 20% per year, capped at 90%', () => {
    expect(computeDepreciation('computers_it', 1)).toBeCloseTo(0.20, 5);
    expect(computeDepreciation('computers_it', 5)).toBeCloseTo(0.90, 5); // capped
  });

  it('stock_raw_material: never depreciates', () => {
    expect(computeDepreciation('stock_raw_material', 5)).toBe(0);
  });

  it('returns null on unknown category', () => {
    expect(computeDepreciation('not_a_category', 5)).toBeNull();
  });

  it('treats negative or non-numeric age as 0', () => {
    expect(computeDepreciation('building_rcc', -5)).toBe(0);
    expect(computeDepreciation('building_rcc', 'abc')).toBe(0);
  });
});

describe('computeItem', () => {
  it('auto depreciation from category + age', () => {
    const r = computeItem({
      replacement_value: 1_000_000,
      age_years: 10,
      category: 'building_rcc',
    });
    expect(r.depreciation_pct).toBeCloseTo(10, 2);
    expect(r.depreciated_value).toBeCloseTo(900_000, 2);
    expect(r.net_loss).toBeCloseTo(900_000, 2);
    expect(r.depreciation_source).toBe('auto');
  });

  it('manual override wins over auto', () => {
    const r = computeItem({
      replacement_value: 1_000_000,
      age_years: 10,
      category: 'building_rcc',
      depreciation_pct: 25,
      depreciation_pct_override: true,
    });
    expect(r.depreciation_pct).toBeCloseTo(25, 2);
    expect(r.depreciated_value).toBeCloseTo(750_000, 2);
    expect(r.depreciation_source).toBe('override');
  });

  it('subtracts salvage from depreciated value', () => {
    const r = computeItem({
      replacement_value: 100_000,
      age_years: 0,
      category: 'machinery_general',
      salvage_value: 20_000,
    });
    expect(r.net_loss).toBeCloseTo(80_000, 2);
  });

  it('caps salvage at depreciated value (cannot recover more than the damaged item is worth)', () => {
    const r = computeItem({
      replacement_value: 100_000,
      age_years: 0,
      category: 'machinery_general',
      salvage_value: 200_000,
    });
    expect(r.salvage_value).toBeCloseTo(100_000, 2);
    expect(r.net_loss).toBe(0);
  });

  it('unknown category falls back to zero depreciation', () => {
    const r = computeItem({
      replacement_value: 100_000,
      age_years: 5,
      category: 'made_up_category',
    });
    expect(r.depreciation_pct).toBe(0);
    expect(r.net_loss).toBe(100_000);
    expect(r.depreciation_source).toBe('fallback_zero');
  });

  it('negative replacement_value treated as 0', () => {
    const r = computeItem({
      replacement_value: -50_000,
      age_years: 0,
      category: 'machinery_general',
    });
    expect(r.depreciated_value).toBe(0);
    expect(r.net_loss).toBe(0);
  });

  it('clamps depreciation_pct override to 0..100', () => {
    const r = computeItem({
      replacement_value: 100_000,
      age_years: 0,
      category: 'machinery_general',
      depreciation_pct: 150,            // > 100
      depreciation_pct_override: true,
    });
    expect(r.depreciation_pct).toBe(100);
    expect(r.depreciated_value).toBe(0);
  });
});

describe('summariseLossSheet', () => {
  const items = [
    { replacement_value: 1_000_000, net_loss: 800_000 },
    { replacement_value: 500_000,   net_loss: 400_000 },
    { replacement_value: 200_000,   net_loss: 150_000 },
  ];

  it('sums VAR + gross_loss', () => {
    const r = summariseLossSheet({ items, sum_insured: 1_700_000 });
    expect(r.value_at_risk).toBe(1_700_000);
    expect(r.gross_loss).toBe(1_350_000);
  });

  it('underinsurance_factor=1 when SI >= VAR', () => {
    const r = summariseLossSheet({ items, sum_insured: 2_000_000 });
    expect(r.underinsurance_factor).toBe(1);
    expect(r.underinsurance_pct).toBe(0);
    expect(r.adjusted_loss).toBe(1_350_000);
  });

  it('applies underinsurance when SI < VAR', () => {
    // SI = 850k, VAR = 1.7M → factor = 0.5
    const r = summariseLossSheet({ items, sum_insured: 850_000 });
    expect(r.underinsurance_factor).toBeCloseTo(0.5, 4);
    expect(r.adjusted_loss).toBeCloseTo(675_000, 2); // 1.35M × 0.5
    expect(r.underinsurance_pct).toBeCloseTo(50, 4);
  });

  it('subtracts excess after underinsurance', () => {
    const r = summariseLossSheet({ items, sum_insured: 850_000, excess_amount: 50_000 });
    expect(r.net_payable).toBeCloseTo(625_000, 2);
  });

  it('floors net_payable at 0 when excess > adjusted_loss', () => {
    const r = summariseLossSheet({ items, sum_insured: 850_000, excess_amount: 10_000_000 });
    expect(r.net_payable).toBe(0);
  });

  it('returns null underinsurance when SI not set', () => {
    const r = summariseLossSheet({ items, sum_insured: null });
    expect(r.underinsurance_factor).toBeNull();
    expect(r.underinsurance_pct).toBeNull();
    expect(r.adjusted_loss).toBe(1_350_000); // unchanged
  });

  it('handles empty items list', () => {
    const r = summariseLossSheet({ items: [], sum_insured: 1_000_000 });
    expect(r.value_at_risk).toBe(0);
    expect(r.gross_loss).toBe(0);
    expect(r.net_payable).toBe(0);
    expect(r.underinsurance_factor).toBeNull();
  });

  it('CLAUDE.md §7 worked example: SI=50L, VAR=100L, gross=80L → adjusted=40L', () => {
    const r = summariseLossSheet({
      items: [
        { replacement_value: 10_000_000, net_loss: 8_000_000 }, // ₹100L RV, ₹80L net
      ],
      sum_insured: 5_000_000,                                    // ₹50L SI
    });
    expect(r.underinsurance_factor).toBeCloseTo(0.5, 4);
    expect(r.adjusted_loss).toBe(4_000_000); // ₹40L
  });
});

describe('sanitiseItemPayload', () => {
  it('trims string fields + clamps lengths', () => {
    const r = sanitiseItemPayload({ description: '  hello  ', notes: '  short  ' });
    expect(r.description).toBe('hello');
    expect(r.notes).toBe('short');
  });

  it('coerces numeric fields safely', () => {
    const r = sanitiseItemPayload({ replacement_value: '1234', salvage_value: '50' });
    expect(r.replacement_value).toBe(1234);
    expect(r.salvage_value).toBe(50);
  });

  it('clamps depreciation_pct to 0..100', () => {
    expect(sanitiseItemPayload({ depreciation_pct: -5 }).depreciation_pct).toBe(0);
    expect(sanitiseItemPayload({ depreciation_pct: 200 }).depreciation_pct).toBe(100);
    expect(sanitiseItemPayload({ depreciation_pct: 'abc' }).depreciation_pct).toBeNull();
  });

  it('coerces depreciation_pct_override to boolean', () => {
    expect(sanitiseItemPayload({ depreciation_pct_override: 'yes' }).depreciation_pct_override).toBe(true);
    expect(sanitiseItemPayload({ depreciation_pct_override: 0 }).depreciation_pct_override).toBe(false);
  });

  it('quantity defaults to 1 when invalid', () => {
    expect(sanitiseItemPayload({ quantity: 'bad' }).quantity).toBe(1);
    expect(sanitiseItemPayload({ quantity: 0 }).quantity).toBe(1);
    expect(sanitiseItemPayload({ quantity: 5 }).quantity).toBe(5);
  });

  it('age_years null/empty becomes null', () => {
    expect(sanitiseItemPayload({ age_years: null }).age_years).toBeNull();
    expect(sanitiseItemPayload({ age_years: '' }).age_years).toBeNull();
    expect(sanitiseItemPayload({ age_years: 3 }).age_years).toBe(3);
  });
});

describe('DEPRECIATION_OPTIONS export', () => {
  it('lists every category for the UI dropdown', () => {
    expect(DEPRECIATION_OPTIONS.length).toBeGreaterThan(10);
    const sample = DEPRECIATION_OPTIONS.find((o) => o.value === 'machinery_general');
    expect(sample).toBeDefined();
    expect(sample.label).toMatch(/Machinery/);
    expect(sample.max).toBe(80);
  });
});
