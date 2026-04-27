// Edge runtime Sentry init (middleware + edge API routes).
// Most of our routes are nodejs runtime so this is mostly inert,
// but keeping it set up so adding edge routes later is one less step.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}
