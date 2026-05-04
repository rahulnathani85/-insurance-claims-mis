// =============================================================================
// tests/insurerOfficeTypes.test.js
// =============================================================================
// Hierarchy rule + validator tests for lib/insurerOfficeTypes.js. Pure JS,
// no DB. The DB enforces the same shape via CHECK constraint + parent FK +
// partial UNIQUE on HO; these tests cover the JS-side mirror that drives
// the form + the API validators.
// =============================================================================

import { describe, it, expect } from 'vitest';

import {
  OFFICE_CODES,
  OFFICE_CODE_LIST,
  OFFICE_TYPE_LABELS,
  OFFICE_TYPE_SHORT_LABELS,
  OFFICE_TYPE_DISPLAY_ORDER,
  OFFICE_TYPE_IS_SINGLETON,
  OFFICE_TYPE_COLORS,
  ALLOWED_PARENT_TYPES,
  ALLOWED_CHILD_TYPES,
  isValidParent,
} from '../lib/insurerOfficeTypes.js';

describe('insurerOfficeTypes — exports', () => {
  it('exports exactly 7 office codes', () => {
    expect(OFFICE_CODE_LIST).toEqual(['HO', 'RO', 'LCBO', 'ZO', 'RCH', 'CCH', 'BO']);
    expect(OFFICE_CODE_LIST).toHaveLength(7);
  });

  it('OFFICE_CODES values match the list', () => {
    expect(Object.values(OFFICE_CODES).sort()).toEqual(
      [...OFFICE_CODE_LIST].sort()
    );
  });

  it('every code has a label, short label, color, and display order', () => {
    for (const code of OFFICE_CODE_LIST) {
      expect(OFFICE_TYPE_LABELS[code]).toBeTypeOf('string');
      expect(OFFICE_TYPE_LABELS[code].length).toBeGreaterThan(0);
      expect(OFFICE_TYPE_SHORT_LABELS[code]).toBeTypeOf('string');
      expect(OFFICE_TYPE_DISPLAY_ORDER[code]).toBeTypeOf('number');
      expect(OFFICE_TYPE_COLORS[code]).toMatchObject({
        bg: expect.any(String),
        fg: expect.any(String),
      });
    }
  });

  it('display order is unique per code (no collisions)', () => {
    const orders = OFFICE_CODE_LIST.map((c) => OFFICE_TYPE_DISPLAY_ORDER[c]);
    const unique = new Set(orders);
    expect(unique.size).toBe(orders.length);
  });

  it('display order ranks HO first and BO last', () => {
    expect(OFFICE_TYPE_DISPLAY_ORDER.HO).toBe(1);
    expect(OFFICE_TYPE_DISPLAY_ORDER.BO).toBe(7);
  });

  it('only HO is a singleton', () => {
    expect(OFFICE_TYPE_IS_SINGLETON.HO).toBe(true);
    for (const code of OFFICE_CODE_LIST) {
      if (code === 'HO') continue;
      expect(OFFICE_TYPE_IS_SINGLETON[code]).toBe(false);
    }
  });
});

describe('ALLOWED_PARENT_TYPES — hierarchy spec', () => {
  it('HO is root (empty parent list)', () => {
    expect(ALLOWED_PARENT_TYPES.HO).toEqual([]);
  });

  it('RO, LCBO, and ZO are children of HO only', () => {
    expect(ALLOWED_PARENT_TYPES.RO).toEqual(['HO']);
    expect(ALLOWED_PARENT_TYPES.LCBO).toEqual(['HO']);
    expect(ALLOWED_PARENT_TYPES.ZO).toEqual(['HO']);
  });

  it('RCH is a child of RO or ZO only', () => {
    expect([...ALLOWED_PARENT_TYPES.RCH].sort()).toEqual(['RO', 'ZO']);
  });

  it('CCH is a child of RCH only', () => {
    expect(ALLOWED_PARENT_TYPES.CCH).toEqual(['RCH']);
  });

  it('BO can sit under RO, ZO, RCH, CCH, or LCBO (5 options)', () => {
    expect([...ALLOWED_PARENT_TYPES.BO].sort()).toEqual(
      ['CCH', 'LCBO', 'RCH', 'RO', 'ZO']
    );
  });
});

describe('ALLOWED_CHILD_TYPES — symmetric inverse of ALLOWED_PARENT_TYPES', () => {
  it('HO can have RO, LCBO, ZO as direct children', () => {
    expect([...ALLOWED_CHILD_TYPES.HO].sort()).toEqual(['LCBO', 'RO', 'ZO']);
  });

  it('RO can have RCH and BO as direct children', () => {
    expect([...ALLOWED_CHILD_TYPES.RO].sort()).toEqual(['BO', 'RCH']);
  });

  it('ZO can have RCH and BO as direct children', () => {
    expect([...ALLOWED_CHILD_TYPES.ZO].sort()).toEqual(['BO', 'RCH']);
  });

  it('LCBO can only have BO as a direct child', () => {
    expect(ALLOWED_CHILD_TYPES.LCBO).toEqual(['BO']);
  });

  it('RCH can have CCH and BO as direct children', () => {
    expect([...ALLOWED_CHILD_TYPES.RCH].sort()).toEqual(['BO', 'CCH']);
  });

  it('CCH can only have BO as a direct child', () => {
    expect(ALLOWED_CHILD_TYPES.CCH).toEqual(['BO']);
  });

  it('BO is a leaf (no legal children)', () => {
    expect(ALLOWED_CHILD_TYPES.BO).toEqual([]);
  });

  it('parent/child symmetry: if A is in ALLOWED_PARENT_TYPES[B], then B is in ALLOWED_CHILD_TYPES[A]', () => {
    for (const child of OFFICE_CODE_LIST) {
      for (const parent of ALLOWED_PARENT_TYPES[child]) {
        expect(ALLOWED_CHILD_TYPES[parent]).toContain(child);
      }
    }
  });

  it('parent/child symmetry: if B is in ALLOWED_CHILD_TYPES[A], then A is in ALLOWED_PARENT_TYPES[B]', () => {
    for (const parent of OFFICE_CODE_LIST) {
      for (const child of ALLOWED_CHILD_TYPES[parent]) {
        expect(ALLOWED_PARENT_TYPES[child]).toContain(parent);
      }
    }
  });
});

describe('isValidParent', () => {
  it('returns true for legal parent/child pairs (spot checks across the tree)', () => {
    expect(isValidParent('RO', 'HO')).toBe(true);
    expect(isValidParent('LCBO', 'HO')).toBe(true);
    expect(isValidParent('ZO', 'HO')).toBe(true);
    expect(isValidParent('RCH', 'RO')).toBe(true);
    expect(isValidParent('RCH', 'ZO')).toBe(true);
    expect(isValidParent('CCH', 'RCH')).toBe(true);
    expect(isValidParent('BO', 'RO')).toBe(true);
    expect(isValidParent('BO', 'ZO')).toBe(true);
    expect(isValidParent('BO', 'RCH')).toBe(true);
    expect(isValidParent('BO', 'CCH')).toBe(true);
    expect(isValidParent('BO', 'LCBO')).toBe(true);
  });

  it('returns false for illegal parent/child pairs', () => {
    // HO has no legal parent.
    expect(isValidParent('HO', 'HO')).toBe(false);
    expect(isValidParent('HO', 'RO')).toBe(false);
    // Skipping levels.
    expect(isValidParent('CCH', 'HO')).toBe(false);
    expect(isValidParent('CCH', 'RO')).toBe(false);
    expect(isValidParent('CCH', 'ZO')).toBe(false);
    // Wrong direction.
    expect(isValidParent('HO', 'BO')).toBe(false);
    expect(isValidParent('RO', 'RO')).toBe(false);
    expect(isValidParent('ZO', 'RO')).toBe(false);
    // LCBO can't parent RCH.
    expect(isValidParent('RCH', 'LCBO')).toBe(false);
  });

  it('returns false for unknown codes', () => {
    expect(isValidParent('XX', 'HO')).toBe(false);
    expect(isValidParent('RO', 'XX')).toBe(false);
    expect(isValidParent('XX', 'YY')).toBe(false);
  });

  it('returns false for non-string inputs (null, undefined, numbers)', () => {
    expect(isValidParent(null, 'HO')).toBe(false);
    expect(isValidParent('RO', null)).toBe(false);
    expect(isValidParent(undefined, undefined)).toBe(false);
    expect(isValidParent(42, 'HO')).toBe(false);
    expect(isValidParent('RO', 42)).toBe(false);
  });

  it('returns false when both inputs are valid codes but the relation is illegal', () => {
    // Cross-checks every illegal pair on the full grid except the legal ones.
    for (const child of OFFICE_CODE_LIST) {
      for (const parent of OFFICE_CODE_LIST) {
        const isLegal = ALLOWED_PARENT_TYPES[child].includes(parent);
        expect(isValidParent(child, parent)).toBe(isLegal);
      }
    }
  });
});
