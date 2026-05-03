-- ============================================================
-- Migration: EW Document Categories + Enhanced Activity Logging
-- SAFE: Purely additive
-- ============================================================

BEGIN;

-- 1. Document categories (admin-editable)
CREATE TABLE IF NOT EXISTS ew_document_categories (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL,
  subfolder_name text NOT NULL,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Seed default EW document categories
INSERT INTO ew_document_categories (name, code, subfolder_name, sort_order) VALUES
  ('Claim Intimation Sheet', 'intimation', 'Intimation', 1),
  ('Policy Copy', 'policy_copy', 'Policy Copy', 2),
  ('Warranty Certificate', 'certificate', 'Certificate', 3),
  ('Job Card', 'job_card', 'Job Card', 4),
  ('Service Record / History', 'service_record', 'Service Record', 5),
  ('Diagnosis Report / Evidence', 'diagnosis', 'Diagnosis Report', 6),
  ('Repair Estimate', 'repair_estimate', 'Repair Estimate', 7),
  ('Tax Invoice (Repair)', 'tax_invoice', 'Tax Invoice', 8),
  ('Inspection Photos', 'inspection_photos', 'Photos - Inspection', 9),
  ('Kept Open Photos', 'kept_open_photos', 'Photos - Kept Open', 10),
  ('Dismantling Photos', 'dismantling_photos', 'Photos - Dismantling', 11),
  ('Reinspection Photos', 'reinspection_photos', 'Photos - Reinspection', 12),
  ('Defective Part Photos', 'defective_parts', 'Photos - Defective Parts', 13),
  ('Installed Part Photos', 'installed_parts', 'Photos - Installed Parts', 14),
  ('FSR Report', 'fsr', 'FSR', 15),
  ('Other Documents', 'other', 'Others', 99);

-- 2. Add document_category to ew_claim_media for categorized uploads
ALTER TABLE ew_claim_media ADD COLUMN IF NOT EXISTS document_category text;
ALTER TABLE ew_claim_media ADD COLUMN IF NOT EXISTS category_id bigint;
ALTER TABLE ew_claim_media ADD COLUMN IF NOT EXISTS subfolder text;

-- 3. Add folder_path to ew_vehicle_claims (for file server integration)
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS folder_path text;

COMMIT;
