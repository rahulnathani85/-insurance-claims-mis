import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// POST - Generate FSR HTML for PDF rendering on client
export async function POST(request) {
  try {
    const body = await request.json();
    const { ew_claim_id } = body;

    if (!ew_claim_id) return NextResponse.json({ error: 'ew_claim_id required' }, { status: 400 });

    // Fetch claim data
    const { data: claim, error } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .select('*')
      .eq('id', ew_claim_id)
      .single();

    if (error || !claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    const isNISLA = claim.company === 'NISLA';
    const html = generateFSRHtml(claim, isNISLA);

    return NextResponse.json({ html, claim });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatAmount(n) {
  if (n === null || n === undefined || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return '-';
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Escape-lite for values that come from the DB so stray characters don't
// corrupt the HTML. Keeps quotes as-is so tables stay readable.
function safe(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateFSRHtml(c, isNISLA) {
  const brand = isNISLA
    ? { name: 'NATHANI INSURANCE SURVEYORS & LOSS ASSESSORS PVT. LTD.', color: '#4B0082', sla: 'IRDA/CORP/S.L.A. No - 200025 Exp. 03/10/2028', tagline: 'LOP &#x2022; Fire &#x2022; Engineering &#x2022; Misc. &#x2022; Marine Cargo &#x2022; Motor' }
    : { name: 'ACUERE SURVEYORS', color: '#1a7ab5', sla: 'S.L.A. 85225 Exp. 02/03/2028', tagline: 'Fire &#x2022; Misc &#x2022; Engineering &#x2022; Marine Cargo &#x2022; Motor' };

  const footerText = isNISLA
    ? 'Head Office: 507, Garnet Palladium, Behind Express Zone Bldg., Off WE Highway, Goregaon-E, Mumbai â 400063<br>Mobile: 9892171640, 9890084540&nbsp;&nbsp;|&nbsp;&nbsp;E-mail: pranav.kumar554@gmail.com, nathani.surveyors@gmail.com'
    : '507, Garnet Palladium, Panch-Bawadi, Goregaon (E), Mumbai - 400063<br>Contact: 9892976754&nbsp;&nbsp;|&nbsp;&nbsp;Email: niteennathani@gmail.com, acueresurveyors@gmail.com';

  const pageHeader = `
    <div class="page-head">
      <div class="brand-row">
        <div class="brand-name">${brand.name}</div>
        <div class="brand-sla">${brand.sla}</div>
        <div class="brand-tagline">${brand.tagline}</div>
      </div>
      <div class="ref-row">
        <span><b>Ref No.:</b> ${safe(c.ref_number) || ''}</span>
        <span><b>Date:</b> ${formatDate(c.report_date)}</span>
      </div>
    </div>`;

  const pageFooter = `
    <div class="page-foot">
      <div class="page-foot-brand">${brand.name}</div>
      <div class="page-foot-addr">${footerText}</div>
    </div>`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>FSR ${safe(c.ref_number) || ''}</title>
<style>
  @page { size: A4; margin: 15mm 15mm 18mm 15mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #000;
  }
  /* Each .page is a full A4 page. Page-break is enforced both via CSS
     (for browsers and html2pdf's 'css' mode) and MSO rules (for Word). */
  .page {
    page-break-after: always;
    page-break-inside: avoid;
    mso-page-break-after: always;
    padding: 0 0 6pt 0;
  }
  .page:last-child {
    page-break-after: auto;
    mso-page-break-after: auto;
  }
  .page-head {
    border-bottom: 2pt solid ${brand.color};
    padding-bottom: 4pt;
    margin-bottom: 10pt;
  }
  .brand-row { text-align: center; }
  .brand-name {
    color: ${brand.color};
    font-size: 14pt;
    font-weight: bold;
    letter-spacing: 0.3pt;
  }
  .brand-sla { color: ${brand.color}; font-size: 9pt; }
  .brand-tagline { color: ${brand.color}; font-size: 9pt; font-style: italic; margin-top: 1pt; }
  .ref-row {
    display: flex;
    justify-content: space-between;
    margin-top: 6pt;
    border: 1pt solid #000;
    padding: 3pt 8pt;
    font-size: 10pt;
  }
  .page-foot {
    margin-top: 14pt;
    padding-top: 4pt;
    border-top: 1pt solid #999;
    text-align: center;
    font-size: 8pt;
    color: #444;
  }
  .page-foot-brand { color: ${brand.color}; font-weight: bold; font-size: 9pt; }
  .page-foot-addr { margin-top: 2pt; line-height: 1.3; }

  h1, h2, h3, h4 { margin: 0; font-family: 'Times New Roman', Times, serif; }
  .report-title {
    text-align: center;
    font-size: 14pt;
    font-weight: bold;
    text-decoration: underline;
    margin: 4pt 0 12pt 0;
  }
  .cover-wrap { text-align: center; margin-top: 40pt; }
  .cover-title {
    font-size: 20pt;
    font-weight: bold;
    color: ${brand.color};
    letter-spacing: 1pt;
    margin-bottom: 20pt;
  }
  .cover-ref {
    font-size: 13pt;
    margin-bottom: 6pt;
  }
  .cover-box {
    border: 1.5pt solid ${brand.color};
    padding: 18pt 20pt;
    text-align: center;
    margin: 18pt 40pt;
    border-radius: 2pt;
  }
  .cover-box .label {
    font-size: 10pt;
    color: #555;
    letter-spacing: 0.5pt;
    text-transform: uppercase;
    margin-bottom: 4pt;
  }
  .cover-box .value {
    font-size: 14pt;
    font-weight: bold;
    margin-bottom: 10pt;
  }
  .cover-box .value:last-child { margin-bottom: 0; }

  .section-title {
    font-weight: bold;
    color: ${brand.color};
    font-size: 11.5pt;
    margin: 14pt 0 6pt 0;
    padding: 3pt 6pt;
    background: #f4f1f9;
    border-left: 3pt solid ${brand.color};
  }

  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 6pt 0 10pt 0;
    font-size: 10.5pt;
  }
  table.data-table td, table.data-table th {
    border: 0.75pt solid #333;
    padding: 5pt 8pt;
    vertical-align: top;
  }
  table.data-table th {
    background: #e8e1f2;
    text-align: left;
    font-weight: bold;
    color: #333;
  }
  table.data-table td.label { width: 32%; background: #f8f6fb; font-weight: bold; }
  table.data-table td.idx { width: 6%; text-align: center; font-weight: bold; background: #f8f6fb; }
  table.data-table td.key { width: 30%; font-weight: bold; background: #f8f6fb; }

  table.amount-table {
    width: 70%;
    margin: 10pt auto;
    font-size: 11pt;
  }
  table.amount-table td { padding: 6pt 10pt; }
  table.amount-table td:last-child { text-align: right; font-family: 'Courier New', monospace; }
  table.amount-table tr.total-row td { background: #e8e1f2; font-weight: bold; }

  p { margin: 6pt 0; text-align: justify; }
  p.indent { text-indent: 24pt; }

  ul.findings { margin: 6pt 0 6pt 0; padding-left: 18pt; }
  ul.findings li { margin-bottom: 6pt; text-align: justify; }
  ul.findings ul { margin-top: 4pt; padding-left: 18pt; }

  .note-block {
    margin-top: 10pt;
    padding: 8pt 12pt;
    background: #fafaf4;
    border: 0.75pt solid #d4c98a;
    border-radius: 2pt;
  }
  .note-block .note-title { font-weight: bold; margin-bottom: 4pt; }
  .note-block ul { margin: 4pt 0 0 0; padding-left: 18pt; }
  .note-block li { margin-bottom: 4pt; }

  .disclaimer { margin-top: 10pt; font-style: italic; font-size: 10.5pt; }
  .discretion { margin-top: 8pt; font-weight: bold; }

  .signature-block {
    margin-top: 40pt;
    text-align: right;
  }
  .signature-line {
    display: inline-block;
    width: 180pt;
    border-top: 0.75pt solid #000;
    margin-top: 36pt;
    padding-top: 2pt;
    font-weight: bold;
  }
  .subject-block { margin: 10pt 0; }
  .subject-block .subject-label { font-weight: bold; }
  .address-block { margin: 10pt 0; line-height: 1.4; }
</style>
</head><body>

<!-- PAGE 1: COVER PAGE -->
<div class="page">
  ${pageHeader}
  <div class="cover-wrap">
    <div class="cover-title">EXTENDED WARRANTY REPORT</div>
    <div class="cover-ref"><b>Ref. No:</b> ${safe(c.ref_number) || ''}</div>
    <div class="cover-ref"><b>Date:</b> ${formatDate(c.report_date)}</div>

    <div class="cover-box">
      <div class="label">Reported Loss to Vehicle No.</div>
      <div class="value">${safe(c.vehicle_reg_no) || '-'}</div>
      <div class="label">VIN Number</div>
      <div class="value">${safe(c.chassis_number) || '-'}</div>
      <div class="label">Insured</div>
      <div class="value">${(safe(c.insured_name) || '-').toUpperCase()}</div>
    </div>

    <div class="cover-box">
      <div class="label">Insurer</div>
      <div class="value" style="color:${brand.color}; font-size:15pt;">${safe(c.insurer_name) || 'The Oriental Insurance Co. Ltd.'}</div>
      <div class="label">Extended Warranty Insurance Policy No.</div>
      <div class="value">${safe(c.policy_number) || '-'}</div>
      ${c.warranty_plan ? `<div class="label">Plan</div><div class="value">${safe(c.warranty_plan)}</div>` : ''}
    </div>
  </div>
  ${pageFooter}
</div>

<!-- PAGE 2: CLAIM DETAILS -->
<div class="page">
  ${pageHeader}
  <div class="report-title">EXTENDED WARRANTY REPORT<br><span style="font-size:11pt; font-weight:normal;">(WITHOUT PREJUDICE)</span></div>

  <div class="address-block">
    To,<br>
    The Claim In-Charge<br>
    <b>${safe(c.insurer_name) || ''}</b><br>
    ${safe(c.insurer_address) || ''}
  </div>

  <div class="subject-block">
    <span class="subject-label">Subject:</span>&nbsp;&nbsp;Reported claim under Extended Warranty of VIN No. ${safe(c.chassis_number) || ''}<br>
    <span style="padding-left: 58pt;">Vehicle No. ${safe(c.vehicle_reg_no) || ''}, Insured: ${safe(c.insured_name) || ''}</span><br>
    <span style="padding-left: 58pt;">Policy No. ${safe(c.policy_number) || ''}&nbsp;&nbsp;|&nbsp;&nbsp;Claim File No. ${safe(c.claim_file_no) || ''}</span>
  </div>

  <p>Dear Sir,</p>
  <p class="indent">Pursuant to valued instruction received from Claims Hub of ${safe(c.insurer_name) || ''} on ${formatDate(c.date_of_intimation)} for survey and loss assessment of the below-mentioned claim, we made immediate contact with the insured&rsquo;s representative and conducted the survey as per the details below.</p>

  <div class="section-title">1. CLAIM DETAILS</div>
  <table class="data-table">
    <tr><td class="label">Insured</td><td>${safe(c.insured_name) || ''}${c.insured_address ? `<br>${safe(c.insured_address)}` : ''}</td></tr>
    <tr><td class="label">Insurer</td><td>${safe(c.insurer_name) || ''}${c.insurer_address ? `<br>${safe(c.insurer_address)}` : ''}</td></tr>
    <tr><td class="label">Policy No.</td><td>${safe(c.policy_number) || ''}</td></tr>
    <tr><td class="label">Claim File No.</td><td>${safe(c.claim_file_no) || ''}</td></tr>
    <tr><td class="label">Date of Intimation</td><td>${formatDate(c.date_of_intimation)}</td></tr>
    <tr><td class="label">Person Contacted</td><td>${safe(c.person_contacted) || ''}</td></tr>
    <tr><td class="label">Estimated Loss Amount</td><td>Rs. ${formatAmount(c.estimated_loss_amount)}</td></tr>
    <tr><td class="label">Claim Type</td><td>Claim under Extended Warranty of VIN No. ${safe(c.chassis_number) || ''}</td></tr>
  </table>

  <p>Now we are submitting our final survey and loss assessment report which is based on the following observations and the documents provided.</p>
  ${pageFooter}
</div>

<!-- PAGE 3: VEHICLE PARTICULARS & FINDINGS -->
<div class="page">
  ${pageHeader}
  <div class="section-title">2. CERTIFICATE / VEHICLE PARTICULARS</div>
  <table class="data-table">
    <tr><td class="idx">a.</td><td class="key">Name of Customer</td><td>${safe(c.customer_name) || ''}</td></tr>
    <tr><td class="idx">b.</td><td class="key">Registration No.</td><td>${safe(c.vehicle_reg_no) || ''}</td></tr>
    <tr><td class="idx">c.</td><td class="key">Date of Registration</td><td>${formatDate(c.date_of_registration)}</td></tr>
    <tr><td class="idx">d.</td><td class="key">Make</td><td>${safe(c.vehicle_make) || ''}</td></tr>
    <tr><td class="idx">e.</td><td class="key">Model / Fuel Type</td><td>${safe(c.model_fuel_type) || ''}</td></tr>
    <tr><td class="idx">f.</td><td class="key">Chassis No.</td><td>${safe(c.chassis_number) || ''}</td></tr>
    <tr><td class="idx">g.</td><td class="key">Engine No.</td><td>${safe(c.engine_number) || ''}</td></tr>
    <tr><td class="idx">h.</td><td class="key">Odometer Reading</td><td>${safe(c.odometer_reading) || ''}</td></tr>
    <tr><td class="idx">i.</td><td class="key">Plan</td><td>${safe(c.warranty_plan) || ''}</td></tr>
    <tr><td class="idx">j.</td><td class="key">Certificate No.</td><td>${safe(c.certificate_no) || ''}</td></tr>
    <tr><td class="idx">k.</td><td class="key">Certificate From / To</td><td>${safe(c.certificate_validity_text) || ''}</td></tr>
    <tr><td class="idx">l.</td><td class="key">Product</td><td>${safe(c.product_description) || ''}</td></tr>
    <tr><td class="idx">m.</td><td class="key">Terms &amp; Conditions</td><td>${safe(c.terms_conditions) || ''}</td></tr>
  </table>

  <div class="section-title">3. OUR SURVEY / INSPECTION / FINDINGS</div>
  <ul class="findings">
    <li>As per instructions received, we made immediate contact with the Service Centre at <b>${safe(c.dealer_name) || 'the authorized dealer'}</b>${c.dealer_address ? `, ${safe(c.dealer_address)}` : ''} on ${formatDate(c.survey_date)} and conducted the survey.</li>
    <li>During our survey the service person has showed the <b>Vehicle No. ${safe(c.vehicle_reg_no) || ''}</b> (of customer ${safe(c.customer_name) || ''}). It was informed that the vehicle was received with customer complaint <b>&ldquo;${(safe(c.customer_complaint) || '').toUpperCase()}&rdquo;</b> on <b>${formatDate(c.complaint_date)}</b>.</li>
    <li>${safe(c.initial_observation) || 'During our survey, it was noted that the vehicle had issues which needed to be diagnosed.'}</li>
    ${c.dismantled_observation ? `<li>${safe(c.dismantled_observation)}</li>` : ''}
    <li>We had informed the dealer to dismantle the vehicle and inform us about the affected parts. The dealer dismantled the vehicle and informed that <b>${safe(c.defective_parts) || 'the affected parts'}</b> were defective and needed to be replaced.</li>
    <li>We convinced the dealer not to change parts which are not covered under the policy and not to perform work which is not falling under Extended Warranty, and the dealer agreed for the same.</li>
    <li>${safe(c.external_damages) || 'No external damages were found.'}</li>
    <li>Service history records were ${c.service_history_verified === false ? 'not verified' : 'verified'}.</li>
  </ul>
  ${pageFooter}
</div>

<!-- PAGE 4: REINSPECTION & ASSESSMENT -->
<div class="page">
  ${pageHeader}
  <ul class="findings">
    <li><b>Reinspection of vehicle was done on ${formatDate(c.reinspection_date)}</b>, and the dealer had removed the affected defective parts, replaced/repaired the same and produced them for our inspection.</li>
    <li>During our survey, photographs of the vehicle were snapped from different angles.</li>
    <li>Tax Invoice was furnished by the dealer, copy enclosed.
      <ul>
        <li>Tax Invoice No.: ${safe(c.tax_invoice_no) || ''}&nbsp;&nbsp;|&nbsp;&nbsp;Date: ${formatDate(c.tax_invoice_date)}</li>
        <li>Invoice Amount: Rs. ${formatAmount(c.tax_invoice_amount)}</li>
      </ul>
    </li>
  </ul>

  <div class="section-title">4. ASSESSMENT OF LOSS</div>
  <ul class="findings">
    <li>We have assessed the loss based on the physical observation of the damages and documents/details submitted by the insured.</li>
    <li>The insured has provided the repair invoice from <b>${safe(c.dealer_invoice_name) || safe(c.dealer_name) || ''}</b>, vide Invoice No. ${safe(c.tax_invoice_no) || ''} dated ${formatDate(c.tax_invoice_date)} for Rs. ${formatAmount(c.tax_invoice_amount)}, which we have considered in our assessment.</li>
    <li>We have adjusted the consumables and parts which are not covered and mentioned in the exclusions of the policy.</li>
    <li>We have not considered the GST component in our assessment, as the insured would be eligible to take GST credit.</li>
  </ul>

  <table class="data-table amount-table">
    <tr><th>Description</th><th style="text-align:right">Amount (Rs.)</th></tr>
    <tr><td>Gross Assessed Loss Amount</td><td>${formatAmount(c.gross_assessed_amount)}</td></tr>
    <tr><td>Less: GST Amount</td><td>${formatAmount(c.gst_amount)}</td></tr>
    <tr class="total-row"><td>Total</td><td>${formatAmount(c.total_after_gst)}</td></tr>
    <tr><td>Less: Not Covered</td><td>${c.not_covered_amount ? formatAmount(c.not_covered_amount) : '-'}</td></tr>
    <tr class="total-row"><td>Net Adjusted Loss Amount</td><td>${formatAmount(c.net_adjusted_amount)}</td></tr>
  </table>

  ${c.amount_in_words ? `<p><b>(${safe(c.amount_in_words)})</b> subject to policy terms and conditions and final approval by the insurer.</p>` : `<p>Subject to policy terms and conditions and final approval by the insurer.</p>`}
  ${pageFooter}
</div>

<!-- PAGE 5: CONCLUSION -->
<div class="page">
  ${pageHeader}
  <div class="section-title">5. CONCLUSION</div>
  <p class="indent">${safe(c.conclusion_text) || 'In view of the above, as per the Manufacturer Guidelines / Manual, the defective / part has been replaced with new one, same be considered under extended warranty, subject to coverage of the vehicle in the policy and as per the terms and conditions of the policy issued.'}</p>

  <div class="note-block">
    <div class="note-title">Note:</div>
    <ul>
      <li>Insurers are advised to check the Annexure of the policy and verify if the particular vehicle was declared to the insurer at the time of taking the policy or agreed in the policy.</li>
      <li>Insurers are advised to check the proof of payment (made by the insured to the dealer) before indemnifying the claimed loss.</li>
    </ul>
  </div>

  <p class="disclaimer">This report is issued without prejudice and is subject to the terms &amp; conditions of the policy of Insurance issued to and held by the Insured, reserving our rights to alter / amend any unintended error, if any.</p>
  <p>This concludes my Extended Warranty report, which has been issued for perusal of the Insurance Co.</p>

  <p class="discretion">(For Discretion of Insurer &amp; their Legal Advisers only)</p>

  <div class="signature-block">
    <div style="margin-bottom: 4pt;">For <b>${brand.name}</b></div>
    <div class="signature-line">Authorized Signatory<br>(Surveyor)</div>
  </div>
  ${pageFooter}
</div>

</body></html>`;
}
