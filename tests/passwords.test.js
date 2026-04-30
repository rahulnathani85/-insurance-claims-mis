// =============================================================================
// tests/passwords.test.js
// =============================================================================
// Unit tests for lib/passwords.js — bcrypt helpers + transparent legacy
// plain-text fallback.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, isBcryptHash } from '../lib/passwords.js';

describe('isBcryptHash', () => {
  it('detects bcrypt hashes', () => {
    expect(isBcryptHash('$2a$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isBcryptHash('$2y$10$abcdefghijklmnopqrstuv')).toBe(true);
  });

  it('rejects plain-text passwords', () => {
    expect(isBcryptHash('admin123')).toBe(false);
    expect(isBcryptHash('password')).toBe(false);
    expect(isBcryptHash('')).toBe(false);
    expect(isBcryptHash(null)).toBe(false);
    expect(isBcryptHash(undefined)).toBe(false);
    expect(isBcryptHash(12345)).toBe(false);
  });
});

describe('hashPassword', () => {
  it('produces a bcrypt hash', async () => {
    const hash = await hashPassword('hunter2');
    expect(isBcryptHash(hash)).toBe(true);
    expect(hash.length).toBeGreaterThanOrEqual(60);
  });

  it('produces a different hash for the same password (salt)', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a).not.toBe(b);
  });

  it('throws on empty / non-string input', async () => {
    await expect(hashPassword('')).rejects.toThrow();
    await expect(hashPassword(null)).rejects.toThrow();
    await expect(hashPassword(undefined)).rejects.toThrow();
    await expect(hashPassword(12345)).rejects.toThrow();
  });
});

describe('verifyPassword', () => {
  it('verifies a correct bcrypt password', async () => {
    const hash = await hashPassword('hunter2');
    const { ok, needsRehash } = await verifyPassword('hunter2', hash);
    expect(ok).toBe(true);
    expect(needsRehash).toBe(false);
  });

  it('rejects a wrong bcrypt password', async () => {
    const hash = await hashPassword('hunter2');
    const { ok, needsRehash } = await verifyPassword('wrongpass', hash);
    expect(ok).toBe(false);
    expect(needsRehash).toBe(false);
  });

  it('verifies legacy plain-text and flags for rehash', async () => {
    const { ok, needsRehash } = await verifyPassword('admin123', 'admin123');
    expect(ok).toBe(true);
    expect(needsRehash).toBe(true);
  });

  it('rejects a wrong legacy plain-text password', async () => {
    const { ok, needsRehash } = await verifyPassword('wrongpass', 'admin123');
    expect(ok).toBe(false);
    expect(needsRehash).toBe(false);
  });

  it('handles non-string input safely', async () => {
    expect(await verifyPassword(null, 'admin123')).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPassword('admin123', null)).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPassword(undefined, undefined)).toEqual({ ok: false, needsRehash: false });
  });
});
