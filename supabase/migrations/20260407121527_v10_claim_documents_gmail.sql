-- Migration V10: Claim Documents & Gmail Integration
--
-- IMPORTANT: claim_documents was already created in v5_user_management_lor_ila
-- (a different schema with id BIGSERIAL, document_type TEXT, status TEXT, etc).
-- v10 is meant to extend that table with Gmail-integration columns. So we use
-- ALTER TABLE ADD COLUMN IF NOT EXISTS instead of CREATE TABLE so this works
-- both on a fresh bootstrap (where v5 ran first) and on legacy prod databases.

-- 1. Extend claim_documents with Gmail / storage fields
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS ref_number       TEXT;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS file_name        TEXT;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS file_type        TEXT;          -- 'intimation_sheet', 'lor', 'ila', 'email_attachment', 'survey_report', 'other'
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS file_size        BIGINT;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS storage_path     TEXT;          -- Supabase Storage path
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS mime_type        TEXT;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS uploaded_by      TEXT;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS source           TEXT DEFAULT 'upload';   -- 'upload', 'gmail', 'generated'
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;          -- if sourced from Gmail
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS gmail_subject    TEXT;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS gmail_from       TEXT;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS gmail_date       TIMESTAMPTZ;
ALTER TABLE claim_documents ADD COLUMN IF NOT EXISTS company          TEXT DEFAULT 'NISLA';

-- 2. Table to store Gmail OAuth tokens per user
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  gmail_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table to track emails tagged to claims
CREATE TABLE IF NOT EXISTS claim_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id BIGINT REFERENCES claims(id) ON DELETE CASCADE,
  ref_number TEXT,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT,
  subject TEXT,
  sender TEXT,
  recipients TEXT,
  email_date TIMESTAMPTZ,
  snippet TEXT,
  has_attachments BOOLEAN DEFAULT FALSE,
  tagged_by TEXT,
  company TEXT DEFAULT 'NISLA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Supabase Storage bucket for claim documents (run manually in Supabase Dashboard > Storage)
-- Bucket name: claim-documents
-- Public: No (private bucket)

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_claim_documents_claim_id ON claim_documents(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_emails_claim_id    ON claim_emails(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_documents_ref      ON claim_documents(ref_number);
