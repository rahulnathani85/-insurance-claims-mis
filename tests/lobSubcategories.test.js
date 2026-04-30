// =============================================================================
// tests/lobSubcategories.test.js
// =============================================================================
// Unit tests for lib/lobSubcategories.js — IRDAI LOB taxonomy helpers
// (modifications 30-04-2026.md §4 / §5).
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  IRDAI_LOBS,
  LOB_SUBCATEGORIES,
  subcategoriesFor,
  normaliseLob,
  suggestSubcategory,
} from '../lib/lobSubcategories.js';

describe('IRDAI taxonomy', () => {
  it('lists exactly the IRDAI 7 LOBs', () => {
    expect(IRDAI_LOBS).toEqual([
      'Fire', 'Engineering', 'Marine Cargo', 'Marine Hull',
      'Motor', 'Miscellaneous', 'LOP',
    ]);
  });

  it('every LOB has a sub-category list', () => {
    for (const lob of IRDAI_LOBS) {
      expect(LOB_SUBCATEGORIES[lob]).toBeDefined();
      expect(LOB_SUBCATEGORIES[lob].length).toBeGreaterThan(0);
    }
  });

  it('every sub-category list ends with "Others"', () => {
    for (const lob of IRDAI_LOBS) {
      const list = LOB_SUBCATEGORIES[lob];
      expect(list[list.length - 1]).toBe('Others');
    }
  });
});

describe('subcategoriesFor', () => {
  it('returns the list for a known LOB', () => {
    expect(subcategoriesFor('Fire')).toContain('SFSP (Standard Fire & Special Perils)');
    expect(subcategoriesFor('Marine Cargo')).toContain('Specific Voyage Policy');
  });

  it('returns [] for null / undefined / unknown', () => {
    expect(subcategoriesFor(null)).toEqual([]);
    expect(subcategoriesFor(undefined)).toEqual([]);
    expect(subcategoriesFor('NotALOB')).toEqual([]);
  });
});

describe('normaliseLob', () => {
  it('canonicalises common variants', () => {
    expect(normaliseLob('motor od')).toBe('Motor');
    expect(normaliseLob('MARINE CARGO')).toBe('Marine Cargo');
    expect(normaliseLob('marine')).toBe('Marine Cargo');
    expect(normaliseLob('engg')).toBe('Engineering');
    expect(normaliseLob('BI')).toBe('LOP');
  });

  it('passes through canonical values', () => {
    expect(normaliseLob('Fire')).toBe('Fire');
    expect(normaliseLob('LOP')).toBe('LOP');
  });

  it('falls back to Miscellaneous on unknown / empty', () => {
    expect(normaliseLob('')).toBe('Miscellaneous');
    expect(normaliseLob(null)).toBe('Miscellaneous');
    expect(normaliseLob('something weird')).toBe('Miscellaneous');
  });
});

describe('suggestSubcategory', () => {
  it('matches Fire SFSP from policy_type', () => {
    const out = suggestSubcategory('Fire', { policy_type: 'Standard Fire and Special Perils Policy' });
    expect(out).toBe('SFSP (Standard Fire & Special Perils)');
  });

  it('matches Engineering CAR from policy_type', () => {
    const out = suggestSubcategory('Engineering', { policy_type: "Contractor's All Risk Policy" });
    expect(out).toBe("CAR (Contractor's All Risk) Policy");
  });

  it('returns null when no overlap', () => {
    expect(suggestSubcategory('Fire', { policy_type: 'something unrelated' })).toBeNull();
  });

  it('returns null without LOB', () => {
    expect(suggestSubcategory(null, { policy_type: 'CAR' })).toBeNull();
  });

  it('skips "Others" — never auto-suggested', () => {
    const out = suggestSubcategory('Fire', { policy_type: 'Others' });
    expect(out).toBeNull();
  });

  it('reads multiple extraction fields (policy_type, lob_subcategory, coverage_type)', () => {
    const out = suggestSubcategory('Marine Cargo', { coverage_type: 'Inland Transit Policy' });
    expect(out).toBe('Inland Transit Policy');
  });
});
