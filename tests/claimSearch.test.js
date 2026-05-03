// =============================================================================
// tests/claimSearch.test.js
// =============================================================================
// Tests for /api/communications/claim-search — typeahead lookup that backs
// the comms-review "tag to existing claim" picker.
//
// What the route does:
//   1. requireUser via x-app-user-email header → app_users lookup
//   2. Multi-company gate (users on company='all'/'development' may pass an
//      explicit ?company= param; everyone else is pinned to their own)
//   3. ILIKE OR search across ref_number / claim_number / insured_name /
//      policy_number, capped at 25 rows
//   4. Returns { ok, query, scope_company, count, results }
//
// We mock @/lib/supabaseAdmin so we can capture and assert the calls the
// route makes.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----------------------------------------------------------------------------
// supabaseAdmin mock
// ----------------------------------------------------------------------------

const state = {
  appUsersByEmail: new Map(),
  claims: [],
  // captured from the last claims query
  lastClaimsQuery: null,
};

function resetState() {
  state.appUsersByEmail.clear();
  state.claims = [];
  state.lastClaimsQuery = null;
}

function makeUserQuery() {
  let email = null;
  return {
    select() { return this; },
    eq(col, val) { if (col === 'email') email = val; return this; },
    async maybeSingle() {
      const found = email ? state.appUsersByEmail.get(email) : null;
      return { data: found || null, error: null };
    },
  };
}

function makeClaimsQuery() {
  // Capture what the route configured so tests can assert on it.
  const captured = {
    selectedColumns: null,
    orders: [],
    eqs: {},
    or: null,
    limit: null,
  };
  state.lastClaimsQuery = captured;

  const q = {
    select(cols) { captured.selectedColumns = cols; return q; },
    order(col, opts = {}) { captured.orders.push({ col, ...opts }); return q; },
    eq(col, val) { captured.eqs[col] = val; return q; },
    or(filterStr) { captured.or = filterStr; return q; },
    limit(n) { captured.limit = n; return q; },
    // Allow `await query` to resolve to { data, error }.
    then(resolve) {
      const filtered = filterClaims(state.claims, captured);
      resolve({ data: filtered.slice(0, captured.limit || 25), error: null });
    },
  };
  return q;
}

// Tiny in-memory filter that mimics what PostgREST would do, just enough for
// the assertions. Not a Postgres simulator — only exercises the predicates the
// route uses.
function filterClaims(claims, captured) {
  let rows = claims;
  for (const [col, val] of Object.entries(captured.eqs)) {
    rows = rows.filter((r) => r[col] === val);
  }
  if (captured.or) {
    // captured.or is e.g. 'ref_number.ilike.%abc%,insured_name.ilike.%abc%,...'
    const parts = captured.or.split(',').map((p) => {
      const m = p.match(/^([a-z_]+)\.ilike\.%(.+)%$/);
      return m ? { col: m[1], needle: m[2].toLowerCase() } : null;
    }).filter(Boolean);
    rows = rows.filter((r) =>
      parts.some(({ col, needle }) =>
        String(r[col] ?? '').toLowerCase().includes(needle)
      )
    );
  }
  // Sort by phase desc (registered > intimation), then created_at desc
  rows = [...rows].sort((a, b) => {
    if (a.phase !== b.phase) return (b.phase || '').localeCompare(a.phase || '');
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  return rows;
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    from(table) {
      if (table === 'app_users') return makeUserQuery();
      if (table === 'claims') return makeClaimsQuery();
      throw new Error(`unexpected from(${table})`);
    },
  },
}));

// ----------------------------------------------------------------------------
// Now we can import the route — its supabaseAdmin reference is the mock.
// ----------------------------------------------------------------------------
const { GET } = await import('../app/api/communications/claim-search/route.js');

beforeEach(() => {
  resetState();
});

function makeRequest(url, headers = {}) {
  return new Request(url, { headers });
}

// ----------------------------------------------------------------------------
// auth gate
// ----------------------------------------------------------------------------

describe('auth gate', () => {
  it('returns 401 when no x-app-user-email header is present', async () => {
    const res = await GET(makeRequest('http://x/api/communications/claim-search?q=foo'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the email is not in app_users', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?q=foo',
      { 'x-app-user-email': 'ghost@example.invalid' }
    ));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the user is is_active=false', async () => {
    state.appUsersByEmail.set('disabled@nisla.in', {
      id: 1, email: 'disabled@nisla.in', name: 'X', role: 'Admin',
      company: 'NISLA', is_active: false,
    });
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?q=foo',
      { 'x-app-user-email': 'disabled@nisla.in' }
    ));
    expect(res.status).toBe(401);
  });
});

// ----------------------------------------------------------------------------
// company scoping
// ----------------------------------------------------------------------------

describe('company scoping', () => {
  beforeEach(() => {
    state.appUsersByEmail.set('nislauser@nisla.in', {
      id: 1, email: 'nislauser@nisla.in', name: 'N', role: 'Admin',
      company: 'NISLA', is_active: true,
    });
    state.appUsersByEmail.set('alladmin@nisla.in', {
      id: 2, email: 'alladmin@nisla.in', name: 'A', role: 'Super',
      company: 'all', is_active: true,
    });
    state.claims = [
      { id: 1, ref_number: '001/26-27/Fire',  company: 'NISLA',  phase: 'registered', created_at: '2026-05-01' },
      { id: 2, ref_number: '002/26-27/Fire',  company: 'Acuere', phase: 'registered', created_at: '2026-05-02' },
    ];
  });

  it('pins a single-company user to their own company regardless of ?company', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?company=Acuere',
      { 'x-app-user-email': 'nislauser@nisla.in' }
    ));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.lastClaimsQuery.eqs.company).toBe('NISLA');
    expect(body.scope_company).toBe('NISLA');
    expect(body.results).toHaveLength(1);
    expect(body.results[0].ref_number).toBe('001/26-27/Fire');
  });

  it('lets a multi-company user pass ?company explicitly', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?company=Acuere',
      { 'x-app-user-email': 'alladmin@nisla.in' }
    ));
    const body = await res.json();
    expect(state.lastClaimsQuery.eqs.company).toBe('Acuere');
    expect(body.results.map((r) => r.ref_number)).toEqual(['002/26-27/Fire']);
  });

  it('returns rows from every company when a multi-company user omits ?company', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search',
      { 'x-app-user-email': 'alladmin@nisla.in' }
    ));
    const body = await res.json();
    expect(state.lastClaimsQuery.eqs.company).toBeUndefined();
    expect(body.results).toHaveLength(2);
  });
});

// ----------------------------------------------------------------------------
// search behaviour
// ----------------------------------------------------------------------------

describe('search behaviour', () => {
  beforeEach(() => {
    state.appUsersByEmail.set('clerk@nisla.in', {
      id: 1, email: 'clerk@nisla.in', name: 'Clerk', role: 'Admin',
      company: 'NISLA', is_active: true,
    });
    state.claims = [
      { id: 1, ref_number: '4053/26-27/Marine', company: 'NISLA', phase: 'registered',
        insured_name: 'Acme Cotton',  policy_number: 'POL-1', claim_number: 'CL-1', created_at: '2026-05-01' },
      { id: 2, ref_number: 'INTAKE/NISLA/abc',  company: 'NISLA', phase: 'intimation',
        insured_name: 'Beta Industries', policy_number: 'POL-2', claim_number: null,    created_at: '2026-05-02' },
      { id: 3, ref_number: '001/26-27/Fire',    company: 'NISLA', phase: 'registered',
        insured_name: 'Cosmic Mills',   policy_number: 'POL-3', claim_number: 'CL-3',  created_at: '2026-04-30' },
    ];
  });

  it('returns the most recent claims when q is empty', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search',
      { 'x-app-user-email': 'clerk@nisla.in' }
    ));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.query).toBe('');
    expect(state.lastClaimsQuery.or).toBeNull();
    // Sort: registered first then most recent → 4053 (May 1), 001 (Apr 30), then intimation INTAKE
    expect(body.results.map((r) => r.ref_number))
      .toEqual(['4053/26-27/Marine', '001/26-27/Fire', 'INTAKE/NISLA/abc']);
  });

  it('builds an ILIKE OR across the four searchable columns', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?q=Cotton',
      { 'x-app-user-email': 'clerk@nisla.in' }
    ));
    const body = await res.json();
    const orStr = state.lastClaimsQuery.or || '';
    expect(orStr).toContain('ref_number.ilike.%Cotton%');
    expect(orStr).toContain('claim_number.ilike.%Cotton%');
    expect(orStr).toContain('insured_name.ilike.%Cotton%');
    expect(orStr).toContain('policy_number.ilike.%Cotton%');
    expect(body.results.map((r) => r.ref_number)).toEqual(['4053/26-27/Marine']);
  });

  it('matches by ref_number substring', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?q=4053',
      { 'x-app-user-email': 'clerk@nisla.in' }
    ));
    const body = await res.json();
    expect(body.results.map((r) => r.ref_number)).toEqual(['4053/26-27/Marine']);
  });

  it('matches by claim_number', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?q=CL-3',
      { 'x-app-user-email': 'clerk@nisla.in' }
    ));
    const body = await res.json();
    expect(body.results.map((r) => r.ref_number)).toEqual(['001/26-27/Fire']);
  });

  it('matches by policy_number', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?q=POL-2',
      { 'x-app-user-email': 'clerk@nisla.in' }
    ));
    const body = await res.json();
    expect(body.results.map((r) => r.ref_number)).toEqual(['INTAKE/NISLA/abc']);
  });

  it('strips commas + parens from the query (PostgREST .or() injection guard)', async () => {
    const res = await GET(makeRequest(
      'http://x/api/communications/claim-search?q=ab%2Cc(d)e',  // ab,c(d)e → ab cd e
      { 'x-app-user-email': 'clerk@nisla.in' }
    ));
    expect(res.status).toBe(200);
    // Sanitiser replaces each of `,` `(` `)` with a single space, so the OR
    // string carries the harmless 'ab c d e' rather than the original — no
    // way to smuggle a 5th .ilike. predicate via comma injection.
    const or = state.lastClaimsQuery.or || '';
    // Exactly 4 .ilike. predicates (one per searchable column), no more:
    expect((or.match(/\.ilike\./g) || []).length).toBe(4);
    expect(or).toMatch(/ref_number\.ilike\.%ab c d e%/);
  });
});

// ----------------------------------------------------------------------------
// limits + projection
// ----------------------------------------------------------------------------

describe('limits + projection', () => {
  beforeEach(() => {
    state.appUsersByEmail.set('clerk@nisla.in', {
      id: 1, email: 'clerk@nisla.in', name: 'Clerk', role: 'Admin',
      company: 'NISLA', is_active: true,
    });
  });

  it('defaults to limit 25', async () => {
    await GET(makeRequest('http://x/api/communications/claim-search', {
      'x-app-user-email': 'clerk@nisla.in',
    }));
    expect(state.lastClaimsQuery.limit).toBe(25);
  });

  it('honours a custom limit, capped at 50', async () => {
    await GET(makeRequest('http://x/api/communications/claim-search?limit=10', {
      'x-app-user-email': 'clerk@nisla.in',
    }));
    expect(state.lastClaimsQuery.limit).toBe(10);

    await GET(makeRequest('http://x/api/communications/claim-search?limit=999', {
      'x-app-user-email': 'clerk@nisla.in',
    }));
    expect(state.lastClaimsQuery.limit).toBe(50);
  });

  it('only selects columns the dropdown needs (no full row payload)', async () => {
    await GET(makeRequest('http://x/api/communications/claim-search', {
      'x-app-user-email': 'clerk@nisla.in',
    }));
    const cols = state.lastClaimsQuery.selectedColumns || '';
    expect(cols).toContain('ref_number');
    expect(cols).toContain('insured_name');
    expect(cols).toContain('lob');
    expect(cols).toContain('phase');
    // Sensitive / verbose fields stay out:
    expect(cols).not.toContain('observations');
    expect(cols).not.toContain('draft_data');
    expect(cols).not.toContain('cover_data');
  });
});
