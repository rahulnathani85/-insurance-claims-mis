/**
 * apiGateway.js — server-only helper for calls to the VPS file-server (port 4000)
 * and puppeteer-server (port 4001).
 *
 * Centralizes three concerns:
 *   1. URL resolution   — FILE_SERVER_URL and PUPPETEER_URL
 *   2. Auth headers     — X-API-Key + X-Gateway-Auth
 *   3. Gateway vs direct — same origin when going through Nginx (api.nisla.in),
 *                          separate :4000/:4001 ports in local dev
 *
 * Do NOT import this in any client component — FILE_SERVER_KEY and
 * GATEWAY_AUTH_SECRET must never ship in the browser bundle.
 *
 * Env vars:
 *   FILE_SERVER_URL          — preferred, server-only. e.g. https://api.nisla.in
 *   NEXT_PUBLIC_FILE_SERVER_URL — legacy fallback, may be http://ip:4000 for /browse.
 *   FILE_SERVER_KEY          — server-only API key shared with both services.
 *   GATEWAY_AUTH_SECRET      — server-only shared secret with Nginx gateway.
 *                              If unset, no gateway header is sent (direct-mode dev).
 *
 * URL routing:
 *   • HTTPS gateway (starts with https://) — puppeteer is on the same origin; Nginx
 *     routes /api/html-to-(pdf|docx) → :4001 and everything else /api/* → :4000.
 *   • Plain HTTP dev — :4000 becomes :4001 for puppeteer by string replace, matching
 *     the old direct-access behaviour.
 */

const FILE_SERVER_URL =
  process.env.FILE_SERVER_URL ||
  process.env.NEXT_PUBLIC_FILE_SERVER_URL ||
  'http://localhost:4000';

// When the URL is HTTPS we're going through the Nginx gateway — same origin for
// both services, Nginx dispatches by path. Otherwise we're in direct-dev mode
// where the puppeteer service listens on the next port (:4000 → :4001).
const PUPPETEER_URL = FILE_SERVER_URL.startsWith('https://')
  ? FILE_SERVER_URL
  : FILE_SERVER_URL.replace(':4000', ':4001');

const FILE_SERVER_KEY = process.env.FILE_SERVER_KEY || '';
const GATEWAY_AUTH_SECRET = process.env.GATEWAY_AUTH_SECRET || '';

/**
 * Build headers for a call to the file-server or puppeteer-server.
 * Always attaches X-API-Key when set; attaches X-Gateway-Auth when set (only
 * required when going through the HTTPS Nginx gateway). Extra headers from
 * the caller (e.g. Content-Type) are merged on top.
 */
function buildHeaders(extra = {}) {
  const headers = { ...extra };
  if (FILE_SERVER_KEY) headers['X-API-Key'] = FILE_SERVER_KEY;
  if (GATEWAY_AUTH_SECRET) headers['X-Gateway-Auth'] = GATEWAY_AUTH_SECRET;
  return headers;
}

export {
  FILE_SERVER_URL,
  PUPPETEER_URL,
  FILE_SERVER_KEY,
  GATEWAY_AUTH_SECRET,
  buildHeaders,
};
