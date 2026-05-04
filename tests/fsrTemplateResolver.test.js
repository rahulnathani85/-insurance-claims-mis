// =============================================================================
// tests/fsrTemplateResolver.test.js
// =============================================================================
// Pure-logic tests for the FSR template resolver in lib/fsr/draft.js.
// The resolver gates FSR rendering through the lifecycle engine — see the
// migration `20260504173522_fsr_template_on_lifecycle.sql` for the data
// shape and the plan file `build-a-universal-3-office-melodic-pillow.md`
// for the soft-transition rationale.
//
// Mock supabase pattern mirrors tests/officesValidation.test.js — chainable
// builder returning canned rows, no real network.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  resolveFsrTemplateName,
  LIFECYCLE_GATE_CUTOFF_AT,
  renderDamagedItemsTable,
  renderLossSummaryTable,
} from '../lib/fsr/index.js';

// ---------- Mock supabase ----------

function makeMockSupabase({ lifecycleRows = {}, templateRows = {} }) {
  return {
    from(table) {
      if (table === 'claim_lifecycle') return makeKvBuilder(lifecycleRows);
      if (table === 'lifecycle_templates') return makeKvBuilder(templateRows);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// Tiny chainable builder that supports .select().eq(col, val).maybeSingle().
// `rows` is a map keyed by `${col}=${val}` returning the canned row, or null.
function makeKvBuilder(rows) {
  let filterKey = null;
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      filterKey = `${col}=${val}`;
      return builder;
    },
    maybeSingle: () => {
      const data = rows[filterKey] || null;
      return Promise.resolve({ data, error: null });
    },
  };
  return builder;
}

// ---------- Fixtures ----------

const POST_CUTOFF = '2026-06-01T00:00:00Z'; // strictly after LIFECYCLE_GATE_CUTOFF_AT
const PRE_CUTOFF = '2026-04-01T00:00:00Z';   // strictly before

function claimAt(createdAt, id = 1) {
  return { id, created_at: createdAt };
}

// ---------- resolveFsrTemplateName: override path ----------

describe('resolveFsrTemplateName — override path', () => {
  it('returns override when caller passes a non-Production templateName', async () => {
    const supabase = makeMockSupabase({});
    const r = await resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF), {
      requestedName: 'Custom_Template_X',
    });
    expect(r).toEqual({ templateName: 'Custom_Template_X', source: 'override' });
  });

  it('treats requestedName="Production" as the default (not an override)', async () => {
    // No lifecycle row, claim is post-cutoff → strict gate should trip.
    const supabase = makeMockSupabase({});
    await expect(
      resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF), { requestedName: 'Production' })
    ).rejects.toMatchObject({ code: 'LIFECYCLE_NOT_INITIALIZED', statusCode: 409 });
  });

  it('treats no requestedName the same as "Production"', async () => {
    const supabase = makeMockSupabase({});
    await expect(
      resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF), {})
    ).rejects.toMatchObject({ code: 'LIFECYCLE_NOT_INITIALIZED' });
  });
});

// ---------- resolveFsrTemplateName: lifecycle-driven path ----------

describe('resolveFsrTemplateName — lifecycle-driven', () => {
  it('returns the template the lifecycle points at', async () => {
    const supabase = makeMockSupabase({
      lifecycleRows: { 'claim_id=42': { id: 7, template_id: 99 } },
      templateRows: {
        'id=99': {
          id: 99,
          template_code: 'marine_ultratech',
          fsr_template_name: 'Ultratech_Marine_Cargo_v1',
        },
      },
    });
    const r = await resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF, 42));
    expect(r).toEqual({
      templateName: 'Ultratech_Marine_Cargo_v1',
      source: 'lifecycle',
      lifecycleTemplateId: 99,
      lifecycleTemplateCode: 'marine_ultratech',
    });
  });

  it('lifecycle path wins regardless of cutoff', async () => {
    const supabase = makeMockSupabase({
      lifecycleRows: { 'claim_id=42': { id: 7, template_id: 99 } },
      templateRows: {
        'id=99': { id: 99, template_code: 'foo', fsr_template_name: 'Custom' },
      },
    });
    // Pre-cutoff claim — but lifecycle is set, so we still use it.
    const r = await resolveFsrTemplateName(supabase, claimAt(PRE_CUTOFF, 42));
    expect(r.source).toBe('lifecycle');
    expect(r.templateName).toBe('Custom');
  });
});

// ---------- resolveFsrTemplateName: legacy soft-transition ----------

describe('resolveFsrTemplateName — legacy soft-transition', () => {
  it('falls back to Production for pre-cutoff claim with no lifecycle', async () => {
    const supabase = makeMockSupabase({});
    const r = await resolveFsrTemplateName(supabase, claimAt(PRE_CUTOFF, 42));
    expect(r.templateName).toBe('Production');
    expect(r.source).toBe('legacy');
    expect(r.warning).toMatch(/no lifecycle initialized/);
    expect(r.warning).toMatch(/42/);
  });

  it('falls back to Production for pre-cutoff claim with lifecycle missing fsr_template_name', async () => {
    const supabase = makeMockSupabase({
      lifecycleRows: { 'claim_id=42': { id: 7, template_id: 99 } },
      templateRows: {
        // Lifecycle template exists but fsr_template_name is null.
        'id=99': { id: 99, template_code: 'foo', fsr_template_name: null },
      },
    });
    const r = await resolveFsrTemplateName(supabase, claimAt(PRE_CUTOFF, 42));
    expect(r.templateName).toBe('Production');
    expect(r.source).toBe('legacy');
    expect(r.warning).toMatch(/no fsr_template_name/);
    expect(r.warning).toMatch(/42/);
  });

  it('legacy fallback does not throw', async () => {
    const supabase = makeMockSupabase({});
    await expect(
      resolveFsrTemplateName(supabase, claimAt(PRE_CUTOFF))
    ).resolves.toBeDefined();
  });
});

// ---------- resolveFsrTemplateName: strict gate ----------

describe('resolveFsrTemplateName — strict gate (post-cutoff)', () => {
  it('throws LIFECYCLE_NOT_INITIALIZED when no lifecycle row exists', async () => {
    const supabase = makeMockSupabase({});
    await expect(
      resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF, 42))
    ).rejects.toMatchObject({
      code: 'LIFECYCLE_NOT_INITIALIZED',
      statusCode: 409,
    });
  });

  it('error message guides the user to initialize lifecycle', async () => {
    const supabase = makeMockSupabase({});
    try {
      await resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF, 42));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.message).toMatch(/Initialize the lifecycle/i);
      expect(e.message).toMatch(/attach a lifecycle template/i);
    }
  });

  it('throws FSR_TEMPLATE_NOT_CONFIGURED when lifecycle exists but template lacks fsr_template_name', async () => {
    const supabase = makeMockSupabase({
      lifecycleRows: { 'claim_id=42': { id: 7, template_id: 99 } },
      templateRows: {
        'id=99': { id: 99, template_code: 'something', fsr_template_name: null },
      },
    });
    await expect(
      resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF, 42))
    ).rejects.toMatchObject({
      code: 'FSR_TEMPLATE_NOT_CONFIGURED',
      statusCode: 409,
    });
  });

  it('error message names the offending lifecycle template id', async () => {
    const supabase = makeMockSupabase({
      lifecycleRows: { 'claim_id=42': { id: 7, template_id: 99 } },
      templateRows: {
        'id=99': { id: 99, template_code: 'something', fsr_template_name: null },
      },
    });
    try {
      await resolveFsrTemplateName(supabase, claimAt(POST_CUTOFF, 42));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.message).toMatch(/id=99/);
    }
  });
});

// ---------- resolveFsrTemplateName: cutoff edge cases ----------

describe('resolveFsrTemplateName — cutoff edge cases', () => {
  it('exactly at cutoff is treated as post-cutoff (strict gate fires)', async () => {
    const supabase = makeMockSupabase({});
    // claim.created_at === LIFECYCLE_GATE_CUTOFF_AT — `<` makes this strict.
    await expect(
      resolveFsrTemplateName(supabase, claimAt(LIFECYCLE_GATE_CUTOFF_AT, 42))
    ).rejects.toMatchObject({ code: 'LIFECYCLE_NOT_INITIALIZED' });
  });

  it('claim with no created_at is treated as post-cutoff (strict)', async () => {
    const supabase = makeMockSupabase({});
    await expect(
      resolveFsrTemplateName(supabase, { id: 42 })
    ).rejects.toMatchObject({ code: 'LIFECYCLE_NOT_INITIALIZED' });
  });
});

// =============================================================================
// renderDamagedItemsTable / renderLossSummaryTable — Marine Cargo helpers
// =============================================================================

describe('renderDamagedItemsTable', () => {
  it('returns empty string for empty / non-array input', () => {
    expect(renderDamagedItemsTable([])).toBe('');
    expect(renderDamagedItemsTable(null)).toBe('');
    expect(renderDamagedItemsTable(undefined)).toBe('');
    expect(renderDamagedItemsTable('not an array')).toBe('');
  });

  it('renders one row per item with a totals tfoot', () => {
    const html = renderDamagedItemsTable([
      {
        invoice_no: '9858084683',
        description: 'HDPE PP Pack',
        pack_size: '50 kg',
        total_dispatched_bags: 32950,
        total_dispatched_mt: 1647.5,
        damaged_bags: 1322,
        damaged_mt: 66.1,
      },
    ]);
    expect(html).toContain('<table class="loss">');
    expect(html).toContain('9858084683');
    expect(html).toContain('HDPE PP Pack');
    expect(html).toContain('50 kg');
    expect(html).toContain('1322');         // damaged bags
    expect(html).toContain('66.100');       // damaged MT (3dp)
    expect(html).toContain('<tfoot>');
    expect(html).toContain('Total');
  });

  it('escapes HTML in user-supplied fields to block injection', () => {
    const html = renderDamagedItemsTable([
      { invoice_no: '<script>alert(1)</script>', description: 'X' },
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sums bags and MT across rows in the footer', () => {
    const html = renderDamagedItemsTable([
      { description: 'A', total_dispatched_bags: 100, total_dispatched_mt: 5,  damaged_bags: 10, damaged_mt: 0.5 },
      { description: 'B', total_dispatched_bags: 200, total_dispatched_mt: 10, damaged_bags: 20, damaged_mt: 1.0 },
    ]);
    // Total dispatched 300 bags, 15 MT; damaged 30 bags, 1.5 MT.
    expect(html).toMatch(/<strong>300<\/strong>/);
    expect(html).toMatch(/<strong>15\.000<\/strong>/);
    expect(html).toMatch(/<strong>30<\/strong>/);
    expect(html).toMatch(/<strong>1\.500<\/strong>/);
  });
});

describe('renderLossSummaryTable', () => {
  it('returns empty string for empty input', () => {
    expect(renderLossSummaryTable([])).toBe('');
  });

  it('computes weighted average extent across rows', () => {
    const html = renderLossSummaryTable([
      // weighted by damaged_mt: 18% × 60 + 30% × 40 = 10.8 + 12 = 22.8 / 100 = 22.8% → rounds to "23%"
      { description: 'A', damaged_bags: 600, damaged_mt: 60, extent_pct: 18, loss_allowed_bags: 108, loss_allowed_mt: 10.8 },
      { description: 'B', damaged_bags: 400, damaged_mt: 40, extent_pct: 30, loss_allowed_bags: 120, loss_allowed_mt: 12.0 },
    ]);
    expect(html).toContain('Average Percentage of Loss');
    expect(html).toMatch(/<strong>23%<\/strong>/);
  });

  it('falls back to simple mean when no MT weights', () => {
    const html = renderLossSummaryTable([
      { description: 'A', damaged_bags: 100, damaged_mt: 0, extent_pct: 10 },
      { description: 'B', damaged_bags: 100, damaged_mt: 0, extent_pct: 30 },
    ]);
    // Simple mean: (10+30)/2 = 20 → "20%"
    expect(html).toMatch(/<strong>20%<\/strong>/);
  });
});
