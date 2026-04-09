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
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatAmount(n) {
  if (!n && n !== 0) return '-';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generateFSRHtml(c, isNISLA) {
  const companyHeader = isNISLA ? getNISLAHeader() : getAcuereHeader();
  const companyPageHeader = isNISLA ? getNISLAPageHeader(c) : getAcuerePageHeader(c);
  const companyFooter = isNISLA ? getNISLAFooter() : getAcuereFooter();

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  @page { margin: 20mm 15mm 25mm 15mm; size: A4; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12px; line-height: 1.5; color: #000; margin: 0; padding: 0; }
  .page { page-break-after: always; position: relative; min-height: 250mm; padding-bottom: 30mm; }
  .page:last-child { page-break-after: auto; }
  .page-header { margin-bottom: 10px; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; border-top: 1px solid #333; padding-top: 3px; }
  table.data-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  table.data-table td, table.data-table th { border: 1px solid #000; padding: 4px 8px; vertical-align: top; }
  table.data-table th { background: #f0f0f0; text-align: center; font-weight: bold; }
  .section-title { font-weight: bold; text-decoration: underline; margin: 15px 0 8px 0; font-size: 12px; }
  .cover-box { border: 1px solid #000; padding: 15px; text-align: center; margin: 10px 0; }
  .amount-table td { padding: 5px 10px; }
  .amount-table td:last-child { text-align: right; }
  h1.company-name { color: ${isNISLA ? '#4B0082' : '#1a7ab5'}; font-size: 20px; margin: 0; }
  .sub-info { color: ${isNISLA ? '#4B0082' : '#1a7ab5'}; font-size: 10px; }
  ul { margin: 5px 0; padding-left: 20px; }
  ul li { margin-bottom: 6px; }
</style>
</head><body>

<!-- PAGE 1: COVER PAGE -->
<div class="page">
${companyHeader}
<div style="text-align:center; margin-top: 30px;">
  <h2 style="font-size: 18px;">EXTENDED WARRANTY REPORT</h2>
  <p style="font-size: 16px;">Ref. No: ${c.ref_number || ''}</p>
  <p style="font-size: 16px;">Date:${formatDate(c.report_date)}</p>
</div>
<div class="cover-box">
  <p style="font-size: 14px;">REPORTED LOSS TO VEHICLE NO. ${c.vehicle_reg_no || ''}</p>
  <p style="font-size: 14px; margin-top: 10px;">VIN NUMBER &ndash; ${c.chassis_number || ''}</p>
  <p style="font-size: 14px; margin-top: 20px;">INSURED: ${(c.insured_name || '').toUpperCase()}</p>
</div>
<div class="cover-box" style="margin-top: 20px;">
  <h2 style="color: ${isNISLA ? '#4B0082' : '#1a7ab5'}; font-size: 22px;">${c.insurer_name || 'The Oriental Insurance Co. Ltd.'}</h2>
  <p style="font-size: 14px; margin-top: 10px;">EXTENDED WARRANTY INSURANCE POLICY NO &ndash;<br>${c.policy_number || ''}</p>
  <p style="font-size: 14px; margin-top: 10px;">${c.warranty_plan || ''}</p>
</div>
${companyFooter}
</div>

<!-- PAGE 2: CLAIM DETAILS -->
<div class="page">
${companyPageHeader}
<div style="text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 10px;">
  EXTENDED WARRANTY REPORT<br>(WITHOUT PREJUDICE)
</div>
<div style="margin-bottom: 10px;">
To<br>
The Claim In-Charge<br>
${c.insurer_name || ''}<br>
${c.insurer_address || ''}
</div>
<div style="margin-bottom: 10px;">
<b>Subject:</b>&nbsp;&nbsp;Reported claim under Extended Warranty of VIN No.${c.chassis_number || ''}<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Vehicle No.${c.vehicle_reg_no || ''} ,Insured: ${c.insured_name || ''}<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Policy No &ndash;${c.policy_number || ''}|| Claim File No.${c.claim_file_no || ''}
</div>
<p>Dear Sir,</p>
<p style="text-indent: 30px;">Pursuant to valued instruction received from Claims Hub of Chennai Office of ${c.insurer_name || ''} on ${formatDate(c.date_of_intimation)} for survey and loss assessment of the below mentioned claim. Accordingly, we made immediate contact with the insured&rsquo;s representative and conducted the survey as per below details:</p>

<div class="section-title">1. CLAIM DETAILS:</div>
<table class="data-table">
  <tr><td style="width:35%">Insured</td><td>${c.insured_name || ''}<br>${c.insured_address || ''}</td></tr>
  <tr><td>Insurer</td><td>${c.insurer_name || ''}<br>${c.insurer_address || ''}</td></tr>
  <tr><td>Policy No</td><td>${c.policy_number || ''}</td></tr>
  <tr><td>Claim File No</td><td>${c.claim_file_no || ''}</td></tr>
  <tr><td>Person Contacted</td><td>${c.person_contacted || ''}</td></tr>
  <tr><td>Estimated loss Amount</td><td>Rs. ${formatAmount(c.estimated_loss_amount)}</td></tr>
  <tr><td>Claim Type</td><td>Claim under Extended Warranty of VIN No. ${c.chassis_number || ''}</td></tr>
</table>

<p>Now we are submitting our final survey and loss assessment report which is based on the following observations and documents provided.</p>
${companyFooter}
</div>

<!-- PAGE 3: VEHICLE PARTICULARS & FINDINGS -->
<div class="page">
${companyPageHeader}
<div class="section-title">2. CERTIFICATE / VEHICLE PARTICULARS:</div>
<table class="data-table">
  <tr><td>a.</td><td style="width:30%">Name of Customer</td><td>${c.customer_name || ''}</td></tr>
  <tr><td>b.</td><td>Registration No.</td><td>${c.vehicle_reg_no || ''}</td></tr>
  <tr><td>c.</td><td>Date of Registration</td><td>${formatDate(c.date_of_registration)}</td></tr>
  <tr><td>d.</td><td>Make</td><td>${c.vehicle_make || ''}</td></tr>
  <tr><td>e.</td><td>Model / Fuel Type</td><td>${c.model_fuel_type || ''}</td></tr>
  <tr><td>f.</td><td>Chassis No.</td><td>${c.chassis_number || ''}</td></tr>
  <tr><td>g.</td><td>Engine No.</td><td>${c.engine_number || ''}</td></tr>
  <tr><td>h.</td><td>Odometer reading</td><td>${c.odometer_reading || ''}</td></tr>
  <tr><td>i.</td><td>Plan</td><td>${c.warranty_plan || ''}</td></tr>
  <tr><td>j.</td><td>Certificate No</td><td>${c.certificate_no || ''}</td></tr>
  <tr><td>k.</td><td>Certificate From / To</td><td>${c.certificate_validity_text || ''}</td></tr>
  <tr><td>l.</td><td>Product</td><td>${c.product_description || ''}</td></tr>
  <tr><td>m.</td><td>Terms &amp; Conditions</td><td>${c.terms_conditions || ''}</td></tr>
</table>

<div class="section-title">3. OUR SURVEY / INSPECTION / FINDINGS:</div>
<ul>
  <li>As per instructions received, we made immediate contact with Service Centre at ${c.dealer_name || 'the authorized dealer'}, at ${c.dealer_address || ''} on ${formatDate(c.survey_date)} and conducted the survey.</li>
  <li>During our survey the service person has showed the <b>Vehicle No.${c.vehicle_reg_no || ''}</b> (Of customer of ${c.customer_name || ''}). It was informed that the vehicle was received with customer complaint <b>&ldquo;${(c.customer_complaint || '').toUpperCase()}&rdquo; on ${formatDate(c.complaint_date)}.</b></li>
  <li>${c.initial_observation || 'During our survey it was noted that the vehicle had issues which need to be diagnosed.'}</li>
  <li>We had informed the dealer to dismantle the vehicle and inform us about the affected parts. The dealer dismantled the vehicle and informed that ${c.defective_parts || 'certain parts were'} defective and needed to be replaced.</li>
  <li>We convinced the dealer not to change parts which are not covered under the policy, not to perform work which is not falling under EW and the dealer agreed for the same.</li>
  <li>During our survey, it was noted that the vehicle was damaged / affected due to breakdown.</li>
  <li>${c.external_damages || 'No external damages were found.'}</li>
</ul>
${companyFooter}
</div>

<!-- PAGE 4: REINSPECTION & ASSESSMENT -->
<div class="page">
${companyPageHeader}
<ul>
  <li>Service history records were verified.</li>
  <li><b>Reinspection of vehicle was done on ${formatDate(c.reinspection_date)}, and</b> the dealer had removed the affected defective parts and replaced/repair the same and produced them for our inspection.</li>
  <li>During our survey, photographs of the Vehicle were snapped from different angles.</li>
  <li>Tax Invoice was furnished by the Dealer, copy enclosed.
    <ul>
      <li>Tax Invoice No &ndash;${c.tax_invoice_no || ''} Date : ${formatDate(c.tax_invoice_date)}</li>
      <li>Invoice Amount &ndash; Rs. ${formatAmount(c.tax_invoice_amount)}</li>
    </ul>
  </li>
</ul>

<div class="section-title">4. ASSESSMENT OF LOSS</div>
<ul>
  <li>We have assessed the loss based on the physical observation of the damages and documents/details submitted by the insured.</li>
  <li>The insured had provided the repairing invoice from ${c.dealer_invoice_name || c.dealer_name || ''}, vide Invoice No &ndash; ${c.tax_invoice_no || ''} dated ${formatDate(c.tax_invoice_date)} for Rs. ${formatAmount(c.tax_invoice_amount)} which we have considered in our assessment.</li>
  <li>We have adjusted the consumables and parts, which are not covered and mentioned in the exclusions of the policy.</li>
  <li>We have not considered GST component in our assessment, as insured would be eligible to take GST credit.</li>
</ul>

<table class="data-table amount-table" style="width: 80%; margin: 15px auto;">
  <tr><th>Description</th><th>Amount</th></tr>
  <tr><td>Gross Assessed Loss Amount</td><td style="text-align:right">${formatAmount(c.gross_assessed_amount)}</td></tr>
  <tr><td>Less GST Amount</td><td style="text-align:right">${formatAmount(c.gst_amount)}</td></tr>
  <tr><td><b>Total</b></td><td style="text-align:right"><b>${formatAmount(c.total_after_gst)}</b></td></tr>
  <tr><td>Less: Not Covered</td><td style="text-align:right">${c.not_covered_amount ? formatAmount(c.not_covered_amount) : '-'}</td></tr>
  <tr><td><b>Net Adjusted Loss Amount</b></td><td style="text-align:right"><b>${formatAmount(c.net_adjusted_amount)}</b></td></tr>
</table>

<p>(${c.amount_in_words || 'Amount in words'}) subject to policy terms and conditions and final approval by the insurer.</p>
${companyFooter}
</div>

<!-- PAGE 5: CONCLUSION -->
<div class="page">
${companyPageHeader}
<div class="section-title">5. CONCLUSION:</div>
<p style="text-indent: 30px;">${c.conclusion_text || 'In view of the above, as per the Manufacturer Guidelines / Manual, the defective / part has been replaced with new one, same be considered under extended warranty, subject to coverage of the vehicle in the policy and as per the terms and conditions of the policy issued.'}</p>

<p style="margin-top: 15px;">Note:</p>
<ul>
  <li>Insurers are advised to check the Annexure of the policy and verify if the particular vehicle was declared to the insurer at the time of taking the policy or agreed in the policy.</li>
  <li>Insurer are advised to check the proof of payment (made by the insured to the dealer), before indemnifying the claimed loss.</li>
</ul>

<p style="margin-top: 15px;">This report is issued without prejudice and is subject to terms &amp; conditions of the policy of Insurance issued to and held by the Insured reserving our rights to alter / amend unintended error, if any.</p>
<p>This concludes my extended warranty report which has been issued for perusal of Insurance Co.</p>

<p style="margin-top: 10px;"><b>(For Discretion of Insurer &amp; their Legal Advisers only)</b></p>
<div style="text-align: right; margin-top: 30px;">
  <b>Authorized Signatory</b><br><br><br><br>
  <b>(Surveyor)</b>
</div>
${companyFooter}
</div>

</body></html>`;
}

// ---- NISLA Letterhead Components ----
function getNISLAHeader() {
  return `<div style="text-align: center;">
  <div style="text-align: right;"><span style="color: #4B0082; font-style: italic; font-size: 16px; font-weight: bold;">NISLA</span></div>
  <h1 style="color: #4B0082; font-size: 22px; margin: 10px 0;">NATHANI INSURANCE SURVEYORS &amp; LOSS<br>ASSESSORS PVT. LTD.</h1>
  <p style="font-size: 11px;">(IRDA/CORP/S.L.A. 200025 EXP. 03/10/2028)</p>
</div>`;
}

function getNISLAPageHeader(c) {
  return `<div class="page-header">
  <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 8px;">
    <div style="color: #4B0082; font-size: 14px; font-weight: bold;">NATHANI INSURANCE SURVEYORS AND LOSS ASSESSORS PVT. LTD.</div>
    <div style="color: #4B0082; font-size: 10px;">IRDA/CORP/S.L.A. No - 200025 Exp. 03/10/2025</div>
    <div style="font-size: 9px; margin: 3px 0;">LOP &#x2767; Fire &#x2767; Engineering &#x2767; Misc. &#x2767; Marine Cargo &#x2767; Marine Cargo</div>
  </div>
  <div style="display: flex; justify-content: space-between; font-size: 11px; border: 1px solid #000; padding: 3px 8px; margin-bottom: 10px;">
    <span><b>Ref No.</b>${c.ref_number || ''}</span>
    <span><b>Date : </b>${formatDate(c.report_date)}</span>
  </div>
</div>`;
}

function getNISLAFooter() {
  return `<div style="text-align: center; font-size: 9px; margin-top: 20px; border-top: 1px solid #000; padding-top: 5px;">
  <b style="color: #4B0082;">NATHANI INSURANCE SURVEYORS AND LOSS ASSESSORS PRIVATE LIMITED</b><br>
  Head Office: 507, Garnet Paladium, Behind Express Zone Bldg., Off WE Highway, Goregaon-E, Mumbai &ndash; 400063<br>
  Mobile: 9892171640, 9890084540<br>
  E-mail:pranav.kumar554@gmail.com, nathani.surveyors@gmail.com
</div>`;
}

// ---- Acuere Letterhead Components ----
function getAcuereHeader() {
  return `<div style="text-align: center; border: 1px solid #ccc; padding: 20px;">
  <h1 style="color: #1a7ab5; font-size: 28px; margin: 0; font-family: 'Courier New', monospace; letter-spacing: 3px;">ACUERE SURVEYORS</h1>
  <p style="color: #1a7ab5; font-size: 11px; margin: 5px 0;">S.L.A. 85225 Exp. 02/03/2028</p>
</div>`;
}

function getAcuerePageHeader(c) {
  return `<div class="page-header">
  <div style="text-align: center; padding-bottom: 5px; margin-bottom: 3px;">
    <div style="color: #1a7ab5; font-size: 18px; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 2px;">ACUERE SURVEYORS</div>
    <div style="color: #1a7ab5; font-size: 9px;">S.L.A. 85225 Exp. 02/03/2028</div>
    <div style="font-size: 8px; color: #1a7ab5;">*Fire *Misc *Engg. *Marine Cargo *Motor</div>
    <div style="font-size: 9px; color: #1a7ab5;">507, Garnet Pladium, Panch-Bawadi, Goregoan (E), Mumbai - 400063</div>
    <div style="font-size: 9px; color: #1a7ab5;">Contact No: 9892976754, 9892976754</div>
    <div style="font-size: 9px; color: #1a7ab5;">Email Id: niteennathani@gmail.com, acueresurveyors@gmail.com</div>
  </div>
  <div style="display: flex; justify-content: space-between; font-size: 11px; border: 1px solid #000; padding: 3px 8px; margin-bottom: 10px;">
    <span><b>Ref No.</b>${c.ref_number || ''}</span>
    <span><b>Date : </b>${formatDate(c.report_date)}</span>
  </div>
</div>`;
}

function getAcuereFooter() {
  return `<div style="text-align: center; font-size: 9px; margin-top: 20px; border-top: 1px solid #333; padding-top: 3px;">&nbsp;</div>`;
}
