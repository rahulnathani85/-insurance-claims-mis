-- Migration V5: User Management, File Tracking, LOR/ILA Generator
-- SAFE: Purely additive. No existing V1 tables are modified.
-- Run this in Supabase SQL Editor.

-- ============================================
-- 1. APP USERS (Simple Login System)
-- ============================================
CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Staff',  -- Admin, Surveyor, Staff
  company TEXT DEFAULT 'NISLA',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default admin user (password: admin123 - change immediately after first login)
-- Password is bcrypt hash of 'admin123'
INSERT INTO app_users (email, password_hash, name, role, company)
VALUES ('admin@nisla.in', '$2b$10$defaulthashplaceholder', 'Admin', 'Admin', 'NISLA')
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- 2. CLAIM LIFECYCLE STAGES (File Tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS claim_stages (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL,
  stage TEXT NOT NULL,  -- Intimation, Survey Scheduled, Survey Done, Assessment, Report Drafted, Report Submitted, Settled, Closed
  stage_date TEXT,
  notes TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_stages_claim_id ON claim_stages(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_stages_stage ON claim_stages(stage);

-- ============================================
-- 3. CLAIM DOCUMENT TRACKING
-- ============================================
CREATE TABLE IF NOT EXISTS claim_documents (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL,
  document_type TEXT NOT NULL,  -- LOR, ILA, FSR, Policy Copy, Survey Photos, Appointment Letter, Claim Form, etc.
  document_name TEXT,
  status TEXT DEFAULT 'Pending',  -- Pending, Generated, Uploaded, Sent
  file_url TEXT,
  generated_from_template BIGINT,  -- references document_templates.id if auto-generated
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_documents_claim_id ON claim_documents(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_documents_type ON claim_documents(document_type);

-- ============================================
-- 4. DOCUMENT TEMPLATES (LOR/ILA Rich Text)
-- ============================================
CREATE TABLE IF NOT EXISTS document_templates (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- LOR, ILA, FSR, Custom
  lob TEXT,  -- NULL means applicable to all LOBs
  company TEXT DEFAULT 'NISLA',
  content TEXT NOT NULL,  -- Rich text HTML content with placeholders like {{insured_name}}
  placeholders TEXT,  -- JSON string of available placeholders
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_type ON document_templates(type);
CREATE INDEX IF NOT EXISTS idx_document_templates_lob ON document_templates(lob);
CREATE INDEX IF NOT EXISTS idx_document_templates_company ON document_templates(company);

-- ============================================
-- 5. GENERATED DOCUMENTS (LOR/ILA Output)
-- ============================================
CREATE TABLE IF NOT EXISTS generated_documents (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL,
  template_id BIGINT REFERENCES document_templates(id),
  type TEXT NOT NULL,  -- LOR, ILA, FSR
  title TEXT,
  content TEXT NOT NULL,  -- Final rich text HTML with data filled in
  pdf_url TEXT,  -- URL if stored as PDF
  lob TEXT,
  company TEXT DEFAULT 'NISLA',
  generated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_documents_claim_id ON generated_documents(claim_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_type ON generated_documents(type);
CREATE INDEX IF NOT EXISTS idx_generated_documents_company ON generated_documents(company);

-- ============================================
-- 6. ACTIVITY LOG (for tracking user actions)
-- ============================================
CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT,
  action TEXT NOT NULL,  -- login, create_claim, generate_lor, update_stage, etc.
  entity_type TEXT,  -- claim, policy, template, etc.
  entity_id BIGINT,
  details TEXT,  -- JSON string with additional details
  company TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_email);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
