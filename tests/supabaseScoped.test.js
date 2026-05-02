// =============================================================================
// tests/supabaseScoped.test.js
// =============================================================================
// Tests for lib/supabaseScoped.js (Phase 3 RLS scoped-client wrapper).
//
// We can't talk to a real Postgres in CI, so the test mocks
// @supabase/supabase-js's createClient to capture the rpc('set_session_user')
// call and assert the wrapper's branching:
//
//   - Empty / missing email → ok=false, error='email is required...'
//   - rpc returns null role  → ok=false, role=null, error='Account not found...'
//   - rpc returns 'Surveyor' → ok=true, role='Surveyor'
//   - rpc returns 'insurer_readonly' → ok=true, role='insurer_readonly'
//   - rpc throws / returns error → ok=false, error propagated
//
// Plus scopedSupabaseFromRequest reads the X-User-Email header.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// rpc behaviour configurable per test
const rpcMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (name, args) => rpcMock(name, args),
    // surfaces of the client we don't exercise in this test:
    from() { return this; },
    auth: {},
  }),
}));

import { scopedSupabaseFor, scopedSupabaseFromRequest } from '../lib/supabaseScoped.js';

beforeEach(() => {
  rpcMock.mockReset();
});

// -----------------------------------------------------------------------------
// scopedSupabaseFor — basic branching
// -----------------------------------------------------------------------------

describe('scopedSupabaseFor', () => {
  it('refuses an empty email without calling RPC', async () => {
    const result = await scopedSupabaseFor({ email: '' });
    expect(result.ok).toBe(false);
    expect(result.client).toBeNull();
    expect(result.role).toBeNull();
    expect(result.error).toMatch(/email is required/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('refuses missing email arg', async () => {
    const result = await scopedSupabaseFor({});
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('calls set_session_user with the trimmed email', async () => {
    rpcMock.mockResolvedValue({ data: 'Surveyor', error: null });
    await scopedSupabaseFor({ email: '  Jane@NISLA.in  ' });
    expect(rpcMock).toHaveBeenCalledWith('set_session_user', { p_email: 'Jane@NISLA.in' });
  });

  it('returns ok=true + role when RPC succeeds', async () => {
    rpcMock.mockResolvedValue({ data: 'Surveyor', error: null });
    const result = await scopedSupabaseFor({ email: 'jane@nisla.in' });
    expect(result.ok).toBe(true);
    expect(result.role).toBe('Surveyor');
    expect(result.error).toBeNull();
    expect(result.client).not.toBeNull();
  });

  it('returns ok=true with role=insurer_readonly for insurer principal', async () => {
    rpcMock.mockResolvedValue({ data: 'insurer_readonly', error: null });
    const result = await scopedSupabaseFor({ email: 'officer@newindia.in' });
    expect(result.ok).toBe(true);
    expect(result.role).toBe('insurer_readonly');
  });

  it('returns ok=false when RPC returns null (unknown / inactive user)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await scopedSupabaseFor({ email: 'ghost@example.com' });
    expect(result.ok).toBe(false);
    expect(result.role).toBeNull();
    expect(result.error).toMatch(/not found|inactive/);
    expect(result.client).toBeNull();
  });

  it('propagates RPC error message', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function set_session_user does not exist' } });
    const result = await scopedSupabaseFor({ email: 'jane@nisla.in' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/function set_session_user/);
    expect(result.client).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// scopedSupabaseFromRequest — header-based shortcut
// -----------------------------------------------------------------------------

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

describe('scopedSupabaseFromRequest', () => {
  it('reads X-User-Email header and forwards to scopedSupabaseFor', async () => {
    rpcMock.mockResolvedValue({ data: 'Admin', error: null });
    const result = await scopedSupabaseFromRequest(
      mockRequest({ 'X-User-Email': 'admin@nisla.in' })
    );
    expect(result.ok).toBe(true);
    expect(result.role).toBe('Admin');
    expect(rpcMock).toHaveBeenCalledWith('set_session_user', { p_email: 'admin@nisla.in' });
  });

  it('is case-insensitive on the header name', async () => {
    rpcMock.mockResolvedValue({ data: 'Surveyor', error: null });
    const result = await scopedSupabaseFromRequest(
      mockRequest({ 'x-user-email': 'jane@nisla.in' })
    );
    expect(result.ok).toBe(true);
  });

  it('returns 401-shape result when header is absent', async () => {
    const result = await scopedSupabaseFromRequest(mockRequest({}));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Authentication required/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('handles a request without headers.get gracefully', async () => {
    const result = await scopedSupabaseFromRequest({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Authentication required/);
  });
});
