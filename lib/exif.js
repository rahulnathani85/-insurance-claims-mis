// =============================================================================
// lib/exif.js
// =============================================================================
// EXIF extraction for site-visit photo evidence.
//
// IRDAI mandates geotagged + timestamped photos for every site visit
// (CLAUDE.md §13, registration spec §10). This module:
//   1. extractExifFromBuffer(buffer) — async; reads JPEG/HEIC EXIF using
//      `exifr`. Returns null on parse failure.
//   2. normaliseExif(rawExif) — pure; turns the raw exifr output into the
//      database column shape (gps_lat, gps_lng, taken_at, camera_make,
//      camera_model, has_geotag, has_timestamp). Unit-testable without an
//      actual image.
//
// Why the split: `exifr`'s output shape is stable enough that we want
// integration confidence on the parse path, but separating the normaliser
// lets us assert behaviour for partial EXIF (no GPS, no timestamp, malformed
// values) without crafting fake JPEGs.
// =============================================================================

import exifr from 'exifr';

const EXIFR_OPTIONS = {
  // Pull the smallest set we need. Matters on Vercel cold starts.
  pick: [
    'DateTimeOriginal', 'CreateDate', 'ModifyDate',
    'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
    'Make', 'Model',
    'Orientation',
  ],
  reviveValues: true,
  translateValues: true,
};

export async function extractExifFromBuffer(buffer) {
  if (!buffer || buffer.length === 0) return null;
  try {
    const raw = await exifr.parse(buffer, EXIFR_OPTIONS);
    return raw || null;
  } catch (e) {
    // Bad EXIF / unsupported format — caller treats as no-EXIF.
    return null;
  }
}

// Pure: normalises the exifr output to our DB column shape.
//
// Returns:
//   {
//     taken_at:      ISO string | null,
//     gps_lat:       number | null,
//     gps_lng:       number | null,
//     camera_make:   string | null,
//     camera_model:  string | null,
//     original_exif: object | null,
//     has_geotag:    boolean,
//     has_timestamp: boolean,
//   }
export function normaliseExif(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      taken_at: null,
      gps_lat: null,
      gps_lng: null,
      camera_make: null,
      camera_model: null,
      original_exif: null,
      has_geotag: false,
      has_timestamp: false,
    };
  }

  const taken_at = pickDate(raw.DateTimeOriginal) ?? pickDate(raw.CreateDate) ?? pickDate(raw.ModifyDate);

  const gps_lat = signedCoord(raw.GPSLatitude, raw.GPSLatitudeRef, ['N', 'S']);
  const gps_lng = signedCoord(raw.GPSLongitude, raw.GPSLongitudeRef, ['E', 'W']);

  return {
    taken_at,
    gps_lat,
    gps_lng,
    camera_make: cleanStr(raw.Make),
    camera_model: cleanStr(raw.Model),
    original_exif: raw,
    has_geotag: gps_lat !== null && gps_lng !== null,
    has_timestamp: taken_at !== null,
  };
}

// exifr usually returns a Date for DateTimeOriginal when reviveValues is on.
// If a string slips through, we coerce; if it's nonsense, we drop.
function pickDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// exifr returns GPS as a positive decimal degree number with separate Ref
// ('N'/'S'/'E'/'W'). Apply the sign per the ref. Some sources return an
// already-signed number — accept that too.
function signedCoord(value, ref, [positiveRef, negativeRef]) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;

  if (typeof ref === 'string') {
    const r = ref.toUpperCase();
    if (r === negativeRef) return -Math.abs(num);
    if (r === positiveRef) return Math.abs(num);
  }
  // No ref: trust the sign on the number.
  return num;
}

function cleanStr(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s === '' ? null : s;
}
