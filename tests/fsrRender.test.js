// =============================================================================
// tests/fsrRender.test.js
// =============================================================================
// Tests for the Slice 2 / 2d extensions to lib/fsr/render.js:
//   - Marine context builder (insurance % / GST % / handling % cascade)
//   - Extended Warranty context builder (invoice + GST + not-covered)
//   - Narrative defaults (every {{narrative.*}} key resolves)
//   - Company profile lookup (NISLA / Acuere letterhead context)
//   - Marine loss-items table renderer
//
// Plus tests for the new helpers:
//   - lib/fsr/numberToWords (rupeesInWords for amount-in-words rendering)
//   - lib/fsr/validationRules (LOB-business-rule layer with native Date math)
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildContext,
  renderFsrHtml,
  renderMarineLossItemsTable,
  companyProfile,
  rupeesInWords,
  numberInWords,
  validateClaim,
} from '../lib/fsr/index.js';

// -----------------------------------------------------------------------------
// numberToWords
// -----------------------------------------------------------------------------

describe('rupeesInWords', () => {
  it('renders zero', () => {
    expect(rupeesInWords(0)).toBe('Rupees Zero Only');
  });

  it('renders whole rupees with no paise', () => {
    expect(rupeesInWords(30604)).toBe('Rupees Thirty Thousand Six Hundred and Four Only');
    expect(rupeesInWords(60036)).toBe('Rupees Sixty Thousand Thirty Six Only');
    expect(rupeesInWords(59648)).toBe('Rupees Fifty Nine Thousand Six Hundred and Forty Eight Only');
  });

  it('renders Indian numbering (lakh / crore)', () => {
    expect(rupeesInWords(1_07_827)).toMatch(/One Lakh Seven Thousand/);
    expect(rupeesInWords(1_50_00_000)).toMatch(/One Crore Fifty Lakh/);
  });

  it('appends paise when there are non-zero decimals', () => {
    expect(rupeesInWords(1234.56)).toMatch(/Rupees One Thousand Two Hundred and Thirty Four and Fifty Six Paise Only/);
  });

  it('handles negative amounts with "Minus"', () => {
    expect(rupeesInWords(-100)).toMatch(/^Minus Rupees One Hundred Only$/);
  });

  it('returns empty string for null/non-numeric/NaN', () => {
    expect(rupeesInWords(null)).toBe('');
    expect(rupeesInWords(undefined)).toBe('');
    expect(rupeesInWords('foo')).toBe('');
    expect(rupeesInWords(NaN)).toBe('');
  });
});

describe('numberInWords', () => {
  it('strips currency wrapping', () => {
    expect(numberInWords(0)).toBe('Zero');
    expect(numberInWords(99)).toBe('Ninety Nine');
    expect(numberInWords(100)).toBe('One Hundred');
    expect(numberInWords(123)).toBe('One Hundred and Twenty Three');
  });

  it('rounds to nearest integer for non-integer inputs', () => {
    expect(numberInWords(2.4)).toBe('Two');
    expect(numberInWords(2.6)).toBe('Three');
  });
});

// -----------------------------------------------------------------------------
// companyProfile
// -----------------------------------------------------------------------------

describe('companyProfile', () => {
  it('returns NISLA defaults', () => {
    const p = companyProfile('NISLA');
    expect(p.name).toMatch(/NATHANI/);
    expect(p.license_line).toMatch(/200025/);
    expect(p.accent_color).toBe('#1e3a5f');
  });

  it('returns ACUERE for Acuere', () => {
    const p = companyProfile('Acuere');
    expect(p.name).toBe('ACUERE SURVEYORS');
    expect(p.license_line).toMatch(/85225/);
    expect(p.accent_color).toBe('#1a7ab5');
  });

  it('falls back to NISLA for unknown company', () => {
    expect(companyProfile('Unknown').name).toMatch(/NATHANI/);
    expect(companyProfile(undefined).name).toMatch(/NATHANI/);
    expect(companyProfile(null).name).toMatch(/NATHANI/);
  });
});

// -----------------------------------------------------------------------------
// buildContext — Marine LOB
// -----------------------------------------------------------------------------

const marineClaim = {
  id: 42,
  ref_number: 'T-012/26-27',
  insurer_name: 'New India Assurance Co. Ltd.',
  insured_name: 'Simero Vitrified Pvt Ltd',
  policy_number: '21210021250200000049',
  claim_number: 'NI-SI-249',
  lob: 'Marine Cargo',
  lob_subcategory: 'Marine Cargo Open Policy',
  date_loss: '2026-04-04',
  date_of_intimation: '2026-04-07',
  loss_location: 'Chennai',
  company: 'Acuere',
  sum_insured: 50_00_00_000,
  gross_loss: 28_000,
};

const marineSheet = {
  insurance_rate_pct: 1.5,
  gst_rate_pct: 18,
  handling_rate_pct: 10,
  excess_amount: 5_051,
  salvage_amount: 0,
  subtotal_amount: 27_063,
  insurance_total: 406,
  pre_gst_total: 27_469,
  gst_amount: 4_944,
  after_gst_total: 32_413,
  handling_amount: 3_241,
  after_handling_total: 35_655,
  net_loss: 35_655,
  net_adjusted_loss: 30_604,
};

const marineItems = [
  { item_no: 1, description: 'Cold Grey (Grano)', code: 'CGG-001', unit: 'Box',
    damaged_qty: 12, rate: 2255.25, amount: 27_063 },
];

describe('buildContext — Marine Cargo', () => {
  it('maps marine_loss_sheets columns to loss_sheet.* placeholders', () => {
    const ctx = buildContext({
      claim: marineClaim,
      marineSheet,
      marineItems,
      ila: null,
      signer: null,
      narrative: null,
    });

    expect(ctx.loss_sheet.subtotal_inr).toMatch(/27,063/);
    expect(ctx.loss_sheet.insurance_rate_pct).toBe('1.50');
    expect(ctx.loss_sheet.insurance_total_inr).toMatch(/406/);
    expect(ctx.loss_sheet.pre_gst_inr).toMatch(/27,469/);
    expect(ctx.loss_sheet.gst_rate_pct).toBe('18.00');
    expect(ctx.loss_sheet.gst_amount_inr).toMatch(/4,944/);
    expect(ctx.loss_sheet.after_gst_inr).toMatch(/32,413/);
    expect(ctx.loss_sheet.handling_rate_pct).toBe('10.00');
    expect(ctx.loss_sheet.handling_label).toBe('Handling');
    expect(ctx.loss_sheet.handling_amount_inr).toMatch(/3,241/);
    expect(ctx.loss_sheet.gross_loss_inr).toMatch(/35,655/);
    expect(ctx.loss_sheet.salvage_inr).toMatch(/—|0/);
    expect(ctx.loss_sheet.net_loss_inr).toMatch(/35,655/);
    expect(ctx.loss_sheet.excess_inr).toMatch(/5,051/);
    expect(ctx.loss_sheet.net_adjusted_loss_inr).toMatch(/30,604/);
    expect(ctx.loss_sheet.net_adjusted_loss_words).toMatch(/Rupees Thirty Thousand Six Hundred and Four Only/);
  });

  it('uses Acuere company profile when claim.company=Acuere', () => {
    const ctx = buildContext({ claim: marineClaim, marineSheet, marineItems });
    expect(ctx.company.name).toBe('ACUERE SURVEYORS');
    expect(ctx.company.accent_color).toBe('#1a7ab5');
  });

  it('still renders policy_period dates', () => {
    const ctx = buildContext({
      claim: { ...marineClaim, policy_period_from: '2025-11-17', policy_period_to: '2026-11-16' },
      marineSheet, marineItems,
    });
    expect(ctx.claim.policy_period_from).toMatch(/Nov 2025/);
    expect(ctx.claim.policy_period_to).toMatch(/Nov 2026/);
  });

  it('Marine context never trips the Fire underinsurance prose', () => {
    const ctx = buildContext({ claim: marineClaim, marineSheet, marineItems });
    expect(ctx.loss_sheet.underinsurance_paragraph).toMatch(/Marine Cargo claims/);
    expect(ctx.loss_sheet.underinsurance_paragraph).not.toMatch(/condition of average/);
  });
});

// -----------------------------------------------------------------------------
// buildContext — Extended Warranty LOB
// -----------------------------------------------------------------------------

describe('buildContext — Extended Warranty', () => {
  const ewClaim = {
    id: 7,
    ref_number: 'AS-1752/25-26',
    insurer_name: 'The Oriental Insurance Co. Ltd.',
    insured_name: 'M/s Assurant Automotive Warranty Solutions',
    policy_number: '411200/48/2023/2139',
    claim_number: 'TKIC86072',
    lob: 'Extended Warranty',
    company: 'Acuere',
  };

  it('derives GST and net-after-GST from invoice amount when ewClaim is null', () => {
    const ctx = buildContext({
      claim: { ...ewClaim, gross_loss: 70_842 },
      ewClaim: null,
    });
    expect(ctx.loss_sheet.gross_loss_inr).toMatch(/70,842/);
    // 70842 * 18/118 = 10,805.something → rounded 10,806
    expect(ctx.loss_sheet.gst_amount_inr).toMatch(/10,80[0-9]/);
    expect(ctx.loss_sheet.after_gst_inr).toMatch(/60,03[5-7]/);
    expect(ctx.loss_sheet.net_adjusted_loss_inr).toMatch(/60,03[5-7]/);
  });

  it('uses ewClaim.repair_invoice_amount when provided', () => {
    const ctx = buildContext({
      claim: ewClaim,
      ewClaim: { repair_invoice_amount: 70_385, gst_rate_pct: 18, not_covered_amount: 0 },
    });
    expect(ctx.loss_sheet.gross_loss_inr).toMatch(/70,385/);
    expect(ctx.loss_sheet.gst_amount_inr).toMatch(/10,73[5-7]/);
  });
});

// -----------------------------------------------------------------------------
// Narrative defaults — every placeholder resolves
// -----------------------------------------------------------------------------

describe('buildContext — narrative defaults', () => {
  it('exposes every documented narrative key, defaulted to empty string', () => {
    const ctx = buildContext({ claim: marineClaim, marineSheet, marineItems, narrative: null });
    const required = [
      'insurer_office_address', 'instructions_received_from', 'dates_of_survey',
      'place_of_survey', 'person_contacted', 'lr_no', 'lr_date', 'vehicle_no',
      'transit', 'basis_of_valuation', 'policy_packing_description',
      'transport_mode', 'commodity_description', 'journey_details',
      'policy_excess_text', 'risks_covered', 'carrier', 'consignor', 'consignee',
      'goods_description', 'invoice_details', 'total_consignment_value_inr',
      'packing_description', 'date_of_booking', 'date_of_arrival',
      'situation_of_loss', 'observations', 'insured_claim_amount_inr',
      'insured_claim_amount_words', 'gst_treatment', 'salvage_basis',
      'consent_of_insured', 'lr_remarks', 'damage_certificate',
      'monetary_claim_status', 'probable_cause',
      // EW
      'plan_name', 'customer_name', 'registration_no', 'date_of_registration',
      'vehicle_make', 'vehicle_model', 'vin', 'engine_no', 'odometer',
      'certificate_no', 'certificate_validity', 'product_description',
      'terms_and_conditions', 'tax_invoice_no', 'tax_invoice_date',
      'tax_invoice_amount_inr', 'assessment_basis', 'customer_complaint',
      'service_centre',
    ];
    for (const k of required) {
      expect(ctx.narrative).toHaveProperty(k);
    }
  });

  it('passes through caller-supplied narrative values', () => {
    const ctx = buildContext({
      claim: marineClaim, marineSheet, marineItems,
      narrative: {
        situation_of_loss: 'The cargo was damaged in transit due to jerks and jolts.',
        observations: 'During our survey, we noted 12 boxes in damaged condition.',
        gst_treatment: 'We have allowed and considered the GST Component subject to reversal proof.',
      },
    });
    expect(ctx.narrative.situation_of_loss).toMatch(/jerks and jolts/);
    expect(ctx.narrative.observations).toMatch(/12 boxes/);
    expect(ctx.narrative.gst_treatment).toMatch(/reversal proof/);
  });
});

// -----------------------------------------------------------------------------
// renderMarineLossItemsTable
// -----------------------------------------------------------------------------

describe('renderMarineLossItemsTable', () => {
  it('renders empty state when no items', () => {
    const html = renderMarineLossItemsTable([]);
    expect(html).toMatch(/No itemised cargo damage/);
  });

  it('renders rows with description, qty, rate, amount + total footer', () => {
    const html = renderMarineLossItemsTable(marineItems);
    expect(html).toContain('Cold Grey (Grano)');
    expect(html).toContain('CGG-001');
    expect(html).toContain('Box');
    expect(html).toMatch(/27,063/);
    expect(html).toContain('Subtotal');
  });

  it('escapes HTML in description', () => {
    const items = [{ ...marineItems[0], description: '<script>x</script>' }];
    const html = renderMarineLossItemsTable(items);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// -----------------------------------------------------------------------------
// renderFsrHtml end-to-end with a real-sample-shaped Marine template
// -----------------------------------------------------------------------------

describe('renderFsrHtml — Marine production template', () => {
  // A trimmed fragment that mirrors the production template structure.
  const tpl = {
    body_html: `
<html><body>
  <h1>{{company.name}}</h1>
  <div>{{company.license_line}}</div>
  <p>Ref: {{claim.ref_number}} | Date: {{date_today}}</p>
  <p>Insurer: {{claim.insurer_name}} | Insured: {{claim.insured_name}}</p>
  <p>Subtotal: {{loss_sheet.subtotal_inr}}</p>
  <p>+ Insurance @ {{loss_sheet.insurance_rate_pct}}% = {{loss_sheet.insurance_total_inr}}</p>
  <p>+ GST @ {{loss_sheet.gst_rate_pct}}% = {{loss_sheet.gst_amount_inr}}</p>
  <p>+ {{loss_sheet.handling_label}} @ {{loss_sheet.handling_rate_pct}}% = {{loss_sheet.handling_amount_inr}}</p>
  <p>Gross: {{loss_sheet.gross_loss_inr}}</p>
  <p>Less Salvage: {{loss_sheet.salvage_inr}}</p>
  <p>Less Excess: {{loss_sheet.excess_inr}}</p>
  <p><strong>Net Adjusted: {{loss_sheet.net_adjusted_loss_inr}} ({{loss_sheet.net_adjusted_loss_words}})</strong></p>
  <p>Person contacted: {{narrative.person_contacted}}</p>
  <p>Situation: {{narrative.situation_of_loss}}</p>
  <div>{{loss_items_table}}</div>
  <p>Signed: {{signer.name}}, IRDAI {{signer.license}}, for {{company.name}}</p>
</body></html>`,
  };

  it('produces a clean HTML render with no unrendered tokens', () => {
    const html = renderFsrHtml({
      template: tpl,
      claim: marineClaim,
      marineSheet,
      marineItems,
      ila: { preliminary_view: '', admissibility_opinion: 'admissible_with_conditions' },
      signer: { name: 'Niteen Nathani', license_number: 'IRDAI/IND/SLA-85225' },
      narrative: {
        person_contacted: 'Mr. Melbin Jose',
        situation_of_loss: 'The consignment was damaged during transit.',
      },
    });

    expect(html).toContain('ACUERE SURVEYORS');
    expect(html).toContain('IRDAI/IND/SLA-85225');
    expect(html).toContain('T-012/26-27');
    expect(html).toContain('Mr. Melbin Jose');
    expect(html).toContain('damaged during transit');
    expect(html).toMatch(/27,063/);
    expect(html).toMatch(/30,604/);
    expect(html).toMatch(/Rupees Thirty Thousand/);
    expect(html).toContain('<table');
    // No leftover {{...}} placeholders
    expect(html).not.toMatch(/\{\{/);
  });

  it('falls back to "(blank)" for narrative keys the surveyor has not filled', () => {
    const html = renderFsrHtml({
      template: tpl,
      claim: marineClaim,
      marineSheet,
      marineItems,
      narrative: null,
    });
    // Every `{{narrative.*}}` should render as "(blank)" rather than vanishing
    expect(html).toContain('Person contacted: (blank)');
    expect(html).toContain('Situation: (blank)');
  });
});

// -----------------------------------------------------------------------------
// validationRules (LOB business-rule layer, no ajv)
// -----------------------------------------------------------------------------

describe('validateClaim — Marine business rules', () => {
  const goodMarine = {
    claimNo: 'NI-SI-249',
    insurer: 'New India Assurance',
    insured: 'Simero Vitrified',
    dateOfIntimation: '2026-04-07',
    dateOfLoss: '2026-04-04',
    placeOfLoss: 'Chennai',
    reportType: 'INTERIM',  // FINAL needs ≥3 annexures
    policy: { policyNo: 'P-1', fromDate: '2025-11-17', toDate: '2026-11-16', sumInsured: 50_00_00_000 },
    surveyor: { name: 'X', slaNo: '85225', category: 'A' },
    marine: {
      policyType: 'OPEN_POLICY',
      iccClause: 'A',
      voyage: { from: 'Morbi', to: 'Chennai', sailingDate: '2026-03-28', arrivalDate: '2026-04-04' },
      cargo: { description: 'Tiles', packing: 'Cardboard', quantity: '340 boxes', invoiceValue: 918_378 },
      causeOfLoss: 'Jerks & jolts',
      natureOfLoss: 'DAMAGE',
    },
    computation: {
      grossLoss: 35_655,
      lessSalvage: 0,
      lessExcess: 5_051,
      lessDepreciation: 0,
      lessUnderInsurance: 0,
      netAdjustedLoss: 30_604,
    },
  };

  it('passes a clean claim', () => {
    const r = validateClaim(goodMarine);
    expect(r.ok).toBe(true);
    expect(r.lob).toBe('MARINE');
    expect(r.errors).toEqual([]);
  });

  it('flags loss outside policy', () => {
    const r = validateClaim({
      ...goodMarine,
      dateOfLoss: '2027-12-01',  // way outside
    });
    expect(r.errors.some((e) => e.code === 'LOSS_OUTSIDE_POLICY')).toBe(true);
  });

  it('flags arrival before sailing', () => {
    const r = validateClaim({
      ...goodMarine,
      marine: {
        ...goodMarine.marine,
        voyage: { ...goodMarine.marine.voyage, arrivalDate: '2026-03-20' },
      },
    });
    expect(r.errors.some((e) => e.code === 'ARRIVAL_BEFORE_SAILING')).toBe(true);
  });

  it('flags computation arithmetic mismatch', () => {
    const r = validateClaim({
      ...goodMarine,
      computation: { ...goodMarine.computation, netAdjustedLoss: 99_999 },
    });
    expect(r.errors.some((e) => e.code === 'COMPUTATION_MISMATCH')).toBe(true);
  });

  it('flags ICC C with theft cause for senior review', () => {
    const r = validateClaim({
      ...goodMarine,
      marine: { ...goodMarine.marine, iccClause: 'C', causeOfLoss: 'Theft during transit' },
    });
    expect(r.errors.some((e) => e.code === 'ICC_C_PERIL_REVIEW')).toBe(true);
  });

  it('flags Cat-C surveyor signing > ₹15 lakh', () => {
    const r = validateClaim({
      ...goodMarine,
      surveyor: { ...goodMarine.surveyor, category: 'C' },
      computation: {
        ...goodMarine.computation,
        grossLoss: 20_00_000, lessExcess: 0, netAdjustedLoss: 20_00_000,
      },
    });
    expect(r.errors.some((e) => e.code === 'SURVEYOR_CAT_INSUFFICIENT')).toBe(true);
  });
});

describe('validateClaim — Extended Warranty business rules', () => {
  const goodEW = {
    claimNo: 'TKIC86072',
    insurer: 'Oriental',
    insured: 'Assurant',
    dateOfIntimation: '2026-03-09',
    dateOfLoss: '2026-03-05',
    placeOfLoss: 'Bathinda',
    reportType: 'INTERIM',
    policy: { policyNo: 'P-1', fromDate: '2025-04-01', toDate: '2027-07-28', sumInsured: 5_00_000 },
    surveyor: { name: 'X', slaNo: '85225', category: 'A' },
    warranty: {
      equipment: { make: 'Toyota', model: 'Fortuner', serialNo: 'MBJBA3FS500834709', purchaseDate: '2022-07-29', invoiceValue: 35_00_000 },
      manufacturerWarranty: { fromDate: '2022-07-29', toDate: '2025-07-28' },
      extendedWarranty: { fromDate: '2025-07-29', toDate: '2027-07-28', planType: 'COMPREHENSIVE' },
      failure: { dateOfFailure: '2026-03-05', symptom: 'diggi not opening', rootCause: 'Power liftgate motor', partsAffected: ['unit assy power'] },
      repairOrReplace: 'REPAIR',
    },
    computation: {
      partsCost: 50_000, labourCost: 10_000, gst: 10_806,
      grossLoss: 70_842, lessExcess: 10_806, lessSalvage: 0, lessDepreciation: 0,
      netAdjustedLoss: 60_036,
    },
  };

  it('passes a clean EW claim', () => {
    const r = validateClaim(goodEW);
    expect(r.ok).toBe(true);
    expect(r.lob).toBe('EXT_WARRANTY');
  });

  it('flags wear-and-tear exclusion', () => {
    const r = validateClaim({
      ...goodEW,
      warranty: { ...goodEW.warranty, failure: { ...goodEW.warranty.failure, wearAndTear: true } },
    });
    expect(r.errors.some((e) => e.code === 'EXCL_WEAR_TEAR')).toBe(true);
  });

  it('flags EW overlapping manufacturer warranty', () => {
    const r = validateClaim({
      ...goodEW,
      warranty: {
        ...goodEW.warranty,
        manufacturerWarranty: { fromDate: '2022-07-29', toDate: '2026-07-28' },  // ends after EW starts
      },
    });
    expect(r.errors.some((e) => e.code === 'EW_OVERLAPS_MFG')).toBe(true);
  });

  it('flags PARTS_ONLY plan with labour cost', () => {
    const r = validateClaim({
      ...goodEW,
      warranty: {
        ...goodEW.warranty,
        extendedWarranty: { ...goodEW.warranty.extendedWarranty, planType: 'PARTS_ONLY' },
      },
      computation: { ...goodEW.computation, labourCost: 5_000 },
    });
    expect(r.errors.some((e) => e.code === 'LABOUR_NOT_COVERED')).toBe(true);
  });
});

describe('validateClaim — unknown LOB', () => {
  it('returns UNKNOWN_LOB error when neither marine nor warranty block present', () => {
    const r = validateClaim({ claimNo: 'X' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('UNKNOWN_LOB');
  });
});
