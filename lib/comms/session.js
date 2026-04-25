// ============================================================
// lib/comms/session.js
// ------------------------------------------------------------
// Lightweight request-auth helpers used by Comms API routes.
// Reads the user email from the `x-app-user-email` header that
// the Communications UI includes on every request (populated
// from AuthContext on the client side).
//
// This is intentionally scoped to the Comms module so it does
// not introduce a global change to existing routes. A portal-
// wide requireSession() helper is tracked separately as a
// security-hardening todo.
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const HEADER_NAME = 'x-app-user-email';

// ------------------------------------------------------------
// getRequestingUser(request)
// Returns the app_users row matching the header email, or null.
// ------------------------------------------------------------
export async function getRequestingUser(request) {
  const email = request.headers.get(HEADER_NAME);
  if (!email) return null;
  const { data, error } = await supabaseAdmin
    .from('app_users')
    .select('id, email, name, role, company, is_active')
    .eq('email', email)
    .maybeSingle();
  if (error || !data) return null;
  if (data.is_active === false) return null;
  return data;
}

// ------------------------------------------------------------
// requireUser(request)
// Returns either { user } or { errorResponse: NextResponse } —
// caller short-circuits on errorResponse.
//
// Usage:
//   const gate = await requireUser(request);
//   if (gate.errorResponse) return gate.errorResponse;
//   const user = gate.user;
// ------------------------------------------------------------
export async function requireUser(request) {
  const user = await getRequestingUser(request);
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Not signed in. Refresh the page and try again.' },
        { status: 401 }
      ),
    };
  }
  return { user };
}

// ------------------------------------------------------------
// requireAdmin(request)
// Like requireUser but also checks role.
// ------------------------------------------------------------
export async function requireAdmin(request) {
  const gate = await requireUser(request);
  if (gate.errorResponse) return gate;
  const role = String(gate.user.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'super_admin') {
    return {
      errorResponse: NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 }
      ),
    };
  }
  return { user: gate.user };
}

// ------------------------------------------------------------
// requireCronSecret(request)
// For the cron endpoints. Checks Authorization: Bearer ${secret}.
//
// Accepts EITHER of two env vars so deployments can pick:
//   COMMS_CRON_SECRET — module-scoped (preferred for blast-radius isolation)
//   CRON_SECRET       — the default Vercel Cron injects when set as env var
// Using CRON_SECRET alone is the easiest path on Vercel: Vercel Cron
// automatically sends "Authorization: Bearer ${CRON_SECRET}" if that env
// var is defined, with no additional config needed.
// ------------------------------------------------------------
export function requireCronSecret(request) {
  const secret = process.env.COMMS_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET (or COMMS_CRON_SECRET) not configured on server' },
      { status: 500 }
    );
  }
  const auth = request.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // OK
}
