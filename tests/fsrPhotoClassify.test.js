// =============================================================================
// tests/fsrPhotoClassify.test.js
// =============================================================================
// Tests for lib/fsr/photoClassifyPrompt.js (Slice 9).
//
// Covers:
//   - buildPhotoClassifyPrompt picks the right LOB-specific category
//     list and emits the expected output-shape contract.
//   - categoriesForLob returns Marine / Warranty / Fire / OTHER buckets.
//   - parsePhotoClassifyJson:
//       - parses a clean JSON array of length N.
//       - strips markdown fences.
//       - returns N "unclassified" stubs on parse failure.
//       - clamps confidence to [0, 1].
//       - normalises optional fields when the model omits them.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildPhotoClassifyPrompt,
  parsePhotoClassifyJson,
  categoriesForLob,
  MARINE_CATEGORIES,
  WARRANTY_CATEGORIES,
  FIRE_CATEGORIES,
} from '../lib/fsr/photoClassifyPrompt.js';

// -----------------------------------------------------------------------------
// categoriesForLob
// -----------------------------------------------------------------------------

describe('categoriesForLob', () => {
  it('returns Marine categories for Marine Cargo + Marine Hull', () => {
    expect(categoriesForLob('Marine Cargo')).toBe(MARINE_CATEGORIES);
    expect(categoriesForLob('Marine Hull')).toBe(MARINE_CATEGORIES);
  });

  it('returns Warranty categories for Extended Warranty', () => {
    expect(categoriesForLob('Extended Warranty')).toBe(WARRANTY_CATEGORIES);
  });

  it('returns Fire categories for Fire', () => {
    expect(categoriesForLob('Fire')).toBe(FIRE_CATEGORIES);
  });

  it('falls back to ["OTHER"] for unknown LOBs', () => {
    expect(categoriesForLob('Engineering')).toEqual(['OTHER']);
    expect(categoriesForLob(null)).toEqual(['OTHER']);
    expect(categoriesForLob(undefined)).toEqual(['OTHER']);
  });

  it('Marine categories include the expected vocabulary', () => {
    expect(MARINE_CATEGORIES).toContain('DAMAGED_CARGO');
    expect(MARINE_CATEGORIES).toContain('CONTAINER_EXTERIOR');
    expect(MARINE_CATEGORIES).toContain('DOCUMENTS');
    expect(MARINE_CATEGORIES).toContain('OTHER');
  });

  it('Warranty categories include serial-plate / repair-estimate', () => {
    expect(WARRANTY_CATEGORIES).toContain('DAMAGED_UNIT');
    expect(WARRANTY_CATEGORIES).toContain('SERIAL_PLATE');
    expect(WARRANTY_CATEGORIES).toContain('REPAIR_ESTIMATE');
  });

  it('Fire categories include structure / electrical-source / water-damage', () => {
    expect(FIRE_CATEGORIES).toContain('FIRE_DAMAGE');
    expect(FIRE_CATEGORIES).toContain('ELECTRICAL_SOURCE');
    expect(FIRE_CATEGORIES).toContain('WATER_DAMAGE');
    expect(FIRE_CATEGORIES).toContain('POLICE_FIRE_BRIGADE_DOCS');
  });
});

// -----------------------------------------------------------------------------
// buildPhotoClassifyPrompt
// -----------------------------------------------------------------------------

describe('buildPhotoClassifyPrompt', () => {
  it('emits a system prompt with the LOB label + category list', () => {
    const r = buildPhotoClassifyPrompt({ lob: 'Marine Cargo', batchSize: 4 });
    expect(r.system).toContain('Marine Cargo');
    expect(r.system).toContain('DAMAGED_CARGO');
    expect(r.system).toContain('OTHER');
  });

  it('embeds the requested batch size in the output contract', () => {
    const r = buildPhotoClassifyPrompt({ lob: 'Fire', batchSize: 7 });
    expect(r.system).toContain('JSON array of length 7');
  });

  it('demands strict JSON output with the documented shape', () => {
    const r = buildPhotoClassifyPrompt({ lob: 'Extended Warranty', batchSize: 1 });
    expect(r.system).toContain('"category"');
    expect(r.system).toContain('"tags"');
    expect(r.system).toContain('"observations"');
    expect(r.system).toContain('"suggestedAnnexure"');
    expect(r.system).toContain('"confidence"');
    expect(r.system).toContain('"flags"');
    expect(r.system).toContain('Return ONLY the JSON array');
  });

  it('mentions the red-flag vocabulary the surveyor cares about', () => {
    const r = buildPhotoClassifyPrompt({ lob: 'Marine Cargo', batchSize: 1 });
    expect(r.system).toMatch(/tampering_visible/);
    expect(r.system).toMatch(/pre_existing_damage/);
    expect(r.system).toMatch(/unclear_evidence/);
  });

  it('falls back to a generic LOB label when LOB is missing', () => {
    const r = buildPhotoClassifyPrompt({ lob: null, batchSize: 1 });
    expect(r.system).toContain('this claim');
  });

  it('warns the model to set confidence < 0.6 when image is unclear', () => {
    const r = buildPhotoClassifyPrompt({ lob: 'Marine Cargo', batchSize: 1 });
    expect(r.system).toContain('confidence < 0.6');
    expect(r.system).toContain('unclear_evidence');
  });
});

// -----------------------------------------------------------------------------
// parsePhotoClassifyJson — happy path
// -----------------------------------------------------------------------------

describe('parsePhotoClassifyJson — happy path', () => {
  it('parses a clean JSON array', () => {
    const raw = JSON.stringify([
      {
        category: 'DAMAGED_CARGO', tags: ['water_damage', 'east_wall'],
        observations: '12 boxes torn open', suggestedAnnexure: 'Photographs - Damaged Cargo',
        confidence: 0.92, flags: [],
      },
      {
        category: 'DOCUMENTS', tags: ['invoice'],
        observations: 'Invoice S/2025-26/23184', suggestedAnnexure: 'Photographs - Documents',
        confidence: 0.88, flags: ['unclear_evidence'],
      },
    ]);
    const r = parsePhotoClassifyJson(raw, 2);
    expect(r).toHaveLength(2);
    expect(r[0].category).toBe('DAMAGED_CARGO');
    expect(r[0].tags).toEqual(['water_damage', 'east_wall']);
    expect(r[0].confidence).toBe(0.92);
    expect(r[0].flags).toEqual([]);
    expect(r[1].flags).toEqual(['unclear_evidence']);
  });

  it('strips ```json code fences', () => {
    const raw = '```json\n' + JSON.stringify([{ category: 'OTHER', tags: [], observations: 'x', suggestedAnnexure: '', confidence: 0.5, flags: [] }]) + '\n```';
    const r = parsePhotoClassifyJson(raw, 1);
    expect(r[0].category).toBe('OTHER');
  });

  it('clamps confidence to [0, 1]', () => {
    const raw = JSON.stringify([
      { category: 'OTHER', tags: [], observations: '', suggestedAnnexure: '', confidence: 2.5, flags: [] },
      { category: 'OTHER', tags: [], observations: '', suggestedAnnexure: '', confidence: -0.3, flags: [] },
    ]);
    const r = parsePhotoClassifyJson(raw, 2);
    expect(r[0].confidence).toBe(1);
    expect(r[1].confidence).toBe(0);
  });

  it('treats non-numeric confidence as 0', () => {
    const raw = JSON.stringify([
      { category: 'OTHER', tags: [], observations: '', suggestedAnnexure: '', confidence: 'high', flags: [] },
    ]);
    const r = parsePhotoClassifyJson(raw, 1);
    expect(r[0].confidence).toBe(0);
  });

  it('normalises missing optional fields', () => {
    const raw = JSON.stringify([
      { category: 'DAMAGED_CARGO', confidence: 0.9 },  // tags / observations / flags / suggestedAnnexure missing
    ]);
    const r = parsePhotoClassifyJson(raw, 1);
    expect(r[0].tags).toEqual([]);
    expect(r[0].observations).toBe('');
    expect(r[0].flags).toEqual([]);
    expect(r[0].suggestedAnnexure).toBe('');
  });

  it('truncates an over-long array to expectedCount', () => {
    const raw = JSON.stringify([
      { category: 'A', tags: [], observations: '', suggestedAnnexure: '', confidence: 0.5, flags: [] },
      { category: 'B', tags: [], observations: '', suggestedAnnexure: '', confidence: 0.5, flags: [] },
      { category: 'C', tags: [], observations: '', suggestedAnnexure: '', confidence: 0.5, flags: [] },
    ]);
    const r = parsePhotoClassifyJson(raw, 2);
    expect(r).toHaveLength(2);
    expect(r[0].category).toBe('A');
    expect(r[1].category).toBe('B');
  });
});

// -----------------------------------------------------------------------------
// parsePhotoClassifyJson — failure / fallback
// -----------------------------------------------------------------------------

describe('parsePhotoClassifyJson — fallback', () => {
  it('returns N stubs with category=OTHER + flags=["unclassified"] on parse failure', () => {
    const r = parsePhotoClassifyJson('not json at all', 3);
    expect(r).toHaveLength(3);
    for (const c of r) {
      expect(c.category).toBe('OTHER');
      expect(c.flags).toEqual(['unclassified']);
      expect(c.confidence).toBe(0);
    }
  });

  it('returns stubs when the model returns a non-array JSON', () => {
    const raw = JSON.stringify({ category: 'DAMAGED_CARGO' });
    const r = parsePhotoClassifyJson(raw, 2);
    expect(r).toHaveLength(2);
    expect(r[0].flags).toEqual(['unclassified']);
  });

  it('handles non-string input', () => {
    expect(parsePhotoClassifyJson(null, 2)).toHaveLength(2);
    expect(parsePhotoClassifyJson(undefined, 2)).toHaveLength(2);
    expect(parsePhotoClassifyJson(42, 2)).toHaveLength(2);
  });

  it('returns 1 stub when expectedCount defaults to 1', () => {
    const r = parsePhotoClassifyJson('garbage');
    expect(r).toHaveLength(1);
  });
});
