import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Always run dynamically — never serve a cached response so template
// edits are reflected in every FSR generation.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST - Generate FSR HTML for PDF/Word rendering on the client.
export async function POST(request) {
  try {
    const body = await request.json();
    const { ew_claim_id } = body;

    if (!ew_claim_id) return NextResponse.json({ error: 'ew_claim_id required' }, { status: 400 });

    const { data: claim, error } = await supabaseAdmin
      .from('ew_vehicle_claims')
      .select('*')
      .eq('id', ew_claim_id)
      .single();

    if (error || !claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    const isNISLA = claim.company === 'NISLA';
    const html = generateFSRHtml(claim, isNISLA);

    return NextResponse.json({ html, claim });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
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

function safe(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateFSRHtml(c, isNISLA) {
  const brand = isNISLA
    ? {
        name: 'NATHANI INSURANCE SURVEYORS &amp; LOSS ASSESSORS PVT. LTD.',
        shortName: 'NATHANI INSURANCE SURVEYORS AND LOSS ASSESSORS PVT. LTD.',
        color: '#4B0082',
        sla: 'IRDA/CORP/S.L.A. No - 200025 Exp. 03/10/2028',
        slaCover: '(IRDA/CORP/S.L.A. 200025 EXP. 03/10/2028)',
        tagline: 'LOP &#10070; Fire &#10070; Engineering &#10070; Misc. &#10070; Marine Cargo &#10070; Motor',
        addrLine: 'Head Office: 507, Garnet Palladium, Behind Express Zone Bldg., Off WE Highway, Goregaon-E, Mumbai &#8211; 400063',
        contactLine: 'Mobile: 9892171640, 9890084540&nbsp;&nbsp;|&nbsp;&nbsp;E-mail: pranav.kumar554@gmail.com, nathani.surveyors@gmail.com',
      }
    : {
        name: 'ACUERE SURVEYORS',
        shortName: 'ACUERE SURVEYORS',
        color: '#1a7ab5',
        sla: 'S.L.A. 85225 Exp. 02/03/2028',
        slaCover: '(S.L.A. 85225 EXP. 02/03/2028)',
        tagline: 'Fire &#10070; Misc. &#10070; Engineering &#10070; Marine Cargo &#10070; Motor',
        addrLine: '507, Garnet Palladium, Panch-Bawadi, Goregaon (E), Mumbai - 400063',
        contactLine: 'Contact: 9892976754&nbsp;&nbsp;|&nbsp;&nbsp;Email: niteennathani@gmail.com, acueresurveyors@gmail.com',
      };

  const refNo = safe(c.ref_number) || '';
  const dateStr = formatDate(c.report_date);

  // Footer for cover page (no page number)
  const coverFoot = `
    <div class="page-foot cover-foot">
      <div class="foot-brand">${brand.shortName}</div>
      <div class="foot-line">${brand.addrLine}</div>
      <div class="foot-line">${brand.contactLine}</div>
    </div>`;

  // Page header for inner pages
  const innerHead = `
    <div class="inner-head">
      <div class="hd-name">${brand.shortName}</div>
      <div class="hd-sla">${brand.sla}</div>
      <div class="hd-tagline">${brand.tagline}</div>
    </div>
    <div class="ref-row">
      <span><b>Ref No.</b> ${refNo}</span>
      <span><b>Date :</b> ${dateStr}</span>
    </div>`;

  // Footer for inner pages with page number
  const innerFoot = (pageNum) => `
    <div class="page-foot">
      <div class="foot-line">${brand.addrLine}</div>
      <div class="foot-line">${brand.contactLine}</div>
      <div class="foot-pgnum">${pageNum}</div>
    </div>`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>FSR ${refNo}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #000;
  }
  .page {
    width: 794px;
    min-height: 1110px;
    box-sizing: border-box;
    padding: 38px 56px 26px 56px;
    page-break-after: always;
    mso-page-break-after: always;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .page:last-child { page-break-after: auto; mso-page-break-after: auto; }
  .page-content { flex: 1 1 auto; }
  .page-foot {
    flex: 0 0 auto;
    border-top: 0.75pt solid #555;
    padding-top: 6px;
    margin-top: 14px;
    text-align: center;
    font-size: 8.5pt;
    line-height: 1.35;
    color: #333;
  }
  .foot-brand { font-weight: bold; color: ${brand.color}; font-size: 9pt; margin-bottom: 2px; }
  .foot-line { margin: 0; }
  .foot-pgnum { margin-top: 4px; font-weight: bold; }

  /* COVER PAGE */
  .cover-brand { text-align: center; margin-top: 4px; }
  .cover-name {
    color: ${brand.color};
    font-size: 19pt;
    font-weight: bold;
    line-height: 1.15;
    letter-spacing: 0.3pt;
  }
  .cover-sla {
    color: ${brand.color};
    font-size: 11pt;
    font-style: italic;
    margin-top: 4px;
  }
  .cover-title {
    text-align: center;
    margin-top: 70px;
    font-size: 22pt;
    font-weight: bold;
    text-decoration: underline;
    letter-spacing: 0.5pt;
  }
  .cover-refbox {
    text-align: center;
    margin-top: 28px;
    font-size: 13pt;
  }
  .cover-refbox div { margin: 4px 0; }
  .cover-vehicle {
    text-align: center;
    margin-top: 36px;
    font-size: 14pt;
    font-weight: bold;
    line-height: 1.5;
  }
  .cover-vin {
    text-align: center;
    font-size: 13pt;
    margin-top: 6px;
  }
  .cover-insured {
    text-align: center;
    margin-top: 28px;
    font-size: 13pt;
    font-weight: bold;
    line-height: 1.5;
  }
  .cover-insurer-block {
    text-align: center;
    margin-top: 40px;
  }
  .cover-insurer {
    color: ${brand.color};
    font-size: 15pt;
    font-weight: bold;
  }
  .cover-policy {
    margin-top: 6px;
    font-size: 12pt;
  }
  .cover-policy .pno { font-weight: bold; }
  .cover-plan {
    margin-top: 10px;
    font-size: 11pt;
    font-style: italic;
  }
  .cover-foot { margin-top: auto; }

  /* INNER PAGES */
  .inner-head {
    text-align: center;
    border-bottom: 1.25pt solid ${brand.color};
    padding-bottom: 6px;
  }
  .hd-name { color: ${brand.color}; font-size: 13pt; font-weight: bold; line-height: 1.2; }
  .hd-sla { color: ${brand.color}; font-size: 9.5pt; }
  .hd-tagline { color: ${brand.color}; font-size: 9.5pt; font-style: italic; margin-top: 2px; }
  .ref-row {
    display: flex;
    justify-content: space-between;
    margin-top: 14px;
    font-size: 10.5pt;
  }
  .report-title {
    text-align: center;
    font-size: 14pt;
    font-weight: bold;
    text-decoration: underline;
    margin: 18px 0 6px 0;
  }
  .report-sub {
    text-align: center;
    font-size: 10.5pt;
    font-style: italic;
    margin-bottom: 14px;
  }
  .address-block {
    margin: 12px 0;
    line-height: 1.4;
    font-size: 11pt;
  }
  .subject-block { margin: 12px 0; font-size: 11pt; }
  .subject-block .sj-label { font-weight: bold; }
  .subject-block .sj-body { display: inline-block; vertical-align: top; }

  .section-title {
    font-weight: bold;
    font-size: 11.5pt;
    margin: 16px 0 6px 0;
    text-decoration: underline;
  }
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0 10px 0;
    font-size: 10.5pt;
  }
  table.data-table td {
    border: 0.6pt solid #444;
    padding: 5px 8px;
    vertical-align: top;
  }
  table.data-table td.label { width: 32%; font-weight: bold; }
  table.data-table td.idx { width: 5%; text-align: center; font-weight: bold; }
  table.data-table td.key { width: 32%; font-weight: bold; }

  table.amount-table {
    width: 80%;
    border-collapse: collapse;
    margin: 12px auto;
    font-size: 11pt;
  }
  table.amount-table td, table.amount-table th {
    border: 0.6pt solid #444;
    padding: 6px 12px;
  }
  table.amount-table th {
    background: #f0ecf6;
    text-align: left;
    font-weight: bold;
  }
  table.amount-table th:last-child, table.amount-table td:last-child { text-align: right; }
  table.amount-table tr.total-row td { background: #f5f1fb; font-weight: bold; }

  p { margin: 6px 0; text-align: justify; }
  p.indent { text-indent: 30px; }

  ul.findings {
    margin: 6px 0 6px 18px;
    padding-left: 12px;
  }
  ul.findings li { margin-bottom: 7px; text-align: justify; }
  ul.findings ul { margin-top: 4px; padding-left: 16px; }

  .note-block {
    margin-top: 14px;
    padding: 10px 14px 10px 14px;
    border-left: 2pt solid ${brand.color};
  }
  .note-block .note-title { font-weight: bold; margin-bottom: 4px; }
  .note-block ul { margin: 4px 0 0 18px; padding-left: 0; }
  .note-block li { margin-bottom: 4px; }

  .disclaimer { margin-top: 12px; font-size: 10.5pt; }
  .discretion { margin-top: 16px; font-weight: bold; font-size: 11pt; }

  .signature-block {
    margin-top: 30px;
    text-align: right;
    font-size: 11pt;
  }
  .signature-block .sig-for { margin-bottom: 6px; }
  .signature-line {
    display: inline-block;
    min-width: 200px;
    border-top: 0.75pt solid #000;
    margin-top: 50px;
    padding-top: 4px;
    font-weight: bold;
    text-align: center;
  }
</style>
</head><body>

<!-- PAGE 1: COVER -->
<div class="page">
  <div class="page-content">
    <div class="cover-brand">
      <div class="cover-name">${brand.shortName}</div>
      <div class="cover-sla">${brand.slaCover}</div>
    </div>
    <div class="cover-title">EXTENDED WARRANTY REPORT</div>
    <div class="cover-refbox">
      <div><b>Ref. No:</b> ${refNo}</div>
      <div><b>Date:</b> ${dateStr}</div>
    </div>
    <div class="cover-vehicle">REPORTED LOSS TO VEHICLE NO. ${safe(c.vehicle_reg_no) || '-'}</div>
    <div class="cover-vin">VIN NUMBER &#8211; ${safe(c.chassis_number) || '-'}</div>
    <div class="cover-insured">INSURED: ${(safe(c.insured_name) || '-').toUpperCase()}</div>
    <div class="cover-insurer-block">
      <div class="cover-insurer">${safe(c.insurer_name) || 'The Oriental Insurance Co. Ltd.'}</div>
      <div class="cover-policy">EXTENDED WARRANTY INSURANCE POLICY NO &#8211; <span class="pno">${safe(c.policy_number) || '-'}</span></div>
      ${c.warranty_plan ? `<div class="cover-plan">${safe(c.warranty_plan)}</div>` : ''}
    </div>
  </div>
  ${coverFoot}
</div>

<!-- PAGE 2: COVER LETTER + CLAIM DETAILS -->
<div class="page">
  <div class="page-content">
    ${innerHead}
    <div class="report-title">EXTENDED WARRANTY REPORT</div>
    <div class="report-sub">(WITHOUT PREJUDICE)</div>
    <div class="address-block">
      To,<br>
      The Claim In-Charge<br>
      <b>${safe(c.insurer_name) || ''}</b><br>
      ${(safe(c.insurer_address) || '').replace(/\n/g, '<br>')}
    </div>
    <div class="subject-block">
      <span class="sj-label">Subject:</span>&nbsp;&nbsp;<span class="sj-body">Reported claim under Extended Warranty of VIN No. ${safe(c.chassis_number) || ''}<br>
      Vehicle No. ${safe(c.vehicle_reg_no) || ''}, Insured: ${safe(c.insured_name) || ''}<br>
      Policy No. ${safe(c.policy_number) || ''}&nbsp;&nbsp;||&nbsp;&nbsp;Claim File No. ${safe(c.claim_file_no) || ''}</span>
    </div>
    <p>Dear Sir,</p>
    <p class="indent">Pursuant to valued instruction received from Claims Hub of ${safe(c.insurer_name) || ''} on ${formatDate(c.date_of_intimation)} for survey and loss assessment of the below-mentioned claim, we made immediate contact with the insured&rsquo;s representative and conducted the survey as per the details below.</p>
    <div class="section-title">1. CLAIM DETAILS:</div>
    <table class="data-table">
      <tr><td class="label">Insured</td><td>${safe(c.insured_name) || ''}${c.insured_address ? `<br>${safe(c.insured_address)}` : ''}</td></tr>
      <tr><td class="label">Insurer</td><td>${safe(c.insurer_name) || ''}${c.insurer_address ? `<br>${safe(c.insurer_address)}` : ''}</td></tr>
      <tr><td class="label">Policy No</td><td>${safe(c.policy_number) || ''}</td></tr>
      <tr><td class="label">Claim File No</td><td>${safe(c.claim_file_no) || ''}</td></tr>
      <tr><td class="label">Person Contacted</td><td>${safe(c.person_contacted) || ''}</td></tr>
      <tr><td class="label">Estimated loss Amount</td><td>Rs. ${formatAmount(c.estimated_loss_amount)}</td></tr>
      <tr><td class="label">Claim Type</td><td>Claim under Extended Warranty of VIN No. ${safe(c.chassis_number) || ''}</td></tr>
    </table>
    <p>Now we are submitting our final survey and loss assessment report which is based on the following observations and the documents provided.</p>
  </div>
  ${innerFoot(2)}
</div>

<!-- PAGE 3: VEHICLE PARTICULARS + FINDINGS -->
<div class="page">
  <div class="page-content">
    ${innerHead}
    <div class="section-title">2. CERTIFICATE / VEHICLE PARTICULARS:</div>
    <table class="data-table">
      <tr><td class="idx">a.</td><td class="key">Name of Customer</td><td>${safe(c.customer_name) || ''}</td></tr>
      <tr><td class="idx">b.</td><td class="key">Registration No.</td><td>${safe(c.vehicle_reg_no) || ''}</td></tr>
      <tr><td class="idx">c.</td><td class="key">Date of Registration</td><td>${formatDate(c.date_of_registration)}</td></tr>
      <tr><td class="idx">d.</td><td class="key">Make</td><td>${safe(c.vehicle_make) || ''}</td></tr>
      <tr><td class="idx">e.</td><td class="key">Model / Fuel Type</td><td>${safe(c.model_fuel_type) || ''}</td></tr>
      <tr><td class="idx">f.</td><td class="key">Chassis No.</td><td>${safe(c.chassis_number) || ''}</td></tr>
      <tr><td class="idx">g.</td><td class="key">Engine No.</td><td>${safe(c.engine_number) || ''}</td></tr>
      <tr><td class="idx">h.</td><td class="key">Odometer reading</td><td>${safe(c.odometer_reading) || ''}</td></tr>
      <tr><td class="idx">i.</td><td class="key">Plan</td><td>${safe(c.warranty_plan) || ''}</td></tr>
      <tr><td class="idx">j.</td><td class="key">Certificate No</td><td>${safe(c.certificate_no) || ''}</td></tr>
      <tr><td class="idx">k.</td><td class="key">Certificate From / To</td><td>${safe(c.certificate_validity_text) || ''}</td></tr>
      <tr><td class="idx">l.</td><td class="key">Product</td><td>${safe(c.product_description) || ''}</td></tr>
      <tr><td class="idx">m.</td><td class="key">Terms &amp; Conditions</td><td>${safe(c.terms_conditions) || ''}</td></tr>
    </table>
    <div class="section-title">3. OUR SURVEY / INSPECTION / FINDINGS:</div>
    <ul class="findings">
      <li>As per instructions received, we made immediate contact with the Service Centre at <b>${safe(c.dealer_name) || 'the authorized dealer'}</b>${c.dealer_address ? `, ${safe(c.dealer_address)}` : ''} on ${formatDate(c.survey_date)} and conducted the survey.</li>
      <li>During our survey the service person has showed the <b>Vehicle No. ${safe(c.vehicle_reg_no) || ''}</b> (of customer ${safe(c.customer_name) || ''}). It was informed that the vehicle was received with customer complaint <b>&ldquo;${(safe(c.customer_complaint) || '').toUpperCase()}&rdquo;</b> on <b>${formatDate(c.complaint_date)}</b>.</li>
      <li>${safe(c.initial_observation) || 'During our survey, it was noted that the vehicle had issues which needed to be diagnosed.'}</li>
      <li>We had informed the dealer to dismantle the vehicle and inform us about the affected parts. The dealer dismantled the vehicle and informed that <b>${safe(c.defective_parts) || 'the affected parts'}</b> were defective and needed to be replaced.</li>
      <li>We convinced the dealer not to change parts which are not covered under the policy and not to perform work which is not falling under Extended Warranty, and the dealer agreed for the same.</li>
      <li>${safe(c.external_damages) || 'No external damages were found.'}</li>
      <li>Service history records were ${c.service_history_verified === false ? 'not verified' : 'verified'}.</li>
    </ul>
  </div>
  ${innerFoot(3)}
</div>

<!-- PAGE 4: REINSPECTION + ASSESSMENT -->
<div class="page">
  <div class="page-content">
    ${innerHead}
    <ul class="findings">
      <li><b>Reinspection of vehicle was done on ${formatDate(c.reinspection_date)}</b>, and the dealer had removed the affected defective parts, replaced/repaired the same and produced them for our inspection.</li>
      <li>During our survey, photographs of the vehicle were snapped from different angles.</li>
      <li>Tax Invoice was furnished by the dealer, copy enclosed.
        <ul>
          <li>Tax Invoice No. &#8211; ${safe(c.tax_invoice_no) || ''}&nbsp;&nbsp;Date : ${formatDate(c.tax_invoice_date)}</li>
          <li>Invoice Amount &#8211; Rs. ${formatAmount(c.tax_invoice_amount)}</li>
        </ul>
      </li>
    </ul>
    <div class="section-title">4. ASSESSMENT OF LOSS:</div>
    <ul class="findings">
      <li>We have assessed the loss based on the physical observation of the damages and documents/details submitted by the insured.</li>
      <li>The insured has provided the repair invoice from <b>${safe(c.dealer_invoice_name) || safe(c.dealer_name) || ''}</b>, vide Invoice No. ${safe(c.tax_invoice_no) || ''} dated ${formatDate(c.tax_invoice_date)} for Rs. ${formatAmount(c.tax_invoice_amount)}, which we have considered in our assessment.</li>
      <li>We have adjusted the consumables and parts which are not covered and mentioned in the exclusions of the policy.</li>
      <li>We have not considered the GST component in our assessment, as the insured would be eligible to take GST credit.</li>
    </ul>
    <table class="amount-table">
      <tr><th>Description</th><th>Amount</th></tr>
      <tr><td>Gross Assessed Loss Amount</td><td>${formatAmount(c.gross_assessed_amount)}</td></tr>
      <tr><td>Less GST Amount</td><td>${formatAmount(c.gst_amount)}</td></tr>
      <tr class="total-row"><td>Total</td><td>${formatAmount(c.total_after_gst)}</td></tr>
      <tr><td>Less: Not Covered</td><td>${c.not_covered_amount ? formatAmount(c.not_covered_amount) : '-'}</td></tr>
      <tr class="total-row"><td>Net Adjusted Loss Amount</td><td>${formatAmount(c.net_adjusted_amount)}</td></tr>
    </table>
    ${c.amount_in_words ? `<p style="text-align:center;"><b>(${safe(c.amount_in_words)})</b> subject to policy terms and conditions and final approval by the insurer.</p>` : `<p style="text-align:center;">Subject to policy terms and conditions and final approval by the insurer.</p>`}
  </div>
  ${innerFoot(4)}
</div>

<!-- PAGE 5: CONCLUSION -->
<div class="page">
  <div class="page-content">
    ${innerHead}
    <div class="section-title">5. CONCLUSION:</div>
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
      <div class="sig-for">For <b>${brand.shortName}</b></div>
      <div class="signature-line">Authorized Signatory<br>(Surveyor)</div>
    </div>
  </div>
  ${innerFoot(5)}
</div>

</body></html>`;
}
