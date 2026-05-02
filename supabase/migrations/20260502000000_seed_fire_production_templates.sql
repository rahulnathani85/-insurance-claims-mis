-- =============================================================================
-- 20260502000000_seed_fire_production_templates.sql
-- =============================================================================
-- Slice 11 - Adds Fire Production templates for NISLA + Acuere.
-- Builds on 20260501000000_seed_real_sample_templates.
-- Idempotent: ON CONFLICT (company, lob, template_name, version) DO NOTHING.
-- =============================================================================

-- Production-format Fire FSR (numbered sections, addressee, subject line)
INSERT INTO public.fsr_lob_templates (company, lob, template_name, version, body_html, notes, is_active)
VALUES (
  'NISLA',
  'Fire',
  'Production',
  1,
  $body$<!DOCTYPE html>
<!--
  Fire FSR â€” NISLA letterhead.

  Goes into the portal table `fsr_lob_templates` as:
    company='NISLA' lob='Fire' template_name='Production' version=1

  Production-format alignment: numbered sections (a)â€“(j) for Claim Details
  and Policy Particulars matching the SK Polyfoams 3472-24-25 reference;
  letterhead at the top with IRDAI license; addressee block; subject line
  with policy + insured + claim no; verbatim insured statement section;
  observations + cause + adequacy of SI + liability + recommended
  settlement + salvage + signoff.

  This is a structurally richer variant of the existing 'Fire Default'
  (v2, seeded by 20260430220000_marine_loss_sheet_and_fsr_v2.sql) â€” the
  Default stays available as the simpler shape; surveyors who want the
  full PSU production format pick 'Production' from the template
  dropdown.
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Fire FSR â€” {{claim.ref_number}}</title>
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

    table.totals { width: 70%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
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
    ol.checklist li { margin: 2px 0; }
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
  <div class="sub">Head Office: 507, Garnet Palladium, Behind Express Zone Bldg., Off WE Highway, Goregaon (E), Mumbai â€“ 400063</div>
  <div class="sub">Mobile: 9892171640, 9890084540 &nbsp;Â·&nbsp; Email: pranav.kumar554@gmail.com, nathani.surveyors@gmail.com</div>
</div>

<div class="ref-line">
  <span><strong>Ref. No:</strong> {{claim.ref_number}}</span>
  <span><strong>Date:</strong> {{date_today}}</span>
</div>

<div class="doc-title">FINAL SURVEY REPORT &mdash; FIRE</div>
<div class="doc-sub">(WITHOUT PREJUDICE)</div>

<div class="to-block">
  <strong>The Claim In-Charge,</strong><br/>
  {{claim.insurer_name}}<br/>
  {{narrative.insurer_office_address}}
</div>

<div class="subject">
  <strong>Subject:</strong> Reported loss / damage due to fire on {{claim.date_loss}} at {{claim.loss_location}}<br/>
  <span class="small">Policy No: {{claim.policy_number}} &nbsp;||&nbsp; Insured: {{claim.insured_name}} &nbsp;||&nbsp; Claim No: {{claim.claim_number}}</span>
</div>

<p>Dear Sir,</p>
<p>Pursuant to valued instruction received from {{narrative.instructions_received_from}} on
   {{claim.date_of_intimation}}, we made immediate contact with the insured&rsquo;s
   representative and conducted the survey of the captioned claim. We are now
   submitting our final survey and loss assessment report based on the following
   observations and documents provided.</p>

<h2>1. Claim Details</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Loss summary</td><td>{{ila.preliminary_view}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Date of intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Date(s) of survey</td><td>{{narrative.dates_of_survey}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">i</td><td class="k">Claim No.</td><td>{{claim.claim_number}}</td></tr>
  <tr><td class="lbl">j</td><td class="k">Estimated loss</td><td>{{loss_sheet.gross_loss_inr}}</td></tr>
</table>

<h2>2. Policy Particulars</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Type of policy</td><td>{{claim.lob_subcategory}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Period of insurance</td><td>{{claim.policy_period_from}} to {{claim.policy_period_to}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Risk location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Policy excess</td><td>{{loss_sheet.excess_inr}}</td></tr>
</table>

<h2>3. About the Insured</h2>
<p>{{narrative.about_insured}}</p>

<h2>4. About the Incident</h2>
<p>The insured&rsquo;s representative has briefed us about the incident as below:</p>
<blockquote>{{narrative.incident_quote}}</blockquote>
<p class="small"><em>The incident reported by the insured has been reproduced verbatim
   without corrections to spelling and / or grammar.</em></p>

<h2>5. General Diary / Police Panchnama</h2>
<p>{{narrative.police_gd}}</p>

<h2>6. Fire Brigade Report</h2>
<p>{{narrative.fire_brigade}}</p>

<h2>7. Our Observations / Inspection &amp; Findings</h2>
<p>{{narrative.observations}}</p>

<h2>8. Cause of Loss</h2>
<p>{{ila.preliminary_view}}</p>

<h2>9. Adequacy of Sum Insured</h2>
<p>{{loss_sheet.underinsurance_paragraph}}</p>

<h2>10. Liability under the Policy</h2>
<p><strong>Admissibility opinion:</strong> {{ila.admissibility_label}}</p>
<p>{{ila.admissibility_reasoning}}</p>

<h2>11. Recommended Settlement</h2>
<table class="totals">
  <tr><td>Gross Loss (per Annexure-A)</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Underinsurance applied</td><td class="num">{{loss_sheet.underinsurance_factor_pct}}</td></tr>
  <tr><td>Adjusted Loss</td><td class="num">{{loss_sheet.adjusted_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Salvage</td><td class="num">{{loss_sheet.total_salvage_inr}}</td></tr>
  <tr><td>Less: Excess / deductible</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Payable</td><td class="num">{{loss_sheet.net_payable_inr}}</td></tr>
</table>
<p>(<strong>{{loss_sheet.net_adjusted_loss_words}}</strong>) subject to policy terms,
   conditions and final approval by the insurer.</p>

<h2>12. Salvage</h2>
<p>Salvage value of <strong>{{loss_sheet.total_salvage_inr}}</strong> has been computed
   item-wise (see Annexure-A) and deducted from the depreciated value of each affected
   item before arriving at the net loss.</p>

<h2>13. Notes</h2>
<ol class="checklist">
  <li>No breach of warranty was observed during the course of survey.</li>
  <li>The loss falls within the policy period.</li>
  <li>The subject matter is covered under the policy.</li>
  <li>The loss has been caused by an insured peril.</li>
</ol>

<h2>14. Declaration</h2>
<p>We hereby declare that we have no interest in the subject matter in question and
   reported on as above. We are neither related to the insured nor the business â€”
   either by blood, business or shareholding of whatsoever nature.</p>

<p>This concludes our final survey and loss assessment report which is issued without
   prejudice and is subject to the terms and conditions of the policy of insurance issued
   to and held by the insured, reserving our rights to alter / amend unintended error,
   if any.</p>

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
  Generated by NISLA Portal &nbsp;Â·&nbsp; Surveyor reference {{claim.ref_number}}
</div>

<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A â€” Itemised Loss Sheet</h2>
  {{loss_items_table}}
  <p class="small" style="margin-top: 14px;">
    Depreciation rates applied per item-category curves. Manual overrides flagged with â€ .
  </p>
</div>

</body>
</html>
$body$,
  'Production-format Fire FSR (numbered sections, addressee, subject line)',
  true
)
ON CONFLICT (company, lob, template_name, version) DO NOTHING;

-- Production-format Fire FSR (numbered sections, addressee, subject line)
INSERT INTO public.fsr_lob_templates (company, lob, template_name, version, body_html, notes, is_active)
VALUES (
  'Acuere',
  'Fire',
  'Production',
  1,
  $body$<!DOCTYPE html>
<!--
  Fire FSR â€” ACUERE letterhead.

  Goes into the portal table `fsr_lob_templates` as:
    company='Acuere' lob='Fire' template_name='Production' version=1

  Structurally identical to fire--nisla.html â€” only the letterhead,
  IRDAI license, and accent colour differ.
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Fire FSR â€” {{claim.ref_number}}</title>
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

    table.totals { width: 70%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 11pt; }
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
    ol.checklist li { margin: 2px 0; }
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
  <div class="sub">A-45, 401, Gurukrupa, Gokuldham, Goregaon (E), Mumbai â€“ 400063</div>
  <div class="sub">Contact: 9892976754, 9892596754 &nbsp;Â·&nbsp; Office: 022-28741640 &nbsp;Â·&nbsp; Email: niteennathani@gmail.com, acueresurveyors@gmail.com</div>
</div>

<div class="ref-line">
  <span><strong>Ref. No:</strong> {{claim.ref_number}}</span>
  <span><strong>Date:</strong> {{date_today}}</span>
</div>

<div class="doc-title">FINAL SURVEY REPORT &mdash; FIRE</div>
<div class="doc-sub">(WITHOUT PREJUDICE)</div>

<div class="to-block">
  <strong>The Claim In-Charge,</strong><br/>
  {{claim.insurer_name}}<br/>
  {{narrative.insurer_office_address}}
</div>

<div class="subject">
  <strong>Subject:</strong> Reported loss / damage due to fire on {{claim.date_loss}} at {{claim.loss_location}}<br/>
  <span class="small">Policy No: {{claim.policy_number}} &nbsp;||&nbsp; Insured: {{claim.insured_name}} &nbsp;||&nbsp; Claim No: {{claim.claim_number}}</span>
</div>

<p>Dear Sir,</p>
<p>Pursuant to valued instruction received from {{narrative.instructions_received_from}} on
   {{claim.date_of_intimation}}, we made immediate contact with the insured&rsquo;s
   representative and conducted the survey of the captioned claim.</p>

<h2>1. Claim Details</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Loss summary</td><td>{{ila.preliminary_view}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Date of loss</td><td>{{claim.date_loss}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Date of intimation</td><td>{{claim.date_of_intimation}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Date(s) of survey</td><td>{{narrative.dates_of_survey}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Loss location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">i</td><td class="k">Claim No.</td><td>{{claim.claim_number}}</td></tr>
  <tr><td class="lbl">j</td><td class="k">Estimated loss</td><td>{{loss_sheet.gross_loss_inr}}</td></tr>
</table>

<h2>2. Policy Particulars</h2>
<table class="kv">
  <tr><td class="lbl">a</td><td class="k">Policy No.</td><td>{{claim.policy_number}}</td></tr>
  <tr><td class="lbl">b</td><td class="k">Insured</td><td>{{claim.insured_name}}</td></tr>
  <tr><td class="lbl">c</td><td class="k">Type of policy</td><td>{{claim.lob_subcategory}}</td></tr>
  <tr><td class="lbl">d</td><td class="k">Period of insurance</td><td>{{claim.policy_period_from}} to {{claim.policy_period_to}}</td></tr>
  <tr><td class="lbl">e</td><td class="k">Insurer</td><td>{{claim.insurer_name}}</td></tr>
  <tr><td class="lbl">f</td><td class="k">Risk location</td><td>{{claim.loss_location}}</td></tr>
  <tr><td class="lbl">g</td><td class="k">Sum insured</td><td>{{loss_sheet.sum_insured_inr}}</td></tr>
  <tr><td class="lbl">h</td><td class="k">Policy excess</td><td>{{loss_sheet.excess_inr}}</td></tr>
</table>

<h2>3. About the Insured</h2>
<p>{{narrative.about_insured}}</p>

<h2>4. About the Incident</h2>
<p>The insured&rsquo;s representative has briefed us about the incident as below:</p>
<blockquote>{{narrative.incident_quote}}</blockquote>
<p class="small"><em>The incident reported by the insured has been reproduced verbatim
   without corrections to spelling and / or grammar.</em></p>

<h2>5. General Diary / Police Panchnama</h2>
<p>{{narrative.police_gd}}</p>

<h2>6. Fire Brigade Report</h2>
<p>{{narrative.fire_brigade}}</p>

<h2>7. Our Observations / Inspection &amp; Findings</h2>
<p>{{narrative.observations}}</p>

<h2>8. Cause of Loss</h2>
<p>{{ila.preliminary_view}}</p>

<h2>9. Adequacy of Sum Insured</h2>
<p>{{loss_sheet.underinsurance_paragraph}}</p>

<h2>10. Liability under the Policy</h2>
<p><strong>Admissibility opinion:</strong> {{ila.admissibility_label}}</p>
<p>{{ila.admissibility_reasoning}}</p>

<h2>11. Recommended Settlement</h2>
<table class="totals">
  <tr><td>Gross Loss (per Annexure-A)</td><td class="num">{{loss_sheet.gross_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Underinsurance applied</td><td class="num">{{loss_sheet.underinsurance_factor_pct}}</td></tr>
  <tr><td>Adjusted Loss</td><td class="num">{{loss_sheet.adjusted_loss_inr}}</td></tr>
  <tr class="subtotal"><td>Less: Salvage</td><td class="num">{{loss_sheet.total_salvage_inr}}</td></tr>
  <tr><td>Less: Excess / deductible</td><td class="num">{{loss_sheet.excess_inr}}</td></tr>
  <tr class="grand"><td>Net Payable</td><td class="num">{{loss_sheet.net_payable_inr}}</td></tr>
</table>
<p>(<strong>{{loss_sheet.net_adjusted_loss_words}}</strong>) subject to policy terms,
   conditions and final approval by the insurer.</p>

<h2>12. Salvage</h2>
<p>Salvage value of <strong>{{loss_sheet.total_salvage_inr}}</strong> has been computed
   item-wise (see Annexure-A) and deducted from the depreciated value of each affected item.</p>

<h2>13. Notes</h2>
<ol class="checklist">
  <li>No breach of warranty was observed during the course of survey.</li>
  <li>The loss falls within the policy period.</li>
  <li>The subject matter is covered under the policy.</li>
  <li>The loss has been caused by an insured peril.</li>
</ol>

<h2>14. Declaration</h2>
<p>We hereby declare that we have no interest in the subject matter in question and
   reported on as above. We are neither related to the insured nor the business â€”
   either by blood, business or shareholding of whatsoever nature.</p>

<p>This concludes our final survey and loss assessment report which is issued without
   prejudice and is subject to the terms and conditions of the policy of insurance issued
   to and held by the insured, reserving our rights to alter / amend unintended error,
   if any.</p>

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
  Generated by NISLA Portal &nbsp;Â·&nbsp; Surveyor reference {{claim.ref_number}}
</div>

<div class="annex">
  <h2 style="margin-top: 0;">Annexure-A â€” Itemised Loss Sheet</h2>
  {{loss_items_table}}
</div>

</body>
</html>
$body$,
  'Production-format Fire FSR (numbered sections, addressee, subject line)',
  true
)
ON CONFLICT (company, lob, template_name, version) DO NOTHING;
