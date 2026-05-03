// =============================================================================
// tests/refNumber.test.js
// =============================================================================
// Unit tests for lib/refNumber.js — placeholder detection + parse helpers.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  isPlaceholderRef,
  extractIntakeShortId,
  PLACEHOLDER_PREFIX,
} from '../lib/refNumber.js';

describe('isPlaceholderRef', () => {
  it('returns true for INTAKE/<co>/<id> shape', () => {
    expect(isPlaceholderRef('INTAKE/NISLA/3dae8108')).toBe(true);
    expect(isPlaceholderRef('INTAKE/ACUERE/abc12345')).toBe(true);
  });

  it('returns false for real surveyor refs', () => {
    expect(isPlaceholderRef('4053/26-27/Marine Cargo')).toBe(false);
    expect(isPlaceholderRef('237/26-27/Fire')).toBe(false);
    expect(isPlaceholderRef('EW-0001/26-27')).toBe(false);
  });

  it('returns false for null / undefined / empty / non-string', () => {
    expect(isPlaceholderRef(null)).toBe(false);
    expect(isPlaceholderRef(undefined)).toBe(false);
    expect(isPlaceholderRef('')).toBe(false);
    expect(isPlaceholderRef(42)).toBe(false);
    expect(isPlaceholderRef({})).toBe(false);
  });

  it('is case-sensitive — only uppercase INTAKE/ counts', () => {
    expect(isPlaceholderRef('intake/NISLA/abc')).toBe(false);
    expect(isPlaceholderRef('Intake/NISLA/abc')).toBe(false);
  });

  it('exports PLACEHOLDER_PREFIX as INTAKE/', () => {
    expect(PLACEHOLDER_PREFIX).toBe('INTAKE/');
  });
});

describe('extractIntakeShortId', () => {
  it('returns the short id for a placeholder ref', () => {
    expect(extractIntakeShortId('INTAKE/NISLA/3dae8108')).toBe('3dae8108');
    expect(extractIntakeShortId('INTAKE/ACUERE/abcdef12')).toBe('abcdef12');
  });

  it('returns null for non-placeholder values', () => {
    expect(extractIntakeShortId('4053/26-27/Fire')).toBe(null);
    expect(extractIntakeShortId(null)).toBe(null);
    expect(extractIntakeShortId('')).toBe(null);
    expect(extractIntakeShortId('INTAKE/')).toBe(null);
    expect(extractIntakeShortId('INTAKE/NISLA')).toBe(null);
  });

  it('returns null when the third segment is empty', () => {
    expect(extractIntakeShortId('INTAKE/NISLA/')).toBe(null);
  });
});
