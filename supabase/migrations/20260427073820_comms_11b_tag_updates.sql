-- ============================================================
-- migration_comms_11b_tag_updates.sql
-- Stage 5: Tag definitions — guidance text + new tags + groups.
--
-- Run AFTER migration_comms_11a_enum_extend.sql has committed.
-- ============================================================

-- 1. Add new columns for UX guidance / grouping (idempotent)
ALTER TABLE tag_definitions
  ADD COLUMN IF NOT EXISTS extraction_required BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS guidance            TEXT,
  ADD COLUMN IF NOT EXISTS sort_order          INT NOT NULL DEFAULT 99;

-- ----------------------------------------------------------------
-- 2. Update existing tags with guidance + sort_order
-- ----------------------------------------------------------------

UPDATE tag_definitions SET
  extraction_required = TRUE,
  sort_order = 1,
  guidance = 'A brand-new claim reported via email. Extract policy number, insured name, date of loss, location, and contact. After extraction, create a new claim record and assign a surveyor.'
WHERE tag = 'intimation';

UPDATE tag_definitions SET
  extraction_required = TRUE,
  sort_order = 2,
  guidance = 'The client is chasing their existing claim. Extract the claim reference, nature of the follow-up, and any new information provided. Link to the existing claim and log the note.'
WHERE tag = 'client_followup';

UPDATE tag_definitions SET
  extraction_required = TRUE,
  sort_order = 3,
  guidance = 'The insurer is requesting additional documents or information about an existing claim. Extract the claim reference, query details, and deadline. Link to the claim and flag it for the handling surveyor.'
WHERE tag = 'insurer_query';

UPDATE tag_definitions SET
  extraction_required = TRUE,
  sort_order = 4,
  guidance = 'A policy document has been shared. Extract policy number, insured name, LOB, sum insured, and validity dates. Archive to the claim/policy folder and cross-link with any matching intimation.'
WHERE tag = 'policy_doc';

UPDATE tag_definitions SET
  extraction_required = TRUE,
  sort_order = 6,
  guidance = 'Surveyor or client has sent site photographs. Extract claim reference and number of images. Attach images to the claim gallery and run vision captioning if configured.'
WHERE tag = 'surveyor_photos';

UPDATE tag_definitions SET
  extraction_required = TRUE,
  sort_order = 6,
  guidance = 'Site visit narrative report from the surveyor. Extract claim reference, visit date, observations, and recommended actions. Attach to claim and generate a summary.'
WHERE tag = 'site_visit_report';

UPDATE tag_definitions SET
  extraction_required = TRUE,
  sort_order = 8,
  guidance = 'The insurer has issued a settlement amount. Extract settled amount, deductions, settlement date, and mode of payment. Update the claim record with settlement details and trigger the fee invoice.'
WHERE tag = 'settlement_advice';

UPDATE tag_definitions SET
  extraction_required = FALSE,
  sort_order = 10,
  guidance = 'Internal team communications, admin notices, or system-generated alerts. No client or claim data to extract. File under internal.'
WHERE tag = 'internal_admin';

-- ----------------------------------------------------------------
-- 3. Insert new tags (with required short_code + description)
-- ----------------------------------------------------------------

INSERT INTO tag_definitions
  (tag, display_label, short_code, description, classifier_prompt,
   extraction_required, sort_order, guidance,
   extraction_schema, auto_route_threshold, routing_actions, enabled, ui_color)
VALUES
  (
    'duplicate',
    'Duplicate',
    'DUP',
    'Suspected duplicate of a previously processed message.',
    'Use when the email appears to repeat a previously processed message (same sender, same subject, same claim reference) without new information.',
    FALSE,
    11,
    'Suspected duplicate. Ask the sender for proof (unique claim ref or doc). If proof is provided -> Non-Extraction. If not within 48 h -> Investigation Pending.',
    '{}',
    0.85,
    '["file_under_internal"]',
    TRUE,
    'slate'
  ),
  (
    'claim_documents',
    'Claim Documents',
    'CDOC',
    'General claim documents like loss statements, invoices, bills, or repair estimates.',
    'Use when the email contains general claim documents such as loss statements, invoices, bills, or repair estimates attached to an existing claim.',
    TRUE,
    5,
    'General claim documents (loss statement, invoices, bills, repair estimates). Extract document type, claim reference, and value amounts. File to the claim folder.',
    '{"claim_ref": "string", "document_type": "string", "value_amount": "string", "issued_by": "string"}',
    0.88,
    '["link_to_claim", "file_to_claim_folder"]',
    TRUE,
    'sky'
  ),
  (
    'claim_registration',
    'Claim Registration by Insurer / Client',
    'CREG',
    'Formal registration / intimation of the claim by the insurer or client.',
    'Use when the insurer or client has formally registered or intimated the claim on their portal or via email and provided a claim reference number.',
    TRUE,
    7,
    'The insurer or client has formally registered / intimated the claim on their portal or via email. Extract claim reference and identifiers. Link to the existing claim record.',
    '{"claim_ref": "string", "registered_by": "string", "registration_date": "string", "insurer_ref": "string"}',
    0.88,
    '["link_to_claim"]',
    TRUE,
    'indigo'
  ),
  (
    'consent_email',
    'Consent Email',
    'CONS',
    'Written consent from the insured / claimant (e.g. for survey, settlement, data sharing).',
    'Use when the insured or claimant has provided written consent for an action such as survey access, settlement acceptance, or data sharing.',
    TRUE,
    9,
    'The insured or claimant has provided written consent (e.g., for survey access, settlement, or data sharing). Extract claim reference, consent type, and the name/date of the consenting party. File to the claim folder.',
    '{"claim_ref": "string", "consent_type": "string", "consenting_party": "string", "consent_date": "string"}',
    0.88,
    '["link_to_claim", "file_to_claim_folder"]',
    TRUE,
    'emerald'
  ),
  (
    'update_from_insurer',
    'Update from Insurer',
    'UPDI',
    'Status update or acknowledgement from the insurer that does not need extraction.',
    'Use when the insurer has sent a status update, acknowledgement, or FYI message that contains no structured data needing extraction.',
    FALSE,
    12,
    'A status update, acknowledgement, or FYI from the insurer that does not require extraction. No structured fields needed. File under internal for reference.',
    '{}',
    0.85,
    '["file_under_internal"]',
    TRUE,
    'slate'
  ),
  (
    'others',
    'Others',
    'OTH',
    'Does not fit any defined category.',
    'Use only when the email clearly does not fit any of the other defined categories. Always add a free-text note explaining why.',
    FALSE,
    13,
    'Does not fit any defined category. Use sparingly. Add a note explaining why this email does not match any standard tag before dismissing.',
    '{}',
    0.85,
    '["file_under_internal"]',
    TRUE,
    'slate'
  )
ON CONFLICT (tag) DO UPDATE SET
  display_label        = EXCLUDED.display_label,
  short_code           = COALESCE(tag_definitions.short_code, EXCLUDED.short_code),
  description          = COALESCE(tag_definitions.description, EXCLUDED.description),
  classifier_prompt    = COALESCE(tag_definitions.classifier_prompt, EXCLUDED.classifier_prompt),
  extraction_required  = EXCLUDED.extraction_required,
  sort_order           = EXCLUDED.sort_order,
  guidance             = EXCLUDED.guidance,
  extraction_schema    = EXCLUDED.extraction_schema,
  auto_route_threshold = EXCLUDED.auto_route_threshold,
  routing_actions      = EXCLUDED.routing_actions,
  enabled              = EXCLUDED.enabled;

-- 4. Index for the new sort_order column
CREATE INDEX IF NOT EXISTS idx_tag_definitions_sort_order ON tag_definitions(sort_order);
