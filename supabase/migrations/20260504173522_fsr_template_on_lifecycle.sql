-- =============================================================================
-- 20260504173522_fsr_template_on_lifecycle.sql
-- =============================================================================
-- Wires FSR template selection to the lifecycle engine.
--
-- Background:
--   `lifecycle_templates` already has 9 matcher columns (match_lob,
--   match_client, match_policy_type, etc.) and a specificity-cascade resolver
--   in lib/lifecycleEngine.js. The seeded `marine_ultratech` lifecycle row
--   (match_lob='Marine Cargo', match_client='UltraTech') correctly fires for
--   any Ultratech Marine Cargo claim.
--
--   `fsr_lob_templates` was indexed by (company, lob, template_name) only —
--   no insured-/client-aware variants without duplicating the matcher engine.
--
-- This migration:
--   1) Adds `fsr_template_name` to `lifecycle_templates`. Each lifecycle
--      template can carry a pointer to the fsr_lob_templates row it should
--      render against. NULL = "fall back to (company, lob, 'Production')"
--      during the soft-transition window (claims pre-dating this migration).
--   2) Inserts the new `Ultratech_Marine_Cargo_v1` HTML into fsr_lob_templates
--      for NISLA. Acuere variant left for a follow-up.
--   3) Updates the seeded `marine_ultratech` lifecycle row to point at the
--      new FSR template.
--
-- Read by lib/fsr/draft.js.resolveFsrTemplateName at FSR render time.
-- Soft transition: claims with created_at < this migration's timestamp
-- continue working via the legacy (company, lob, 'Production') path.
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Hook on lifecycle_templates
-- ----------------------------------------------------------------------------
ALTER TABLE public.lifecycle_templates
  ADD COLUMN IF NOT EXISTS fsr_template_name TEXT;

COMMENT ON COLUMN public.lifecycle_templates.fsr_template_name IS
  'Optional pointer to a fsr_lob_templates.template_name. Read by lib/fsr/draft.js.resolveFsrTemplateName at FSR render time. NULL means "fall back to (company, lob, ''Production'')" — soft-transition behaviour during the lifecycle-gate rollout. Once Phase 4 ships (lifecycle gate extended to all post-registration artifacts), every active lifecycle template should set this to a concrete fsr_lob_templates row.';

-- ----------------------------------------------------------------------------
-- 2. Author the new Ultratech Marine Cargo FSR template (NISLA letterhead)
--
-- Variables:
--   {{claim.*}}                   — auto-filled from the claims row
--   {{date_today}}                — current date in en-IN
--   {{signer.name}} / .license    — surveyor sigblock
--   {{narrative.*}}               — surveyor-typed (Phase 1b ships UI form)
--   {{narrative.damaged_items_table}} / .loss_summary_table
--                                 — pre-rendered server-side from
--                                   narrative.damaged_items (array). Both
--                                   keys are in TRUSTED_HTML_KEYS so the
--                                   table markup is rendered, not escaped.
--
-- Typo / structural fixes vs the user-provided source docx:
--   "due to reported fire"            → "due to reported damage during transit"
--   "Tata AIG General Insuranc Co"    → "Tata AIG General Insurance Co. Ltd."
--   "Ahura Cement"                    → "Ahura Centre"
--   "Consent Datae"                   → "Consent Date"
--   Recommendation amount inconsistent w/ assessed → driven by narrative
--                                                    so surveyor sets it.
-- ----------------------------------------------------------------------------
INSERT INTO public.fsr_lob_templates (company, lob, template_name, version, body_html, is_active)
VALUES ('NISLA', 'Marine Cargo', 'Ultratech_Marine_Cargo_v1', 1,
$HTML$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Final Survey Report — {{claim.ref_number}}</title>
<style>
  @page { size: A4 portrait; margin: 18mm 16mm; }
  body { font-family: 'Times New Roman', Georgia, serif; font-size: 11pt; line-height: 1.45; color: #0f172a; }
  .letterhead { text-align: center; border-bottom: 2px solid {{company.accent_color}}; padding-bottom: 8px; margin-bottom: 14px; }
  .letterhead h1 { margin: 0; font-size: 16pt; letter-spacing: 0.4px; }
  .letterhead .lic { font-size: 9.5pt; color: #334155; margin-top: 4px; }
  .letterhead .addr { font-size: 9pt; color: #475569; margin-top: 3px; }
  h2.report-title { text-align: center; margin: 16px 0 10px; font-size: 14pt; letter-spacing: 0.6px; }
  h3.section { font-size: 12pt; margin: 18px 0 6px; color: {{company.accent_color}}; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 10.5pt; }
  table.kv td { border: 1px solid #94a3b8; padding: 5px 8px; vertical-align: top; }
  table.kv td.k { width: 32%; background: #f1f5f9; font-weight: 600; }
  table.loss th, table.loss td { border: 1px solid #94a3b8; padding: 5px 6px; }
  table.loss th { background: #e2e8f0; font-weight: 600; text-align: left; }
  table.loss td.num, table.loss th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.loss tfoot td { background: #f1f5f9; }
  .head-meta { display: table; width: 100%; margin-bottom: 8px; }
  .head-meta div { display: table-cell; }
  .head-meta .right { text-align: right; }
  .stamp { font-style: italic; font-size: 10pt; color: #475569; }
  .sigblock { margin-top: 28px; }
  .sigblock .sig-row { display: table; width: 100%; margin-top: 8px; }
  .sigblock .sig-row > div { display: table-cell; vertical-align: top; }
  .sigblock .sig-row .right { text-align: right; }
  ul.notes { margin: 4px 0 0 18px; padding: 0; }
  .small { font-size: 9.5pt; color: #475569; }
  .narrative p { margin: 0 0 8px; text-align: justify; }
  .cover-letter p { margin: 0 0 8px; text-align: justify; }
  .declaration p { margin: 0 0 8px; text-align: justify; }
</style>
</head>
<body>

<div class="letterhead">
  <h1>{{company.name}}</h1>
  <div class="lic">{{company.license_line}}</div>
  <div class="addr">{{company.address_line}}</div>
</div>

<div class="head-meta">
  <div><strong>Ref. No:</strong> {{claim.ref_number}}</div>
  <div class="right"><strong>Date:</strong> {{date_today}}</div>
</div>

<h2 class="report-title">FINAL SURVEY REPORT</h2>
<h3 class="section" style="text-align:center; border:none;">REPORTED LOSS / DAMAGE DURING TRANSIT</h3>

<table class="kv">
  <tr><td class="k">Date of Loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="k">Claim Number</td><td>{{claim.claim_number}}</td></tr>
  <tr><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="k">Marine Cargo Open Policy No.</td><td>{{claim.policy_number}}</td></tr>
</table>

<h2 class="report-title" style="margin-top:24px;">FINAL MARINE SURVEY REPORT</h2>
<p class="stamp" style="text-align:center; margin-top:-6px;">(Without Prejudice)</p>

<div class="cover-letter">
  <p><strong>To,</strong><br/>
  The Claim In-charge,<br/>
  Claims — Commercial Lines,<br/>
  {{claim.insurer_name}}<br/>
  {{narrative.insurer_office_address}}</p>

  <p><strong>Subject:</strong> Reported loss/damage to consignment pertaining to RR No. {{narrative.rr_no}} dated {{narrative.rr_date}} || Date of Loss: {{claim.date_loss}}<br/>
  Policy No. {{claim.policy_number}} || Insured: {{claim.insured_name}} || Claim No. {{claim.claim_number}}</p>

  <p>Dear Sir,</p>

  <p>Pursuant to valued instructions received on {{claim.date_of_intimation}} for survey and loss assessment, we immediately contacted the insured's representative, took an appointment, and visited the affected location on {{narrative.dates_of_survey}} for survey of the loss reportedly caused to the insured during transit. At the location, we met the consignee's representative, {{narrative.person_contacted}}, and discussed the loss.</p>

  <p>We are now submitting our final survey and loss assessment report, which is based on the following observations and the documents furnished by the insured.</p>
</div>

<h3 class="section">Claim Details</h3>
<table class="kv">
  <tr><td class="k">(a) Loss to Insured</td><td>Reported loss/damage to consignment during transit</td></tr>
  <tr><td class="k">(b) Date of Loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="k">(c) Date of Intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="k">(d) Date(s) of Survey</td><td>{{narrative.dates_of_survey}}</td></tr>
  <tr><td class="k">(e) Loss Location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="k">(f) Place of Survey</td><td>{{narrative.place_of_survey}}</td></tr>
  <tr><td class="k">(g) RR No / Date</td><td>{{narrative.rr_no}} dated {{narrative.rr_date}}</td></tr>
  <tr><td class="k">(h) Goods Damaged</td><td>{{narrative.cargo_type}}</td></tr>
  <tr><td class="k">(i) Estimated Loss Amount</td><td>{{loss_sheet.estimated_reserve_inr}}</td></tr>
  <tr><td class="k">(j) Final Doc. Submission Date</td><td>{{narrative.final_doc_submission_date}}</td></tr>
  <tr><td class="k">(k) Consent Date</td><td>{{narrative.consent_date}}</td></tr>
  <tr><td class="k">(l) Reason for Delay</td><td>{{narrative.delay_reason}}</td></tr>
</table>

<h3 class="section">Policy Particulars</h3>
<table class="kv">
  <tr><td class="k">(a) Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="k">(b) Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="k">(c) Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="k">(d) Policy Type</td><td>{{narrative.policy_type_label}}</td></tr>
  <tr><td class="k">(e) Policy Period</td><td>{{claim.policy_period_from}} to {{claim.policy_period_to}}</td></tr>
  <tr><td class="k">(f) Interest Insured</td><td>{{narrative.interest_insured}}</td></tr>
  <tr><td class="k">(g) Packing Details (per policy)</td><td>{{narrative.policy_packing_details}}</td></tr>
  <tr><td class="k">(h) Conveyance</td><td>{{narrative.policy_conveyance}}</td></tr>
  <tr><td class="k">(i) Voyage</td><td>{{narrative.policy_voyage}}</td></tr>
  <tr><td class="k">(j) Coverage Type</td><td>{{narrative.policy_coverage_type}}</td></tr>
  <tr><td class="k">(k) Sum Insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="k">(l) Basis of Valuation</td><td>{{narrative.policy_basis_of_valuation}}</td></tr>
  <tr><td class="k">(m) Excess</td><td>{{narrative.policy_excess}}</td></tr>
</table>

<h3 class="section">Details of Consignment</h3>
<table class="kv">
  <tr><td class="k">(a) Consignor</td><td>{{narrative.consignor_name}}<br/><span class="small">{{narrative.consignor_address}}</span></td></tr>
  <tr><td class="k">(b) Consignee</td><td>{{narrative.consignee_name}}<br/><span class="small">{{narrative.consignee_address}}</span></td></tr>
  <tr><td class="k">(c) Type of Packing</td><td>{{narrative.type_of_packing}}</td></tr>
  <tr><td class="k">(d) Cargo Type / Product</td><td>{{narrative.cargo_type}}</td></tr>
  <tr><td class="k">(e) Consignment Weight</td><td>{{narrative.consignment_weight_bags}} bags / {{narrative.consignment_weight_mt}} MT</td></tr>
  <tr><td class="k">(f) Mode of Transit</td><td>{{narrative.mode_of_transit}}</td></tr>
  <tr><td class="k">(g) Transit From / To</td><td>{{narrative.transit_from}} → {{narrative.transit_to}}</td></tr>
  <tr><td class="k">(h) LR / RR No.</td><td>{{narrative.rr_no}} dated {{narrative.rr_date}}</td></tr>
  <tr><td class="k">(i) Date / Place of Dispatch</td><td>{{narrative.date_of_dispatch}} from {{narrative.transit_from}}</td></tr>
  <tr><td class="k">(j) Date of Arrival</td><td>{{narrative.date_of_arrival}}</td></tr>
  <tr><td class="k">(k) Place of Arrival</td><td>{{narrative.place_of_arrival}}</td></tr>
  <tr><td class="k">(l) Type of Load</td><td>{{narrative.type_of_load}}</td></tr>
  <tr><td class="k">(m) Invoice(s)</td><td>{{narrative.invoice_details_block}}</td></tr>
  <tr><td class="k">(n) Total Consignment Value</td><td>{{narrative.total_consignment_value_inr_ult}}</td></tr>
</table>

<h3 class="section">Loss Details</h3>
<table class="kv">
  <tr><td class="k">(a) Loss Date</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="k">(b) Type of Loss</td><td>{{narrative.type_of_loss}}</td></tr>
  <tr><td class="k">(c) Cause of Loss</td><td>{{narrative.cause_of_loss_short}}</td></tr>
  <tr><td class="k">(d) Catastrophic Event</td><td>{{narrative.catastrophic_event}}</td></tr>
  <tr><td class="k">(e) Loss due to Accident / Transhipment</td><td>{{narrative.accident_loss}}</td></tr>
  <tr><td class="k">(f) Loss under Import Leg</td><td>{{narrative.import_leg_loss}}</td></tr>
  <tr><td class="k">(g) Inter-depot Movement</td><td>{{narrative.inter_depot_movement}}</td></tr>
  <tr><td class="k">(h) Loss Location</td><td>{{narrative.loss_location_label}}</td></tr>
  <tr><td class="k">(i) FIR / Police Complaint</td><td>{{narrative.fir_status}}</td></tr>
  <tr><td class="k">(j) Carrier / Transporter</td><td>{{narrative.carrier_name}}</td></tr>
  <tr><td class="k">(k) Vehicle present at visit</td><td>{{narrative.vehicle_present_at_visit}}</td></tr>
  <tr><td class="k">(l) Storage condition of cargo</td><td>{{narrative.storage_condition}}</td></tr>
  <tr><td class="k">(m) Cargo Segregated</td><td>{{narrative.cargo_segregated}}</td></tr>
</table>

<h3 class="section">Packing Details</h3>
<div class="narrative">
  <p>{{narrative.packing_description}}</p>
  <p><strong>External condition of packing during survey:</strong> {{narrative.packing_external_condition}}</p>
</div>

<h3 class="section">Incident Details</h3>
<div class="narrative">
  <p>{{narrative.incident_narrative}}</p>
</div>

<h3 class="section">Cause of Loss</h3>
<p>{{narrative.cause_of_loss_short}}</p>

<h3 class="section">Nature of Loss</h3>
<p>{{narrative.nature_of_loss}}</p>

<h3 class="section">Extent of Loss</h3>
<p>{{narrative.extent_of_loss}}</p>

<h3 class="section">Our Observations / Findings</h3>
<div class="narrative">
  <p>{{narrative.observation_narrative}}</p>
</div>

<h3 class="section">Damaged Items</h3>
{{narrative.damaged_items_table}}

<h3 class="section">Summary of Damage Allowance</h3>
{{narrative.loss_summary_table}}

<h3 class="section">Assessment of Loss</h3>
<div class="narrative">
  <p>We have assessed the loss based on our physical inspection / verification of the damages.</p>
  <p><strong>Quantity:</strong> Physically verified the damaged quantity and considered accordingly in the assessment.</p>
  <p><strong>Rate:</strong> Per MT rate of cement taken from the STN / Invoice — {{narrative.rate_per_mt_inr}} per MT.</p>
  <p><strong>Basis of valuation:</strong> Partial loss.</p>
  <p><strong>Freight charges:</strong> {{narrative.freight_per_mt_inr}} per MT considered in the assessment.</p>
  <p><strong>Treatment of tax:</strong> {{narrative.treatment_of_tax_note}}</p>
  <p><strong>Salvage:</strong> {{narrative.salvage_amount_note}} Pickup date: {{narrative.salvage_pickup_date}}. Salvage buyer: {{narrative.salvage_buyer}}. Insurer salvage team involved: {{narrative.insurer_team_salvage}}.</p>
  <p><strong>Excess:</strong> {{narrative.excess_amount_inr}} for each and every claim.</p>
</div>

<h3 class="section">Summary of Assessment of Loss</h3>
<table class="loss">
  <tbody>
    <tr><td>Gross Assessed Loss</td><td class="num">{{narrative.gross_assessed_loss_inr}}</td></tr>
    <tr><td>Less: Excess as per Policy condition</td><td class="num">{{narrative.excess_amount_inr}}</td></tr>
    <tr><td><strong>Net Adjusted Loss</strong></td><td class="num"><strong>{{narrative.net_adjusted_loss_inr_ult}}</strong></td></tr>
  </tbody>
</table>
<p><em>{{narrative.net_adjusted_loss_words_ult}}</em> — subject to policy terms and conditions and final approval by the insurer.</p>

<h3 class="section">Consent of the Insured</h3>
<div class="narrative">
  <p>{{narrative.consent_of_insured}}</p>
  <p>The insured has agreed with the assessment and has given consent for the same.</p>
</div>

<h3 class="section">Recommendation</h3>
<p>We hereby recommend to the insurer to settle this claim by paying <strong>{{narrative.recommendation_amount_inr}}</strong> ({{narrative.recommendation_amount_words}}) to the insured, subject to policy terms and conditions.</p>
<p class="small">{{narrative.recommendation_text}}</p>

<h3 class="section">Notes</h3>
<ul class="notes">
  <li>We have not observed any breach of policy conditions / warranty.</li>
  <li>The loss does not fall under any exclusion.</li>
  <li>The loss falls within the policy period.</li>
  <li>The subject matter is covered under the policy.</li>
  <li>The cause of loss is a covered peril under the subject policy; liability would therefore fall upon the Insurer.</li>
</ul>

<h3 class="section">Declaration</h3>
<div class="declaration">
  <p>We hereby declare that we have no interest in the subject matter in question and reported on as above. We are neither related to the insured nor the business by blood, business or shareholding of any nature whatsoever.</p>
  <p>This concludes our final survey and loss assessment report which is issued without prejudice and is subject to the terms and conditions of the policy of insurance issued to and held by the Insured, reserving our rights to alter / amend any unintended error.</p>
</div>

<p class="stamp" style="text-align:right; margin-top:10px;">For discretion of the Insurer & their legal advisers only — Without Prejudice</p>

<div class="sigblock">
  <div class="sig-row">
    <div></div>
    <div class="right">
      <strong>For {{company.name}}</strong><br/>
      <br/><br/>
      ____________________________<br/>
      {{signer.name}}<br/>
      <span class="small">IRDAI Licence No. {{signer.license}}</span><br/>
      <span class="small">Authorised Signatory</span>
    </div>
  </div>
</div>

<h3 class="section" style="margin-top:24px;">Enclosures</h3>
<table class="loss">
  <thead>
    <tr><th>Document</th><th>Enclosed (Y/N)</th><th>Original / Copy</th></tr>
  </thead>
  <tbody>
    <tr><td>Communication mails with insured & insurer</td><td></td><td></td></tr>
    <tr><td>STN / Invoice</td><td></td><td></td></tr>
    <tr><td>BL / AWB / LR / GR / RR / Postal receipt</td><td></td><td></td></tr>
    <tr><td>Packing List</td><td></td><td></td></tr>
    <tr><td>Claim Form</td><td></td><td></td></tr>
    <tr><td>Claim Bill</td><td></td><td></td></tr>
    <tr><td>Certificate of Facts</td><td></td><td></td></tr>
    <tr><td>Photographs of damage / destruction</td><td></td><td></td></tr>
    <tr><td>Notice to Carrier (with POD)</td><td></td><td></td></tr>
    <tr><td>Pre-Dispatch Inspection Report</td><td></td><td></td></tr>
    <tr><td>Joint Inspection Report (JIR)</td><td></td><td></td></tr>
    <tr><td>Other Annexures</td><td></td><td></td></tr>
  </tbody>
</table>

</body>
</html>
$HTML$,
TRUE);

-- ----------------------------------------------------------------------------
-- 3. Wire the seeded marine_ultratech lifecycle template at the new FSR.
--    The lifecycle resolver picks marine_ultratech for any claim with
--    lob='Marine Cargo' AND client='UltraTech' (specificity 2, priority 250
--    — beats the generic Marine Cargo template at priority 200).
-- ----------------------------------------------------------------------------
UPDATE public.lifecycle_templates
SET    fsr_template_name = 'Ultratech_Marine_Cargo_v1'
WHERE  template_code = 'marine_ultratech';

-- Tell PostgREST to refresh its schema cache so the new column is visible
-- to the JS client without a redeploy.
NOTIFY pgrst, 'reload schema';

COMMIT;
