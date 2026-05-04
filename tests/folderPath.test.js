// =============================================================================
// tests/folderPath.test.js
// =============================================================================
// Unit tests for lib/folderPath.js — the shared helper that produces the
// on-disk working-folder path for a claim. Behaviour must match the legacy
// /api/claims POST handler so PRs that swap call sites don't shift output.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { generateFolderPath } from '../lib/folderPath.js';

describe('generateFolderPath', () => {
  it('produces the canonical NISLA / Marine Cargo path', () => {
    expect(generateFolderPath({
      company: 'NISLA',
      lob: 'Marine Cargo',
      refNumber: '4050/26-27/Marine',
      insuredName: 'Chifu Agritech Pvt Ltd',
    })).toBe('D:\\2026-27\\NISLA\\Marine Cargo\\4050_26-27_Marine - Chifu Agritech Pvt Ltd');
  });

  it('strips Windows-illegal characters from every segment', () => {
    expect(generateFolderPath({
      company: 'NIS|LA',
      lob: 'Fire/Allied',
      refNumber: '237/26-27/Fire',
      insuredName: 'M/s "Acme" Co. <Ltd>?',
    })).toBe('D:\\2026-27\\NIS_LA\\Fire_Allied\\237_26-27_Fire - M_s _Acme_ Co. _Ltd__');
  });

  it('caps insured_name at 50 characters', () => {
    const longName = 'A'.repeat(120);
    const out = generateFolderPath({
      company: 'NISLA',
      lob: 'Fire',
      refNumber: '1/26-27/Fire',
      insuredName: longName,
    });
    // ' - <50 As>' suffix
    expect(out.endsWith(' - ' + 'A'.repeat(50))).toBe(true);
    expect(out).not.toContain('A'.repeat(51));
  });

  it('falls back to safe defaults when fields are missing/null', () => {
    expect(generateFolderPath({})).toBe('D:\\2026-27\\NISLA\\Miscellaneous\\ - Unknown');
    expect(generateFolderPath({
      company: null, lob: null, refNumber: null, insuredName: null,
    })).toBe('D:\\2026-27\\NISLA\\Miscellaneous\\ - Unknown');
  });

  it('handles ACUERE company correctly', () => {
    expect(generateFolderPath({
      company: 'ACUERE',
      lob: 'Engineering',
      refNumber: '102/26-27/Engg',
      insuredName: 'Tata Power',
    })).toBe('D:\\2026-27\\ACUERE\\Engineering\\102_26-27_Engg - Tata Power');
  });

  it('preserves spaces in LOB and insured name (not in the illegal set)', () => {
    const out = generateFolderPath({
      company: 'NISLA',
      lob: 'Marine Hull',
      refNumber: '5/26-27/Hull',
      insuredName: 'Bharti Shipyard Pvt Ltd',
    });
    expect(out).toContain('Marine Hull');
    expect(out).toContain('Bharti Shipyard Pvt Ltd');
  });
});
