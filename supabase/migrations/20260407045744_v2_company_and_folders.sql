-- Migration V2: Add company selector, fix policy fields, add folder tracking

-- Add company column to claims and policies
ALTER TABLE claims ADD COLUMN IF NOT EXISTS company TEXT DEFAULT 'NISLA';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS company TEXT DEFAULT 'NISLA';

-- Add missing policy fields
ALTER TABLE policies ADD COLUMN IF NOT EXISTS risk_location TEXT;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS coverage_amount NUMERIC;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS description TEXT;

-- Add folder_path to claims for tracking output folders
ALTER TABLE claims ADD COLUMN IF NOT EXISTS folder_path TEXT;

-- Rename sum_insured to keep backward compat (it already exists as TEXT, add numeric version)
-- The form will use sum_assured (mapped to sum_insured column)
