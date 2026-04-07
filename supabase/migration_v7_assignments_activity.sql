-- Migration V7: File Assignment & Activity Logging Enhancements
-- SAFE: Purely additive. No existing tables modified.
-- Run this in Supabase SQL Editor.

-- ============================================
-- 1. CLAIM ASSIGNMENTS (assign files to team members)
-- ============================================
CREATE TABLE IF NOT EXISTS claim_assignments (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL,
  assigned_to TEXT NOT NULL,  -- user email
  assigned_by TEXT,           -- admin email
  role TEXT DEFAULT 'Surveyor',  -- Surveyor, Staff, Reviewer
  status TEXT DEFAULT 'Assigned',  -- Assigned, In Progress, Completed, Reassigned
  notes TEXT,
  assigned_date TEXT,
  due_date TEXT,
  completed_date TEXT,
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_assignments_claim ON claim_assignments(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_assignments_user ON claim_assignments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_claim_assignments_company ON claim_assignments(company);
CREATE INDEX IF NOT EXISTS idx_claim_assignments_status ON claim_assignments(status);

-- ============================================
-- 2. ENHANCED ACTIVITY LOG INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_company ON activity_log(company);
