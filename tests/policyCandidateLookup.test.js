// =============================================================================
// tests/policyCandidateLookup.test.js
// =============================================================================
// Unit tests for lib/comms/policyCandidateLookup.js. Mocks a minimal Supabase
// chainable builder so each test scripts the rows the DB would return.
// Pattern mirrors tests/executor.test.js (lighter weight — only `policies`
// table is involved).
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findCandidatePolicies,
  normalisePolicyNumber,
} from '../lib/comms/policyCandidateLookup.js';

// In-memory state. Each test seeds `dbState.policies` with the rows the
// mock builder returns from `select(...)`.
const dbState = { policies: [] };

function makeMockSupabase() {
  return {
    from(table) {
      let _filters = [];
      let _ilikePattern = null;
      let _company = null;

      const builder = {
        select() { return builder; },
        limit() { return builder; },
        eq(col, val) {
          if (col === 'company') _company = val;
          _filters.push({ col, val });
          return builder;
        },
        ilike(col, pattern) {
          _ilikePattern = { col, pattern };
          return builder;
        },
        // Final await — Supabase returns { data, error }.
        then(resolve) {
          if (table !== 'policies') return resolve({ data: [], error: null });

          // Apply company scope.
          let rows = dbState.policies.filter((r) =>
            _company == null || r.company === _company
          );

          // Apply ilike filter (case-insensitive substring match — strip the
          // wrapping % chars and lowercase compare).
          if (_ilikePattern) {
            const needle = String(_ilikePattern.pattern).replace(/^%|%$/g, '').toLowerCase();
            const col = _ilikePattern.col;
            rows = rows.filter((r) =>
              String(r[col] ?? '').toLowerCase().includes(needle)
            );
          }

          return resolve({ data: rows, error: null });
        },
      };

      return builder;
    },
  };
}

beforeEach(() => {
  dbState.policies = [];
});

describe('normalisePolicyNumber', () => {
  it('uppercases + strips whitespace + collapses runs of dashes', () => {
    expect(normalisePolicyNumber('  pol-123-456  ')).toBe('POL-123-456');
    expect(normalisePolicyNumber('pol --- 123')).toBe('POL-123');
    expect(normalisePolicyNumber('  ')).toBe('');
  });

  it('returns empty string for non-strings', () => {
    expect(normalisePolicyNumber(null)).toBe('');
    expect(normalisePolicyNumber(undefined)).toBe('');
    expect(normalisePolicyNumber(42)).toBe('');
  });
});

describe('findCandidatePolicies', () => {
  it('returns empty array when nothing matches', async () => {
    dbState.policies = [
      { id: 1, policy_number: 'AAA-111', insurer: 'X', insured_name: 'Y', company: 'NISLA',
        coverage_amount: null, sum_insured: null, start_date: null, end_date: null, created_at: '2026-01-01' },
    ];
    const out = await findCandidatePolicies({
      supabase: makeMockSupabase(),
      policyNumber: 'NO-MATCH-123',
      insurer: null,
      insuredName: null,
      company: 'NISLA',
    });
    expect(out).toEqual([]);
  });

  it('exact policy_number match wins (pass 1)', async () => {
    dbState.policies = [
      { id: 5, policy_number: '460708212610000001', insurer: 'NICL', insured_name: 'Chifu', company: 'NISLA',
        coverage_amount: 5000000, sum_insured: '5000000', start_date: '2026-04-04', end_date: '2027-04-03',
        created_at: '2026-04-01' },
    ];
    const out = await findCandidatePolicies({
      supabase: makeMockSupabase(),
      policyNumber: '460708212610000001',
      insurer: 'NICL',
      insuredName: 'Chifu',
      company: 'NISLA',
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(5);
    expect(out[0].source).toBe('master');
    expect(out[0].verified).toBe(true);
  });

  it('synthesises verified=false when amount/dates are missing', async () => {
    dbState.policies = [
      { id: 6, policy_number: 'AAA-111', insurer: 'X', insured_name: 'Y', company: 'NISLA',
        coverage_amount: null, sum_insured: null, start_date: null, end_date: null, created_at: '2026-01-01' },
    ];
    const out = await findCandidatePolicies({
      supabase: makeMockSupabase(),
      policyNumber: 'AAA-111',
      company: 'NISLA',
    });
    expect(out).toHaveLength(1);
    expect(out[0].verified).toBe(false);
  });

  it('OCR-fuzzy match catches O↔0 / I↔1 / dash variants (pass 2)', async () => {
    // Master has 'POL-O123-I45'; extracted has 'POL01230145' (no dashes,
    // O→0, I→1). Fuzzy key ocrFuzzyKey() should equate them.
    dbState.policies = [
      { id: 7, policy_number: 'POL-O123-I45', insurer: 'NICL', insured_name: 'M/s Acme', company: 'NISLA',
        coverage_amount: 100000, sum_insured: '100000', start_date: '2026-01-01', end_date: '2027-01-01',
        created_at: '2026-01-01' },
    ];
    const out = await findCandidatePolicies({
      supabase: makeMockSupabase(),
      policyNumber: 'POL01230145',
      insurer: 'NICL',
      company: 'NISLA',
    });
    expect(out.some((r) => r.id === 7)).toBe(true);
  });

  it('falls back to insurer+insured_name (pass 3) when policy_number misses', async () => {
    dbState.policies = [
      { id: 8, policy_number: 'OTHER-999', insurer: 'NICL', insured_name: 'Chifu Agritech',
        company: 'NISLA', coverage_amount: 1000, sum_insured: '1000', start_date: '2026-01-01',
        end_date: '2027-01-01', created_at: '2026-01-01' },
    ];
    const out = await findCandidatePolicies({
      supabase: makeMockSupabase(),
      policyNumber: 'POLICY-DOES-NOT-EXIST',
      insurer: 'NICL',
      insuredName: 'Chifu Agritech',
      company: 'NISLA',
    });
    expect(out.some((r) => r.id === 8)).toBe(true);
  });

  it('caps results at 5 even with many matches', async () => {
    dbState.policies = Array.from({ length: 12 }).map((_, i) => ({
      id: i + 1,
      policy_number: `POL-${i}`,
      insurer: 'NICL',
      insured_name: 'Chifu',
      company: 'NISLA',
      coverage_amount: 1000,
      sum_insured: '1000',
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      created_at: '2026-01-01',
    }));
    const out = await findCandidatePolicies({
      supabase: makeMockSupabase(),
      policyNumber: null,
      insurer: 'NICL',
      insuredName: 'Chifu',
      company: 'NISLA',
    });
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it('respects company scope (NISLA query does not return ACUERE rows)', async () => {
    dbState.policies = [
      { id: 9,  policy_number: 'POL-X', insurer: 'NICL', insured_name: 'Chifu', company: 'ACUERE',
        coverage_amount: 1000, sum_insured: '1000', start_date: '2026-01-01', end_date: '2027-01-01',
        created_at: '2026-01-01' },
      { id: 10, policy_number: 'POL-X', insurer: 'NICL', insured_name: 'Chifu', company: 'NISLA',
        coverage_amount: 1000, sum_insured: '1000', start_date: '2026-01-01', end_date: '2027-01-01',
        created_at: '2026-01-01' },
    ];
    const out = await findCandidatePolicies({
      supabase: makeMockSupabase(),
      policyNumber: 'POL-X',
      insurer: 'NICL',
      insuredName: 'Chifu',
      company: 'NISLA',
    });
    expect(out.every((r) => r.company === 'NISLA')).toBe(true);
    expect(out.some((r) => r.id === 10)).toBe(true);
    expect(out.some((r) => r.id === 9)).toBe(false);
  });

  it('throws when supabase client is missing', async () => {
    await expect(findCandidatePolicies({})).rejects.toThrow(/supabase client required/);
  });
});
