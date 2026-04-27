// Node.js / serverless functions Sentry init.
// Catches API route errors, cron failures, and Supabase issues.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    // Don't capture every console.warn — just errors and explicit captures.
    beforeSend(event) {
      if (event.level === 'log' || event.level === 'info') return null;
      return event;
    },
  });
}
