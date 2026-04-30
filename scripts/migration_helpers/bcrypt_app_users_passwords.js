#!/usr/bin/env node
// =============================================================================
// scripts/migration_helpers/bcrypt_app_users_passwords.js
// =============================================================================
// Idempotent backfill: bcrypt-hashes any app_users row whose password_hash is
// still stored as plain text. Skips rows that already start with $2a$/$2b$/$2y$.
//
// Why a separate script when the login route already rehashes on first login?
//   - Some users never log in again (deactivated, role changed, vendor seeds).
//     Without this backfill those rows remain plain text indefinitely.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=...  \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/migration_helpers/bcrypt_app_users_passwords.js [--apply]
//
// Default is dry-run: prints what would change. Pass --apply to write.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;
const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

function isBcryptHash(value) {
  if (typeof value !== 'string' || value.length < 7) return false;
  return BCRYPT_PREFIXES.some((p) => value.startsWith(p));
}

async function main() {
  console.log(`[backfill] mode = ${apply ? 'APPLY' : 'DRY-RUN'}`);

  const { data: users, error } = await supabase
    .from('app_users')
    .select('id, email, name, password_hash')
    .order('id', { ascending: true });

  if (error) {
    console.error('[backfill] query failed:', error.message);
    process.exit(1);
  }

  let already = 0;
  let toMigrate = 0;
  let migrated = 0;
  let failed = 0;

  for (const user of users) {
    if (isBcryptHash(user.password_hash)) {
      already += 1;
      continue;
    }
    toMigrate += 1;
    console.log(`  - id=${user.id} ${user.email || user.name} :: legacy plain text`);

    if (!apply) continue;

    try {
      const newHash = await bcrypt.hash(user.password_hash, BCRYPT_COST);
      const { error: updErr } = await supabase
        .from('app_users')
        .update({ password_hash: newHash })
        .eq('id', user.id);
      if (updErr) {
        failed += 1;
        console.error(`    ! update failed for id=${user.id}: ${updErr.message}`);
      } else {
        migrated += 1;
      }
    } catch (e) {
      failed += 1;
      console.error(`    ! hash failed for id=${user.id}:`, e);
    }
  }

  console.log('');
  console.log(`[backfill] total=${users.length} already_bcrypt=${already} legacy=${toMigrate} migrated=${migrated} failed=${failed}`);
  if (!apply && toMigrate > 0) {
    console.log('[backfill] dry-run only. re-run with --apply to write changes.');
  }
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});
