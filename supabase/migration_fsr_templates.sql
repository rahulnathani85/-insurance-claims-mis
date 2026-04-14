-- ============================================================
-- Migration: FSR Template Editor
-- SAFE: Purely additive.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS fsr_templates (
  id bigserial PRIMARY KEY,
  company text NOT NULL,
  template_name text DEFAULT 'Default',
  company_full_name text,
  company_short_name text,
  sla_number text,
  sla_expiry text,
  tagline text,
  brand_color text DEFAULT '#4B0082',
  address_line text,
  contact_line text,
  cover_title text DEFAULT 'EXTENDED WARRANTY REPORT',
  section1_title text DEFAULT '1. CLAIM DETAILS:',
  section2_title text DEFAULT '2. CERTIFICATE / VEHICLE PARTICULARS:',
  section3_title text DEFAULT '3. OUR SURVEY / INSPECTION / FINDINGS:',
  section4_title text DEFAULT '4. ASSESSMENT OF LOSS:',
  section5_title text DEFAULT '5. CONCLUSION:',
  cover_letter_opening text,
  cover_letter_closing text,
  conclusion_text text,
  note1_text text,
  note2_text text,
  note3_text text,
  signature_text text DEFAULT 'Authorised Signatory',
  assessment_label_gross text DEFAULT 'Gross Assessed Loss',
  assessment_label_gst text DEFAULT 'Less: GST @ 18% (As the insured is eligible for GST credit)',
  assessment_label_total text DEFAULT 'Total',
  assessment_label_not_covered text DEFAULT 'Less: Not Covered / Excess',
  assessment_label_net text DEFAULT 'Net Adjusted Loss Amount',
  font_family text DEFAULT 'Times New Roman, Times, serif',
  font_size text DEFAULT '11pt',
  logo_base64 text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fsr_templates_company ON fsr_templates(company);

-- Seed NISLA default template
INSERT INTO fsr_templates (company, template_name, company_full_name, company_short_name, sla_number, sla_expiry, tagline, brand_color, address_line, contact_line, cover_letter_opening, cover_letter_closing, conclusion_text, note1_text, note2_text, note3_text) VALUES (
  'NISLA', 'Default',
  'NATHANI INSURANCE SURVEYORS & LOSS ASSESSORS PVT. LTD.',
  'NATHANI INSURANCE SURVEYORS AND LOSS ASSESSORS PVT. LTD.',
  'IRDA/CORP/S.L.A. No - 200025',
  '03/10/2028',
  'LOP ✦ Fire ✦ Engineering ✦ Misc. ✦ Marine Cargo ✦ Motor',
  '#4B0082',
  'Head Office: 507, Garnet Palladium, Behind Express Zone Bldg., Off WE Highway, Goregaon-E, Mumbai – 400063',
  'Mobile: 9892171640, 9890084540  |  E-mail: pranav.kumar554@gmail.com, nathani.surveyors@gmail.com',
  'Pursuant to valued instruction received from {{appointing_office}} on {{date_of_intimation}} for survey and loss assessment of the below-mentioned claim, we made immediate contact with the insured''s representative and conducted the survey as per the details below.',
  'Now we are submitting our final survey and loss assessment report which is based on the following observations and the documents provided.',
  'In view of the above, as per the Manufacturer Guidelines / Manual, the defective / part has been replaced with new one, same be considered under extended warranty, subject to coverage of the vehicle in the policy and as per the terms and conditions of the policy issued.',
  'Kindly check annexure for proof of payment for the amount of repair and photos of defective parts and installed parts.',
  'This report is furnished without prejudice to the rights, liabilities, terms and conditions of the policy issued by the insurer.',
  'This report is based on the facts and information made available and known to us at the time of survey and preparation of the report. If any new facts or information come to our notice, the same shall be incorporated in subsequent/supplementary report.'
);

-- Seed Acuere default template
INSERT INTO fsr_templates (company, template_name, company_full_name, company_short_name, sla_number, sla_expiry, tagline, brand_color, address_line, contact_line, cover_letter_opening, cover_letter_closing, conclusion_text, note1_text, note2_text, note3_text) VALUES (
  'Acuere', 'Default',
  'ACUERE SURVEYORS',
  'ACUERE SURVEYORS',
  'S.L.A. 85225',
  '02/03/2028',
  'Fire ✦ Misc. ✦ Engineering ✦ Marine Cargo ✦ Motor',
  '#1a7ab5',
  '507, Garnet Palladium, Panch-Bawadi, Goregaon (E), Mumbai - 400063',
  'Contact: 9892976754  |  Email: niteennathani@gmail.com, acueresurveyors@gmail.com',
  'Pursuant to valued instruction received from {{appointing_office}} on {{date_of_intimation}} for survey and loss assessment of the below-mentioned claim, we made immediate contact with the insured''s representative and conducted the survey as per the details below.',
  'Now we are submitting our final survey and loss assessment report which is based on the following observations and the documents provided.',
  'In view of the above, as per the Manufacturer Guidelines / Manual, the defective / part has been replaced with new one, same be considered under extended warranty, subject to coverage of the vehicle in the policy and as per the terms and conditions of the policy issued.',
  'Kindly check annexure for proof of payment for the amount of repair and photos of defective parts and installed parts.',
  'This report is furnished without prejudice to the rights, liabilities, terms and conditions of the policy issued by the insurer.',
  'This report is based on the facts and information made available and known to us at the time of survey and preparation of the report. If any new facts or information come to our notice, the same shall be incorporated in subsequent/supplementary report.'
);

COMMIT;
