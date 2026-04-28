-- ============================================================
-- Comms Intelligence — Migration 3: Tag Library Seeds
-- SAFE: Purely additive. Idempotent (ON CONFLICT DO NOTHING).
-- ============================================================
-- Seeds the 8 workflow tags with their classifier prompts,
-- extraction schemas, routing actions, and auto-route
-- thresholds. Rerunning the migration is a no-op.
-- ============================================================

BEGIN;

INSERT INTO tag_definitions
  (tag, display_label, short_code, description, ui_color, classifier_prompt, extraction_schema, routing_actions, auto_route_threshold)
VALUES
('intimation', 'New Intimation', 'INT',
 'New claim notification from insurer',
 'blue',
 'A new claim is being intimated for survey. Look for policy number, insured name, vehicle/property details, date of loss, location, sum insured, and a request for survey.',
 '{
   "policy_no":          {"type": "string",  "required": true,  "hint": "policy number from insurer"},
   "insured_name":       {"type": "string",  "required": true,  "hint": "name of insured person/entity"},
   "vehicle_or_property":{"type": "string",  "required": true,  "hint": "what is being claimed against"},
   "date_of_loss":       {"type": "date",    "required": true,  "hint": "ISO 8601 date"},
   "location":           {"type": "string",  "required": true,  "hint": "where the loss occurred"},
   "contact":            {"type": "string",  "required": false, "hint": "phone or email of insured"},
   "sum_insured":        {"type": "string",  "required": false, "hint": "total sum insured under policy"},
   "lob":                {"type": "enum",    "required": true,  "hint": "Motor OD, Fire, Marine Cargo, etc."}
 }'::jsonb,
 '[
   {"action_type": "create_claim",      "params": {"status": "intimated"}},
   {"action_type": "assign_surveyor",   "params": {"strategy": "round_robin_by_lob"}},
   {"action_type": "send_email",        "params": {"template": "intimation_acknowledgement", "to": "from_address"}},
   {"action_type": "notify_whatsapp",   "params": {"to": "assigned_surveyor", "template": "new_assignment"}}
 ]'::jsonb,
 0.92),

('surveyor_photos', 'Surveyor Photos', 'PHO',
 'Inspection photos from field team',
 'violet',
 'Photos of damaged vehicle/property received from a NISLA surveyor or field team member. Look for claim reference and identify the source as a surveyor.',
 '{
   "claim_ref":          {"type": "string",  "required": true,  "hint": "NISLA claim ID or external ref"},
   "photo_count":        {"type": "integer", "required": true,  "hint": "number of photos attached"},
   "location_metadata":  {"type": "string",  "required": false, "hint": "from EXIF or message body"},
   "capture_date":       {"type": "date",    "required": false, "hint": "from EXIF"}
 }'::jsonb,
 '[
   {"action_type": "attach_photos_to_claim", "params": {}},
   {"action_type": "run_vision_captioning",  "params": {"model": "claude-sonnet"}},
   {"action_type": "update_claim_gallery",   "params": {}}
 ]'::jsonb,
 0.90),

('site_visit_report', 'Site Visit Report', 'SVR',
 'Preliminary observations from field team',
 'indigo',
 'Surveyor reporting back from a site visit. Will mention cause of loss, observations, and possibly documents needed from insured.',
 '{
   "claim_ref":            {"type": "string", "required": true},
   "visit_date":           {"type": "date",   "required": true},
   "cause_of_loss":        {"type": "string", "required": true},
   "observations":         {"type": "string", "required": true, "hint": "key findings"},
   "further_docs_needed":  {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "update_claim_status",   "params": {"status": "site_done"}},
   {"action_type": "file_to_claim_folder",  "params": {"category": "preliminary_observations"}},
   {"action_type": "generate_summary",      "params": {"format": "markdown"}}
 ]'::jsonb,
 0.88),

('insurer_query', 'Insurer Query', 'QRY',
 'Clarification request from insurer',
 'amber',
 'Insurer is asking for clarification or additional information on an existing claim. Subject often references a claim number.',
 '{
   "claim_ref":          {"type": "string", "required": true},
   "query_type":         {"type": "string", "required": true, "hint": "what is being asked"},
   "requested_info":     {"type": "string", "required": true},
   "response_deadline":  {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "link_to_claim",   "params": {}},
   {"action_type": "draft_reply",     "params": {"context_source": "claim_file"}},
   {"action_type": "set_claim_flag",  "params": {"flag": "awaiting_response"}}
 ]'::jsonb,
 0.88),

('settlement_advice', 'Settlement Advice', 'SET',
 'Insurer confirms settlement amount',
 'emerald',
 'Insurer confirming claim has been settled. Will mention settled amount, settlement date, mode of payment, and any deductions.',
 '{
   "claim_ref":        {"type": "string", "required": true},
   "settled_amount":   {"type": "string", "required": true},
   "settlement_date":  {"type": "date",   "required": true},
   "deductions":       {"type": "string", "required": false},
   "mode_of_payment":  {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "update_claim_settlement", "params": {}},
   {"action_type": "mark_claim_closed",       "params": {}},
   {"action_type": "trigger_fee_invoice",     "params": {}},
   {"action_type": "archive_email",           "params": {}}
 ]'::jsonb,
 0.93),

('client_followup', 'Client Follow-up', 'CLI',
 'Client or insured chasing for status',
 'teal',
 'The insured or their representative is asking about the status of their claim.',
 '{
   "claim_ref_or_name":  {"type": "string", "required": true},
   "query_summary":      {"type": "string", "required": true},
   "urgency":            {"type": "enum",   "required": false, "hint": "low, medium, high"}
 }'::jsonb,
 '[
   {"action_type": "route_to_assigned_surveyor", "params": {}},
   {"action_type": "log_in_crm",                 "params": {"category": "client_followup"}},
   {"action_type": "draft_reply",                "params": {"template": "status_update"}}
 ]'::jsonb,
 0.85),

('policy_doc', 'Policy Document', 'POL',
 'Policy document received as attachment',
 'sky',
 'A policy copy is being shared, usually as a PDF attachment. Often arrives shortly after intimation.',
 '{
   "policy_no":      {"type": "string", "required": true},
   "insurer":        {"type": "string", "required": true},
   "insured":        {"type": "string", "required": true},
   "sum_insured":    {"type": "string", "required": false},
   "policy_period":  {"type": "string", "required": false},
   "lob":            {"type": "string", "required": false}
 }'::jsonb,
 '[
   {"action_type": "archive_pdf_to_claim_folder",  "params": {}},
   {"action_type": "extract_policy_fields_to_db",  "params": {}},
   {"action_type": "cross_link_to_intimation",     "params": {}}
 ]'::jsonb,
 0.88),

('internal_admin', 'Internal / Admin', 'ADM',
 'Internal team or admin matters - no extraction',
 'slate',
 'Internal team communication, holiday notices, admin matters. No structured data extraction needed.',
 '{}'::jsonb,
 '[
   {"action_type": "file_under_internal", "params": {}}
 ]'::jsonb,
 0.85)

ON CONFLICT (tag) DO NOTHING;

COMMIT;
