// ============================================================
// lib/comms/pubsubVerify.js
// ------------------------------------------------------------
// Stage 4 — verifies the OIDC JWT that Google Pub/Sub Push
// attaches to each delivery (Authorization: Bearer <jwt>).
//
// Without verification, anyone who learns the webhook URL could
// POST fake "new email" notifications and trigger ingest. The
// JWT proves the request really came from Google's Pub/Sub
// service.
//
// Verification rules (per Google's OIDC docs):
//   1. alg must be RS256 (reject 'none' and HS* variants)
//   2. iss must be 'https://accounts.google.com' or
//      'accounts.google.com'
//   3. aud must equal GMAIL_PUBSUB_VERIFIER_AUDIENCE env var
//      (set to the webhook URL when the subscription was created)
//   4. exp must be in the future
//   5. iat must not be in the future
//   6. signature must verify against the Google public key whose
//      kid matches the JWT header's kid
//
// We pull Google's certs from the JWKS endpoint and cache them
// in-process for 1 hour (Google rotates ~daily but the same kid
// stays valid for the rotation window).
//
// Implemented with Node's built-in `crypto` (no extra dependency).
// ============================================================

import crypto from 'node:crypto';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ALLOWED_ALG = 'RS256';
const ALLOWED_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);
const CLOCK_SKEW_SEC = 60; // tolerate small clock drift

let _jwksCache = null;
let _jwksCachedAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getGoogleKeys() {
  const now = Date.now();
  if (_jwksCache && now - _jwksCachedAt < JWKS_TTL_MS) {
    return _jwksCache;
  }
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) {
    throw new Error(`Google JWKS fetch failed: ${res.status}`);
  }
  const data = await res.json();
  _jwksCache = data?.keys || [];
  _jwksCachedAt = now;
  return _jwksCache;
}

function findKey(keys, kid) {
  return (keys || []).find((k) => k.kid === kid) || null;
}

function base64UrlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

// ------------------------------------------------------------
// verifyPubsubJwt(token, expectedAudience)
//
// Returns the decoded payload on success.
// Throws Error with a descriptive message on any failure.
// ------------------------------------------------------------
export async function verifyPubsubJwt(token, expectedAudience) {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing JWT');
  }
  if (!expectedAudience) {
    throw new Error('expectedAudience required (set GMAIL_PUBSUB_VERIFIER_AUDIENCE env var)');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT (expected 3 dot-separated segments)');
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Header
  let header;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf-8'));
  } catch {
    throw new Error('Malformed JWT header');
  }
  if (header.alg !== ALLOWED_ALG) {
    throw new Error(`JWT alg must be ${ALLOWED_ALG}, got '${header.alg}'`);
  }
  if (!header.kid) {
    throw new Error('JWT header missing kid');
  }

  // 2. Payload
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf-8'));
  } catch {
    throw new Error('Malformed JWT payload');
  }

  // 3. Claims
  if (!ALLOWED_ISSUERS.has(payload.iss)) {
    throw new Error(`JWT iss '${payload.iss}' not allowed`);
  }
  if (payload.aud !== expectedAudience) {
    throw new Error(`JWT aud '${payload.aud}' does not match expected '${expectedAudience}'`);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SEC < nowSec) {
    throw new Error('JWT expired');
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_SEC > nowSec) {
    throw new Error('JWT issued in the future');
  }

  // 4. Signature
  const keys = await getGoogleKeys();
  const jwk = findKey(keys, header.kid);
  if (!jwk) {
    // Try a forced refresh in case Google just rotated.
    _jwksCache = null;
    const refreshedKeys = await getGoogleKeys();
    const refreshedJwk = findKey(refreshedKeys, header.kid);
    if (!refreshedJwk) {
      throw new Error(`No Google public key matches kid '${header.kid}'`);
    }
    return verifyWithJwk(refreshedJwk, headerB64, payloadB64, signatureB64, payload);
  }

  return verifyWithJwk(jwk, headerB64, payloadB64, signatureB64, payload);
}

function verifyWithJwk(jwk, headerB64, payloadB64, signatureB64, payload) {
  // Node 16+ supports importing JWK keys directly into the crypto module.
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (err) {
    throw new Error(`Failed to import Google public key: ${err.message}`);
  }

  const signedPayload = `${headerB64}.${payloadB64}`;
  const signatureBytes = base64UrlDecode(signatureB64);

  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(signedPayload, 'utf-8'),
    publicKey,
    signatureBytes
  );

  if (!valid) {
    throw new Error('JWT signature invalid');
  }

  return payload;
}

// ------------------------------------------------------------
// extractBearerToken(request)
// Pull the Bearer token from the Authorization header. Throws
// if missing or malformed.
// ------------------------------------------------------------
export function extractBearerToken(request) {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Missing or malformed Authorization: Bearer header');
  }
  return token;
}
