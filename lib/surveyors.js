// =============================================================================
// lib/surveyors.js
// =============================================================================
// Helpers for surveyor licensing and assignment eligibility.
//
// IRDAI Surveyors & Loss Assessors Regulations 2015 require an active license
// for the relevant peril category. Per the registration spec (§7, §10),
// assignment must be blocked if the surveyor's license is expired, and a
// warning shown if it expires within 30 days.
//
// PERIL_TYPES is the canonical list used by the surveyor master form's
// peril-specialties multi-select.
// =============================================================================

export const LICENSE_CATEGORIES = ['A', 'B', 'Fellow', 'Associate'];

export const PERIL_TYPES = [
  'Fire',
  'Marine Cargo',
  'Marine Hull',
  'Engineering',
  'Electronic Equipment',
  'Bankers Indemnity',
  'Sports & Media',
  'Extended Warranty',
  'Credit / UPI',
  'Liability & Product Recall',
  'Business Interruption',
  'Miscellaneous',
];

export const REGIONS = ['West', 'North', 'South', 'East', 'Central'];

// Surveyor is blocked from new assignments if license expires within this many days.
export const LICENSE_EXPIRY_BLOCK_DAYS = 0;
// Warning is shown on the master page within this many days of expiry.
export const LICENSE_EXPIRY_WARN_DAYS = 60;
// Spec §7: assignment ranking filters out surveyors whose license expires
// within 30 days, even if not yet expired.
export const LICENSE_EXPIRY_ASSIGNMENT_BUFFER_DAYS = 30;

// Returns one of: 'expired' | 'expiring_soon' | 'valid' | 'unknown'.
//
// today is injectable for tests. Both args may be Date or ISO date string.
export function licenseStatus(expiryDate, today = new Date()) {
  if (!expiryDate) return 'unknown';

  const expiry = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  const now = today instanceof Date ? today : new Date(today);

  if (Number.isNaN(expiry.getTime()) || Number.isNaN(now.getTime())) return 'unknown';

  const days = daysBetween(now, expiry);

  if (days < 0) return 'expired';
  if (days <= LICENSE_EXPIRY_WARN_DAYS) return 'expiring_soon';
  return 'valid';
}

// Whole-day difference (b - a). Negative if b is before a.
// Uses UTC midnights so the result is the same whether the code runs on a
// Mumbai laptop (IST) or a Vercel us-east-1 lambda.
export function daysBetween(a, b) {
  const aUtc = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bUtc = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((bUtc - aUtc) / 86_400_000);
}

// Eligibility for a NEW assignment. Returns { eligible, reason }.
// reason is null on eligible=true, otherwise a human-readable string for
// the UI / audit log.
export function isEligibleForAssignment(surveyor, today = new Date()) {
  if (!surveyor) return { eligible: false, reason: 'Surveyor not found' };
  if (surveyor.active === false) return { eligible: false, reason: 'Surveyor is inactive' };

  if (!surveyor.license_number) {
    return { eligible: false, reason: 'No IRDAI license on file' };
  }

  const status = licenseStatus(surveyor.license_expiry_date, today);
  if (status === 'unknown') {
    return { eligible: false, reason: 'License expiry not recorded' };
  }
  if (status === 'expired') {
    return { eligible: false, reason: 'License expired' };
  }

  // Within the assignment buffer? Block per spec §7.
  if (surveyor.license_expiry_date) {
    const expiry = new Date(surveyor.license_expiry_date);
    const days = daysBetween(today instanceof Date ? today : new Date(today), expiry);
    if (days <= LICENSE_EXPIRY_ASSIGNMENT_BUFFER_DAYS) {
      return {
        eligible: false,
        reason: `License expires in ${days} day${days === 1 ? '' : 's'} — too close to assignment buffer (${LICENSE_EXPIRY_ASSIGNMENT_BUFFER_DAYS}d)`,
      };
    }
  }

  return { eligible: true, reason: null };
}

// Normalises an API request body into a column-clean insert/update object.
// Trims strings, converts '' to null, filters peril_specialties, validates
// max_concurrent_claims. Doesn't validate license_category — caller does.
export function sanitiseSurveyorPayload(body) {
  const out = {};
  const stringFields = [
    'name', 'designation', 'phone', 'email', 'company',
    'license_number', 'license_category',
    'region', 'pan', 'gstin', 'address', 'notes',
  ];
  for (const f of stringFields) {
    if (body[f] !== undefined) {
      const v = typeof body[f] === 'string' ? body[f].trim() : body[f];
      out[f] = v === '' ? null : v;
    }
  }
  if (body.active !== undefined) out.active = !!body.active;
  if (body.license_issued_date !== undefined) {
    out.license_issued_date = body.license_issued_date || null;
  }
  if (body.license_expiry_date !== undefined) {
    out.license_expiry_date = body.license_expiry_date || null;
  }
  if (body.peril_specialties !== undefined) {
    out.peril_specialties = Array.isArray(body.peril_specialties)
      ? body.peril_specialties.filter((p) => typeof p === 'string' && p.trim())
      : null;
  }
  if (body.max_concurrent_claims !== undefined) {
    const n = parseInt(body.max_concurrent_claims, 10);
    out.max_concurrent_claims = Number.isFinite(n) && n > 0 ? n : null;
  }
  return out;
}

// Adds computed fields to a raw surveyors row for display.
export function decorateSurveyor(row, today = new Date()) {
  const status = licenseStatus(row.license_expiry_date, today);
  const days =
    row.license_expiry_date
      ? daysBetween(today instanceof Date ? today : new Date(today), new Date(row.license_expiry_date))
      : null;
  return {
    ...row,
    license_status: status,
    days_until_expiry: days,
  };
}
