// =============================================================================
// lib/fsr/render.js
// =============================================================================
// Renders an FSR HTML template (loaded from fsr_lob_templates.body_html)
// against a context built from the claim, latest ILA, and the LOB-appropriate
// loss sheet (Fire `loss_sheets` or Marine `marine_loss_sheets`).
//
// Substitution language is intentionally minimal — `{{path.with.dots}}`
// resolves against the context object. Missing values become "(blank)" so
// the rendered PDF never has unrendered tokens.
//
// Pre-rendered specials (escapeHtml is bypassed for these — they are HTML
// chunks we built ourselves):
//   {{loss_items_table}}
//   {{loss_sheet.underinsurance_paragraph}}
//
// Context shape (full vocabulary documented in nisla-ai-pack/docs/CLAUDE_CODE_NOTES.md §5):
//
//   ctx.claim.<column>                     direct from claims row
//   ctx.loss_sheet.<key>                   Fire OR Marine sheet, _inr suffix = INR-formatted
//   ctx.loss_sheet.handling_label          variable text ("Handling" / "Add 10% as per Policy" / etc.)
//   ctx.loss_sheet.net_adjusted_loss_words "Rupees ... Only" amount-in-words
//   ctx.narrative.<block>                  free-form prose pulled from claim_fsr_drafts.narrative_jsonb
//   ctx.ila.preliminary_view, ila.admissibility_label, ila.admissibility_reasoning
//   ctx.signer.name / .license             from surveyors row
//   ctx.company.name / .license_line / .address_line / .accent_color
//   ctx.date_today
//   ctx.loss_items_table                   pre-rendered <table> HTML
// =============================================================================

import { rupeesInWords } from './numberToWords.js';

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});

const ADMISSIBILITY_LABELS = {
  admissible: 'Admissible (prima facie covered)',
  admissible_with_conditions: 'Admissible with conditions',
  needs_investigation: 'Needs investigation',
  likely_non_admissible: 'Likely non-admissible',
  non_admissible: 'Non-admissible',
};

// Per-firm letterhead context. Mapped to {{company.*}} placeholders so the
// firm-agnostic ILA templates resolve their letterhead at render time.
//
// IMPORTANT: company.accent_color is interpolated into the templates inside
// <style> blocks (e.g. `border-bottom: 2px solid {{company.accent_color}};`).
// Our substitute() helper HTML-escapes interpolated values by default — that
// works for hex colours because `#1e3a5f` has no HTML metacharacters, but it
// would corrupt the CSS if the value ever contained `<`, `>`, `&`, `"`, or
// `'`. assertCssSafe() below guards against that — keep all `accent_color`
// values strictly hex / rgb / named-colour.
const COMPANY_PROFILES = {
  NISLA: {
    name: 'NATHANI INSURANCE SURVEYORS & LOSS ASSESSORS PVT. LTD.',
    license_line: 'IRDA/CORP/S.L.A. No. 200025 (Exp. 03/10/2028)',
    address_line: '507, Garnet Palladium, Behind Express Zone, Off WE Highway, Goregaon (E), Mumbai – 400063',
    accent_color: '#1e3a5f',
  },
  Acuere: {
    name: 'ACUERE SURVEYORS',
    license_line: 'IRDAI Licence: IRDAI/IND/SLA-85225 (Exp. 02/03/2028)',
    address_line: 'A-45, 401, Gurukrupa, Gokuldham, Goregaon (E), Mumbai – 400063',
    accent_color: '#1a7ab5',
  },
};

// Module-load-time assertion. Failing here at import time is loud and
// obvious — far better than corrupting CSS at runtime.
for (const [key, profile] of Object.entries(COMPANY_PROFILES)) {
  assertCssSafeColor(profile.accent_color, `COMPANY_PROFILES['${key}'].accent_color`);
}

// assertCssSafeColor — throws if the value contains characters that would
// break CSS once HTML-escaped. Accepts hex (`#abc` / `#abcdef`), rgb()/rgba(),
// hsl()/hsla(), and CSS named colours (no special chars). Anything else gets
// rejected.
export function assertCssSafeColor(value, label = 'accent_color') {
  if (typeof value !== 'string') {
    throw new Error(`${label}: must be a string, got ${typeof value}`);
  }
  // No HTML metacharacters — they'd be escaped and break the CSS.
  if (/[<>&"']/.test(value)) {
    throw new Error(`${label}: contains HTML metacharacter — would break CSS after HTML-escaping`);
  }
  // Whitelist of permissible CSS colour shapes. Conservative on purpose;
  // expand if a future profile needs e.g. var(--brand) — but the
  // substitute() escaping then needs revisiting.
  const ok =
    /^#[0-9a-fA-F]{3}$/.test(value) ||                                // #abc
    /^#[0-9a-fA-F]{6}$/.test(value) ||                                // #abcdef
    /^#[0-9a-fA-F]{8}$/.test(value) ||                                // #abcdef88 (with alpha)
    /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[0-9.]+\s*)?\)$/.test(value) ||
    /^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*[0-9.]+\s*)?\)$/.test(value) ||
    /^[a-zA-Z]+$/.test(value);                                         // named colours
  if (!ok) {
    throw new Error(`${label}: "${value}" is not a recognised CSS colour shape (hex / rgb / hsl / named).`);
  }
  return value;
}

export function companyProfile(company) {
  return COMPANY_PROFILES[company] || COMPANY_PROFILES.NISLA;
}

// -----------------------------------------------------------------------------
// renderFsrHtml — top-level entry
// -----------------------------------------------------------------------------
export function renderFsrHtml({ template, claim, lossSheet, lossItems = [], marineSheet, marineItems = [], ila, signer, narrative, ewClaim }) {
  if (!template?.body_html) throw new Error('renderFsrHtml: template.body_html is required');

  const context = buildContext({
    claim, lossSheet, lossItems, marineSheet, marineItems, ila, signer, narrative, ewClaim,
    company: claim?.company || 'NISLA',
  });
  return substitute(template.body_html, context);
}

// -----------------------------------------------------------------------------
// buildContext — gather all values + pre-render the table / prose pieces
// -----------------------------------------------------------------------------
// All inputs are optional; the function falls back to safe defaults. Per-LOB
// behaviour:
//   - Fire claims  → reads `lossSheet` / `lossItems`, renders the depreciation
//                    cascade and underinsurance paragraph.
//   - Marine Cargo → reads `marineSheet` / `marineItems`, renders the
//                    insurance % → GST → handling % cascade.
//   - Extended Warranty → reads `ewClaim` (ew_vehicle_claims row) for
//                    invoice + GST + not-covered amounts. Falls back to
//                    `claim.gross_loss` if that's not available.
//   - Other LOBs   → uses claim columns only.
// -----------------------------------------------------------------------------
export function buildContext({ claim, lossSheet, lossItems = [], marineSheet, marineItems = [], ila, signer, narrative, ewClaim, company }) {
  const lob = claim?.lob || '';
  const isMarine = lob === 'Marine Cargo' || lob === 'Marine Hull';
  const isEW = lob === 'Extended Warranty';

  const ctx = {
    claim: {
      ref_number: claim?.ref_number || `#${claim?.id || ''}`,
      claim_number: claim?.claim_number || '',
      insurer_name: claim?.insurer_name || '',
      insured_name: claim?.insured_name || '',
      policy_number: claim?.policy_number || '',
      lob: claim?.lob || '',
      lob_subcategory: claim?.lob_subcategory || '',
      date_loss: fmtDate(claim?.date_loss),
      date_of_intimation: fmtDate(claim?.date_of_intimation),
      registered_at: fmtDate(claim?.registered_at),
      loss_location: claim?.loss_location || '',
      policy_period_from: fmtDate(claim?.policy_period_from),
      policy_period_to: fmtDate(claim?.policy_period_to),
      // Surface the company on claim too — handy in cover headers.
      company: claim?.company || 'NISLA',
    },

    // Loss-sheet context: union of Fire, Marine and EW vocabularies.
    // The template only uses the keys it needs; the others render as
    // "(blank)". For Marine, we map marineSheet → loss_sheet so the
    // shared template language works across both LOBs.
    loss_sheet: isMarine ? buildMarineLossContext(marineSheet, marineItems, claim)
              : isEW    ? buildEwLossContext(ewClaim, claim)
              :           buildFireLossContext(lossSheet, lossItems, claim),

    ila: {
      preliminary_view: ila?.preliminary_view || '(no preliminary view recorded)',
      admissibility_label: ADMISSIBILITY_LABELS[ila?.admissibility_opinion] || 'Pending assessment',
      preliminary_admissibility_label: ADMISSIBILITY_LABELS[ila?.admissibility_opinion] || 'preliminarily appears admissible',
      admissibility_reasoning: ila?.admissibility_reasoning || '',
    },

    // Free-form narrative blocks. Surveyor fills via UI or AI drafts via
    // /api/ai/fsr-narrative. The shape here matches placeholders in the
    // real-sample templates — every key falls back to "(blank)" if unset.
    narrative: buildNarrativeContext(narrative, claim),

    signer: {
      name: signer?.name || signer?.email || '(unsigned)',
      license: signer?.license_number || '',
      email: signer?.email || '',
    },

    company: companyProfile(company || claim?.company),

    date_today: new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    }),

    loss_items_table: isMarine
      ? renderMarineLossItemsTable(marineItems)
      : renderLossItemsTable(lossItems),
  };

  return ctx;
}

// -----------------------------------------------------------------------------
// Fire — depreciation-based cascade
// -----------------------------------------------------------------------------
function buildFireLossContext(lossSheet, lossItems, claim) {
  const grossLoss = lossSheet?.gross_loss ?? claim?.gross_loss ?? null;
  const adjustedLoss = lossSheet?.adjusted_loss ?? grossLoss;
  const netPayable = lossSheet?.net_payable ?? adjustedLoss;
  const totalSalvage = sumSalvage(lossItems);

  return {
    sum_insured_inr:                 fmtINR(lossSheet?.sum_insured ?? claim?.sum_insured),
    value_at_risk_inr:               fmtINR(lossSheet?.value_at_risk),
    gross_loss_inr:                  fmtINR(grossLoss),
    adjusted_loss_inr:               fmtINR(adjustedLoss),
    net_payable_inr:                 fmtINR(netPayable),
    net_adjusted_loss_inr:           fmtINR(netPayable),
    net_adjusted_loss_words:         rupeesInWords(netPayable),
    excess_inr:                      fmtINR(lossSheet?.excess_amount),
    total_salvage_inr:               fmtINR(totalSalvage),
    salvage_inr:                     fmtINR(totalSalvage),
    underinsurance_factor_pct:       fmtUnderinsuranceFactor(lossSheet?.underinsurance_factor),
    underinsurance_paragraph:        underinsuranceParagraph(lossSheet),

    // Marine cascade keys aren't applicable for Fire — leave blank but
    // don't break the substitution.
    subtotal_inr: '',
    insurance_rate_pct: '',
    insurance_total_inr: '',
    pre_gst_inr: '',
    gst_rate_pct: '',
    gst_amount_inr: '',
    after_gst_inr: '',
    handling_rate_pct: '',
    handling_label: '',
    handling_amount_inr: '',
    net_loss_inr: fmtINR(netPayable),
    not_covered_inr: '',
    estimated_reserve_inr: fmtINR(grossLoss),
  };
}

// -----------------------------------------------------------------------------
// Marine — insurance% / GST% / handling% cascade
// -----------------------------------------------------------------------------
function buildMarineLossContext(marineSheet, marineItems, claim) {
  const subtotal = marineSheet?.subtotal_amount ?? sumLineAmounts(marineItems);
  const insRate = numberOrEmpty(marineSheet?.insurance_rate_pct);
  const insTotal = marineSheet?.insurance_total ?? null;
  const preGst = marineSheet?.pre_gst_total ?? null;
  const gstRate = numberOrEmpty(marineSheet?.gst_rate_pct);
  const gstAmt = marineSheet?.gst_amount ?? null;
  const afterGst = marineSheet?.after_gst_total ?? null;
  const handRate = numberOrEmpty(marineSheet?.handling_rate_pct);
  const handAmt = marineSheet?.handling_amount ?? null;
  const grossLoss = marineSheet?.after_handling_total ?? marineSheet?.gross_loss ?? claim?.gross_loss ?? null;
  const salvage = marineSheet?.salvage_amount ?? null;
  const netLoss = marineSheet?.net_loss ?? null;
  const excess = marineSheet?.excess_amount ?? null;
  const netAdj = marineSheet?.net_adjusted_loss ?? null;

  return {
    sum_insured_inr:           fmtINR(claim?.sum_insured),
    estimated_reserve_inr:     fmtINR(grossLoss ?? claim?.gross_loss),

    subtotal_inr:              fmtINR(subtotal),
    insurance_rate_pct:        insRate,
    insurance_total_inr:       fmtINR(insTotal),
    pre_gst_inr:               fmtINR(preGst),
    gst_rate_pct:              gstRate,
    gst_amount_inr:            fmtINR(gstAmt),
    after_gst_inr:             fmtINR(afterGst),
    handling_rate_pct:         handRate,
    // Default 'Add 10%' matches the column default in
    // 20260503020000_marine_handling_label and the production samples
    // (T-012, 4790). Surveyors override per-claim via the
    // marine_loss_sheets.handling_label column.
    handling_label:            marineSheet?.handling_label || 'Add 10%',
    handling_amount_inr:       fmtINR(handAmt),
    gross_loss_inr:            fmtINR(grossLoss),
    salvage_inr:               fmtINR(salvage),
    net_loss_inr:              fmtINR(netLoss),
    excess_inr:                fmtINR(excess),
    net_adjusted_loss_inr:     fmtINR(netAdj),
    net_adjusted_loss_words:   rupeesInWords(netAdj),

    // Fire-specific keys — empty for Marine
    value_at_risk_inr: '',
    adjusted_loss_inr: '',
    net_payable_inr: fmtINR(netAdj),
    total_salvage_inr: fmtINR(salvage),
    underinsurance_factor_pct: '',
    underinsurance_paragraph: 'Marine Cargo claims under turnover/open policies are valued on a CIF + sundry basis; underinsurance is not applicable.',
    not_covered_inr: '',
  };
}

// -----------------------------------------------------------------------------
// Extended Warranty — invoice + GST cascade
// -----------------------------------------------------------------------------
function buildEwLossContext(ewClaim, claim) {
  const invoiceAmount = ewClaim?.repair_invoice_amount ?? ewClaim?.invoice_amount ?? claim?.gross_loss ?? null;
  const gstRate = ewClaim?.gst_rate_pct ?? 18;
  const gstAmount = invoiceAmount && Number.isFinite(Number(invoiceAmount))
    ? Math.round(Number(invoiceAmount) * (gstRate / (100 + gstRate)))
    : null;
  const afterGst = invoiceAmount && gstAmount !== null
    ? Number(invoiceAmount) - gstAmount
    : null;
  const notCovered = ewClaim?.not_covered_amount ?? 0;
  const netAdjusted = afterGst !== null ? afterGst - Number(notCovered || 0) : afterGst;

  return {
    sum_insured_inr:         fmtINR(claim?.sum_insured),
    estimated_reserve_inr:   fmtINR(invoiceAmount),

    gross_loss_inr:          fmtINR(invoiceAmount),
    gst_rate_pct:            gstRate,
    gst_amount_inr:          fmtINR(gstAmount),
    after_gst_inr:           fmtINR(afterGst),
    not_covered_inr:         fmtINR(notCovered),
    net_adjusted_loss_inr:   fmtINR(netAdjusted),
    net_adjusted_loss_words: rupeesInWords(netAdjusted),

    // Marine-specific keys
    subtotal_inr: '',
    insurance_rate_pct: '',
    insurance_total_inr: '',
    pre_gst_inr: '',
    handling_rate_pct: '',
    handling_label: '',
    handling_amount_inr: '',
    salvage_inr: '',
    net_loss_inr: fmtINR(netAdjusted),
    excess_inr: '',
    // Fire keys
    value_at_risk_inr: '',
    adjusted_loss_inr: '',
    net_payable_inr: fmtINR(netAdjusted),
    total_salvage_inr: '',
    underinsurance_factor_pct: '',
    underinsurance_paragraph: 'Extended Warranty cover indemnifies the insured against the cost of replacing manufacturer-defective parts; underinsurance is not applicable.',
  };
}

// -----------------------------------------------------------------------------
// Narrative defaults — every placeholder used by the real-sample templates
// resolves to a value (empty string → "(blank)" via substitute()).
// -----------------------------------------------------------------------------
function buildNarrativeContext(n, claim) {
  const src = n || {};
  const f = (k) => (typeof src[k] === 'string' ? src[k] : '');

  // Marine Cargo damage breakdowns. The surveyor types the structured
  // damaged_items array into narrative_jsonb (Phase 1b ships a UI for this);
  // we pre-render the two HTML tables server-side and expose them via
  // {{narrative.damaged_items_table}} / {{narrative.loss_summary_table}}
  // (both registered in TRUSTED_HTML_KEYS so substitute() doesn't escape
  // the table markup).
  const damagedItems = Array.isArray(src.damaged_items) ? src.damaged_items : [];
  const damagedItemsTable = renderDamagedItemsTable(damagedItems);
  const lossSummaryTable = renderLossSummaryTable(damagedItems);

  return {
    // Marine (cargo + hull)
    insurer_office_address:    f('insurer_office_address'),
    instructions_received_from: f('instructions_received_from'),
    dates_of_survey:           f('dates_of_survey'),
    place_of_survey:           f('place_of_survey'),
    person_contacted:          f('person_contacted'),
    lr_no:                     f('lr_no'),
    lr_date:                   f('lr_date'),
    vehicle_no:                f('vehicle_no'),
    vessel_name:               f('vessel_name'),
    transit:                   f('transit'),
    basis_of_valuation:        f('basis_of_valuation'),
    policy_packing_description: f('policy_packing_description'),
    transport_mode:            f('transport_mode'),
    commodity_description:     f('commodity_description'),
    journey_details:           f('journey_details'),
    policy_excess_text:        f('policy_excess_text'),
    risks_covered:             f('risks_covered'),
    carrier:                   f('carrier'),
    consignor:                 f('consignor'),
    consignee:                 f('consignee'),
    goods_description:         f('goods_description'),
    invoice_details:           f('invoice_details'),
    total_consignment_value_inr: f('total_consignment_value_inr'),
    packing_description:       f('packing_description'),
    date_of_booking:           f('date_of_booking'),
    date_of_arrival:           f('date_of_arrival'),
    situation_of_loss:         f('situation_of_loss'),
    observations:              f('observations') || f('surveyObservations'),
    insured_claim_amount_inr:  f('insured_claim_amount_inr'),
    insured_claim_amount_words: f('insured_claim_amount_words'),
    gst_treatment:             f('gst_treatment') || 'GST component has been considered subject to reversal proof.',
    salvage_basis:             f('salvage_basis'),
    consent_of_insured:        f('consent_of_insured'),
    lr_remarks:                f('lr_remarks'),
    damage_certificate:        f('damage_certificate'),
    monetary_claim_status:     f('monetary_claim_status'),
    probable_cause:            f('probable_cause'),

    // Extended Warranty
    insured_address:           f('insured_address'),
    plan_name:                 f('plan_name'),
    customer_name:             f('customer_name'),
    registration_no:           f('registration_no'),
    date_of_registration:      f('date_of_registration'),
    vehicle_make:              f('vehicle_make'),
    vehicle_model:             f('vehicle_model'),
    vin:                       f('vin'),
    engine_no:                 f('engine_no'),
    odometer:                  f('odometer'),
    certificate_no:            f('certificate_no'),
    certificate_validity:      f('certificate_validity'),
    product_description:       f('product_description'),
    terms_and_conditions:      f('terms_and_conditions'),
    tax_invoice_no:            f('tax_invoice_no'),
    tax_invoice_date:          f('tax_invoice_date'),
    tax_invoice_amount_inr:    f('tax_invoice_amount_inr'),
    assessment_basis:          f('assessment_basis'),
    customer_complaint:        f('customer_complaint'),
    service_centre:            f('service_centre'),

    // Cross-LOB / ILA
    preliminary_findings:      f('preliminary_findings'),
    documents_pending:         f('documents_pending'),
    next_steps:                f('next_steps'),

    // Fire-specific (kept from earlier templates so the Fire FSR v2 still renders)
    about_insured:             f('about_insured'),
    about_consignment:         f('about_consignment'),
    incident_quote:            f('incident_quote'),
    police_gd:                 f('police_gd'),
    fire_brigade:              f('fire_brigade'),

    // Older AI-pack vocabulary (so claim_fsr_drafts.narrative_jsonb keys
    // saved under the AI-pack names also resolve)
    causeOfLoss:               f('causeOfLoss'),
    surveyObservations:        f('surveyObservations'),
    policyAdmissibility:       f('policyAdmissibility'),
    recommendation:            f('recommendation'),

    // -------- Ultratech Marine Cargo template additions --------
    // Single-value narrative fields used by the Ultratech_Marine_Cargo_v1
    // template. Each falls back to '' (rendered as "(blank)" by substitute).
    consignor_name:                f('consignor_name'),
    consignor_address:             f('consignor_address'),
    consignee_name:                f('consignee_name'),
    consignee_address:             f('consignee_address'),
    transit_from:                  f('transit_from'),
    transit_to:                    f('transit_to'),
    rr_no:                         f('rr_no'),
    rr_date:                       f('rr_date'),
    date_of_dispatch:              f('date_of_dispatch'),
    place_of_arrival:              f('place_of_arrival'),
    type_of_load:                  f('type_of_load'),
    type_of_packing:               f('type_of_packing'),
    cargo_type:                    f('cargo_type'),
    consignment_weight_bags:       f('consignment_weight_bags'),
    consignment_weight_mt:         f('consignment_weight_mt'),
    mode_of_transit:               f('mode_of_transit'),
    invoice_details_block:         f('invoice_details_block'),
    total_consignment_value_inr_ult: f('total_consignment_value_inr_ult'),
    type_of_loss:                  f('type_of_loss'),
    cause_of_loss_short:           f('cause_of_loss_short'),
    nature_of_loss:                f('nature_of_loss'),
    extent_of_loss:                f('extent_of_loss'),
    catastrophic_event:            f('catastrophic_event'),
    accident_loss:                 f('accident_loss'),
    import_leg_loss:               f('import_leg_loss'),
    inter_depot_movement:          f('inter_depot_movement'),
    loss_location_label:           f('loss_location_label'),
    fir_status:                    f('fir_status'),
    carrier_name:                  f('carrier_name'),
    vehicle_present_at_visit:      f('vehicle_present_at_visit'),
    storage_condition:             f('storage_condition'),
    cargo_segregated:              f('cargo_segregated'),
    packing_external_condition:    f('packing_external_condition'),
    incident_narrative:            f('incident_narrative'),
    observation_narrative:         f('observation_narrative'),
    consent_status:                f('consent_status'),
    consent_date:                  f('consent_date'),
    final_doc_submission_date:     f('final_doc_submission_date'),
    delay_reason:                  f('delay_reason'),
    interest_insured:              f('interest_insured'),
    policy_packing_details:        f('policy_packing_details'),
    policy_conveyance:             f('policy_conveyance'),
    policy_voyage:                 f('policy_voyage'),
    policy_coverage_type:          f('policy_coverage_type'),
    policy_basis_of_valuation:     f('policy_basis_of_valuation'),
    policy_excess:                 f('policy_excess'),
    policy_type_label:             f('policy_type_label'),
    policy_period_label:           f('policy_period_label'),
    rate_per_mt_inr:               f('rate_per_mt_inr'),
    freight_per_mt_inr:            f('freight_per_mt_inr'),
    excess_amount_inr:             f('excess_amount_inr'),
    gross_assessed_loss_inr:       f('gross_assessed_loss_inr'),
    net_adjusted_loss_inr_ult:     f('net_adjusted_loss_inr_ult'),
    net_adjusted_loss_words_ult:   f('net_adjusted_loss_words_ult'),
    average_pct_loss:              f('average_pct_loss'),
    treatment_of_tax_note:         f('treatment_of_tax_note'),
    salvage_amount_note:           f('salvage_amount_note'),
    salvage_pickup_date:           f('salvage_pickup_date'),
    salvage_buyer:                 f('salvage_buyer'),
    insurer_team_salvage:          f('insurer_team_salvage'),
    recommendation_text:           f('recommendation_text'),
    recommendation_amount_inr:     f('recommendation_amount_inr'),
    recommendation_amount_words:   f('recommendation_amount_words'),

    // Pre-rendered HTML tables — see TRUSTED_HTML_KEYS for the unescape
    // contract. Source data lives at narrative.damaged_items (array).
    damaged_items_table:           damagedItemsTable,
    loss_summary_table:            lossSummaryTable,
  };
}

// -----------------------------------------------------------------------------
// Ultratech Marine Cargo damaged-bag tables. The surveyor types the
// damaged_items array into narrative_jsonb; these helpers turn it into HTML
// rows for the FSR's two breakdown tables.
//
// Item shape (each row in narrative.damaged_items):
//   {
//     invoice_no:            string,
//     description:           string,    e.g. 'HDPE PP Pack'
//     pack_size:             string,    e.g. '50 kg'
//     total_dispatched_bags: number,
//     total_dispatched_mt:   number,
//     damaged_bags:          number,
//     damaged_mt:            number,
//     extent_pct:            number,    percentage allowance (0–100)
//     loss_allowed_bags:     number,    derived: damaged_bags × extent_pct/100
//     loss_allowed_mt:       number,    derived: damaged_mt × extent_pct/100
//   }
// -----------------------------------------------------------------------------
export function renderDamagedItemsTable(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';

  const rows = items.map((it) => `
    <tr>
      <td>${escapeHtml(it.invoice_no || '')}</td>
      <td>${escapeHtml(it.description || '')}</td>
      <td>${escapeHtml(it.pack_size || '')}</td>
      <td class="num">${fmtNumber(it.total_dispatched_bags, 0)}</td>
      <td class="num">${fmtNumber(it.total_dispatched_mt, 3)}</td>
      <td class="num">${fmtNumber(it.damaged_bags, 0)}</td>
      <td class="num">${fmtNumber(it.damaged_mt, 3)}</td>
    </tr>`).join('');

  const totalDispBags = items.reduce((s, i) => s + (Number(i.total_dispatched_bags) || 0), 0);
  const totalDispMt   = items.reduce((s, i) => s + (Number(i.total_dispatched_mt) || 0), 0);
  const totalDmgBags  = items.reduce((s, i) => s + (Number(i.damaged_bags) || 0), 0);
  const totalDmgMt    = items.reduce((s, i) => s + (Number(i.damaged_mt) || 0), 0);

  return `
<table class="loss">
  <thead>
    <tr>
      <th rowspan="2">Invoice / STN No</th>
      <th rowspan="2">Description of Items</th>
      <th rowspan="2">Pack Size</th>
      <th colspan="2">Total Dispatched Qty.</th>
      <th colspan="2">Damaged Qty.</th>
    </tr>
    <tr>
      <th>In Bags</th>
      <th>Weight (MT)</th>
      <th>In Bags</th>
      <th>Weight (MT)</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="3" style="text-align:right;"><strong>Total</strong></td>
      <td class="num"><strong>${fmtNumber(totalDispBags, 0)}</strong></td>
      <td class="num"><strong>${fmtNumber(totalDispMt, 3)}</strong></td>
      <td class="num"><strong>${fmtNumber(totalDmgBags, 0)}</strong></td>
      <td class="num"><strong>${fmtNumber(totalDmgMt, 3)}</strong></td>
    </tr>
  </tfoot>
</table>`;
}

export function renderLossSummaryTable(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';

  const rows = items.map((it) => `
    <tr>
      <td>${escapeHtml(it.description || '')}</td>
      <td>${escapeHtml(it.pack_size || '')}</td>
      <td class="num">${fmtNumber(it.damaged_bags, 0)}</td>
      <td class="num">${fmtNumber(it.damaged_mt, 3)}</td>
      <td class="num">${fmtNumber(it.extent_pct, 0)}</td>
      <td class="num">${fmtNumber(it.loss_allowed_bags, 0)}</td>
      <td class="num">${fmtNumber(it.loss_allowed_mt, 3)}</td>
    </tr>`).join('');

  // Average extent across rows, weighted by damaged_mt where available.
  const totalDmgMt = items.reduce((s, i) => s + (Number(i.damaged_mt) || 0), 0);
  const weightedExtent = totalDmgMt > 0
    ? items.reduce((s, i) => s + (Number(i.extent_pct) || 0) * (Number(i.damaged_mt) || 0), 0) / totalDmgMt
    : items.reduce((s, i) => s + (Number(i.extent_pct) || 0), 0) / items.length;

  return `
<table class="loss">
  <thead>
    <tr>
      <th rowspan="2">Description of Items</th>
      <th rowspan="2">Pack Size</th>
      <th colspan="2">Damaged Qty</th>
      <th rowspan="2">Extent of damage (%age Allowance)</th>
      <th colspan="2">Qty. of loss Allowed</th>
    </tr>
    <tr>
      <th>In Bags</th>
      <th>Weight (MT)</th>
      <th>In Bags</th>
      <th>Weight (MT)</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="6" style="text-align:right;"><strong>Average Percentage of Loss</strong></td>
      <td class="num"><strong>${fmtNumber(weightedExtent, 0)}%</strong></td>
    </tr>
  </tfoot>
</table>`;
}

// -----------------------------------------------------------------------------
// renderLossItemsTable — Fire/depreciation-style table (existing — unchanged)
// -----------------------------------------------------------------------------
export function renderLossItemsTable(items = []) {
  if (!items.length) {
    return '<p style="color: #64748b; font-size: 10pt;">No itemised loss recorded.</p>';
  }

  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.item_no)}</td>
      <td>${escapeHtml(item.description)}${item.notes ? `<br/><span style="font-size: 9pt; color: #64748b;">${escapeHtml(item.notes)}</span>` : ''}</td>
      <td>${escapeHtml(item.category || '')}</td>
      <td class="num">${fmtINR(item.replacement_value)}</td>
      <td class="num">${fmtNumber(item.age_years, 2) || '—'}</td>
      <td class="num">${fmtNumber(item.depreciation_pct, 2)}${item.depreciation_pct_override ? ' †' : ''}</td>
      <td class="num">${fmtINR(item.depreciated_value)}</td>
      <td class="num">${fmtINR(item.salvage_value)}</td>
      <td class="num"><strong>${fmtINR(item.net_loss)}</strong></td>
    </tr>`).join('');

  return `
<table class="loss">
  <thead>
    <tr>
      <th>#</th>
      <th>Description</th>
      <th>Category</th>
      <th>RV</th>
      <th>Age (yrs)</th>
      <th>Dep %</th>
      <th>Dep'd value</th>
      <th>Salvage</th>
      <th>Net loss</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

// -----------------------------------------------------------------------------
// renderMarineLossItemsTable — Marine-style claimed-vs-assessed
// -----------------------------------------------------------------------------
// Mirrors the production Marine sample table:
//   # | Description | UOM | Damaged Qty | Rate | Amount
// Plus a footer row totalling the amount column.
// -----------------------------------------------------------------------------
export function renderMarineLossItemsTable(items = []) {
  if (!items.length) {
    return '<p style="color: #64748b; font-size: 10pt;">No itemised cargo damage recorded.</p>';
  }

  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.item_no)}</td>
      <td>${escapeHtml(item.description || '')}${item.code ? `<br/><span style="font-size: 9pt; color: #64748b;">Code: ${escapeHtml(item.code)}</span>` : ''}</td>
      <td>${escapeHtml(item.unit || item.pack_size || '')}</td>
      <td class="num">${fmtNumber(item.damaged_qty, 2)}</td>
      <td class="num">${fmtINR(item.rate)}</td>
      <td class="num"><strong>${fmtINR(item.amount)}</strong></td>
    </tr>`).join('');

  return `
<table class="loss">
  <thead>
    <tr>
      <th>#</th>
      <th>Description</th>
      <th>UOM</th>
      <th>Damaged Qty</th>
      <th>Rate</th>
      <th>Amount</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="5" style="text-align: right;"><strong>Subtotal</strong></td>
      <td class="num"><strong>${fmtINR(total)}</strong></td>
    </tr>
  </tfoot>
</table>`;
}

// -----------------------------------------------------------------------------
// underinsuranceParagraph — prose summary appropriate for the FSR §3
// -----------------------------------------------------------------------------
export function underinsuranceParagraph(lossSheet = {}) {
  const si = Number(lossSheet?.sum_insured);
  const var_total = Number(lossSheet?.value_at_risk);
  const factor = lossSheet?.underinsurance_factor;

  if (!Number.isFinite(si) || si <= 0) {
    return 'Sum insured is not recorded — adequacy of sum insured cannot be assessed at this stage.';
  }
  if (!Number.isFinite(var_total) || var_total <= 0) {
    return `Sum insured of ${fmtINR(si)} on the policy. Value at risk has not been quantified yet — adequacy of sum insured will be reviewed in the supplementary report once the loss sheet is complete.`;
  }
  if (factor === null || factor === undefined) {
    return `Sum insured ${fmtINR(si)} against value at risk ${fmtINR(var_total)}. Underinsurance has not been computed.`;
  }
  if (factor >= 1) {
    return `Sum insured of ${fmtINR(si)} fully covers the value at risk of ${fmtINR(var_total)}. The policy is adequately insured; no underinsurance applies.`;
  }
  const shortfallPct = ((1 - factor) * 100).toFixed(2);
  return `Sum insured of ${fmtINR(si)} against the value at risk of ${fmtINR(var_total)} indicates underinsurance to the extent of ${shortfallPct}%. As per condition of average, the assessed loss is reduced proportionately by the factor ${factor.toFixed(4)}.`;
}

// -----------------------------------------------------------------------------
// substitute — pure {{a.b.c}} resolver (escaped output, modulo trusted keys)
// -----------------------------------------------------------------------------
const TRUSTED_HTML_KEYS = new Set([
  'loss_items_table',
  'loss_sheet.underinsurance_paragraph',
  // Pre-rendered server-side from narrative.damaged_items (an array). The
  // surveyor never types HTML directly into these — values are escaped by
  // renderDamagedItemsTable / renderLossSummaryTable before the wrapping
  // <table> markup is added. See lib/fsr/render.js.
  'narrative.damaged_items_table',
  'narrative.loss_summary_table',
]);

export function substitute(template, context) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g, (_whole, path) => {
    const value = resolvePath(context, path);
    if (value === undefined || value === null || value === '') return '(blank)';
    if (TRUSTED_HTML_KEYS.has(path)) return String(value);
    return escapeHtml(value);
  });
}

function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

// -----------------------------------------------------------------------------
// formatting helpers
// -----------------------------------------------------------------------------

export function fmtINR(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return INR_FORMATTER.format(n);
}

export function fmtNumber(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(decimals);
}

export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtUnderinsuranceFactor(factor) {
  if (factor === null || factor === undefined) return 'Not applicable';
  const n = Number(factor);
  if (!Number.isFinite(n)) return 'Not applicable';
  if (n >= 1) return 'Nil (fully insured)';
  return `${(n * 100).toFixed(2)}% applied`;
}

function numberOrEmpty(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return fmtNumber(n, 2);
}

function sumSalvage(items = []) {
  return items.reduce((s, i) => s + (Number(i.salvage_value) || 0), 0);
}

function sumLineAmounts(items = []) {
  return items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
