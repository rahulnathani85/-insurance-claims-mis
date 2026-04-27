// ============================================================
// lib/observability.js
// ------------------------------------------------------------
// Thin wrapper around Sentry so our app code doesn't import the
// SDK directly. Two benefits:
//   1. If Sentry isn't configured (no DSN), every call is a no-op
//      — no need to gate every call site with `if (dsn)`.
//   2. We can swap providers later (Datadog, Honeycomb, etc.)
//      by changing this one file.
//
// Usage:
//   import { captureError, addBreadcrumb } from '@/lib/observability';
//   try { ... } catch (err) {
//     captureError(err, { area: 'comms-ingest', message_id });
//     throw err; // still rethrow if you want callers to know
//   }
// ============================================================

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
const enabled = !!dsn;

export function captureError(error, context = {}) {
  // Always log to console so local dev / Vercel logs still see it.
  console.error('[error]', context.area || '', error?.message || error, context);

  if (!enabled) return;

  Sentry.withScope((scope) => {
    if (context.area) scope.setTag('area', context.area);
    if (context.user_email) scope.setUser({ email: context.user_email });
    if (context.company) scope.setTag('company', context.company);
    Object.entries(context).forEach(([k, v]) => {
      if (k !== 'area' && k !== 'user_email' && k !== 'company') {
        scope.setExtra(k, v);
      }
    });
    Sentry.captureException(error);
  });
}

export function captureMessage(message, level = 'warning', context = {}) {
  console.warn('[message]', context.area || '', message, context);

  if (!enabled) return;

  Sentry.withScope((scope) => {
    if (context.area) scope.setTag('area', context.area);
    Object.entries(context).forEach(([k, v]) => {
      if (k !== 'area') scope.setExtra(k, v);
    });
    Sentry.captureMessage(message, level);
  });
}

export function addBreadcrumb({ category, message, data, level = 'info' }) {
  if (!enabled) return;
  Sentry.addBreadcrumb({ category, message, data, level });
}
