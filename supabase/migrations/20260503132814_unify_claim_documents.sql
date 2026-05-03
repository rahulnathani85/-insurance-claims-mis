-- ============================================================
-- claim_documents: link to message_attachments + backfill
-- ------------------------------------------------------------
-- Backs the Unified Documents tab feature. Goal: every document
-- associated with a claim (email attachment, manual upload,
-- generated LOR/ILA/FSR) lives as a row in claim_documents.
-- Renames mutate claim_documents.file_name; future consumers
-- (FSR annexure list, email reply attachments) read from this
-- table and inherit renames automatically.
--
-- message_attachments stays immutable as the comms-pipeline
-- audit record. claim_documents.attachment_id is the back-link.
--
-- Two changes:
--   1. ALTER TABLE claim_documents ADD COLUMN attachment_id uuid
--      + a partial-unique index (claim_id, attachment_id) so
--      backfills are idempotent and dedup is enforced.
--   2. Backfill — for every claim with an intake_message_id, file
--      each of the linked email's attachments as a claim_documents
--      row, skipping any that were already filed (e.g. via the
--      gmail/tag flow).
-- ============================================================

BEGIN;

-- 1. Idempotency key linking back to message_attachments.id
ALTER TABLE public.claim_documents
  ADD COLUMN IF NOT EXISTS attachment_id uuid;

COMMENT ON COLUMN public.claim_documents.attachment_id IS
  'For source=gmail rows, the originating message_attachments.id. NULL for upload/generated rows. Lets backfills + executor inserts dedupe by (claim_id, attachment_id).';

-- FK with ON DELETE SET NULL — if the comms-audit row is purged
-- the document row stays; the user-edited file_name shouldn''t
-- evaporate just because we cleaned up an old inbox_messages row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'claim_documents_attachment_id_fkey'
  ) THEN
    ALTER TABLE public.claim_documents
      ADD CONSTRAINT claim_documents_attachment_id_fkey
      FOREIGN KEY (attachment_id)
      REFERENCES public.message_attachments(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS claim_documents_attachment_unique
  ON public.claim_documents (claim_id, attachment_id)
  WHERE attachment_id IS NOT NULL;

-- 2. Backfill — file every existing intimation claim's email
-- attachments as claim_documents rows.
INSERT INTO public.claim_documents
  (claim_id, ref_number, attachment_id, file_name, file_type,
   mime_type, file_size, storage_path, source,
   gmail_message_id, gmail_from, gmail_date,
   company, document_type, status, created_at)
SELECT
  c.id,
  c.ref_number,
  ma.id,
  ma.filename,
  'email_attachment',
  ma.mime_type,
  ma.size_bytes,
  ma.storage_path,
  'gmail',
  m.source_msg_id,
  m.from_address,
  m.received_at,
  c.company,
  'Email Attachment',
  'Uploaded',
  ma.created_at
FROM public.claims c
JOIN public.inbox_messages m ON m.id = c.intake_message_id
JOIN public.message_attachments ma ON ma.message_id = m.id
WHERE c.intake_message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.claim_documents cd
    WHERE cd.claim_id = c.id
      AND cd.attachment_id = ma.id
  );

COMMIT;
