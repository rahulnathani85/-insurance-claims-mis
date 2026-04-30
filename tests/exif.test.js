// =============================================================================
// tests/exif.test.js
// =============================================================================
// Unit tests for lib/exif.js — focuses on normaliseExif (pure). The
// extractExifFromBuffer wrapper is a thin call into exifr; we trust the
// library and don't fake JPEG bytes here.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { normaliseExif } from '../lib/exif.js';

describe('normaliseExif', () => {
  it('returns all-null with flags=false on empty input', () => {
    const out = normaliseExif(null);
    expect(out.taken_at).toBeNull();
    expect(out.gps_lat).toBeNull();
    expect(out.gps_lng).toBeNull();
    expect(out.has_geotag).toBe(false);
    expect(out.has_timestamp).toBe(false);
    expect(out.original_exif).toBeNull();
  });

  it('returns all-null on non-object input', () => {
    expect(normaliseExif(42).has_geotag).toBe(false);
    expect(normaliseExif('hi').has_timestamp).toBe(false);
  });

  it('extracts a Date from DateTimeOriginal', () => {
    const out = normaliseExif({ DateTimeOriginal: new Date('2026-04-30T11:22:33Z') });
    expect(out.taken_at).toBe('2026-04-30T11:22:33.000Z');
    expect(out.has_timestamp).toBe(true);
  });

  it('falls back to CreateDate when DateTimeOriginal missing', () => {
    const out = normaliseExif({ CreateDate: new Date('2026-04-29T08:00:00Z') });
    expect(out.taken_at).toBe('2026-04-29T08:00:00.000Z');
    expect(out.has_timestamp).toBe(true);
  });

  it('falls back to ModifyDate when both DateTimeOriginal and CreateDate missing', () => {
    const out = normaliseExif({ ModifyDate: new Date('2026-04-28T00:00:00Z') });
    expect(out.taken_at).toBe('2026-04-28T00:00:00.000Z');
  });

  it('coerces ISO string timestamps', () => {
    const out = normaliseExif({ DateTimeOriginal: '2026-04-30T11:22:33Z' });
    expect(out.taken_at).toBe('2026-04-30T11:22:33.000Z');
    expect(out.has_timestamp).toBe(true);
  });

  it('drops invalid timestamps', () => {
    const out = normaliseExif({ DateTimeOriginal: 'not a date' });
    expect(out.taken_at).toBeNull();
    expect(out.has_timestamp).toBe(false);
  });

  it('applies S/W refs to flip GPS sign', () => {
    const out = normaliseExif({
      GPSLatitude: 12.97, GPSLatitudeRef: 'S',
      GPSLongitude: 77.59, GPSLongitudeRef: 'W',
    });
    expect(out.gps_lat).toBeCloseTo(-12.97, 5);
    expect(out.gps_lng).toBeCloseTo(-77.59, 5);
    expect(out.has_geotag).toBe(true);
  });

  it('keeps positive GPS for N/E refs', () => {
    const out = normaliseExif({
      GPSLatitude: 19.076, GPSLatitudeRef: 'N',
      GPSLongitude: 72.877, GPSLongitudeRef: 'E',
    });
    expect(out.gps_lat).toBeCloseTo(19.076, 5);
    expect(out.gps_lng).toBeCloseTo(72.877, 5);
    expect(out.has_geotag).toBe(true);
  });

  it('trusts the sign on GPS when no ref provided', () => {
    const out = normaliseExif({ GPSLatitude: -19.076, GPSLongitude: -72.877 });
    expect(out.gps_lat).toBeCloseTo(-19.076, 5);
    expect(out.gps_lng).toBeCloseTo(-72.877, 5);
    expect(out.has_geotag).toBe(true);
  });

  it('flags has_geotag=false when only one coord is present', () => {
    const out = normaliseExif({ GPSLatitude: 19.076, GPSLatitudeRef: 'N' });
    expect(out.gps_lat).toBeCloseTo(19.076, 5);
    expect(out.gps_lng).toBeNull();
    expect(out.has_geotag).toBe(false);
  });

  it('rejects non-numeric GPS values', () => {
    const out = normaliseExif({ GPSLatitude: 'oops', GPSLongitude: 'oops' });
    expect(out.gps_lat).toBeNull();
    expect(out.gps_lng).toBeNull();
    expect(out.has_geotag).toBe(false);
  });

  it('extracts and trims camera make/model', () => {
    const out = normaliseExif({ Make: '  Apple  ', Model: '  iPhone 14 Pro  ' });
    expect(out.camera_make).toBe('Apple');
    expect(out.camera_model).toBe('iPhone 14 Pro');
  });

  it('drops empty/whitespace camera strings', () => {
    expect(normaliseExif({ Make: '   ', Model: '' }).camera_make).toBeNull();
    expect(normaliseExif({ Make: 123 }).camera_make).toBeNull();
  });

  it('preserves the raw exif as original_exif', () => {
    const raw = { DateTimeOriginal: new Date('2026-04-30Z'), Custom: 'preserve me' };
    const out = normaliseExif(raw);
    expect(out.original_exif).toBe(raw);
  });
});
