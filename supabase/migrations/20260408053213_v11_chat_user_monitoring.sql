-- Migration V11: Claim Chat/Messages + Enhanced User Monitoring
-- SAFE: Purely additive. No existing tables or data modified.
-- Run this in Supabase SQL Editor.

-- ============================================
-- 1. CLAIM MESSAGES (File-wise Chat / Communication Log)
-- ============================================
CREATE TABLE IF NOT EXISTS claim_messages (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL,
  ref_number TEXT,
  sender_email TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  is_internal BOOLEAN DEFAULT true,
  parent_id BIGINT,
  attachments TEXT,
  is_read_by TEXT DEFAULT '[]',
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_messages_claim ON claim_messages(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_messages_sender ON claim_messages(sender_email);
CREATE INDEX IF NOT EXISTS idx_claim_messages_created ON claim_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_claim_messages_company ON claim_messages(company);

-- ============================================
-- 2. USER SESSIONS LOG
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_name TEXT,
  login_at TIMESTAMPTZ DEFAULT NOW(),
  logout_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_email ON user_sessions(user_email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_login ON user_sessions(login_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_company ON user_sessions(company);

-- ============================================
-- 3. ADD last_active COLUMN TO app_users
-- ============================================
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS total_claims_handled INTEGER DEFAULT 0;
