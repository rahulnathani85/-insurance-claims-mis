-- ============================================================
-- claim_documents.ocr_text — cache OCR results on the unified
-- documents table so the Registration Agent can read from one
-- source whether the claim was email-sourced or manually created.
-- ------------------------------------------------------------
-- Why:
--   Today readAttachmentsForMessage caches OCR on
--   message_attachments.ocr_text. PR #38 unified all claim
--   documents into claim_documents (with attachment_id back-ref
--   for email-sourced rows). To support manual claims (no
--   intake_message_id, no message_attachments rows), the OCR
--   cache needs to live on claim_documents itself.
--
-- Backfill: copy ocr_text from message_attachments for already-
-- materialised email-sourced claim_documents rows. Idempotent
-- (only touches NULL rows).
-- ============================================================

BEGIN;

ALTER TABLE public.claim_documents
  ADD COLUMN IF NOT EXISTS ocr_text TEXT;

COMMENT ON COLUMN public.claim_documents.ocr_text IS
  'OCR-extracted text for this document, populated lazily by the Registration Agent on first read. Cached so re-extracts skip the OCR API call.';

-- Backfill from message_attachments for email-sourced rows that
-- already have an OCR result. PR #38 migration ensured email-
-- sourced claim_documents rows carry attachment_id pointing at
-- the originating message_attachments row.
UPDATE public.claim_documents cd
SET ocr_text = ma.ocr_text
FROM public.message_attachments ma
WHERE cd.attachment_id = ma.id
  AND cd.ocr_text IS NULL
  AND ma.ocr_text IS NOT NULL;

COMMIT;
