// =============================================================================
// tests/insurerAgent.test.js
// =============================================================================
// Pure-logic tests for the Insurer Registration Agent's lib/* primitives.
// Routes themselves are integration-tested manually (they hit live LLM and
// OCR providers — out of scope here). Vitest, Node env, no DOM.
// =============================================================================

import { describe, it, expect } from 'vitest';

import {
  parseInsurerJson,
  buildLookupPrompt,
  ALLOWED_OFFICE_CODES_AT_AGENT_STAGE,
  ALLOWED_OWNERSHIP_TYPES,
} from '../lib/insurerAgent/extractor.js';

import {
  isValidGSTIN,
  isValidPIN,
  pinMatchesState,
  isPlausiblePhone,
  isPlausibleEmail,
  assessConfidence,
} from '../lib/insurerAgent/confidence.js';

import {
  suggestParents,
  topologicalOrder,
  validateOffices,
} from '../lib/insurerAgent/autoLink.js';

// ============================================================================
// extractor.js — JSON parser + prompt shape
// ============================================================================

describe('parseInsurerJson', () => {
  it('parses a clean JSON response', () => {
    const text = JSON.stringify({
      insurer: { company_name: 'X', code: 'X' },
      offices: [{ office_code: 'HO', name: 'Mumbai HO' }],
      field_confidences: { 'insurer.company_name': 'high' },
      extraction_notes: null,
    });
    const r = parseInsurerJson(text);
    expect(r.insurer.company_name).toBe('X');
    expect(r.offices).toHaveLength(1);
  });

  it('strips ```json fences if the model adds them', () => {
    const inner = JSON.stringify({
      insurer: { company_name: 'X' },
      offices: [],
      field_confidences: {},
      extraction_notes: null,
    });
    const r = parseInsurerJson('```json\n' + inner + '\n```');
    expect(r.insurer.company_name).toBe('X');
  });

  it('strips bare ``` fences too', () => {
    const inner = JSON.stringify({ insurer: { company_name: 'Y' }, offices: [] });
    const r = parseInsurerJson('```\n' + inner + '\n```');
    expect(r.insurer.company_name).toBe('Y');
  });

  it('falls back to extracting the last { ... } block on stray preamble', () => {
    const inner = JSON.stringify({ insurer: { company_name: 'Z' }, offices: [] });
    const r = parseInsurerJson("Here's the JSON:\n" + inner);
    expect(r.insurer.company_name).toBe('Z');
  });

  it('throws on empty input', () => {
    expect(() => parseInsurerJson('')).toThrow(/empty/);
    expect(() => parseInsurerJson('   ')).toThrow(/empty/);
  });

  it('throws on non-JSON', () => {
    expect(() => parseInsurerJson('not json at all')).toThrow();
  });

  it('throws when insurer field is missing', () => {
    expect(() => parseInsurerJson(JSON.stringify({ offices: [] }))).toThrow(/insurer/);
  });

  it('drops offices with disallowed codes (RCH/CCH/BO at agent stage)', () => {
    const r = parseInsurerJson(JSON.stringify({
      insurer: { company_name: 'X' },
      offices: [
        { office_code: 'HO', name: 'HO Mumbai' },
        { office_code: 'BO', name: 'Branch X' },     // dropped
        { office_code: 'RCH', name: 'Hub Y' },        // dropped
        { office_code: 'CCH', name: 'Corporate Z' }, // dropped
        { office_code: 'RO', name: 'Pune RO' },
      ],
    }));
    expect(r.offices).toHaveLength(2);
    expect(r.offices.map((o) => o.office_code).sort()).toEqual(['HO', 'RO']);
  });

  it('clamps unknown ownership_type to null', () => {
    const r = parseInsurerJson(JSON.stringify({
      insurer: { company_name: 'X', ownership_type: 'Cooperative' },
      offices: [],
    }));
    expect(r.insurer.ownership_type).toBeNull();
  });

  it('keeps allowed ownership_type', () => {
    const r = parseInsurerJson(JSON.stringify({
      insurer: { company_name: 'X', ownership_type: 'PSU' },
      offices: [],
    }));
    expect(r.insurer.ownership_type).toBe('PSU');
  });

  it('coerces office row by trimming and lifting `code`/`type` to office_code', () => {
    const r = parseInsurerJson(JSON.stringify({
      insurer: { company_name: 'X' },
      offices: [
        { code: 'ho', name: '  Mumbai HO  ', city: '' }, // alt key, lowercase, padded
      ],
    }));
    expect(r.offices).toHaveLength(1);
    expect(r.offices[0].office_code).toBe('HO');
    expect(r.offices[0].name).toBe('Mumbai HO');
    expect(r.offices[0].city).toBeNull();
  });
});

describe('buildLookupPrompt', () => {
  it('mode "name" forbids high confidence in the prompt', () => {
    const { systemPrompt, userMessage } = buildLookupPrompt({ mode: 'name', name: 'ICICI Lombard' });
    expect(systemPrompt).toContain('JSON ONLY');
    expect(userMessage).toContain('ICICI Lombard');
    expect(userMessage).toMatch(/medium.*low|"high" is not allowed/i);
  });

  it('mode "url" pins the model to the page text', () => {
    const html = 'Mumbai office at 123 Marine Drive';
    const { userMessage } = buildLookupPrompt({ mode: 'url', url: 'https://x', htmlText: html });
    expect(userMessage).toContain('Mumbai office');
    expect(userMessage).toContain('do NOT supplement');
  });

  it('mode "document" with xlsx rows passes JSON evidence', () => {
    const rows = [{ branch_name: 'Pune RO', city: 'Pune' }];
    const { userMessage } = buildLookupPrompt({ mode: 'document', xlsxRows: rows });
    expect(userMessage).toContain('Pune RO');
  });

  it('mode "document" without xlsx falls back to OCR text', () => {
    const { userMessage } = buildLookupPrompt({ mode: 'document', ocrText: 'OCR content here' });
    expect(userMessage).toContain('OCR content here');
  });

  it('throws on unknown mode', () => {
    expect(() => buildLookupPrompt({ mode: 'magic' })).toThrow(/mode/);
  });
});

describe('agent-stage allowed codes', () => {
  it('exposes only the 4 hierarchy levels', () => {
    expect(ALLOWED_OFFICE_CODES_AT_AGENT_STAGE.sort()).toEqual(['HO', 'LCBO', 'RO', 'ZO']);
  });
});

describe('ALLOWED_OWNERSHIP_TYPES', () => {
  it('matches the spec list', () => {
    expect(ALLOWED_OWNERSHIP_TYPES).toEqual([
      'PSU', 'Private', 'Standalone Health', 'Foreign Reinsurer',
    ]);
  });
});

// ============================================================================
// confidence.js — checksums + heuristics
// ============================================================================

describe('isValidGSTIN', () => {
  // Reference GSTIN that passes the published checksum spec.
  // Generated by walking the algorithm forward over a synthetic 14-char prefix.
  it('accepts a known-good GSTIN', () => {
    // Calibrated against the public GST checksum implementation.
    // 27AAPFU0939F1ZV — Bombay-region PAN-based test GSTIN.
    expect(isValidGSTIN('27AAPFU0939F1ZV')).toBe(true);
  });

  it('rejects mistyped check digit', () => {
    // Same prefix as above but wrong final char.
    expect(isValidGSTIN('27AAPFU0939F1ZX')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidGSTIN('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGSTIN('27AAPFU0939F1ZVX')).toBe(false);
  });

  it('rejects bad format', () => {
    expect(isValidGSTIN('XXAAPFU0939F1ZV')).toBe(false);  // first two not digits
    expect(isValidGSTIN('27AAPFU0939F1AV')).toBe(false);  // 'A' instead of 'Z' at pos 13
    expect(isValidGSTIN('27aapfu0939f1zv')).toBe(true);   // case-insensitive (we upper-case)
  });

  it('rejects non-string / null', () => {
    expect(isValidGSTIN(null)).toBe(false);
    expect(isValidGSTIN(undefined)).toBe(false);
    expect(isValidGSTIN(27)).toBe(false);
  });
});

describe('isValidPIN', () => {
  it('accepts 6-digit PINs starting with 1–9', () => {
    expect(isValidPIN('400001')).toBe(true);
    expect(isValidPIN('110001')).toBe(true);
    expect(isValidPIN('560001')).toBe(true);
  });
  it('rejects PINs starting with 0', () => {
    expect(isValidPIN('000001')).toBe(false);
  });
  it('rejects non-6-digit input', () => {
    expect(isValidPIN('40000')).toBe(false);
    expect(isValidPIN('4000001')).toBe(false);
    expect(isValidPIN('40000A')).toBe(false);
  });
});

describe('pinMatchesState', () => {
  it('accepts Mumbai PIN with Maharashtra', () => {
    expect(pinMatchesState('400001', 'Maharashtra')).toBe(true);
  });
  it('rejects Mumbai PIN with Karnataka', () => {
    expect(pinMatchesState('400001', 'Karnataka')).toBe(false);
  });
  it('returns null when state is unknown to the heuristic', () => {
    expect(pinMatchesState('400001', 'Atlantis')).toBeNull();
  });
  it('returns null when PIN is malformed', () => {
    expect(pinMatchesState('40000', 'Maharashtra')).toBeNull();
  });
  it('case-insensitive on state', () => {
    expect(pinMatchesState('400001', 'MAHARASHTRA')).toBe(true);
  });
});

describe('isPlausiblePhone / isPlausibleEmail', () => {
  it('accepts plausible phones', () => {
    expect(isPlausiblePhone('+919876543210')).toBe(true);
    expect(isPlausiblePhone('022 6650 1234')).toBe(true);
    expect(isPlausiblePhone('9876543210')).toBe(true);
  });
  it('rejects too-short phones', () => {
    expect(isPlausiblePhone('123')).toBe(false);
  });
  it('accepts emails', () => {
    expect(isPlausibleEmail('contact@insurer.in')).toBe(true);
  });
  it('rejects non-emails', () => {
    expect(isPlausibleEmail('contact@')).toBe(false);
    expect(isPlausibleEmail('contact')).toBe(false);
  });
});

describe('assessConfidence', () => {
  it('promotes valid GSTIN to high', () => {
    const out = assessConfidence({ gstin: '27AAPFU0939F1ZV' }, { 'insurer.gstin': 'medium' });
    expect(out['insurer.gstin']).toBe('high');
  });
  it('demotes invalid GSTIN to low', () => {
    const out = assessConfidence({ gstin: '27AAPFU0939F1ZX' }, { 'insurer.gstin': 'high' });
    expect(out['insurer.gstin']).toBe('low');
  });
  it('promotes city+state when PIN matches', () => {
    const out = assessConfidence(
      { city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
      {}
    );
    expect(out['insurer.city']).toBe('high');
    expect(out['insurer.state']).toBe('high');
    expect(out['insurer.pin']).toBe('high');
  });
  it('demotes pin+state when they conflict', () => {
    const out = assessConfidence(
      { city: 'Mumbai', state: 'Karnataka', pin: '400001' },
      {}
    );
    expect(out['insurer.pin']).toBe('low');
    expect(out['insurer.state']).toBe('low');
  });
  it('does not invent confidences for fields that are null', () => {
    const out = assessConfidence({ gstin: null, pin: null }, {});
    expect(out['insurer.gstin']).toBeUndefined();
    expect(out['insurer.pin']).toBeUndefined();
  });
});

// ============================================================================
// autoLink.js — suggestions, topo sort, validation
// ============================================================================

describe('suggestParents', () => {
  it('leaves HO with no parent', () => {
    const r = suggestParents([{ office_code: 'HO', name: 'Mumbai HO' }]);
    expect(r[0].parentIndex).toBeNull();
  });

  it('suggests HO as parent for an unparented RO', () => {
    const offices = [
      { office_code: 'HO', name: 'Mumbai HO', city: 'Mumbai', state: 'Maharashtra' },
      { office_code: 'RO', name: 'Pune RO', city: 'Pune', state: 'Maharashtra' },
    ];
    const r = suggestParents(offices);
    expect(r[1].parentIndex).toBe(0);
    expect(r[1].reason).toMatch(/state|Mumbai HO/);
  });

  it('prefers same-city candidate over same-state', () => {
    const offices = [
      // Two ROs both legal as parent of the BO; one same city, one same state.
      { office_code: 'RO', name: 'Pune RO',     city: 'Pune',   state: 'Maharashtra' },
      { office_code: 'RO', name: 'Mumbai RO',   city: 'Mumbai', state: 'Maharashtra' },
      { office_code: 'BO', name: 'Andheri BO',  city: 'Mumbai', state: 'Maharashtra' },
    ];
    const r = suggestParents(offices);
    expect(r[2].parentIndex).toBe(1); // Mumbai RO, not Pune RO
  });

  it('respects already-linked offices (does not suggest)', () => {
    const offices = [
      { office_code: 'HO', name: 'HO',  city: 'Mumbai' },
      { office_code: 'RO', name: 'RO1', city: 'Pune', parent_name: 'HO' },
    ];
    const r = suggestParents(offices);
    expect(r[1].reason).toMatch(/already linked/i);
    expect(r[1].parentIndex).toBeNull();
  });

  it('returns null parentIndex when no candidate has the right type', () => {
    // BO needs RO/ZO/RCH/CCH/LCBO; only HO available -> no candidate.
    const offices = [
      { office_code: 'HO', name: 'HO',  city: 'Mumbai' },
      { office_code: 'BO', name: 'Branch', city: 'Mumbai' },
    ];
    const r = suggestParents(offices);
    expect(r[1].parentIndex).toBeNull();
  });
});

describe('topologicalOrder', () => {
  it('orders parents before children', () => {
    const offices = [
      { office_code: 'BO', name: 'Branch', parent_name: 'Pune RO' },
      { office_code: 'HO', name: 'HO' },
      { office_code: 'RO', name: 'Pune RO', parent_name: 'HO' },
    ];
    const { order, cycle } = topologicalOrder(offices);
    expect(cycle).toBe(false);
    // HO must come before Pune RO; Pune RO must come before Branch.
    const pos = (idx) => order.indexOf(idx);
    expect(pos(1)).toBeLessThan(pos(2)); // HO before Pune RO
    expect(pos(2)).toBeLessThan(pos(0)); // Pune RO before Branch
  });

  it('treats unresolvable parent_name as a root', () => {
    const offices = [
      { office_code: 'HO', name: 'HO' },
      { office_code: 'BO', name: 'Orphan', parent_name: 'Does Not Exist' },
    ];
    const { order, cycle } = topologicalOrder(offices);
    expect(cycle).toBe(false);
    expect(order).toHaveLength(2);
  });

  it('flags cycles', () => {
    const offices = [
      { office_code: 'RO', name: 'A', parent_name: 'B' },
      { office_code: 'RO', name: 'B', parent_name: 'A' },
    ];
    const { order, cycle } = topologicalOrder(offices);
    expect(cycle).toBe(true);
    expect(order).toHaveLength(2);
  });
});

describe('validateOffices — HO singleton + parent-type rules', () => {
  it('passes a clean HO+RO pair', () => {
    const r = validateOffices([
      { office_code: 'HO', name: 'HO Mumbai' },
      { office_code: 'RO', name: 'Pune RO', parent_name: 'HO Mumbai' },
    ]);
    expect(r.errors).toEqual([]);
  });

  it('flags missing HO', () => {
    const r = validateOffices([
      { office_code: 'RO', name: 'Pune RO' },
    ]);
    expect(r.errors.some((e) => e.includes('Head Office'))).toBe(true);
  });

  it('flags two HOs', () => {
    const r = validateOffices([
      { office_code: 'HO', name: 'Mumbai HO' },
      { office_code: 'HO', name: 'Delhi HO' },
    ]);
    expect(r.errors.some((e) => /2 HO/.test(e))).toBe(true);
  });

  it('flags HO with parent', () => {
    const r = validateOffices([
      { office_code: 'HO', name: 'Mumbai HO', parent_name: 'Other' },
    ]);
    expect(r.errors.some((e) => /HO must have no parent/.test(e))).toBe(true);
  });

  it('flags non-HO with no parent', () => {
    const r = validateOffices([
      { office_code: 'HO', name: 'Mumbai HO' },
      { office_code: 'BO', name: 'Andheri BO' },
    ]);
    expect(r.errors.some((e) => /requires a parent/.test(e))).toBe(true);
  });

  it('flags illegal parent type (CCH parent of BO is fine; HO parent of CCH is not)', () => {
    const r = validateOffices([
      { office_code: 'HO',  name: 'HO' },
      { office_code: 'CCH', name: 'CCH X', parent_name: 'HO' }, // illegal: CCH must have RCH parent
    ]);
    expect(r.errors.some((e) => /cannot have a HO parent/.test(e))).toBe(true);
  });

  it('flags duplicate office names', () => {
    const r = validateOffices([
      { office_code: 'HO', name: 'X' },
      { office_code: 'RO', name: 'X', parent_name: 'X' }, // self-conflict
    ]);
    expect(r.errors.some((e) => /Duplicate office name/.test(e))).toBe(true);
  });

  it('flags unknown office_code', () => {
    const r = validateOffices([
      { office_code: 'XYZ', name: 'X' },
    ]);
    expect(r.errors.some((e) => /office_code "XYZ"/.test(e))).toBe(true);
  });

  it('passes empty array (caller treats this as "skip")', () => {
    const r = validateOffices([]);
    expect(r.errors).toEqual([]);
  });
});
