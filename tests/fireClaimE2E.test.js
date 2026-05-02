// =============================================================================
// tests/fireClaimE2E.test.js
// =============================================================================
// CLAUDE.md §11 #6 — end-to-end Fire claim test.
//
// Walks the full Fire-claim FSR pipeline as a single integration test:
//
//   1. Synthetic claim row + loss-sheet header (sum_insured + excess).
//   2. Three loss-sheet items: building / electronics / stock-raw-material —
//      each exercises a different depreciation curve from
//      config/depreciation.js. computeItem() runs over each.
//   3. summariseLossSheet() rolls items up to value_at_risk, gross_loss,
//      underinsurance_factor, adjusted_loss, net_payable.
//   4. buildContext() composes the {{...}} placeholder map for the Fire
//      Production template — claim columns + loss_sheet.* + ila.* + signer.*
//      + company.*.
//   5. renderFsrHtml() against a Fire-shaped template with all the major
//      placeholder slots used by 20260430210000_fsr_lob_templates'
//      'Fire Default' / 'Fire Production' rows.
//   6. Asserts the rendered HTML contains the expected INR amounts, the
//      underinsurance prose, the signer block, the loss-items table, and
//      that no `{{...}}` placeholder leaked through.
//
// Pure-JS — no Supabase, no fetch, no Anthropic. Everything is library
// code we already have unit tests for; this is the first test that
// exercises the *whole chain*.
//
// Why this matters: the "amber bar" gaps that surveyors see on the FSR
// panel come from missing loss_sheet.* placeholders. This test pins down
// the contract between summariseLossSheet() output keys and
// buildContext() / template `{{loss_sheet.*}}` keys, so a future change
// to either side that breaks the chain shows up loud here.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { computeItem, summariseLossSheet } from '../lib/lossSheet/index.js';
import { buildContext, renderFsrHtml } from '../lib/fsr/index.js';

// -----------------------------------------------------------------------------
// Synthetic claim — Fire claim at a textile godown, NISLA company.
// Numbers chosen to exercise underinsurance (SI < VAR) and the
// excess deduction.
// -----------------------------------------------------------------------------

const fireClaim = {
  id: 9999,
  ref_number: 'TEST/26-27/Fire',
  claim_number: 'NIA-FIRE-TEST-001',
  insurer_name: 'New India Assurance Co. Ltd.',
  insured_name: 'M/s SK Polyfoams (Test)',
  policy_number: 'TEST-POL-FIRE-001',
  lob: 'Fire',
  lob_subcategory: 'SFSP (Standard Fire & Special Perils)',
  date_loss: '2026-04-15',
  date_of_intimation: '2026-04-16',
  registered_at: '2026-04-17T03:00:00Z',
  policy_period_from: '2025-08-01',
  policy_period_to: '2026-07-31',
  loss_location: 'Plot 42, MIDC Phase II, Tarapur, Maharashtra',
  company: 'NISLA',
};

// Sum-insured deliberately below value-at-risk to trigger the
// underinsurance factor + adjusted-loss leg of the cascade.
const lossSheetHeader = {
  sum_insured: 50_00_000,        // Rs 50 lakh on the policy
  excess_amount: 25_000,
};

const ila = {
  preliminary_view: 'Fire originated in the godown\'s electrical panel and spread to adjacent stock racks before the fire brigade arrived.',
  admissibility_opinion: 'admissible_with_conditions',
  admissibility_reasoning: 'Loss is admissible subject to verification of the policy schedule and reinstatement of damaged stock.',
};

const signer = {
  name: 'Niteen Nathani',
  email: 'niteen@nisla.in',
  license_number: 'IRDAI/CORP/SLA-200025',
};

// Three items spanning the depreciation curves we care about
const itemInputs = [
  {
    item_no: 1,
    description: 'Office RCC structure (godown bay 2)',
    category: 'building_rcc',
    replacement_value: 30_00_000,    // Rs 30 lakh
    age_years: 8,                    // 1% × 8 = 8% dep
    salvage_value: 50_000,
    notes: 'Smoke + water damage to the eastern wall; structural integrity intact.',
  },
  {
    item_no: 2,
    description: 'Office computers + monitors (12 nos.)',
    category: 'computers_it',
    replacement_value: 6_00_000,     // Rs 6 lakh
    age_years: 3,                    // 20% × 3 = 60%
    salvage_value: 20_000,
    notes: 'All units charred beyond repair.',
  },
  {
    item_no: 3,
    description: 'Stock — raw polyfoam material',
    category: 'stock_raw_material',
    replacement_value: 25_00_000,    // Rs 25 lakh — never depreciates
    age_years: 0,
    salvage_value: 0,
  },
];

// -----------------------------------------------------------------------------
// Step 1 — compute per-item math
// -----------------------------------------------------------------------------

describe('Fire e2e — step 1: per-item depreciation', () => {
  it('Item 1 (building, 8y) depreciates ~8%', () => {
    const r = computeItem(itemInputs[0]);
    // 1%/yr × 8 yrs = 8%
    expect(r.depreciation_pct).toBeCloseTo(8, 1);
    // 30L × 0.92 = 27.6L
    expect(r.depreciated_value).toBeCloseTo(27_60_000, 0);
    expect(r.salvage_value).toBe(50_000);
    // 27.6L − 50k = 27,10,000
    expect(r.net_loss).toBeCloseTo(27_10_000, 0);
    expect(r.depreciation_source).toBe('auto');
  });

  it('Item 2 (computers, 3y) depreciates 60%', () => {
    const r = computeItem(itemInputs[1]);
    expect(r.depreciation_pct).toBeCloseTo(60, 1);
    // 6L × 0.40 = 2,40,000
    expect(r.depreciated_value).toBeCloseTo(2_40_000, 0);
    // 2.4L − 20k = 2,20,000
    expect(r.net_loss).toBeCloseTo(2_20_000, 0);
  });

  it('Item 3 (stock raw material) never depreciates', () => {
    const r = computeItem(itemInputs[2]);
    expect(r.depreciation_pct).toBe(0);
    expect(r.depreciated_value).toBe(25_00_000);
    expect(r.net_loss).toBe(25_00_000);
    expect(r.depreciation_source).toBe('auto');
  });

  it('caps salvage at depreciated value (no negative net loss)', () => {
    const r = computeItem({
      replacement_value: 1_00_000,
      age_years: 5,
      category: 'computers_it',  // 5y × 20% capped at 90% → dep'd value = 10k
      salvage_value: 50_000,     // would push net loss negative
    });
    expect(r.salvage_value).toBe(10_000);  // capped at depreciated value
    expect(r.net_loss).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Step 2 — summary (VAR / gross / underinsurance / adjusted / net payable)
// -----------------------------------------------------------------------------

describe('Fire e2e — step 2: claim-level summary', () => {
  // Pre-compute items once for the suite
  const items = itemInputs.map((input) => {
    const c = computeItem(input);
    return { ...input, ...c };
  });

  it('rolls VAR + gross_loss across all items', () => {
    const s = summariseLossSheet({
      items,
      sum_insured: lossSheetHeader.sum_insured,
      excess_amount: lossSheetHeader.excess_amount,
    });
    // VAR = 30L + 6L + 25L = 61L
    expect(s.value_at_risk).toBeCloseTo(61_00_000, 0);
    // Gross loss = 27.10L + 2.20L + 25L = 54.30L
    expect(s.gross_loss).toBeCloseTo(54_30_000, 0);
  });

  it('computes the underinsurance factor (SI 50L / VAR 61L = 0.819...)', () => {
    const s = summariseLossSheet({
      items,
      sum_insured: lossSheetHeader.sum_insured,
      excess_amount: lossSheetHeader.excess_amount,
    });
    expect(s.underinsurance_factor).toBeGreaterThan(0.819);
    expect(s.underinsurance_factor).toBeLessThan(0.820);
    // shortfall %
    expect(s.underinsurance_pct).toBeGreaterThan(18);
    expect(s.underinsurance_pct).toBeLessThan(19);
  });

  it('adjusted_loss = gross × factor, net_payable subtracts excess (floor 0)', () => {
    const s = summariseLossSheet({
      items,
      sum_insured: lossSheetHeader.sum_insured,
      excess_amount: lossSheetHeader.excess_amount,
    });
    // adjusted = 54.30L × 0.8197 ≈ 44.51L
    expect(s.adjusted_loss).toBeGreaterThan(44_45_000);
    expect(s.adjusted_loss).toBeLessThan(44_55_000);
    // net = adjusted − 25k excess
    expect(s.net_payable).toBe(Math.max(0, s.adjusted_loss - 25_000));
    expect(s.excess_applied).toBe(25_000);
  });

  it('skips underinsurance when SI ≥ VAR (no shortfall)', () => {
    const s = summariseLossSheet({
      items,
      sum_insured: 75_00_000,  // > VAR of 61L
      excess_amount: 25_000,
    });
    expect(s.underinsurance_factor).toBe(1);
    expect(s.adjusted_loss).toBe(s.gross_loss);
  });

  it('skips factor + adjusted=gross when SI is null', () => {
    const s = summariseLossSheet({
      items,
      sum_insured: null,
      excess_amount: 0,
    });
    expect(s.underinsurance_factor).toBeNull();
    expect(s.adjusted_loss).toBe(s.gross_loss);
    expect(s.net_payable).toBe(s.gross_loss);
  });
});

// -----------------------------------------------------------------------------
// Step 3 — buildContext + renderFsrHtml against a Fire-shaped template
// -----------------------------------------------------------------------------

describe('Fire e2e — step 3: render Fire FSR against the loss-sheet summary', () => {
  // Pre-compute items + sheet
  const items = itemInputs.map((input) => {
    const c = computeItem(input);
    return { ...input, ...c };
  });
  const summary = summariseLossSheet({
    items,
    sum_insured: lossSheetHeader.sum_insured,
    excess_amount: lossSheetHeader.excess_amount,
  });
  // The lossSheet object the renderer expects has the header inputs
  // PLUS the summary fields written back. recomputeSheet() does this in
  // production after every item mutation — here we mimic it inline.
  const lossSheet = {
    ...lossSheetHeader,
    ...summary,
  };

  // Trimmed Fire-shaped template that exercises every loss_sheet.*
  // placeholder + the {{loss_items_table}} special.
  const fireTemplate = {
    body_html: `<!DOCTYPE html>
<html><body>
  <h1>{{company.name}}</h1>
  <p>Ref: {{claim.ref_number}} · Date: {{date_today}}</p>
  <p>Insured: {{claim.insured_name}}</p>
  <p>Policy period: {{claim.policy_period_from}} to {{claim.policy_period_to}}</p>
  <h2>Loss summary</h2>
  <p>Sum insured: {{loss_sheet.sum_insured_inr}}</p>
  <p>Value at risk: {{loss_sheet.value_at_risk_inr}}</p>
  <p>Gross loss: {{loss_sheet.gross_loss_inr}}</p>
  <p>Underinsurance: {{loss_sheet.underinsurance_factor_pct}}</p>
  <p>{{loss_sheet.underinsurance_paragraph}}</p>
  <p>Adjusted loss: {{loss_sheet.adjusted_loss_inr}}</p>
  <p>Excess: {{loss_sheet.excess_inr}}</p>
  <p>Net payable: {{loss_sheet.net_payable_inr}}</p>
  <p>ILA preliminary view: {{ila.preliminary_view}}</p>
  <p>Admissibility: {{ila.admissibility_label}}</p>
  <p>{{ila.admissibility_reasoning}}</p>
  <p>Signed: {{signer.name}} ({{signer.license}})</p>
  <div>{{loss_items_table}}</div>
</body></html>`,
  };

  it('buildContext exposes every loss_sheet.* placeholder the template references', () => {
    const ctx = buildContext({
      claim: fireClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(ctx.loss_sheet.sum_insured_inr).toMatch(/50,00,000/);
    expect(ctx.loss_sheet.value_at_risk_inr).toMatch(/61,00,000/);
    expect(ctx.loss_sheet.gross_loss_inr).toMatch(/54,30,000/);
    expect(ctx.loss_sheet.adjusted_loss_inr).toMatch(/44,(?:50|51),(?:\d{3})/);
    expect(ctx.loss_sheet.net_payable_inr).toMatch(/44,(?:25|26|29|30),(?:\d{3})/);
    expect(ctx.loss_sheet.excess_inr).toMatch(/25,000/);
    // Renderer emits the factor-applied %, i.e. (SI / VAR) * 100 — for our
    // setup that's 50/61 ≈ 81.97%. Surveyors read "x% applied" as "x% of
    // gross is paid". The complementary shortfall % shows up in the
    // underinsurance prose paragraph (asserted in the next test).
    expect(ctx.loss_sheet.underinsurance_factor_pct).toMatch(/81\.\d{2}% applied/);
  });

  it('underinsurance_paragraph spells out the shortfall in surveyor-style prose', () => {
    const ctx = buildContext({
      claim: fireClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(ctx.loss_sheet.underinsurance_paragraph).toMatch(/Sum insured of/i);
    expect(ctx.loss_sheet.underinsurance_paragraph).toMatch(/61,00,000/);
    expect(ctx.loss_sheet.underinsurance_paragraph).toMatch(/condition of average/i);
  });

  it('renderFsrHtml end-to-end has no leftover {{...}} tokens', () => {
    const html = renderFsrHtml({
      template: fireTemplate, claim: fireClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(html).not.toMatch(/\{\{[^}]+\}\}/);  // no unrendered placeholders
  });

  it('rendered HTML contains the right INR figures + signer block', () => {
    const html = renderFsrHtml({
      template: fireTemplate, claim: fireClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(html).toMatch(/50,00,000/);   // SI
    expect(html).toMatch(/54,30,000/);   // gross
    expect(html).toMatch(/61,00,000/);   // VAR
    expect(html).toMatch(/25,000/);      // excess
    expect(html).toContain('Niteen Nathani');
    expect(html).toContain('IRDAI/CORP/SLA-200025');
    expect(html).toContain('NATHANI');   // company.name
    expect(html).toContain('TEST/26-27/Fire');
  });

  it('rendered HTML embeds the itemised loss-items table', () => {
    const html = renderFsrHtml({
      template: fireTemplate, claim: fireClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(html).toContain('<table');
    expect(html).toContain('Office RCC structure');
    expect(html).toContain('Stock — raw polyfoam material');
    // Rendered loss-items table is HTML — should NOT be HTML-escaped
    expect(html).not.toContain('&lt;table');
  });

  it('escapes HTML in claim / ILA strings to prevent injection', () => {
    const evilClaim = { ...fireClaim, insured_name: '<script>alert(1)</script>' };
    const html = renderFsrHtml({
      template: fireTemplate, claim: evilClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders the company-aware letterhead (NISLA vs ACUERE)', () => {
    const acuereClaim = { ...fireClaim, company: 'Acuere' };
    const acuereHtml = renderFsrHtml({
      template: fireTemplate, claim: acuereClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(acuereHtml).toContain('ACUERE SURVEYORS');
    expect(acuereHtml).not.toContain('NATHANI');

    const nislaHtml = renderFsrHtml({
      template: fireTemplate, claim: fireClaim, lossSheet, lossItems: items, ila, signer,
    });
    expect(nislaHtml).toContain('NATHANI');
    expect(nislaHtml).not.toContain('ACUERE SURVEYORS');
  });
});

// -----------------------------------------------------------------------------
// Step 4 — math chain integrity (catches contract drift)
// -----------------------------------------------------------------------------

describe('Fire e2e — step 4: math chain integrity', () => {
  it('summary math is reproducible from line items alone', () => {
    // Re-run the whole pipeline twice, compare results — no global state.
    const items = itemInputs.map((input) => ({ ...input, ...computeItem(input) }));
    const a = summariseLossSheet({ items, sum_insured: 50_00_000, excess_amount: 25_000 });
    const b = summariseLossSheet({ items, sum_insured: 50_00_000, excess_amount: 25_000 });
    expect(a).toEqual(b);
  });

  it('summary numbers feed buildContext without drift', () => {
    const items = itemInputs.map((input) => ({ ...input, ...computeItem(input) }));
    const summary = summariseLossSheet({ items, sum_insured: 50_00_000, excess_amount: 25_000 });
    const ctx = buildContext({
      claim: fireClaim,
      lossSheet: { sum_insured: 50_00_000, excess_amount: 25_000, ...summary },
      lossItems: items,
      ila, signer,
    });

    // Pull the rupee figure back out of the formatted INR string.
    const vargRendered = parseInr(ctx.loss_sheet.value_at_risk_inr);
    const grossRendered = parseInr(ctx.loss_sheet.gross_loss_inr);
    const adjRendered = parseInr(ctx.loss_sheet.adjusted_loss_inr);
    const netRendered = parseInr(ctx.loss_sheet.net_payable_inr);

    // INR formatter rounds to whole rupees (maximumFractionDigits=0), so
    // we check within ±1 rupee of the raw summary numbers.
    expect(Math.abs(vargRendered - summary.value_at_risk)).toBeLessThan(1);
    expect(Math.abs(grossRendered - summary.gross_loss)).toBeLessThan(1);
    expect(Math.abs(adjRendered - summary.adjusted_loss)).toBeLessThan(1);
    expect(Math.abs(netRendered - summary.net_payable)).toBeLessThan(1);
  });
});

// Helper — extract the rupee count from an "₹X,XX,XXX" formatted string.
function parseInr(s) {
  if (typeof s !== 'string') return NaN;
  const digits = s.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : NaN;
}
