// =============================================================================
// tests/marineLossSheet.test.js
// =============================================================================
// Unit tests for Marine Cargo loss-sheet math.
//
// Test cases pinned to real production working sheets shared by NISLA:
//   - Qutone Ceramic 4301-25-26 (subtotal 13,764.24 → net adjusted 9,044.64)
//   - Kansai Nerolac 4771-25-26 (per-pack damage)
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  computeItem,
  summariseMarineLossSheet,
  sanitiseItemPayload,
  sanitiseSheetPayload,
} from '../lib/marineLossSheet/index.js';

describe('computeItem', () => {
  it('amount = qty × rate, line_total = amount + insurance', () => {
    const r = computeItem({ damaged_qty: 10, rate: 1230.39, sheet_insurance_rate_pct: 1 });
    expect(r.amount).toBeCloseTo(12303.90, 2);
    expect(r.insurance_value).toBeCloseTo(123.04, 2);
    expect(r.line_total).toBeCloseTo(12426.94, 2);
  });

  it('per-line override beats sheet default', () => {
    const r = computeItem({ damaged_qty: 100, rate: 100, insurance_rate_pct: 2.5, sheet_insurance_rate_pct: 1 });
    expect(r.amount).toBe(10_000);
    expect(r.insurance_value).toBe(250);
    expect(r.insurance_rate_pct).toBe(2.5);
  });

  it('zero qty → zero everything', () => {
    const r = computeItem({ damaged_qty: 0, rate: 1000, sheet_insurance_rate_pct: 1 });
    expect(r.amount).toBe(0);
    expect(r.line_total).toBe(0);
  });

  it('clamps insurance_rate_pct to [0, 100]', () => {
    expect(computeItem({ damaged_qty: 1, rate: 1000, insurance_rate_pct: 200 }).insurance_rate_pct).toBe(100);
    expect(computeItem({ damaged_qty: 1, rate: 1000, insurance_rate_pct: -5 }).insurance_rate_pct).toBe(0);
  });

  it('non-numeric rate falls back to 0', () => {
    const r = computeItem({ damaged_qty: 1, rate: 'oops', sheet_insurance_rate_pct: 1 });
    expect(r.amount).toBe(0);
    expect(r.line_total).toBe(0);
  });
});

describe('summariseMarineLossSheet', () => {
  // Real Qutone Ceramic working-sheet figures (4301-25-26):
  //   Item 1: 10 boxes × ₹1,230.39 = ₹12,303.90; insurance 1% = ₹123.04
  //   Item 2:  2 boxes × ₹  730.17 = ₹ 1,460.34; insurance 1% =  ₹14.60
  //   Subtotal = ₹13,764.24; insurance total ≈ ₹137.64
  //   Pre-GST = ₹13,901.88
  //   + GST 18% = ₹2,502.34 → After GST ₹16,404.22
  //   + 10% handling = ₹1,640.42 → After handling ₹18,044.64
  //   − Salvage 0
  //   Net Loss = ₹18,044.64
  //   − Excess ₹9,000
  //   Net Adjusted Loss = ₹9,044.64
  it('matches the Qutone Ceramic 4301-25-26 working sheet', () => {
    const items = [
      { amount: 12303.90, insurance_value: 123.04 },
      { amount: 1460.34, insurance_value: 14.60 },
    ];
    const r = summariseMarineLossSheet({
      items,
      insurance_rate_pct: 1,
      gst_rate_pct: 18,
      handling_rate_pct: 10,
      salvage_amount: 0,
      excess_amount: 9000,
    });
    expect(r.subtotal_amount).toBeCloseTo(13764.24, 2);
    expect(r.insurance_total).toBeCloseTo(137.64, 2);
    expect(r.pre_gst_total).toBeCloseTo(13901.88, 2);
    expect(r.gst_amount).toBeCloseTo(2502.34, 1);     // ±0.1 for floating-point
    expect(r.after_gst_total).toBeCloseTo(16404.22, 1);
    expect(r.handling_amount).toBeCloseTo(1640.42, 1);
    expect(r.after_handling_total).toBeCloseTo(18044.64, 1);
    expect(r.net_loss).toBeCloseTo(18044.64, 1);
    expect(r.net_adjusted_loss).toBeCloseTo(9044.64, 1);
  });

  it('subtracts salvage before excess', () => {
    const r = summariseMarineLossSheet({
      items: [{ amount: 10000, insurance_value: 100 }],
      insurance_rate_pct: 1, gst_rate_pct: 18, handling_rate_pct: 10,
      salvage_amount: 5000, excess_amount: 1000,
    });
    // pre_gst 10100 → +18% = 11918 → +10% = 13109.80
    // − salvage 5000 = 8109.80 → − excess 1000 = 7109.80
    expect(r.net_loss).toBeCloseTo(8109.80, 1);
    expect(r.net_adjusted_loss).toBeCloseTo(7109.80, 1);
  });

  it('caps salvage at after_handling (cannot recover more than the gross)', () => {
    const r = summariseMarineLossSheet({
      items: [{ amount: 1000, insurance_value: 10 }],
      insurance_rate_pct: 1, gst_rate_pct: 18, handling_rate_pct: 10,
      salvage_amount: 100_000_000,  // huge
      excess_amount: 0,
    });
    expect(r.salvage_applied).toBeCloseTo(r.after_handling_total, 1);
    expect(r.net_loss).toBe(0);
    expect(r.net_adjusted_loss).toBe(0);
  });

  it('floors net_adjusted at 0 when excess exceeds net_loss', () => {
    const r = summariseMarineLossSheet({
      items: [{ amount: 100, insurance_value: 1 }],
      insurance_rate_pct: 1, gst_rate_pct: 18, handling_rate_pct: 10,
      salvage_amount: 0,
      excess_amount: 10_000_000,
    });
    expect(r.net_adjusted_loss).toBe(0);
  });

  it('handles empty items', () => {
    const r = summariseMarineLossSheet({ items: [] });
    expect(r.subtotal_amount).toBe(0);
    expect(r.net_adjusted_loss).toBe(0);
  });

  it('clamps rate fields to [0, 100]', () => {
    const r = summariseMarineLossSheet({
      items: [{ amount: 100, insurance_value: 0 }],
      gst_rate_pct: 200,
      handling_rate_pct: -5,
    });
    expect(r.gst_rate_pct).toBe(100);
    expect(r.handling_rate_pct).toBe(0);
  });
});

describe('sanitiseItemPayload', () => {
  it('trims string fields', () => {
    const r = sanitiseItemPayload({ description: '  Raw material  ', notes: '  ' });
    expect(r.description).toBe('Raw material');
    expect(r.notes).toBeNull();
  });

  it('coerces damaged_qty / rate', () => {
    const r = sanitiseItemPayload({ damaged_qty: '5', rate: '100.50' });
    expect(r.damaged_qty).toBe(5);
    expect(r.rate).toBe(100.5);
  });

  it('clamps insurance_rate_pct to [0, 100]', () => {
    expect(sanitiseItemPayload({ insurance_rate_pct: 150 }).insurance_rate_pct).toBe(100);
    expect(sanitiseItemPayload({ insurance_rate_pct: -10 }).insurance_rate_pct).toBe(0);
    expect(sanitiseItemPayload({ insurance_rate_pct: '' }).insurance_rate_pct).toBeNull();
    expect(sanitiseItemPayload({ insurance_rate_pct: 'abc' }).insurance_rate_pct).toBeNull();
  });

  it('damaged_qty defaults to 1 when invalid', () => {
    expect(sanitiseItemPayload({ damaged_qty: 'bad' }).damaged_qty).toBe(1);
    expect(sanitiseItemPayload({ damaged_qty: 0 }).damaged_qty).toBe(1);
    expect(sanitiseItemPayload({ damaged_qty: 5 }).damaged_qty).toBe(5);
  });

  it('rate accepts 0 (free goods)', () => {
    expect(sanitiseItemPayload({ rate: 0 }).rate).toBe(0);
  });
});

describe('sanitiseSheetPayload', () => {
  it('clamps rate fields', () => {
    const r = sanitiseSheetPayload({ insurance_rate_pct: 150, gst_rate_pct: -5 });
    expect(r.insurance_rate_pct).toBe(0);  // out of [0,100] → 0 default
    expect(r.gst_rate_pct).toBe(0);
  });

  it('rejects unknown status', () => {
    expect(() => sanitiseSheetPayload({ status: 'made_up' })).toThrow(/status/);
  });

  it('accepts each spec status', () => {
    for (const s of ['draft', 'under_review', 'approved', 'superseded']) {
      const r = sanitiseSheetPayload({ status: s });
      expect(r.status).toBe(s);
    }
  });

  it('non-negative amounts', () => {
    const r = sanitiseSheetPayload({ excess_amount: -100, salvage_amount: -50 });
    expect(r.excess_amount).toBe(0);
    expect(r.salvage_amount).toBe(0);
  });
});
