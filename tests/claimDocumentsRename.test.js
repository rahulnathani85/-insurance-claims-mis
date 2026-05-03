// =============================================================================
// tests/claimDocumentsRename.test.js
// =============================================================================
// Pure tests for sanitiseDisplayName — the input filter on the rename
// endpoint. No Supabase mocks required.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { sanitiseDisplayName, MAX_FILE_NAME_LENGTH } from '../lib/claimDocuments.js';

describe('sanitiseDisplayName', () => {
  it('trims whitespace', () => {
    expect(sanitiseDisplayName('  Insurance Policy.pdf  ')).toBe('Insurance Policy.pdf');
  });

  it('strips path-traversal characters', () => {
    expect(sanitiseDisplayName('../../etc/passwd')).toBe('....etcpasswd');
    expect(sanitiseDisplayName('docs\\private\\foo.pdf')).toBe('docsprivatefoo.pdf');
  });

  it('strips Windows-reserved characters', () => {
    expect(sanitiseDisplayName('foo<bar>baz:qux"quux|corge?grault*pdf'))
      .toBe('foobarbazquxquuxcorgegraultpdf');
  });

  it('converts control characters to spaces (does not delete them)', () => {
    // Control chars become spaces so adjacent words don't fuse together —
    // important when LLM output or pasted text has stray \t / \n / null bytes.
    const input = 'foo' + String.fromCharCode(7) + 'bar' + String.fromCharCode(8) + 'baz';
    expect(sanitiseDisplayName(input)).toBe('foo bar baz');
  });

  it('collapses internal whitespace including tabs and newlines', () => {
    expect(sanitiseDisplayName('Policy   Schedule\t\nv2')).toBe('Policy Schedule v2');
  });

  it('returns null for empty / whitespace-only / null / undefined', () => {
    expect(sanitiseDisplayName('')).toBe(null);
    expect(sanitiseDisplayName('   ')).toBe(null);
    expect(sanitiseDisplayName(null)).toBe(null);
    expect(sanitiseDisplayName(undefined)).toBe(null);
  });

  it('returns null when only stripped chars are provided', () => {
    expect(sanitiseDisplayName('////')).toBe(null);
    expect(sanitiseDisplayName('<>:"|?*')).toBe(null);
  });

  it('coerces non-string inputs to string before sanitising', () => {
    expect(sanitiseDisplayName(42)).toBe('42');
    expect(sanitiseDisplayName(true)).toBe('true');
  });

  it('caps at MAX_FILE_NAME_LENGTH and preserves a short extension', () => {
    const longStem = 'a'.repeat(300);
    const out = sanitiseDisplayName(`${longStem}.pdf`);
    expect(out.length).toBeLessThanOrEqual(MAX_FILE_NAME_LENGTH);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('handles values with no extension at the cap', () => {
    const long = 'x'.repeat(400);
    const out = sanitiseDisplayName(long);
    expect(out.length).toBe(MAX_FILE_NAME_LENGTH);
  });

  it('passes typical user inputs through unchanged', () => {
    expect(sanitiseDisplayName('Policy schedule (Chifu Agritech).pdf'))
      .toBe('Policy schedule (Chifu Agritech).pdf');
    expect(sanitiseDisplayName('FSR 4050-26-27 v1.pdf'))
      .toBe('FSR 4050-26-27 v1.pdf');
  });
});
