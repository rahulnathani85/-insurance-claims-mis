// =============================================================================
// tests/surveyors.test.js
// =============================================================================
// Unit tests for lib/surveyors.js: license-status classification and
// assignment-eligibility gate (spec §7).
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  licenseStatus,
  daysBetween,
  isEligibleForAssignment,
  decorateSurveyor,
  sanitiseSurveyorPayload,
  LICENSE_EXPIRY_WARN_DAYS,
  LICENSE_EXPIRY_ASSIGNMENT_BUFFER_DAYS,
} from '../lib/surveyors.js';

const TODAY = new Date('2026-04-30T00:00:00Z');

function plusDays(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('daysBetween', () => {
  it('returns 0 for the same UTC day regardless of time', () => {
    expect(daysBetween(new Date('2026-04-30T03:00:00Z'), new Date('2026-04-30T22:00:00Z'))).toBe(0);
  });
  it('returns positive when b is later', () => {
    expect(daysBetween(new Date('2026-04-30'), new Date('2026-05-05'))).toBe(5);
  });
  it('returns negative when b is earlier', () => {
    expect(daysBetween(new Date('2026-04-30'), new Date('2026-04-25'))).toBe(-5);
  });
});

describe('licenseStatus', () => {
  it('returns "unknown" when expiry is missing', () => {
    expect(licenseStatus(null, TODAY)).toBe('unknown');
    expect(licenseStatus(undefined, TODAY)).toBe('unknown');
    expect(licenseStatus('', TODAY)).toBe('unknown');
  });

  it('returns "unknown" for invalid dates', () => {
    expect(licenseStatus('not-a-date', TODAY)).toBe('unknown');
  });

  it('returns "expired" for past dates', () => {
    expect(licenseStatus(plusDays(-1), TODAY)).toBe('expired');
    expect(licenseStatus(plusDays(-365), TODAY)).toBe('expired');
  });

  it('returns "expiring_soon" within the warn window', () => {
    expect(licenseStatus(plusDays(0), TODAY)).toBe('expiring_soon');
    expect(licenseStatus(plusDays(30), TODAY)).toBe('expiring_soon');
    expect(licenseStatus(plusDays(LICENSE_EXPIRY_WARN_DAYS), TODAY)).toBe('expiring_soon');
  });

  it('returns "valid" for dates beyond the warn window', () => {
    expect(licenseStatus(plusDays(LICENSE_EXPIRY_WARN_DAYS + 1), TODAY)).toBe('valid');
    expect(licenseStatus(plusDays(365), TODAY)).toBe('valid');
  });
});

describe('isEligibleForAssignment', () => {
  const baseSurveyor = {
    id: 'abc',
    name: 'Jane Doe',
    active: true,
    license_number: 'IRDAI/CORP/SLA-200025',
    license_expiry_date: plusDays(365),
  };

  it('blocks when surveyor missing', () => {
    const r = isEligibleForAssignment(null, TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/not found/i);
  });

  it('blocks inactive surveyors', () => {
    const r = isEligibleForAssignment({ ...baseSurveyor, active: false }, TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/inactive/i);
  });

  it('blocks when no license number on file', () => {
    const r = isEligibleForAssignment({ ...baseSurveyor, license_number: null }, TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no irdai license/i);
  });

  it('blocks when expiry not recorded', () => {
    const r = isEligibleForAssignment({ ...baseSurveyor, license_expiry_date: null }, TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/expiry not recorded/i);
  });

  it('blocks expired licenses', () => {
    const r = isEligibleForAssignment({ ...baseSurveyor, license_expiry_date: plusDays(-1) }, TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/expired/i);
  });

  it('blocks licenses within the assignment buffer (30 days)', () => {
    const r = isEligibleForAssignment(
      { ...baseSurveyor, license_expiry_date: plusDays(LICENSE_EXPIRY_ASSIGNMENT_BUFFER_DAYS) },
      TODAY
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/expires in/i);
  });

  it('allows licenses beyond the assignment buffer', () => {
    const r = isEligibleForAssignment(
      { ...baseSurveyor, license_expiry_date: plusDays(LICENSE_EXPIRY_ASSIGNMENT_BUFFER_DAYS + 1) },
      TODAY
    );
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeNull();
  });
});

describe('decorateSurveyor', () => {
  it('adds license_status and days_until_expiry', () => {
    const out = decorateSurveyor({ license_expiry_date: plusDays(10) }, TODAY);
    expect(out.license_status).toBe('expiring_soon');
    expect(out.days_until_expiry).toBe(10);
  });

  it('handles missing expiry gracefully', () => {
    const out = decorateSurveyor({ license_expiry_date: null }, TODAY);
    expect(out.license_status).toBe('unknown');
    expect(out.days_until_expiry).toBeNull();
  });
});

describe('sanitiseSurveyorPayload', () => {
  it('trims strings and converts blanks to null', () => {
    const out = sanitiseSurveyorPayload({ name: '  Jane  ', email: '', license_number: '   ' });
    expect(out.name).toBe('Jane');
    expect(out.email).toBeNull();
    expect(out.license_number).toBeNull();
  });

  it('coerces active to boolean', () => {
    expect(sanitiseSurveyorPayload({ active: 1 }).active).toBe(true);
    expect(sanitiseSurveyorPayload({ active: 0 }).active).toBe(false);
  });

  it('filters peril_specialties to non-empty strings', () => {
    expect(
      sanitiseSurveyorPayload({ peril_specialties: ['Fire', '', '  ', 'Marine Cargo', null] }).peril_specialties
    ).toEqual(['Fire', 'Marine Cargo']);
  });

  it('parses max_concurrent_claims as positive integer or null', () => {
    expect(sanitiseSurveyorPayload({ max_concurrent_claims: '25' }).max_concurrent_claims).toBe(25);
    expect(sanitiseSurveyorPayload({ max_concurrent_claims: 'abc' }).max_concurrent_claims).toBeNull();
    expect(sanitiseSurveyorPayload({ max_concurrent_claims: '0' }).max_concurrent_claims).toBeNull();
    expect(sanitiseSurveyorPayload({ max_concurrent_claims: '-3' }).max_concurrent_claims).toBeNull();
  });

  it('ignores undefined fields (does not blank them)', () => {
    const out = sanitiseSurveyorPayload({ name: 'Jane' });
    expect('email' in out).toBe(false);
    expect('peril_specialties' in out).toBe(false);
  });
});
