-- =============================================================================
-- 20260502020000_seed_marine_hull_templates.sql
-- =============================================================================
-- Slice 12 — Marine Hull Production templates for NISLA + Acuere.
-- Builds on 20260501000000_seed_real_sample_templates and the Fire-only
-- delta in 20260502000000_seed_fire_production_templates.
--
-- No real Marine Hull sample was available at template-build time; the
-- structure here is a best-effort PSU production format derived from the
-- Marine Cargo template with Hull-specific math:
--   - No insurance % adder (Hull = agreed value, not CIF + 10%).
--   - Optional Sue & Labour / General Average lines via handling_label.
--   - No GST adder (input GST in Hull repair invoices is reclaimable).
--
-- Idempotent: ON CONFLICT (company, lob, template_name, version) DO NOTHING.
-- Source HTML lives in nisla-ai-pack/templates/html/marine-hull--*.html
-- and can be regenerated via templates/portal-migrations/build.mjs.
-- =============================================================================

-- Marine Hull FSR (vessel particulars, repair-cost cascade, GA / Sue & Labour)
INSERT INTO public.fsr_lob_templates (company, lob, template_name, version, body_html, notes, is_active)
VALUES (
  'NISLA',
  'Marine Hull',
  'Production',
  1,
  $body$<!DOCTYPE html>
<!--
  Marine Hull FSR — NISLA letterhead.

  Goes into the portal table `fsr_lob_templates` as:
    company='NISLA' lob='Marine Hull' template_name='Production' version=1

  Marine Hull math differs from Marine Cargo:
    - No insurance % adder (Hull is valued at agreed value, not CIF + 10%).
    - Temporary repair + permanent repair lines.
    - Optional Sue & Labour expenses.
    - Optional General Average contribution.
    - Less: Salvage, Less: Excess.
    - No GST adder (input GST in Hull repair invoices is typically
      reclaimable as input credit and excluded from the assessed loss).

  This template uses the same `loss_sheet.*` placeholder vocabulary
  the Marine Cargo template uses (the underlying marine_loss_sheets
  table is shared); surveyors adapting it for Hull can set
  insurance_rate_pct + gst_rate_pct = 0 and use the handling_label
  field for Sue & Labour or General Average lines.

  No real Marine Hull sample was available at template-build time;
  the structure here is a best-effort PSU production format. Any
  adjustments based on real Hull reports should be made by editing
  this HTML and re-running templates/portal-migrations/build.mjs.
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Marine Hull FSR — {{claim.ref_number}}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #111; line-height: 1.45; }

    .letterhead { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 12px; }
    .letterhead h1 { margin: 0; font-size: 14pt; color: #1e3a5f; }
    .letterhead .lob-strip { font-size: 9pt; color: #475569; margin-top: 2px; letter-spacing: 0.4px; }
    .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }

    .ref-line { display: flex; justify-content: space-between; font-size: 10pt; margin: 8px 0; }
    .doc-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 14px 0 4px; color: #1e3a5f; letter-spacing: 0.4px; }
    .doc-sub { text-align: center; font-size: 10pt; color: #475569; font-style: italic; margin-bottom: 12px; }

    .to-block { font-size: 10pt; margin: 12px 0; line-height: 1.45; }
    .subject { font-size: 10pt; font-weight: 700; margin: 12px 0; padding: 8px; background: #f8fafc; border-left: 3px solid #1e3a5f; }
    h2 { font-size: 11pt; color: #1e3a5f; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.3px; }

    table.kv { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
    table.kv td { padding: 4px 6px; vertical-align: top; border: 1px solid #e2e8f0; font-size: 10pt; }
    table.kv td.lbl { width: 4%; font-weight: 600; color: #475569; text-align: center; }
    table.kv td.k   { width: 28%; font-weight: 600; color: #475569; }

    table.totals { width: 75%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
    table.totals td { padding: 4px 8px; }
    table.totals tr.subtotal td { font-weight: 600; border-top: 1px solid #cbd5e1; }
    table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1e3a5f; padding-top: 8px; font-size: 12pt; }
    table.totals td.num { text-align: right; }

    table.loss { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 8px 0; }
    table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 3px 5px; }
    table.loss th { background: #f1f5f9; font-weight: 700; text-align: center; }
    table.loss td.num { text-align: right; }

    blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 4px 12px; font-style: italic; color: #334155; background: #f8fafc; }
    ol.checklist { font-size: 10pt; margin: 4px 0 4px 18px; padding: 0; }
    .signoff { margin-top: 30px; padding-top: 12px; border-top: 1px dashed #94a3b8; }
    .footer { margin-top: 24px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    .annex { page-break-before: always; }
    p { margin: 6px 0; }
    .small { font-size: 9pt; color: #475569; }
  </style>
</head>
<body>

<div class="letterhead">
  <h1>NATHANI INSURANCE SURVEYORS &amp; LOSS ASSESSORS PVT. LTD.</h1>
  <div class="lob-strip">LOP &nbsp;|&nbsp; Fire &nbsp;|&nbsp; Engineering &nbsp;|&nbsp; Misc. &nbsp;|&nbsp; Marine Cargo &nbsp;|&nbsp; Marine Hull</div>
  <div class="sub">IRDA/CORP/S.L.A. No. 200025 (Exp. 03/10/2028)</div>
  <div class="sub">507, Garnet Palladium, Behind Express Zone Bldg., Off WE Highway, Goregaon (E), Mumbai – 400063</div>
</div>

<div class="ref-line">
  <span><strong>Ref. No:</strong> {{claim.ref_number}}</span>
  <span><strong>Date:</strong> {{date_today}}</span>
</div>

<div class="doc-title">MARINE HULL SURVEY REPORT</div>
<div class="doc-sub">(WITHOUT PREJUDICE)</div>

<div class="to-block">
  <strong>The Manager,</strong><br/>
  {{claim.insurer_name}}<br/>
  {{narrative.insurer_office_address}}
</div>

<div class="subject">
  <strong>Subject:</strong> Survey of Marine Hull damage — Vessel {{narrative.vessel_name}}<br/>
  <span class="small">Policy No: {{claim.policy_number}} &nbsp;||&nbsp; Insured: {{claim.insured_name}} &nbsp;||&nbsp; Claim No: {{claim.claim_number}}</span>
</div>

<p>Dear Sir,</p>
<p>Pursuant to valued instruction received from {{narrative.instructions_received_from}} on
   {{claim.date_of_intimation}}, we conducted the survey of the captioned Marine Hull
   claim. Our findings + assessment are below.</p>

<table class="kv">
  <tr><td class="k">Instructions received from</td><td>{{narrative.instructions_received_from}}</td></tr>
  <tr><td class="k">Date of incident</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="k">Date of survey</td><td>{{narrative.dates_of_survey}}</td></tr>
  <tr><td class="k">Place of survey</td><td>{{narrative.place_of_survey}}</td></tr>
  <tr><td class="k">Vessel name / IMO</td><td>{{narrative.vessel_name}}</td></tr>
  <tr><td class="k">Owner / Operator</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="k">Estimated loss</td><td>{{loss_sheet.gross_loss_inr}}</td></tr>
</table>

<h2>1. Policy Particulars</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Insured (Owner)</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Type of policy</td><td>{{claim.lob_subcategory}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Period of insurance</td><td>{{claim.policy_period_from}} to {{claim.policy_period_to}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Sum insured (Agreed value)</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Policy clauses</td><td>{{narrative.risks_covered}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Policy excess / deductible</td><td>{{narrative.policy_excess_text}}</td></tr>
</table>

<h2>2. Vessel &amp; Voyage Particulars</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Vessel name</td><td>{{narrative.vessel_name}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">IMO / Reg. No.</td><td>{{narrative.vehicle_no}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Voyage from / to</td><td>{{narrative.transit}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Date of incident</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Place of incident</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Master / Person contacted</td><td>{{narrative.person_contacted}}</td></tr>
</table>

<h2>3. Situation of Loss</h2>
<p>{{narrative.situation_of_loss}}</p>

<h2>4. Our Observations / Survey Findings</h2>
<p>{{narrative.observations}}</p>

<h2>5. Cause of Loss</h2>
<p>{{ila.preliminary_view}}</p>

<h2>6. Assessment of Loss</h2>
<p>The Marine Hull loss has been assessed on the following basis:</p>
<ul class="small">
  <li>Repair invoices and quotations were verified during the course of survey.</li>
  <li>Hull is valued at the agreed-value Sum Insured per the policy schedule.</li>
  <li>{{narrative.gst_treatment}}</li>
  <li>Salvage: {{narrative.salvage_basis}}</li>
  <li>Excess: {{narrative.policy_excess_text}}</li>
</ul>

<table class="totals">
  <tr><td>Permanent repair costs (per Annexure-A)</td><td class="num">{{loss_sheet.subtotal_inr}}</td></tr>
  <tr class="subtotal"><td>Add: {{loss_sheet.handling_label}} (Sue &amp; Labour / General Average)</td><td class="num">{{loss_sheet.handling_amount_inr}}</td></tr>
  <tr><td>Gross Assessed Loss</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Salvage</td><td class="num">{{loss_sheet.salvage_inr}}</td></tr>
  <tr><td>Net Assessed Loss</td><td class="num">{{loss_sheet.net_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Policy Excess</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Adjusted Loss</td><td class="num">{{loss_sheet.net_adjusted_loss_inr}}</td></tr>
</table>

<p>(<strong>{{loss_sheet.net_adjusted_loss_words}}</strong>) subject to policy terms,
   conditions and final approval by the insurer.</p>

<h2>7. Admissibility of Claim</h2>
<p>Based on the facts of the case, documents examined, and observations made during
   the survey, we are of the opinion that the reported loss is
   <strong>{{ila.admissibility_label}}</strong> under the policy, subject to terms,
   conditions, warranties and exclusions.</p>
<p>{{ila.admissibility_reasoning}}</p>

<h2>8. Recommendation</h2>
<p>We hereby recommend the insurer to consider the claim for settlement at
   <strong>{{loss_sheet.net_adjusted_loss_inr}}</strong>
   ({{loss_sheet.net_adjusted_loss_words}}).</p>

<h2>9. Notes</h2>
<ol class="checklist">
  <li>The vessel was operating within the warranted area at the time of the incident.</li>
  <li>The loss falls within the policy period.</li>
  <li>The subject matter is covered under the policy.</li>
  <li>The loss has been caused by an insured peril.</li>
</ol>

<h2>10. Declaration</h2>
<p>We hereby declare that we have no interest in the subject matter in question and
   reported on as above. We are neither related to the insured nor the business —
   either by blood, business or shareholding of whatsoever nature.</p>

<p>This concludes our final survey and loss assessment report which is issued without
   prejudice and is subject to the terms and conditions of the policy of insurance.</p>

<p class="small"><em>(For discretion of insurer &amp; their legal advisers only)</em></p>

<div class="signoff">
  <p style="margin-top: 22px;">
    <strong>Authorized Signatory</strong><br/>
    <strong>{{signer.name}}</strong> (Surveyor)<br/>
    IRDAI Licence: {{signer.license}}<br/>
    For Nathani Insurance Surveyors and Loss Assessors Pvt. Ltd.<br/>
    <span class="small">Date: {{date_today}}</span>
  </p>
</div>

<div class="footer">
  Generated by NISLA Portal &nbsp;·&nbsp; Surveyor reference {{claim.ref_number}}
</div>

<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A — Itemised Repair Costs</h2>
  {{loss_items_table}}
</div>

</body>
</html>
$body$,
  'Marine Hull FSR (vessel particulars, repair-cost cascade, GA / Sue & Labour)',
  true
)
ON CONFLICT (company, lob, template_name, version) DO NOTHING;

-- Marine Hull FSR (vessel particulars, repair-cost cascade, GA / Sue & Labour)
INSERT INTO public.fsr_lob_templates (company, lob, template_name, version, body_html, notes, is_active)
VALUES (
  'Acuere',
  'Marine Hull',
  'Production',
  1,
  $body$<!DOCTYPE html>
<!--
  Marine Hull FSR — ACUERE letterhead.

  Goes into the portal table `fsr_lob_templates` as:
    company='Acuere' lob='Marine Hull' template_name='Production' version=1

  Structurally identical to marine-hull--nisla.html — only the letterhead,
  IRDAI license, and accent colour differ.
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Marine Hull FSR — {{claim.ref_number}}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #111; line-height: 1.45; }

    .letterhead { text-align: center; border-bottom: 2px solid #1a7ab5; padding-bottom: 8px; margin-bottom: 12px; }
    .letterhead h1 { margin: 0; font-size: 14pt; color: #1a7ab5; }
    .letterhead .lob-strip { font-size: 9pt; color: #475569; margin-top: 2px; letter-spacing: 0.4px; }
    .letterhead .sub { font-size: 9pt; color: #475569; margin-top: 2px; }

    .ref-line { display: flex; justify-content: space-between; font-size: 10pt; margin: 8px 0; }
    .doc-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 14px 0 4px; color: #1a7ab5; letter-spacing: 0.4px; }
    .doc-sub { text-align: center; font-size: 10pt; color: #475569; font-style: italic; margin-bottom: 12px; }

    .to-block { font-size: 10pt; margin: 12px 0; line-height: 1.45; }
    .subject { font-size: 10pt; font-weight: 700; margin: 12px 0; padding: 8px; background: #f0f9ff; border-left: 3px solid #1a7ab5; }
    h2 { font-size: 11pt; color: #1a7ab5; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.3px; }

    table.kv { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
    table.kv td { padding: 4px 6px; vertical-align: top; border: 1px solid #e2e8f0; font-size: 10pt; }
    table.kv td.lbl { width: 4%; font-weight: 600; color: #475569; text-align: center; }
    table.kv td.k   { width: 28%; font-weight: 600; color: #475569; }

    table.totals { width: 75%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
    table.totals td { padding: 4px 8px; }
    table.totals tr.subtotal td { font-weight: 600; border-top: 1px solid #cbd5e1; }
    table.totals tr.grand td { font-weight: 700; border-top: 2px solid #1a7ab5; padding-top: 8px; font-size: 12pt; }
    table.totals td.num { text-align: right; }

    table.loss { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 8px 0; }
    table.loss th, table.loss td { border: 1px solid #cbd5e1; padding: 3px 5px; }
    table.loss th { background: #f1f5f9; font-weight: 700; text-align: center; }
    table.loss td.num { text-align: right; }

    blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 4px 12px; font-style: italic; color: #334155; background: #f0f9ff; }
    ol.checklist { font-size: 10pt; margin: 4px 0 4px 18px; padding: 0; }
    .signoff { margin-top: 30px; padding-top: 12px; border-top: 1px dashed #94a3b8; }
    .footer { margin-top: 24px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    .annex { page-break-before: always; }
    p { margin: 6px 0; }
    .small { font-size: 9pt; color: #475569; }
  </style>
</head>
<body>

<div class="letterhead">
  <h1>ACUERE SURVEYORS</h1>
  <div class="lob-strip">Fire &nbsp;|&nbsp; Misc &nbsp;|&nbsp; Engg. &nbsp;|&nbsp; Marine Cargo &nbsp;|&nbsp; Motor</div>
  <div class="sub">IRDAI Licence: IRDAI/IND/SLA-85225 (Exp. 02/03/2028)</div>
  <div class="sub">A-45, 401, Gurukrupa, Gokuldham, Goregaon (E), Mumbai – 400063</div>
</div>

<div class="ref-line">
  <span><strong>Ref. No:</strong> {{claim.ref_number}}</span>
  <span><strong>Date:</strong> {{date_today}}</span>
</div>

<div class="doc-title">MARINE HULL SURVEY REPORT</div>
<div class="doc-sub">(WITHOUT PREJUDICE)</div>

<div class="to-block">
  <strong>The Manager,</strong><br/>
  {{claim.insurer_name}}<br/>
  {{narrative.insurer_office_address}}
</div>

<div class="subject">
  <strong>Subject:</strong> Survey of Marine Hull damage — Vessel {{narrative.vessel_name}}<br/>
  <span class="small">Policy No: {{claim.policy_number}} &nbsp;||&nbsp; Insured: {{claim.insured_name}} &nbsp;||&nbsp; Claim No: {{claim.claim_number}}</span>
</div>

<p>Dear Sir,</p>
<p>Pursuant to valued instruction received from {{narrative.instructions_received_from}} on
   {{claim.date_of_intimation}}, we conducted the survey of the captioned Marine Hull
   claim. Our findings + assessment are below.</p>

<table class="kv">
  <tr><td class="k">Instructions received from</td><td>{{narrative.instructions_received_from}}</td></tr>
  <tr><td class="k">Date of incident</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="k">Date of survey</td><td>{{narrative.dates_of_survey}}</td></tr>
  <tr><td class="k">Place of survey</td><td>{{narrative.place_of_survey}}</td></tr>
  <tr><td class="k">Vessel name / IMO</td><td>{{narrative.vessel_name}}</td></tr>
  <tr><td class="k">Owner / Operator</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="k">Estimated loss</td><td>{{loss_sheet.gross_loss_inr}}</td></tr>
</table>

<h2>1. Policy Particulars</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Insured (Owner)</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Type of policy</td><td>{{claim.lob_subcategory}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Period of insurance</td><td>{{claim.policy_period_from}} to {{claim.policy_period_to}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Sum insured (Agreed value)</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Policy clauses</td><td>{{narrative.risks_covered}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Policy excess / deductible</td><td>{{narrative.policy_excess_text}}</td></tr>
</table>

<h2>2. Vessel &amp; Voyage Particulars</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Vessel name</td><td>{{narrative.vessel_name}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">IMO / Reg. No.</td><td>{{narrative.vehicle_no}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Voyage from / to</td><td>{{narrative.transit}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Date of incident</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Place of incident</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Master / Person contacted</td><td>{{narrative.person_contacted}}</td></tr>
</table>

<h2>3. Situation of Loss</h2>
<p>{{narrative.situation_of_loss}}</p>

<h2>4. Our Observations / Survey Findings</h2>
<p>{{narrative.observations}}</p>

<h2>5. Cause of Loss</h2>
<p>{{ila.preliminary_view}}</p>

<h2>6. Assessment of Loss</h2>
<p>The Marine Hull loss has been assessed on the following basis:</p>
<ul class="small">
  <li>Repair invoices and quotations were verified during the course of survey.</li>
  <li>Hull is valued at the agreed-value Sum Insured per the policy schedule.</li>
  <li>{{narrative.gst_treatment}}</li>
  <li>Salvage: {{narrative.salvage_basis}}</li>
  <li>Excess: {{narrative.policy_excess_text}}</li>
</ul>

<table class="totals">
  <tr><td>Permanent repair costs (per Annexure-A)</td><td class="num">{{loss_sheet.subtotal_inr}}</td></tr>
  <tr class="subtotal"><td>Add: {{loss_sheet.handling_label}} (Sue &amp; Labour / General Average)</td><td class="num">{{loss_sheet.handling_amount_inr}}</td></tr>
  <tr><td>Gross Assessed Loss</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Salvage</td><td class="num">{{loss_sheet.salvage_inr}}</td></tr>
  <tr><td>Net Assessed Loss</td><td class="num">{{loss_sheet.net_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Policy Excess</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Adjusted Loss</td><td class="num">{{loss_sheet.net_adjusted_loss_inr}}</td></tr>
</table>

<p>(<strong>{{loss_sheet.net_adjusted_loss_words}}</strong>) subject to policy terms,
   conditions and final approval by the insurer.</p>

<h2>7. Admissibility of Claim</h2>
<p>Based on the facts of the case, documents examined, and observations made during
   the survey, we are of the opinion that the reported loss is
   <strong>{{ila.admissibility_label}}</strong> under the policy, subject to terms,
   conditions, warranties and exclusions.</p>
<p>{{ila.admissibility_reasoning}}</p>

<h2>8. Recommendation</h2>
<p>We hereby recommend the insurer to consider the claim for settlement at
   <strong>{{loss_sheet.net_adjusted_loss_inr}}</strong>
   ({{loss_sheet.net_adjusted_loss_words}}).</p>

<h2>9. Notes</h2>
<ol class="checklist">
  <li>The vessel was operating within the warranted area at the time of the incident.</li>
  <li>The loss falls within the policy period.</li>
  <li>The subject matter is covered under the policy.</li>
  <li>The loss has been caused by an insured peril.</li>
</ol>

<h2>10. Declaration</h2>
<p>We hereby declare that we have no interest in the subject matter in question and
   reported on as above. We are neither related to the insured nor the business —
   either by blood, business or shareholding of whatsoever nature.</p>

<p>This concludes our final survey and loss assessment report which is issued without
   prejudice and is subject to the terms and conditions of the policy of insurance.</p>

<p class="small"><em>(For discretion of insurer &amp; their legal advisers only)</em></p>

<div class="signoff">
  <p style="margin-top: 22px;">
    <strong>Authorized Signatory</strong><br/>
    <strong>{{signer.name}}</strong> (Surveyor)<br/>
    IRDAI Licence: {{signer.license}}<br/>
    For Acuere Surveyors<br/>
    <span class="small">Date: {{date_today}}</span>
  </p>
</div>

<div class="footer">
  Generated by NISLA Portal &nbsp;·&nbsp; Surveyor reference {{claim.ref_number}}
</div>

<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A — Itemised Repair Costs</h2>
  {{loss_items_table}}
</div>

</body>
</html>
$body$,
  'Marine Hull FSR (vessel particulars, repair-cost cascade, GA / Sue & Labour)',
  true
)
ON CONFLICT (company, lob, template_name, version) DO NOTHING;
