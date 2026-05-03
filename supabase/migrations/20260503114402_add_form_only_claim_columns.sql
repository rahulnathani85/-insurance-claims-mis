-- ============================================================
-- Add the 16 form-only columns that the registration form
-- collects but had no backing column on `claims`.
-- ------------------------------------------------------------
-- Background: until now, /claim-registration/<id> rendered
-- inputs for these fields, yet PUT /api/claims/<id> stripped
-- them before the legacy update because Postgres would reject
-- the unknown columns. The Registration Agent (PR #32) made
-- this visible by populating sum_insured (provenance-only),
-- which broke submit and triggered an audit that found 19
-- ghost form fields.
--
-- Three of the 19 are correctly provenance-only by design
-- (sum_insured, claim_amount_intimated, peril_type per
-- CLAUDE.md §13a) and continue to live in claim_field_values.
--
-- The remaining 16 are operational metadata with natural
-- single-source authority (the insurer's intimation) — no
-- multi-source dispute, so the provenance ledger is overkill.
-- This migration adds them as plain columns so the form
-- actually persists what the clerk types.
--
-- All ALTER TABLE statements are idempotent (IF NOT EXISTS).
-- Pure additive; no data backfill, no destructive change.
-- ============================================================

BEGIN;

-- Insurer details ------------------------------------------------
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS insurer_branch          text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS dealing_officer_name    text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS dealing_officer_email   text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS dealing_officer_phone   text;

-- Insured contact details ----------------------------------------
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS insured_contact_phone   text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS insured_contact_email   text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS insured_gstin           text;

-- LOB sub-category (per-LOB taxonomy from lib/lobSubcategories.js)
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS lob_subcategory         text;

-- Loss-location breakdown ----------------------------------------
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS loss_location_pin       text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS loss_location_state     text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS loss_location_district  text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS loss_location_lat       numeric;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS loss_location_lng       numeric;

-- Surveyor fee structure -----------------------------------------
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS fee_basis               text;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS fee_amount              numeric;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS fee_notes               text;

-- Comments for documentation -------------------------------------
COMMENT ON COLUMN public.claims.insurer_branch IS
  'Issuing branch / divisional office of the insurer.';
COMMENT ON COLUMN public.claims.dealing_officer_name IS
  'Insurer-side desk officer handling this claim — name.';
COMMENT ON COLUMN public.claims.dealing_officer_email IS
  'Dealing officer email; usually the From: header on the intimation.';
COMMENT ON COLUMN public.claims.dealing_officer_phone IS
  'Dealing officer phone in +91XXXXXXXXXX form for Indian numbers.';
COMMENT ON COLUMN public.claims.insured_contact_phone IS
  'Primary phone for the insured / claimant.';
COMMENT ON COLUMN public.claims.insured_contact_email IS
  'Primary email for the insured / claimant.';
COMMENT ON COLUMN public.claims.insured_gstin IS
  '15-character GSTIN if the insured is GST-registered.';
COMMENT ON COLUMN public.claims.lob_subcategory IS
  'Per-LOB sub-classification (e.g. Fire -> SFSP / IAR / Mega Risk). See lib/lobSubcategories.js.';
COMMENT ON COLUMN public.claims.loss_location_pin IS
  '6-digit PIN code of the loss location.';
COMMENT ON COLUMN public.claims.loss_location_lat IS
  'WGS84 latitude of the loss location, populated when geocoded.';
COMMENT ON COLUMN public.claims.loss_location_lng IS
  'WGS84 longitude of the loss location.';
COMMENT ON COLUMN public.claims.fee_basis IS
  'How the surveyor fee is determined: irdai_scale | special_agreement.';

COMMIT;
