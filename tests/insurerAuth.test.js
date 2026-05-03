// =============================================================================
// tests/insurerAuth.test.js
// =============================================================================
// Tests for lib/auth/insurer.js (Phase 2 of the insurer-portal rollout).
//
// Pure-JS — mocks Supabase + request to exercise:
//   - isInsurerUser / getInsurerId predicates
//   - requireSurveyorOrThrow (in-route guard)
//   - requireSurveyorRequest (header-based mutation guard)
//   - scopeClaimsForInsurer (claims filter chaining)
//   - withSurveyorGuard (route wrapper)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  INSURER_ROLE,
  isInsurerUser,
  getInsurerId,
  requireSurveyorOrThrow,
  requireSurveyorRequest,
  scopeClaimsForInsurer,
  loadInsurer,
} from '../lib/auth/insurer.js';

// -----------------------------------------------------------------------------
// supabaseAdmin mock — installed via vi.mock so the module's import resolves
// to our stub before lib/auth/insurer.js initialises.
// -----------------------------------------------------------------------------

const mockState = {
  appUsersByEmail: new Map(),
  insurersById: new Map(),
};

function resetMock() {
  mockState.appUsersByEmail.clear();
  mockState.insurersById.clear();
}

function makeQuery(table) {
  let conds = {};
  let result = null;

  const obj = {
    select() { return obj; },
    eq(col, val) { conds[col] = val; return obj; },
    ilike(col, val) { conds[`${col}_ilike`] = val.toLowerCase(); return obj; },
    async maybeSingle() {
      if (table === 'app_users') {
        const ilike = conds['email_ilike'];
        if (ilike) {
          const found = mockState.appUsersByEmail.get(ilike.trim());
          return { data: found || null, error: null };
        }
      }
      if (table === 'insurers') {
        const id = conds['id'];
        if (id) {
          const found = mockState.insurersById.get(id);
          return { data: found || null, error: null };
        }
      }
      return { data: null, error: null };
    },
  };
  return obj;
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    from: (table) => makeQuery(table),
  },
}));

// Helper for headers — mimics the Web Fetch Request.headers shape.
function mockRequest(headers = {}) {
  return {
    headers: {
      get: (k) => {
        const lower = k.toLowerCase();
        for (const [hk, hv] of Object.entries(headers)) {
          if (hk.toLowerCase() === lower) return hv;
        }
        return null;
      },
    },
  };
}

beforeEach(() => {
  resetMock();
});

// -----------------------------------------------------------------------------
// isInsurerUser / getInsurerId — predicates over a session row
// -----------------------------------------------------------------------------

describe('isInsurerUser', () => {
  it('returns true for role=insurer_readonly', () => {
    expect(isInsurerUser({ role: 'insurer_readonly' })).toBe(true);
    expect(isInsurerUser({ role: INSURER_ROLE })).toBe(true);
  });
  it('returns false for surveyor / admin / staff', () => {
    expect(isInsurerUser({ role: 'Surveyor' })).toBe(false);
    expect(isInsurerUser({ role: 'Admin' })).toBe(false);
    expect(isInsurerUser({ role: 'Staff' })).toBe(false);
  });
  it('returns false for null / undefined / non-object', () => {
    expect(isInsurerUser(null)).toBe(false);
    expect(isInsurerUser(undefined)).toBe(false);
    expect(isInsurerUser('insurer_readonly')).toBe(false);
    expect(isInsurerUser({})).toBe(false);
  });
});

describe('getInsurerId', () => {
  it('returns the BIGINT for a valid insurer user', () => {
    expect(getInsurerId({ role: 'insurer_readonly', insurer_id: 7 })).toBe(7);
    expect(getInsurerId({ role: 'insurer_readonly', insurer_id: '12' })).toBe(12);
  });
  it('returns null for non-insurer user', () => {
    expect(getInsurerId({ role: 'Surveyor', insurer_id: 7 })).toBeNull();
    expect(getInsurerId(null)).toBeNull();
  });
  it('returns null when insurer_id is invalid', () => {
    expect(getInsurerId({ role: 'insurer_readonly', insurer_id: null })).toBeNull();
    expect(getInsurerId({ role: 'insurer_readonly', insurer_id: 'not-a-number' })).toBeNull();
    expect(getInsurerId({ role: 'insurer_readonly' })).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// requireSurveyorOrThrow — in-route guard
// -----------------------------------------------------------------------------

describe('requireSurveyorOrThrow', () => {
  it('does not throw for surveyor / admin / staff users', () => {
    expect(() => requireSurveyorOrThrow({ role: 'Surveyor' })).not.toThrow();
    expect(() => requireSurveyorOrThrow({ role: 'Admin' })).not.toThrow();
    expect(() => requireSurveyorOrThrow(null)).not.toThrow();
  });
  it('throws INSURER_FORBIDDEN with statusCode=403 for insurer user', () => {
    let caught = null;
    try { requireSurveyorOrThrow({ role: 'insurer_readonly', insurer_id: 5 }); }
    catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(403);
    expect(caught.code).toBe('INSURER_FORBIDDEN');
    expect(caught.message).toMatch(/read-only/i);
  });
});

// -----------------------------------------------------------------------------
// requireSurveyorRequest — header-based mutation guard
// -----------------------------------------------------------------------------

describe('requireSurveyorRequest', () => {
  it('returns null when X-User-Email header is absent (server-to-server / cron)', async () => {
    const r = mockRequest({});
    const result = await requireSurveyorRequest(r);
    expect(result).toBeNull();
  });

  it('returns null when the email is unknown (defers to route auth)', async () => {
    const r = mockRequest({ 'X-User-Email': 'ghost@example.com' });
    const result = await requireSurveyorRequest(r);
    expect(result).toBeNull();
  });

  it('returns null when the user is inactive', async () => {
    mockState.appUsersByEmail.set('jane@nisla.in', {
      id: 1, email: 'jane@nisla.in', role: 'Surveyor', insurer_id: null, is_active: false,
    });
    const r = mockRequest({ 'X-User-Email': 'jane@nisla.in' });
    const result = await requireSurveyorRequest(r);
    expect(result).toBeNull();
  });

  it('returns the user row for an active surveyor', async () => {
    mockState.appUsersByEmail.set('jane@nisla.in', {
      id: 1, email: 'jane@nisla.in', role: 'Surveyor', insurer_id: null, is_active: true,
    });
    const r = mockRequest({ 'X-User-Email': 'jane@nisla.in' });
    const result = await requireSurveyorRequest(r);
    expect(result).toEqual(expect.objectContaining({ email: 'jane@nisla.in', role: 'Surveyor' }));
  });

  it('throws 403 INSURER_FORBIDDEN when the user is insurer_readonly', async () => {
    mockState.appUsersByEmail.set('officer@newindia.in', {
      id: 99, email: 'officer@newindia.in', role: 'insurer_readonly', insurer_id: 3, is_active: true,
    });
    const r = mockRequest({ 'X-User-Email': 'officer@newindia.in' });
    let caught = null;
    try { await requireSurveyorRequest(r); }
    catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.statusCode).toBe(403);
    expect(caught.code).toBe('INSURER_FORBIDDEN');
  });

  it('lowercases / trims the email match (ilike)', async () => {
    mockState.appUsersByEmail.set('officer@newindia.in', {
      id: 99, email: 'officer@newindia.in', role: 'insurer_readonly', insurer_id: 3, is_active: true,
    });
    const r = mockRequest({ 'x-user-email': '  Officer@NewIndia.IN  ' });
    let caught = null;
    try { await requireSurveyorRequest(r); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe('INSURER_FORBIDDEN');
  });

  it('handles a request without a headers.get method gracefully', async () => {
    const r = {};  // no headers
    const result = await requireSurveyorRequest(r);
    expect(result).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// scopeClaimsForInsurer — adds insurer_name filter for insurer principals
// -----------------------------------------------------------------------------

describe('scopeClaimsForInsurer', () => {
  it('returns the query unchanged for non-insurer user', async () => {
    const fakeQuery = { _filters: [], eq(col, val) { this._filters.push([col, val]); return this; } };
    const out = await scopeClaimsForInsurer(fakeQuery, { role: 'Surveyor' });
    expect(out).toBe(fakeQuery);
    expect(fakeQuery._filters).toEqual([]);
  });

  it('returns the query unchanged for null user', async () => {
    const fakeQuery = { _filters: [], eq(col, val) { this._filters.push([col, val]); return this; } };
    const out = await scopeClaimsForInsurer(fakeQuery, null);
    expect(out).toBe(fakeQuery);
    expect(fakeQuery._filters).toEqual([]);
  });

  it('chains insurer_name filter for insurer user with valid insurer row', async () => {
    // Note: the insurers table column is `company_name` (V1 legacy
    // schema), not `name`. claims.insurer_name stores the same string.
    mockState.insurersById.set(7, { id: 7, company_name: 'New India Assurance Co. Ltd.' });
    const fakeQuery = { _filters: [], eq(col, val) { this._filters.push([col, val]); return this; } };
    const user = { role: 'insurer_readonly', insurer_id: 7 };
    const out = await scopeClaimsForInsurer(fakeQuery, user);
    expect(out).toBe(fakeQuery);
    expect(fakeQuery._filters).toEqual([['insurer_name', 'New India Assurance Co. Ltd.']]);
  });

  it('fails closed (filter to a never-match) when insurer_id is mis-provisioned', async () => {
    // No insurer in the mock for id=99 → row doesn't exist
    const fakeQuery = { _filters: [], eq(col, val) { this._filters.push([col, val]); return this; } };
    const user = { role: 'insurer_readonly', insurer_id: 99 };
    const out = await scopeClaimsForInsurer(fakeQuery, user);
    expect(out).toBe(fakeQuery);
    expect(fakeQuery._filters).toEqual([['insurer_name', '__no_match__']]);
  });
});

// -----------------------------------------------------------------------------
// loadInsurer — convenience for dashboard headers
// -----------------------------------------------------------------------------

describe('loadInsurer', () => {
  it('returns null for non-insurer user', async () => {
    expect(await loadInsurer({ role: 'Surveyor' })).toBeNull();
    expect(await loadInsurer(null)).toBeNull();
  });

  it('returns the insurer row for a valid insurer user', async () => {
    mockState.insurersById.set(3, {
      id: 3, company_name: 'Oriental Insurance', code: 'ORI', registered_address: 'New Delhi',
    });
    const out = await loadInsurer({ role: 'insurer_readonly', insurer_id: 3 });
    expect(out).toEqual(expect.objectContaining({ id: 3, company_name: 'Oriental Insurance' }));
  });

  it('returns null when the linked insurer row is missing', async () => {
    const out = await loadInsurer({ role: 'insurer_readonly', insurer_id: 99 });
    expect(out).toBeNull();
  });
});
