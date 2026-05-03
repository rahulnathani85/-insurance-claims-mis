// =============================================================================
// lib/auth/insurer.js
// =============================================================================
// CLAUDE.md §11 #8 — Insurer-portal helpers (Phase 1 scaffolding).
//
// THIS MODULE IS DELIBERATELY MINIMAL. It exposes the predicates that
// Phase 2 routes will use to gate / scope insurer-readonly access.
// Phase 3 will enable per-table RLS that uses these same predicates;
// Phase 4 drops permissive RLS once every route is audited. The full
// rollout is documented in `docs/insurer-portal-rls-spec.md`.
//
// Until Phase 2 ships, no production user has role='insurer_readonly'
// (the role check now permits it but no UI provisions it). The helpers
// below are safe to import + call — they short-circuit cleanly when
// `user` is the typical NISLA / Acuere internal record.
// =============================================================================

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const INSURER_ROLE = 'insurer_readonly';

// -----------------------------------------------------------------------------
// isInsurerUser — true iff the session principal is an insurer-portal user.
// -----------------------------------------------------------------------------
// Pass the `user` row from app_users (or the sessionStorage shape, which
// has the same key set). Returns false for every non-insurer principal,
// including null / unauthenticated.
// -----------------------------------------------------------------------------
export function isInsurerUser(user) {
  if (!user || typeof user !== 'object') return false;
  return user.role === INSURER_ROLE;
}

// -----------------------------------------------------------------------------
// getInsurerId — pulls the insurer_id off the user row when present.
// -----------------------------------------------------------------------------
// Returns null for any non-insurer user. Phase 3 RLS predicates will
// require this to be non-null when role='insurer_readonly' (the
// CHECK constraint in 20260503030000 enforces that pairing at the DB
// level too).
// -----------------------------------------------------------------------------
export function getInsurerId(user) {
  if (!isInsurerUser(user)) return null;
  const id = user?.insurer_id;
  // Reject null / undefined / '' explicitly — Number(null)===0 and we
  // don't want a misconfigured row to silently scope to insurer_id=0.
  if (id === null || id === undefined || id === '') return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

// -----------------------------------------------------------------------------
// requireSurveyorOrThrow — guard that route handlers can call to refuse
// an insurer principal on routes that should never be exposed publicly
// (e.g. mutation endpoints).
// -----------------------------------------------------------------------------
// Throws a tagged error so the route's catch block can map it to a 403.
// -----------------------------------------------------------------------------
export function requireSurveyorOrThrow(user) {
  if (isInsurerUser(user)) {
    const e = new Error('Endpoint is read-only for insurer-portal users');
    e.statusCode = 403;
    e.code = 'INSURER_FORBIDDEN';
    throw e;
  }
}

// -----------------------------------------------------------------------------
// scopeClaimsForInsurer — adds an insurer-name filter to a claims query
// when the principal is an insurer user. No-op for surveyors.
// -----------------------------------------------------------------------------
// Usage:
//   let q = supabaseAdmin.from('claims').select('*');
//   q = await scopeClaimsForInsurer(q, user);
//   const { data, error } = await q;
//
// In Phase 3 the same gating will be enforced by RLS on the DB side; in
// Phase 1/2 we layer it in user-space so insurer-readonly UI can be
// previewed without flipping the RLS switch.
// -----------------------------------------------------------------------------
export async function scopeClaimsForInsurer(query, user) {
  const insurerId = getInsurerId(user);
  if (insurerId === null) return query;

  // Look up the insurer's display name. The `insurers` table calls
  // it `company_name` (legacy schema from the V1 migration); claims
  // store the same string in `claims.insurer_name`. We map across.
  const { data: ins } = await supabaseAdmin
    .from('insurers')
    .select('company_name')
    .eq('id', insurerId)
    .maybeSingle();
  if (!ins?.company_name) {
    // Mis-provisioned user — fail closed (no rows).
    return query.eq('insurer_name', '__no_match__');
  }
  return query.eq('insurer_name', ins.company_name);
}

// -----------------------------------------------------------------------------
// loadInsurer — convenience for the dashboard / claim-detail headers.
// -----------------------------------------------------------------------------
// Returns the full insurers row for the user's linked insurer, or null
// if the user isn't an insurer principal.
// -----------------------------------------------------------------------------
export async function loadInsurer(user) {
  const id = getInsurerId(user);
  if (id === null) return null;
  const { data } = await supabaseAdmin
    .from('insurers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

// -----------------------------------------------------------------------------
// requireSurveyorRequest — server-side mutation guard.
// -----------------------------------------------------------------------------
// Reads the X-User-Email request header (set by the lib/api/fetch
// helper on every authenticated client request) and looks up the user.
// If the user is insurer_readonly, throws with statusCode=403 so the
// caller's catch block can map cleanly to NextResponse.json(...).
//
// If the header is absent (e.g. server-to-server / cron / webhook), we
// return null and don't 403 — the route's own auth path applies.
//
// Phase 3 will replace this with JWT-claim-based RLS (see
// docs/insurer-portal-rls-spec.md) which removes the need to look up
// the user on every request. Until then this is the soft enforcement.
// -----------------------------------------------------------------------------
export async function requireSurveyorRequest(request) {
  const userEmail = request?.headers?.get?.('x-user-email') || '';
  if (!userEmail) return null;

  const { data: user } = await supabaseAdmin
    .from('app_users')
    .select('id, email, role, insurer_id, is_active')
    .ilike('email', userEmail.trim())
    .maybeSingle();

  if (!user || !user.is_active) return null;  // unknown email — let the route's own auth handle

  if (user.role === INSURER_ROLE) {
    const e = new Error('Endpoint is read-only for insurer-portal users');
    e.statusCode = 403;
    e.code = 'INSURER_FORBIDDEN';
    throw e;
  }

  return user;
}

// -----------------------------------------------------------------------------
// withSurveyorGuard — convenience wrapper for route handlers.
// -----------------------------------------------------------------------------
// Use it like:
//   export const POST = withSurveyorGuard(async (request, ctx) => { ... });
// Wraps the handler in a try/catch that maps INSURER_FORBIDDEN → 403.
// -----------------------------------------------------------------------------
export function withSurveyorGuard(handler) {
  return async function (request, ctx) {
    try {
      await requireSurveyorRequest(request);
    } catch (e) {
      if (e?.code === 'INSURER_FORBIDDEN') {
        const { NextResponse } = await import('next/server');
        return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
      }
      throw e;
    }
    return handler(request, ctx);
  };
}
