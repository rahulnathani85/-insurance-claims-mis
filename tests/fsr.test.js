// =============================================================================
// tests/fsr.test.js
// =============================================================================
// Unit tests for lib/fsr — substitution, INR formatting, escaping,
// underinsurance prose, loss-items table builder, sanitiser.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  renderFsrHtml,
  buildContext,
  renderLossItemsTable,
  underinsuranceParagraph,
  substitute,
  fmtINR,
  fmtNumber,
  fmtDate,
  escapeHtml,
  sanitiseDraftPayload,
} from '../lib/fsr/index.js';

const baseClaim = {
  id: 1,
  ref_number: '4053/26-27/Fire',
  insurer_name: 'New India Assurance',
  insured_name: 'Acme Industries',
  policy_number: 'POL-1',
  claim_number: 'NIA/2026/12345',
  lob: 'Fire',
  lob_subcategory: 'SFSP (Standard Fire & Special Perils)',
  date_loss: '2026-04-29',
  date_of_intimation: '2026-04-29',
  registered_at: '2026-04-30T03:00:00Z',
  loss_location: 'Mumbai',
  company: 'NISLA',
};
const baseLossSheet = {
  sum_insured: 5_000_000,
  excess_amount: 50_000,
  value_at_risk: 6_000_000,
  gross_loss: 1_350_000,
  underinsurance_factor: 0.833333,
  adjusted_loss: 1_125_000,
  net_payable: 1_075_000,
};
const baseItems = [
  { item_no: 1, description: 'Office furniture', category: 'furniture', replacement_value: 200_000, age_years: 5, depreciation_pct: 37.5, depreciation_pct_override: false, depreciated_value: 125_000, salvage_value: 5_000, net_loss: 120_000 },
  { item_no: 2, description: 'Stock — raw material', category: 'stock_raw_material', replacement_value: 1_000_000, age_years: 0, depreciation_pct: 0, depreciation_pct_override: false, depreciated_value: 1_000_000, salvage_value: 50_000, net_loss: 950_000 },
];
const baseIla = {
  preliminary_view: 'Fire damaged the godown. <visible scorch marks> on east wall.',
  admissibility_opinion: 'admissible_with_conditions',
  admissibility_reasoning: 'Subject to policy schedule confirmation.',
};
const baseSigner = { name: 'Jane Doe', license_number: 'IRDAI/CORP/SLA-200025' };

// -----------------------------------------------------------------------------
// fmtINR / fmtNumber / fmtDate / escapeHtml
// -----------------------------------------------------------------------------

describe('fmtINR', () => {
  it('formats Indian numbering', () => {
    const out = fmtINR(5_000_000);
    expect(out).toMatch(/₹.*50,00,000/);
  });

  it('returns "—" for null / non-numeric', () => {
    expect(fmtINR(null)).toBe('—');
    expect(fmtINR(undefined)).toBe('—');
    expect(fmtINR('')).toBe('—');
    expect(fmtINR('not a number')).toBe('—');
  });
});

describe('fmtNumber', () => {
  it('formats with given decimals', () => {
    expect(fmtNumber(37.5, 2)).toBe('37.50');
    expect(fmtNumber(5, 0)).toBe('5');
  });
  it('returns "" for null', () => {
    expect(fmtNumber(null)).toBe('');
    expect(fmtNumber('')).toBe('');
  });
});

describe('fmtDate', () => {
  it('formats ISO into Indian date', () => {
    const out = fmtDate('2026-04-30');
    expect(out).toMatch(/Apr 2026/);
    expect(out).toMatch(/30/);
  });
  it('handles invalid dates by returning the raw string', () => {
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });
  it('returns empty for null', () => {
    expect(fmtDate(null)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes the 5 dangerous chars', () => {
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
    expect(escapeHtml("o'reilly")).toBe('o&#39;reilly');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
});

// -----------------------------------------------------------------------------
// substitute
// -----------------------------------------------------------------------------

describe('substitute', () => {
  it('resolves dotted paths', () => {
    const out = substitute('Hello {{user.name}}', { user: { name: 'Jane' } });
    expect(out).toBe('Hello Jane');
  });

  it('escapes substituted values by default', () => {
    const out = substitute('{{x}}', { x: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('does NOT escape the loss_items_table special (trusted pre-built HTML)', () => {
    const out = substitute('{{loss_items_table}}', { loss_items_table: '<table><tr><td>x</td></tr></table>' });
    expect(out).toBe('<table><tr><td>x</td></tr></table>');
  });

  it('uses "(blank)" for missing paths', () => {
    expect(substitute('{{missing.path}}', {})).toBe('(blank)');
    expect(substitute('{{a.b.c}}', { a: { b: null } })).toBe('(blank)');
  });

  it('handles whitespace inside braces', () => {
    expect(substitute('{{  user.name  }}', { user: { name: 'X' } })).toBe('X');
  });

  it('returns empty string when template is not a string', () => {
    expect(substitute(null, {})).toBe('');
    expect(substitute(123, {})).toBe('');
  });
});

// -----------------------------------------------------------------------------
// underinsuranceParagraph
// -----------------------------------------------------------------------------

describe('underinsuranceParagraph', () => {
  it('flags missing SI', () => {
    const out = underinsuranceParagraph({ value_at_risk: 1_000_000 });
    expect(out).toMatch(/not recorded/i);
  });

  it('flags missing VAR', () => {
    const out = underinsuranceParagraph({ sum_insured: 5_000_000 });
    expect(out).toMatch(/not been quantified/i);
  });

  it('says "fully insured" when factor=1', () => {
    const out = underinsuranceParagraph({ sum_insured: 5_000_000, value_at_risk: 4_000_000, underinsurance_factor: 1 });
    expect(out).toMatch(/fully covers/i);
  });

  it('reports shortfall percentage when underinsured', () => {
    const out = underinsuranceParagraph({ sum_insured: 5_000_000, value_at_risk: 10_000_000, underinsurance_factor: 0.5 });
    expect(out).toMatch(/50\.00%/);
    expect(out).toMatch(/condition of average/i);
  });

  it('handles factor=null gracefully', () => {
    const out = underinsuranceParagraph({ sum_insured: 5_000_000, value_at_risk: 10_000_000, underinsurance_factor: null });
    expect(out).toMatch(/not been computed/i);
  });
});

// -----------------------------------------------------------------------------
// renderLossItemsTable
// -----------------------------------------------------------------------------

describe('renderLossItemsTable', () => {
  it('renders empty state when no items', () => {
    const html = renderLossItemsTable([]);
    expect(html).toMatch(/No itemised loss/);
  });

  it('renders one row per item with key columns', () => {
    const html = renderLossItemsTable(baseItems);
    expect(html).toContain('Office furniture');
    expect(html).toContain('Stock — raw material');
    expect(html).toMatch(/₹.*2,00,000/);  // RV column
    expect(html).toMatch(/<td class="num"><strong>/);
  });

  it('marks manual depreciation overrides with †', () => {
    const items = [{ ...baseItems[0], depreciation_pct_override: true }];
    const html = renderLossItemsTable(items);
    expect(html).toContain('†');
  });

  it('escapes HTML in description / notes', () => {
    const items = [{ ...baseItems[0], description: '<script>alert(1)</script>' }];
    const html = renderLossItemsTable(items);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// -----------------------------------------------------------------------------
// buildContext + renderFsrHtml
// -----------------------------------------------------------------------------

describe('buildContext', () => {
  it('produces full context object with formatted INR fields', () => {
    const ctx = buildContext({ claim: baseClaim, lossSheet: baseLossSheet, lossItems: baseItems, ila: baseIla, signer: baseSigner });
    expect(ctx.claim.ref_number).toBe('4053/26-27/Fire');
    expect(ctx.loss_sheet.gross_loss_inr).toMatch(/13,50,000|1,350,000/);
    expect(ctx.loss_sheet.underinsurance_factor_pct).toMatch(/applied/);
    expect(ctx.ila.admissibility_label).toMatch(/Admissible with conditions/);
    expect(ctx.signer.name).toBe('Jane Doe');
    expect(ctx.loss_items_table).toContain('Office furniture');
  });

  it('falls back gracefully when ILA missing', () => {
    const ctx = buildContext({ claim: baseClaim, lossSheet: baseLossSheet, lossItems: [], ila: null, signer: null });
    expect(ctx.ila.preliminary_view).toMatch(/no preliminary view/i);
    expect(ctx.ila.admissibility_label).toMatch(/Pending/i);
    expect(ctx.signer.name).toMatch(/unsigned/);
  });

  it('produces "fully insured" prose when SI = VAR', () => {
    const ctx = buildContext({
      claim: baseClaim,
      lossSheet: { ...baseLossSheet, sum_insured: 6_000_000, underinsurance_factor: 1 },
      lossItems: baseItems,
      ila: baseIla,
      signer: baseSigner,
    });
    expect(ctx.loss_sheet.underinsurance_paragraph).toMatch(/fully covers/i);
  });
});

describe('renderFsrHtml', () => {
  const template = {
    body_html: `<!DOCTYPE html><html><body>
      <h1>{{claim.ref_number}}</h1>
      <p>{{ila.preliminary_view}}</p>
      <p>{{loss_sheet.underinsurance_paragraph}}</p>
      <div>{{loss_items_table}}</div>
      <p>By {{signer.name}} ({{signer.license}})</p>
    </body></html>`,
  };

  it('substitutes all top-level placeholders + escapes ILA HTML', () => {
    const html = renderFsrHtml({
      template,
      claim: baseClaim,
      lossSheet: baseLossSheet,
      lossItems: baseItems,
      ila: baseIla,
      signer: baseSigner,
    });
    expect(html).toContain('4053/26-27/Fire');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('IRDAI/CORP/SLA-200025');
    // ILA preliminary_view contained "<visible scorch marks>" — should be escaped
    expect(html).not.toContain('<visible scorch marks>');
    expect(html).toContain('&lt;visible scorch marks&gt;');
    // loss_items_table is trusted HTML → preserved
    expect(html).toContain('<table');
    expect(html).toContain('Office furniture');
  });

  it('throws when template body_html missing', () => {
    expect(() => renderFsrHtml({
      template: {}, claim: baseClaim, lossSheet: baseLossSheet,
      lossItems: [], ila: null, signer: null,
    })).toThrow();
  });
});

// -----------------------------------------------------------------------------
// sanitiseDraftPayload
// -----------------------------------------------------------------------------

describe('sanitiseDraftPayload', () => {
  it('passes draft_content through as-is', () => {
    const r = sanitiseDraftPayload({ draft_content: '<html>hi</html>' });
    expect(r.draft_content).toBe('<html>hi</html>');
  });

  it('coerces non-string draft_content to null', () => {
    const r = sanitiseDraftPayload({ draft_content: 12345 });
    expect(r.draft_content).toBeNull();
  });

  it('rejects unknown status', () => {
    expect(() => sanitiseDraftPayload({ status: 'pending' })).toThrow();
  });

  it('accepts each spec status', () => {
    for (const s of ['draft', 'under_review', 'approved', 'superseded']) {
      const r = sanitiseDraftPayload({ status: s });
      expect(r.status).toBe(s);
    }
  });

  it('trims approved_by', () => {
    const r = sanitiseDraftPayload({ approved_by: '  jane@nisla.in  ' });
    expect(r.approved_by).toBe('jane@nisla.in');
  });
});
