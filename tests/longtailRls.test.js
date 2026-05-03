// =============================================================================
// tests/longtailRls.test.js
// =============================================================================
// Static shape verification for the Phase 3b RLS migrations:
//
//   supabase/migrations/20260503060000_longtail_rls_internal.sql   (refuse-all)
//   supabase/migrations/20260503070000_longtail_rls_visible.sql    (parent-claim scoped)
//
// We can't run real RLS in CI (no Postgres), so these tests are file-level
// guards that catch the dumb mistakes we've actually shipped before:
//
//   - Forgetting to DROP the permissive `Allow all access to X` baseline
//     before adding restrictive policies (would silently leave the table
//     wide open since the most-permissive policy wins).
//   - Forgetting WITH CHECK on a write policy (Postgres allows the write
//     but blocks the read-back, leading to confusing errors in routes).
//   - Typing the GUC role wrong (e.g. 'insurer_read_only' vs the canonical
//     'insurer_readonly') — would silently never match.
//   - Missing `ENABLE ROW LEVEL SECURITY` on the older tables that never
//     had RLS turned on (claim_messages / claim_ai_conversations /
//     survey_fee_bills / claim_documents).
//
// If a future hand-edit weakens any of these, the tests fail loudly.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const internalSql = readFileSync(
  join(MIGRATIONS_DIR, '20260503060000_longtail_rls_internal.sql'),
  'utf8'
);
const visibleSql = readFileSync(
  join(MIGRATIONS_DIR, '20260503070000_longtail_rls_visible.sql'),
  'utf8'
);

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/**
 * Find a CREATE POLICY block by name and return the lines from the
 * CREATE POLICY through the next semicolon (stripped).
 */
function findPolicy(sql, policyName) {
  const re = new RegExp(
    `CREATE POLICY\\s+"${policyName}"[^;]*;`,
    's'
  );
  const m = sql.match(re);
  return m ? m[0] : null;
}

/** Did the migration drop the legacy permissive baseline by name? */
function hasDropPermissive(sql, table) {
  return new RegExp(
    `DROP POLICY IF EXISTS "Allow all access to ${table}" ON public\\.${table};`
  ).test(sql);
}

/** Did the migration enable RLS on a table that didn't have it before? */
function hasEnableRls(sql, table) {
  return new RegExp(
    `ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`
  ).test(sql);
}

// -----------------------------------------------------------------------------
// 20260503060000_longtail_rls_internal.sql — refuse-all tables
// -----------------------------------------------------------------------------

describe('Phase 3b-1 internal-only RLS migration', () => {

  // 5 tables had explicit "Allow all access to X" baselines that must be dropped.
  const TABLES_WITH_BASELINE = [
    'claim_chat_messages',
    'marine_loss_sheets',
    'marine_loss_sheet_items',
    'loss_sheets',
    'loss_sheet_items',
  ];

  // 4 older tables never had RLS enabled — the migration must turn it on.
  const TABLES_NEEDING_ENABLE = [
    'claim_messages',
    'claim_ai_conversations',
    'survey_fee_bills',
    'claim_documents',
  ];

  const ALL_TABLES = [...TABLES_WITH_BASELINE, ...TABLES_NEEDING_ENABLE];

  it.each(TABLES_WITH_BASELINE)(
    'drops the "Allow all access to %s" permissive baseline',
    (table) => {
      expect(hasDropPermissive(internalSql, table)).toBe(true);
    }
  );

  it.each(TABLES_NEEDING_ENABLE)(
    'enables RLS on %s (older table — never had RLS turned on)',
    (table) => {
      expect(hasEnableRls(internalSql, table)).toBe(true);
    }
  );

  it.each(ALL_TABLES)(
    'creates a refuse-insurer FOR ALL policy on %s',
    (table) => {
      const policy = findPolicy(internalSql, `${table}_rls_no_insurer`);
      expect(policy, `expected ${table}_rls_no_insurer policy`).not.toBeNull();
      expect(policy).toMatch(/FOR ALL/);
      // Both USING and WITH CHECK must reference the canonical role string.
      expect(policy).toMatch(
        /USING\s*\(\s*public\.current_user_role\(\)\s+IS DISTINCT FROM\s+'insurer_readonly'\s*\)/
      );
      expect(policy).toMatch(
        /WITH CHECK\s*\(\s*public\.current_user_role\(\)\s+IS DISTINCT FROM\s+'insurer_readonly'\s*\)/
      );
    }
  );

  it('does not accidentally use the wrong role spelling', () => {
    // Common typos that would silently never match.
    expect(internalSql).not.toMatch(/insurer_read_only/);
    expect(internalSql).not.toMatch(/InsurerReadOnly/);
    expect(internalSql).not.toMatch(/insurerReadonly/);
  });

  it('uses IS DISTINCT FROM (NULL-safe), not <>', () => {
    // <> against a NULL role would refuse even surveyor flows.
    // Only the rollback comment block is allowed to mention <>.
    const codeOnly = internalSql.split(/^-- ====/m)[1] || internalSql;
    expect(codeOnly).not.toMatch(/current_user_role\(\)\s*<>/);
  });
});

// -----------------------------------------------------------------------------
// 20260503070000_longtail_rls_visible.sql — partially-visible tables
// -----------------------------------------------------------------------------

describe('Phase 3b-2 partially-visible RLS migration', () => {

  // Each of these tables has 4 policies (SELECT/INSERT/UPDATE/DELETE).
  const TABLES = ['site_visits', 'ila_drafts', 'ila_submissions'];

  it.each(TABLES)('drops the "Allow all access to %s" baseline', (table) => {
    expect(hasDropPermissive(visibleSql, table)).toBe(true);
  });

  it.each(TABLES)(
    'creates a SELECT policy on %s scoped via parent claim',
    (table) => {
      const policy = findPolicy(visibleSql, `${table}_rls_select`);
      expect(policy, `expected ${table}_rls_select`).not.toBeNull();
      expect(policy).toMatch(/FOR SELECT/);
      // Surveyor branch
      expect(policy).toMatch(
        /current_user_role\(\)\s+IS DISTINCT FROM\s+'insurer_readonly'/
      );
      // Insurer branch — joins to claims via claim_id and matches insurer_name
      expect(policy).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM public\.claims c/);
      expect(policy).toMatch(new RegExp(`c\\.id = ${table}\\.claim_id`));
      expect(policy).toMatch(
        /c\.insurer_name = public\.current_user_insurer_name\(\)/
      );
    }
  );

  it.each(TABLES)(
    'creates INSERT/UPDATE/DELETE policies on %s that refuse insurers',
    (table) => {
      const insertPol = findPolicy(visibleSql, `${table}_rls_insert`);
      const updatePol = findPolicy(visibleSql, `${table}_rls_update`);
      const deletePol = findPolicy(visibleSql, `${table}_rls_delete`);

      expect(insertPol).not.toBeNull();
      expect(updatePol).not.toBeNull();
      expect(deletePol).not.toBeNull();

      // INSERT must have WITH CHECK; bare WITH CHECK on row predicate
      expect(insertPol).toMatch(/FOR INSERT/);
      expect(insertPol).toMatch(
        /WITH CHECK\s*\(\s*public\.current_user_role\(\)\s+IS DISTINCT FROM\s+'insurer_readonly'\s*\)/
      );

      // UPDATE needs both USING (existing row) and WITH CHECK (new row)
      expect(updatePol).toMatch(/FOR UPDATE/);
      expect(updatePol).toMatch(
        /USING\s*\(\s*public\.current_user_role\(\)\s+IS DISTINCT FROM\s+'insurer_readonly'\s*\)/
      );
      expect(updatePol).toMatch(
        /WITH CHECK\s*\(\s*public\.current_user_role\(\)\s+IS DISTINCT FROM\s+'insurer_readonly'\s*\)/
      );

      // DELETE only needs USING
      expect(deletePol).toMatch(/FOR DELETE/);
      expect(deletePol).toMatch(
        /USING\s*\(\s*public\.current_user_role\(\)\s+IS DISTINCT FROM\s+'insurer_readonly'\s*\)/
      );
    }
  );

  it('ila_drafts SELECT additionally restricts to status = approved', () => {
    // Mirrors the claim_fsr_drafts pattern from Phase 3a — works-in-progress
    // drafts must stay invisible to insurers.
    const policy = findPolicy(visibleSql, 'ila_drafts_rls_select');
    expect(policy).toMatch(/status\s*=\s*'approved'/);
  });

  it('site_visits / ila_submissions SELECT do NOT add a status filter', () => {
    // Sanity: only ila_drafts has a status filter. site_visits and
    // ila_submissions surface every row that belongs to the insurer.
    const sv = findPolicy(visibleSql, 'site_visits_rls_select');
    const ils = findPolicy(visibleSql, 'ila_submissions_rls_select');
    expect(sv).not.toMatch(/status\s*=/);
    expect(ils).not.toMatch(/status\s*=/);
  });

  it('does not accidentally use the wrong role spelling', () => {
    expect(visibleSql).not.toMatch(/insurer_read_only/);
  });
});
