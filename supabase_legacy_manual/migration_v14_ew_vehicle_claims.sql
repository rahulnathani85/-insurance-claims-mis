-- Migration v14: Extended Warranty Vehicle Claims Module
-- Creates tables for EW vehicle claim lifecycle, media, and FSR generation

-- Main EW Vehicle Claims table (extends claims table via claim_id)
CREATE TABLE IF NOT EXISTS ew_vehicle_claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID REFERENCES claims(id) ON DELETE SET NULL,
  ref_number TEXT,
  company TEXT DEFAULT 'NISLA',
  report_date DATE,

  -- Section 1: Claim Details
  insured_name TEXT,
  insured_address TEXT,
  insurer_name TEXT,
  insurer_address TEXT,
  policy_number TEXT,
  claim_file_no TEXT,
  person_contacted TEXT,
  estimated_loss_amount NUMERIC(12,2),
  date_of_intimation DATE,

  -- Section 2: Certificate / Vehicle Particulars
  customer_name TEXT,
  vehicle_reg_no TEXT,
  date_of_registration DATE,
  vehicle_make TEXT,
  model_fuel_type TEXT,
  chassis_number TEXT,
  engine_number TEXT,
  odometer_reading TEXT,
  warranty_plan TEXT,
  certificate_no TEXT,
  certificate_from DATE,
  certificate_to DATE,
  certificate_kms TEXT,
  certificate_validity_text TEXT,
  product_description TEXT,
  terms_conditions TEXT,

  -- Dealer / Service Centre Info
  dealer_name TEXT,
  dealer_address TEXT,
  dealer_contact TEXT,

  -- Customer complaint
  customer_complaint TEXT,
  complaint_date DATE,

  -- Section 3: Survey / Inspection / Findings
  survey_date DATE,
  survey_location TEXT,
  initial_observation TEXT,
  dismantled_observation TEXT,
  defective_parts TEXT,
  external_damages TEXT DEFAULT 'No external damages were found.',
  service_history_verified BOOLEAN DEFAULT true,

  -- Reinspection
  reinspection_date DATE,
  reinspection_notes TEXT,

  -- Tax Invoice
  tax_invoice_no TEXT,
  tax_invoice_date DATE,
  tax_invoice_amount NUMERIC(12,2),
  dealer_invoice_name TEXT,

  -- Section 4: Assessment of Loss
  gross_assessed_amount NUMERIC(12,2),
  gst_amount NUMERIC(12,2),
  total_after_gst NUMERIC(12,2),
  not_covered_amount NUMERIC(12,2) DEFAULT 0,
  net_adjusted_amount NUMERIC(12,2),
  amount_in_words TEXT,

  -- Section 5: Conclusion
  conclusion_text TEXT DEFAULT 'In view of the above, as per the Manufacturer Guidelines / Manual, the defective / part has been replaced with new one, same be considered under extended warranty, subject to coverage of the vehicle in the policy and as per the terms and conditions of the policy issued.',

  -- Lifecycle stage tracking
  current_stage INTEGER DEFAULT 1,
  current_stage_name TEXT DEFAULT 'Claim Intimation',
  status TEXT DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Assessment', 'Report Ready', 'Completed', 'Closed')),

  -- Meta
  created_by TEXT,
  assigned_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- EW Claim Lifecycle Stages
CREATE TABLE IF NOT EXISTS ew_claim_stages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ew_claim_id UUID REFERENCES ew_vehicle_claims(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Skipped')),
  started_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  notes TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- EW Claim Media (Photos/Videos per stage)
CREATE TABLE IF NOT EXISTS ew_claim_media (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ew_claim_id UUID REFERENCES ew_vehicle_claims(id) ON DELETE CASCADE,
  stage_number INTEGER,
  media_type TEXT CHECK (media_type IN ('photo', 'video', 'document')),
  file_name TEXT,
  file_url TEXT,
  file_size INTEGER,
  caption TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_company ON ew_vehicle_claims(company);
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_status ON ew_vehicle_claims(status);
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_ref ON ew_vehicle_claims(ref_number);
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_claim_id ON ew_vehicle_claims(claim_id);
CREATE INDEX IF NOT EXISTS idx_ew_claim_stages_claim ON ew_claim_stages(ew_claim_id);
CREATE INDEX IF NOT EXISTS idx_ew_claim_media_claim ON ew_claim_media(ew_claim_id);

-- EW-specific ref counter (separate from main claims counter)
-- The existing ref_counters table has an 'Extended Warranty' entry which we'll continue to use
