-- ============================================================
-- Migration: Extended Warranty Lot Feature
-- SAFE: Purely additive. Creates lot tables + adds fsr_generated_at
--       tracking column to ew_vehicle_claims.
-- ============================================================

BEGIN;

-- Track when FSR was last saved to the claim folder. Used by the Lot
-- creation UI to limit selection to claims that already have an FSR.
ALTER TABLE ew_vehicle_claims
  ADD COLUMN IF NOT EXISTS fsr_generated_at TIMESTAMPTZ;

-- Parent lot record. One lot bundles many EW claims, typically of the
-- same EW program (e.g. "Jeep Extended Warranty"), and represents the
-- invoice package submitted to the insurer / OEM.
CREATE TABLE IF NOT EXISTS ew_lots (
  id BIGSERIAL PRIMARY KEY,
  lot_number TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT 'NISLA',
  lot_date DATE DEFAULT CURRENT_DATE,
  ew_program TEXT,
  insurer_name TEXT,
  surveyor_name TEXT,
  notes TEXT,

  -- Totals (recomputed on save of lot claims)
  claim_count INTEGER DEFAULT 0,
  total_professional_fee NUMERIC(12,2) DEFAULT 0,
  total_reinspection NUMERIC(12,2) DEFAULT 0,
  total_conveyance NUMERIC(12,2) DEFAULT 0,
  total_photographs NUMERIC(12,2) DEFAULT 0,
  total_bill NUMERIC(12,2) DEFAULT 0,
  total_gst NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,

  status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft', 'Finalized', 'Invoiced', 'Paid')),

  -- Audit
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_ew_lots_company_lot_number UNIQUE (company, lot_number)
);

-- Per-claim line item inside a lot. Stores the fee breakdown captured
-- at lot-creation time so the Excel always reproduces the same numbers
-- even if the underlying claim is edited later.
CREATE TABLE IF NOT EXISTS ew_lot_claims (
  id BIGSERIAL PRIMARY KEY,
  lot_id BIGINT NOT NULL REFERENCES ew_lots(id) ON DELETE CASCADE,
  ew_claim_id UUID NOT NULL REFERENCES ew_vehicle_claims(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,

  -- Snapshot fields (copied from ew_vehicle_claims at lot creation; cached for Excel)
  ref_number TEXT,
  claim_file_no TEXT,
  policy_number TEXT,
  insured_name TEXT,
  customer_name TEXT,
  vehicle_reg_no TEXT,
  chassis_number TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  date_of_intimation DATE,
  date_of_loss DATE,
  report_date DATE,
  estimated_loss_amount NUMERIC(12,2),
  gross_assessed_amount NUMERIC(12,2),
  net_adjusted_amount NUMERIC(12,2),
  admissibility TEXT,
  location TEXT,
  workshop_name TEXT,
  breakdown_details TEXT,
  service_request_number TEXT,

  -- Fee line items
  professional_fee NUMERIC(12,2) DEFAULT 0,
  reinspection_fee NUMERIC(12,2) DEFAULT 0,
  conveyance NUMERIC(12,2) DEFAULT 0,
  photographs NUMERIC(12,2) DEFAULT 0,
  total_bill NUMERIC(12,2) DEFAULT 0,
  gst NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_ew_lot_claims UNIQUE (lot_id, ew_claim_id)
);

-- Auto-incrementing counter per company for the lot number
CREATE TABLE IF NOT EXISTS ew_lot_counters (
  company TEXT PRIMARY KEY,
  current_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed a row for the two known companies so the first-use UPDATE path works
INSERT INTO ew_lot_counters (company, current_count) VALUES ('NISLA', 0) ON CONFLICT (company) DO NOTHING;
INSERT INTO ew_lot_counters (company, current_count) VALUES ('Acuere', 0) ON CONFLICT (company) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ew_lots_company ON ew_lots(company);
CREATE INDEX IF NOT EXISTS idx_ew_lots_status ON ew_lots(status);
CREATE INDEX IF NOT EXISTS idx_ew_lots_lot_date ON ew_lots(lot_date DESC);
CREATE INDEX IF NOT EXISTS idx_ew_lot_claims_lot ON ew_lot_claims(lot_id);
CREATE INDEX IF NOT EXISTS idx_ew_lot_claims_claim ON ew_lot_claims(ew_claim_id);
CREATE INDEX IF NOT EXISTS idx_ew_vehicle_claims_fsr_generated_at ON ew_vehicle_claims(fsr_generated_at);

COMMIT;
