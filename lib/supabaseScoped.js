// =============================================================================
// lib/supabaseScoped.js
// =============================================================================
// Phase 3 RLS — anon-key Supabase client wrapper that establishes a
// session-claim GUC at the start of every query chain.
//
// Why a wrapper rather than just using lib/supabase directly:
//   - The anon-key client doesn't bypass RLS (good — that's the point).
//   - But Postgres connections are pooled by PgBouncer, so a `SET LOCAL`
//     in one query won't survive into the next query unless we're inside
//     the same transaction. So we wrap each insurer-portal query into a
//     SECURITY DEFINER `set_session_user` RPC that sets the GUC at
//     transaction-local scope.
//   - PostgREST runs each request in its own transaction, so the GUC
//     set by an RPC call at request start IS visible to subsequent
//     SELECTs in the same request — IF they ride on the same PostgREST
//     transaction. That's the case for every request that uses one
//     supabase-js client instance with the anon-key.
//
// Usage:
//   import { scopedSupabaseFor } from '@/lib/supabaseScoped';
//   const supabase = await scopedSupabaseFor({ email: 'officer@newindia.in' });
//   const { data, error } = await supabase.from('claims').select('*');
//   //                                                   ^^^^^^^^^^^^^^
//   // RLS now sees current_user_role()='insurer_readonly' and filters
//   // claims to those where insurer_name = current_user_insurer_name().
//
// If `email` is empty / unknown, the function returns a client that
// will fail closed (no GUC set, but RLS policies on insurer-visible
// tables will refuse selects since current_user_role() is NULL → the
// permissive branch). Callers should check the returned `role` and
// 401 / 403 accordingly.
//
// IMPORTANT — Phase 3a scope: this client is wired up ONLY for the
// /api/insurer-portal/* routes. Surveyor flows continue to use
// lib/supabaseAdmin (service-role, bypasses RLS) so RLS changes are
// invisible to them. Phase 3b will progressively migrate other anon-key
// queries onto this scoped client as we tighten more tables.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Don't throw at import time — let the runtime error give a clearer
  // message inside the route. Tests that don't actually invoke the
  // client never hit this.
  console.warn(
    '[supabaseScoped] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is unset. ' +
    'Insurer-portal queries will fail.'
  );
}

// -----------------------------------------------------------------------------
// scopedSupabaseFor — returns an anon client with the session-claim GUC
// set for the given user email. Call this once per request.
// -----------------------------------------------------------------------------
// Returns: { client, role, ok, error }
//   client — the supabase-js client (anon key, RLS active)
//   role   — the role string returned by set_session_user RPC; null
//            if the email was rejected
//   ok     — convenience boolean
//   error  — error message when ok=false
//
// Example route usage:
//   const { client, role, ok, error } = await scopedSupabaseFor({ email: userEmail });
//   if (!ok) return NextResponse.json({ error }, { status: 401 });
//   if (role !== 'insurer_readonly') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
//   const { data } = await client.from('claims').select(...);
// -----------------------------------------------------------------------------
export async function scopedSupabaseFor({ email }) {
  if (!email) {
    return {
      client: null,
      role: null,
      ok: false,
      error: 'email is required to establish a scoped session',
    };
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    db: { schema: 'public' },
  });

  // Establish the session GUCs. set_session_user is SECURITY DEFINER so
  // anon-key callers can invoke it. Returns the role string or null.
  const { data: role, error } = await client.rpc('set_session_user', {
    p_email: String(email).trim(),
  });

  if (error) {
    return { client: null, role: null, ok: false, error: error.message };
  }
  if (!role) {
    return {
      client: null,
      role: null,
      ok: false,
      error: 'Account not found or inactive',
    };
  }

  return { client, role, ok: true, error: null };
}

// -----------------------------------------------------------------------------
// scopedSupabaseFromRequest — convenience that pulls the email from
// the X-User-Email header. Mirrors the shape of requireSurveyorRequest
// in lib/auth/insurer.js.
// -----------------------------------------------------------------------------
export async function scopedSupabaseFromRequest(request) {
  const email = request?.headers?.get?.('x-user-email') || '';
  if (!email) {
    return { client: null, role: null, ok: false, error: 'Authentication required' };
  }
  return scopedSupabaseFor({ email });
}
