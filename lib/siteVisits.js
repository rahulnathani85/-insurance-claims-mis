// =============================================================================
// lib/siteVisits.js
// =============================================================================
// Helpers for site-visit + photo evidence routes.
// =============================================================================

export const VALID_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'];

// String fields that any site-visit insert/update may carry.
const STRING_FIELDS = [
  'purpose', 'conducted_by_email', 'conducted_by_name',
  'location_address', 'location_pin', 'location_state', 'location_district',
  'weather_conditions', 'observations', 'next_steps',
  'created_by', 'updated_by',
];

// Builds an insert/update payload from the request body. Trims strings, empty
// → null, parses numerics, validates status, filters attendees, drops keys
// that aren't part of the schema.
//
// Pass { skipUndefined: true } for PATCH-style updates where missing keys
// should not blank existing columns.
export function sanitiseSiteVisitPayload(body, { skipUndefined = false } = {}) {
  const out = {};
  for (const f of STRING_FIELDS) {
    if (body[f] === undefined) {
      if (!skipUndefined) continue;
      continue;
    }
    out[f] = nullableString(body[f]);
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    out.status = body.status;
  }

  if (body.surveyor_id !== undefined) out.surveyor_id = body.surveyor_id || null;

  for (const f of ['scheduled_at', 'started_at', 'completed_at']) {
    if (body[f] !== undefined) out[f] = body[f] || null;
  }

  if (body.location_lat !== undefined) out.location_lat = numberOrNull(body.location_lat);
  if (body.location_lng !== undefined) out.location_lng = numberOrNull(body.location_lng);

  if (body.attendees !== undefined) {
    out.attendees = Array.isArray(body.attendees)
      ? body.attendees.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim())
      : null;
  }

  if (body.company !== undefined) out.company = body.company || 'NISLA';
  if (body.visit_number !== undefined && Number.isFinite(Number(body.visit_number))) {
    out.visit_number = Math.max(1, parseInt(body.visit_number, 10));
  }

  return out;
}

export function nullableString(v) {
  if (typeof v !== 'string') return v == null ? null : v;
  const s = v.trim();
  return s === '' ? null : s;
}

export function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
