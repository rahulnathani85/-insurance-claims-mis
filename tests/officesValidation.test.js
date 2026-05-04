// =============================================================================
// tests/officesValidation.test.js
// =============================================================================
// Tests for lib/officeValidation.js — the server-side helper that gates
// 3-office writes on POST /api/claims and PUT /api/claims/[id]. Mock follows
// the lightweight pattern from tests/executor.test.js — just enough of the
// supabase-js builder surface for the helper's two queries:
//   1. .from('insurers').select('id, company_name').ilike(...).maybeSingle()
//   2. .from('insurer_offices').select(...).in('id', [...])
// =============================================================================

import { describe, it, expect } from 'vitest';
import { validateAndHydrateOffices } from '../lib/officeValidation.js';

// ---------- Mock builder ----------

function makeMockSupabase({ insurers = [], offices = [] }) {
  return {
    from(table) {
      if (table === 'insurers') return makeInsurerBuilder(insurers);
      if (table === 'insurer_offices') return makeOfficeBuilder(offices);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function makeInsurerBuilder(rows) {
  let ilikeArgs = null;
  const builder = {
    select: () => builder,
    ilike: (col, val) => {
      ilikeArgs = { col, val };
      return builder;
    },
    maybeSingle: () => {
      if (!ilikeArgs) return Promise.resolve({ data: null, error: null });
      const target = String(ilikeArgs.val).trim().toLowerCase();
      const match = rows.find(
        (r) => String(r[ilikeArgs.col] || '').trim().toLowerCase() === target
      );
      return Promise.resolve({ data: match || null, error: null });
    },
  };
  return builder;
}

function makeOfficeBuilder(rows) {
  let inArgs = null;
  const builder = {
    select: () => builder,
    in: (col, vals) => {
      inArgs = { col, vals: vals.map(Number) };
      return builder;
    },
    then: (resolve) => {
      const data = inArgs
        ? rows.filter((r) => inArgs.vals.includes(Number(r[inArgs.col])))
        : rows;
      resolve({ data, error: null });
    },
  };
  return builder;
}

// ---------- Fixtures ----------

const INSURERS = [
  { id: 1, company_name: 'New India Assurance' },
  { id: 2, company_name: 'Oriental Insurance' },
];

const OFFICES = [
  // Insurer 1 (New India)
  { id: 11, insurer_id: 1, name: 'Mumbai HO',     address: 'Fort',     city: 'Mumbai',    state: 'MH', pin: '400001', is_active: true  },
  { id: 12, insurer_id: 1, name: 'Pune RO',       address: 'Camp',     city: 'Pune',      state: 'MH', pin: '411001', is_active: true  },
  { id: 13, insurer_id: 1, name: 'Closed RO',     address: 'Old',      city: 'Nashik',    state: 'MH', pin: '422001', is_active: false },
  // Insurer 2 (Oriental)
  { id: 21, insurer_id: 2, name: 'Delhi HO',      address: 'CP',       city: 'New Delhi', state: 'DL', pin: '110001', is_active: true  },
];

// ---------- Tests ----------

describe('validateAndHydrateOffices — no-op cases', () => {
  it('returns ok with no mutation when no office_id provided', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = { insurer_name: 'New India Assurance', other: 'value' };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(true);
    expect(body.appointing_office_name).toBeUndefined();
    expect(body.policy_office_name).toBeUndefined();
  });

  it('treats undefined and null and empty string office_id as not-provided', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = {
      insurer_name: 'New India Assurance',
      appointing_office_id: null,
      policy_office_id: '',
      fsr_office_id: undefined,
    };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(true);
  });

  it('handles missing/non-object body without throwing', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    expect((await validateAndHydrateOffices(supabase, null)).ok).toBe(true);
    expect((await validateAndHydrateOffices(supabase, undefined)).ok).toBe(true);
    expect((await validateAndHydrateOffices(supabase, 'not an object')).ok).toBe(true);
  });
});

describe('validateAndHydrateOffices — happy path', () => {
  it('hydrates name+address for all 3 roles when offices match insurer', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = {
      insurer_name: 'New India Assurance',
      appointing_office_id: 11,
      policy_office_id: 12,
      fsr_office_id: 12,
      // Client-supplied junk that must be overwritten:
      appointing_office_name: 'CLIENT JUNK',
      policy_office_address: 'CLIENT JUNK',
    };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(true);
    expect(body.appointing_office_id).toBe(11);
    expect(body.appointing_office_name).toBe('Mumbai HO');
    expect(body.appointing_office_address).toBe('Fort, Mumbai, MH, 400001');
    expect(body.policy_office_name).toBe('Pune RO');
    expect(body.policy_office_address).toBe('Camp, Pune, MH, 411001');
    expect(body.fsr_office_name).toBe('Pune RO');
  });

  it('case-insensitive insurer_name match', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = { insurer_name: 'NEW INDIA ASSURANCE', appointing_office_id: 11 };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(true);
    expect(body.appointing_office_name).toBe('Mumbai HO');
  });

  it('hydrates only the roles that were provided (does not invent fields)', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = { insurer_name: 'New India Assurance', appointing_office_id: 11 };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(true);
    expect(body.appointing_office_name).toBe('Mumbai HO');
    expect(body.policy_office_name).toBeUndefined();
    expect(body.fsr_office_name).toBeUndefined();
  });

  it('numeric coercion: string office_id matches numeric DB id', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = {
      insurer_name: 'New India Assurance',
      appointing_office_id: '11',
    };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(true);
    expect(body.appointing_office_id).toBe(11);
  });
});

describe('validateAndHydrateOffices — failure cases', () => {
  it('returns 400 when office_id does not exist', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = { insurer_name: 'New India Assurance', appointing_office_id: 9999 };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/not found/i);
  });

  it('returns 400 when office is inactive', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = { insurer_name: 'New India Assurance', policy_office_id: 13 };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/inactive/i);
  });

  it('returns 400 when office belongs to a different insurer', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = {
      insurer_name: 'New India Assurance',
      appointing_office_id: 11, // insurer 1
      policy_office_id: 21,     // insurer 2 — mismatch
    };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/different insurer/i);
  });

  it('rejects when claim insurer is unknown but offices span insurers', async () => {
    // No insurer_name on body — fallback adopts first office's insurer_id.
    // Second office from a different insurer must still fail.
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = {
      appointing_office_id: 11, // insurer 1
      fsr_office_id: 21,        // insurer 2
    };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/different insurer/i);
  });

  it('accepts when insurer_name is missing but offices share an insurer (fallback path)', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = { appointing_office_id: 11, policy_office_id: 12 };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(true);
    expect(body.appointing_office_name).toBe('Mumbai HO');
    expect(body.policy_office_name).toBe('Pune RO');
  });

  it('rejects when insurer_name resolves to a different insurer than the office', async () => {
    const supabase = makeMockSupabase({ insurers: INSURERS, offices: OFFICES });
    const body = {
      insurer_name: 'Oriental Insurance',
      appointing_office_id: 11, // belongs to New India (insurer 1)
    };
    const r = await validateAndHydrateOffices(supabase, body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/different insurer/i);
  });
});
