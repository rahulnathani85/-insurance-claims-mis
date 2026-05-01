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
    narrative: buildNarrativeContext(narrative),

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
    handling_label:            marineSheet?.handling_label || 'Handling',
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
function buildNarrativeContext(n) {
  const src = n || {};
  const f = (k) => (typeof src[k] === 'string' ? src[k] : '');
  return {
    // Marine
    insurer_office_address:    f('insurer_office_address'),
    instructions_received_from: f('instructions_received_from'),
    dates_of_survey:           f('dates_of_survey'),
    place_of_survey:           f('place_of_survey'),
    person_contacted:          f('person_contacted'),
    lr_no:                     f('lr_no'),
    lr_date:                   f('lr_date'),
    vehicle_no:                f('vehicle_no'),
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
  };
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
