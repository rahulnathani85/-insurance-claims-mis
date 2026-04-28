-- Migration V9: Broker Master + Claim Lifecycle Workflow with TAT
-- SAFE: Purely additive. No existing tables or data modified.
-- Run this in Supabase SQL Editor.

-- ============================================
-- 1. BROKER MASTER
-- ============================================
CREATE TABLE IF NOT EXISTS brokers (
  id BIGSERIAL PRIMARY KEY,
  broker_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  gst_number TEXT,
  license_number TEXT,
  status TEXT DEFAULT 'Active',
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brokers_name ON brokers(broker_name);
CREATE INDEX IF NOT EXISTS idx_brokers_company ON brokers(company);

-- ============================================
-- 2. ADD BROKER FIELD TO CLAIMS TABLE
-- ============================================
ALTER TABLE claims ADD COLUMN IF NOT EXISTS broker_id BIGINT REFERENCES brokers(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS broker_name TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS assigned_to TEXT;  -- Team member email for claim assignment

-- ============================================
-- 3. CLAIM WORKFLOW STAGES TABLE
-- (Tracks each stage completion per claim)
-- ============================================
CREATE TABLE IF NOT EXISTS claim_workflow (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL,
  ref_number TEXT,
  stage_number INT NOT NULL,
  stage_name TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',  -- Pending, In Progress, Completed, Skipped
  due_date DATE,                  -- Auto-calculated TAT deadline
  completed_date TIMESTAMPTZ,
  assigned_to TEXT,               -- User email
  assigned_by TEXT,
  comments TEXT,
  tat_days INT,                   -- TAT in days for this stage
  tat_from TEXT,                  -- Which date TAT is calculated from (e.g. 'date_intimation', 'prev_stage')
  is_tat_breached BOOLEAN DEFAULT FALSE,
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_workflow_claim ON claim_workflow(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_workflow_status ON claim_workflow(status);
CREATE INDEX IF NOT EXISTS idx_claim_workflow_assigned ON claim_workflow(assigned_to);
CREATE INDEX IF NOT EXISTS idx_claim_workflow_breach ON claim_workflow(is_tat_breached);
CREATE INDEX IF NOT EXISTS idx_claim_workflow_due ON claim_workflow(due_date);

-- ============================================
-- 4. CLAIM WORKFLOW COMMENTS / HISTORY
-- (Tracks comments, reassignments, updates per stage)
-- ============================================
CREATE TABLE IF NOT EXISTS claim_workflow_history (
  id BIGSERIAL PRIMARY KEY,
  workflow_id BIGINT REFERENCES claim_workflow(id),
  claim_id BIGINT NOT NULL,
  action TEXT NOT NULL,  -- comment, assign, reassign, status_change, document_received
  user_email TEXT,
  user_name TEXT,
  details TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cwh_workflow ON claim_workflow_history(workflow_id);
CREATE INDEX IF NOT EXISTS idx_cwh_claim ON claim_workflow_history(claim_id);

-- ============================================
-- 5. CLAIM REMINDERS TABLE
-- (LOR reminders, gentle reminders, final reminder)
-- ============================================
CREATE TABLE IF NOT EXISTS claim_reminders (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL,
  ref_number TEXT,
  reminder_type TEXT NOT NULL,  -- LOR, Gentle_Reminder_1, Gentle_Reminder_2, Gentle_Reminder_3, Final_Reminder, Closure_Notice
  due_date DATE,
  sent_date DATE,
  status TEXT DEFAULT 'Pending',  -- Pending, Sent, Overdue
  sent_to TEXT,        -- insured/insurer/broker
  sent_by TEXT,        -- user email
  notes TEXT,
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_claim ON claim_reminders(claim_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON claim_reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON claim_reminders(due_date);
