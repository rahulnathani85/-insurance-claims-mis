// =============================================================================
// lib/passwords.js
// =============================================================================
// Password hashing + verification for app_users.
//
// History: passwords were stored as plain text in app_users.password_hash until
// the bcrypt migration. To avoid forcing every user to reset their password,
// verifyPassword() falls back to plain-text equality when the stored value is
// not a bcrypt hash, and the caller is expected to re-hash on first successful
// login (see app/api/auth/login/route.js).
//
// New writes (user create / password change) MUST go through hashPassword()
// so they land as bcrypt from day one.
// =============================================================================

import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

// Bcrypt hashes always start with one of these prefixes.
// Anything else is treated as legacy plain text.
const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

export function isBcryptHash(value) {
  if (typeof value !== 'string' || value.length < 7) return false;
  return BCRYPT_PREFIXES.some((p) => value.startsWith(p));
}

export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

// Returns { ok: boolean, needsRehash: boolean }.
//
// needsRehash is true when the stored value matched but was not a bcrypt hash
// (i.e. legacy plain text). The caller should re-store the bcrypt hash.
export async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') {
    return { ok: false, needsRehash: false };
  }

  if (isBcryptHash(stored)) {
    const ok = await bcrypt.compare(plain, stored);
    return { ok, needsRehash: false };
  }

  // Legacy plain-text fallback. Constant-time comparison would be safer in
  // theory, but these rows already exist in the clear in the database — the
  // attack surface is the DB, not a timing side-channel on the API.
  const ok = stored === plain;
  return { ok, needsRehash: ok };
}
