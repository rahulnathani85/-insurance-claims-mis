'use client';
// =============================================================================
// lib/api/authedFetch.js
// =============================================================================
// Phase 2 thin client-side fetch wrapper that auto-attaches the active
// user's email as an X-User-Email header. The server-side helper
// `requireSurveyorRequest` (lib/auth/insurer.js) reads the header to
// refuse mutation calls from insurer_readonly principals.
//
// Why a header rather than the request body:
//   - Some routes don't accept a body (DELETE)
//   - Some routes already have a complex body shape and we don't want
//     to grow it further with an `acting_user_email`
//   - A header is a uniform mechanism — easy for Phase 3 to extend
//     into a real JWT
//
// When the user isn't logged in (e.g. unauthenticated fetch on /login)
// the header is just omitted and the server's other auth paths apply.
//
// Drop-in replacement for global fetch:
//
//   import { authedFetch } from '@/lib/api/authedFetch';
//
//   const res = await authedFetch('/api/claims/258', {
//     method: 'PUT',
//     body: JSON.stringify({ ... }),
//   });
//
// Headers passed via init.headers are merged on top of the auth header,
// so Content-Type etc. work normally.
// =============================================================================

export async function authedFetch(input, init = {}) {
  const headers = { ...(init.headers || {}) };
  // Body-bearing methods need Content-Type unless the caller sets it
  // (FormData skips it deliberately; we don't override).
  if (init.body && typeof init.body === 'string' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Read the active session — synchronous since sessionStorage is
  // available on the client.
  let userEmail = '';
  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage?.getItem('mis_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.email) userEmail = String(parsed.email);
      }
    } catch {
      // Corrupt session — let it through unauthenticated.
    }
  }

  if (userEmail && !headers['X-User-Email'] && !headers['x-user-email']) {
    headers['X-User-Email'] = userEmail;
  }

  return fetch(input, { ...init, headers });
}

// useAuthedFetch — hook variant that returns the bare authedFetch.
// Provided for consistency with other auth-aware hooks; the function
// is stateless so this is purely an ergonomic wrapper.
export function useAuthedFetch() {
  return authedFetch;
}
