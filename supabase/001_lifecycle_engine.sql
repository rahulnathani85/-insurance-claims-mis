-- =============================================================================
-- NISLA LIFECYCLE ENGINE — FULL SCHEMA MIGRATION
-- =============================================================================
-- Replaces four parallel stage systems with ONE data-driven engine.
--
-- What this migration does:
--   1. Creates 9 new tables (templates, stages, items, sub-tasks, branches,
--      time-rules, claim-runtime tables, reopen history)
--   2. Seeds templates for EW base, Toyota TW override, Marine UltraTech/Tiles,
--      Marine Tata Motors (working examples to validate the engine)
--   3. Freezes the four old stage tables (renames them with _archive_ suffix)
--      so no new writes can happen to them, but existing data is preserved
--   4. Adds flag columns to claims and ew_vehicle_claims to point at the new
--      engine tables
--
-- Execution: run in a single transaction. If anything fails, ROLLBACK.
-- Estimated runtime on live DB: 10-30 seconds.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — CORE TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1  lifecycle_templates
-- The top-level template definition. One row per template variant.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_templates (
    id                     BIGSERIAL PRIMARY KEY,
    template_code          TEXT UNIQUE NOT NULL,
    template_name          TEXT NOT NULL,
    description            TEXT,

    -- Resolution type: 'full_list' replaces everything; 'override' applies
    -- deltas on top of parent_template_id's resolved stages.
    resolution_type        TEXT NOT NULL CHECK (resolution_type IN ('full_list', 'override')),
    parent_template_id     BIGINT REFERENCES lifecycle_templates(id),

    -- Matching dimensions. NULL means "no constraint on this dimension".
    -- All non-NULL dimensions must match for the template to be a candidate.
    match_lob              TEXT,           -- e.g. 'Extended Warranty', 'Marine Cargo'
    match_policy_type      TEXT,           -- e.g. 'SFSP', 'IAR', 'Sookshma'
    match_cause_of_loss    TEXT,           -- e.g. 'Fire Damage', 'Transit Shortage'
    match_subject_matter   TEXT,           -- e.g. 'Stock', 'Building', 'Vehicle'
    match_portfolio        TEXT,           -- e.g. 'Toyota True Warranty', 'Mercedes EW'
    match_client           TEXT,           -- e.g. 'UltraTech', 'Tata Motors', 'Grasim'
    match_size_band        TEXT,           -- 'Small' | 'Medium' | 'High' | 'VeryHigh'
    match_nature           TEXT,           -- 'Routine' | 'Catastrophe' | 'Fraud' | 'Large Loss'
    match_appointment_src  TEXT,           -- 'Insurer' | 'Broker' | 'Insured' | 'Other'

    -- Feature toggles — opt-in. Most templates will leave these off.
    branching_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    subtasks_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    time_rules_enabled     BOOLEAN NOT NULL DEFAULT FALSE,

    -- Versioning. When a template is edited, a new version row is inserted
    -- and the old one is kept. Claims always reference a specific version.
    version                INT NOT NULL DEFAULT 1,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    superseded_by          BIGINT REFERENCES lifecycle_templates(id),

    -- Priority for tie-breaking when specificity is equal.
    -- Higher wins. Default 100.
    priority               INT NOT NULL DEFAULT 100,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by             TEXT,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lifecycle_templates_active ON lifecycle_templates(is_active) WHERE is_active;
CREATE INDEX idx_lifecycle_templates_match_lob ON lifecycle_templates(match_lob) WHERE is_active;
CREATE INDEX idx_lifecycle_templates_parent ON lifecycle_templates(parent_template_id);

COMMENT ON TABLE  lifecycle_templates IS 'Top-level lifecycle template definitions. Resolved by specificity cascade against a claim''s attributes.';
COMMENT ON COLUMN lifecycle_templates.resolution_type IS 'full_list = this template replaces all ancestor stages; override = applies deltas on top of parent';
COMMENT ON COLUMN lifecycle_templates.version IS 'When edited, a new version is created. Existing claims keep their resolved version; new claims use the latest active version.';


-- -----------------------------------------------------------------------------
-- 1.2  lifecycle_template_stages
-- The detail stages within a template. Ordered by sequence, grouped by phase.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_template_stages (
    id                     BIGSERIAL PRIMARY KEY,
    template_id            BIGINT NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,

    -- Stage identity
    stage_code             TEXT NOT NULL,   -- e.g. 'ew_initial_inspection'; unique within template
    stage_name             TEXT NOT NULL,
    description            TEXT,

    -- Universal phase this stage belongs to. 1-7, matches the canonical phases:
    -- 1=Appointment, 2=Survey & Inspection, 3=ILA & LOR, 4=Pending Requirements,
    -- 5=Assessment, 6=Report, 7=Delivery
    universal_phase        SMALLINT NOT NULL CHECK (universal_phase BETWEEN 1 AND 7),

    -- Position within the template (overall sequence) and within the phase.
    sequence_number        INT NOT NULL,
    sequence_within_phase  INT NOT NULL,

    -- TATs in hours. NULL = no TAT. 0 = immediate.
    firm_tat_hours         INT,
    insurer_tat_hours      INT,

    -- TAT anchor: what event does the TAT clock start from?
    -- 'intimation' | 'previous_stage_complete' | 'specific_stage:<code>'
    firm_tat_anchor        TEXT DEFAULT 'previous_stage_complete',
    insurer_tat_anchor     TEXT DEFAULT 'intimation',

    -- Ownership
    owner_role             TEXT,  -- 'Admin' | 'Surveyor' | 'Lead Surveyor' | 'Reviewer' | 'Auto' | 'Other'

    -- What marks this stage Complete?
    completion_trigger     TEXT,  -- Free-text description of the expected artifact/action
    required_artifacts     JSONB, -- Array of {type, description, mandatory}

    -- Feature toggles at stage level
    branching_active       BOOLEAN NOT NULL DEFAULT FALSE,
    subtasks_active        BOOLEAN NOT NULL DEFAULT FALSE,
    subtask_completion_rule TEXT DEFAULT 'all' CHECK (subtask_completion_rule IN ('all', 'any', 'count')),
    subtask_min_count      INT,

    -- For override templates: delta operation
    -- 'add' (new stage), 'replace' (replaces parent stage with same stage_code),
    -- 'remove' (deletes parent stage with same stage_code),
    -- 'modify' (modifies fields on parent stage)
    delta_operation        TEXT DEFAULT 'add' CHECK (delta_operation IN ('add', 'replace', 'remove', 'modify')),

    -- Is this stage auto-skippable? If TRUE, engine evaluates skip_condition.
    is_skippable           BOOLEAN NOT NULL DEFAULT FALSE,
    skip_condition         JSONB,  -- {field: 'claim.subject_matter', operator: 'eq', value: 'Building'}

    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (template_id, stage_code)
);

CREATE INDEX idx_lts_template ON lifecycle_template_stages(template_id);
CREATE INDEX idx_lts_phase ON lifecycle_template_stages(template_id, universal_phase, sequence_within_phase);

COMMENT ON TABLE lifecycle_template_stages IS 'Detail stages that sit under the 7 universal phases within a template.';


-- -----------------------------------------------------------------------------
-- 1.3  lifecycle_template_stage_branches
-- OPTIONAL. Rich branching rules per stage. Only used if stage's
-- branching_active = TRUE.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_template_stage_branches (
    id                     BIGSERIAL PRIMARY KEY,
    stage_id               BIGINT NOT NULL REFERENCES lifecycle_template_stages(id) ON DELETE CASCADE,

    -- Branches are evaluated in order. First match wins.
    evaluation_order       INT NOT NULL,

    -- The condition to evaluate. JSON-encoded boolean expression.
    -- Shape: {field, operator, value} OR
    --        {all: [condition1, condition2, ...]} OR
    --        {any: [condition1, condition2, ...]}
    --
    -- field can reference claim fields (claim.estimated_loss_amount),
    -- stage outcome (outcome.type, outcome.value), or resolved lifecycle
    -- state (lifecycle.phase_4_open_count).
    --
    -- operators: eq, neq, gt, gte, lt, lte, in, not_in, exists, not_exists
    condition_json         JSONB NOT NULL,

    -- What happens when this branch matches?
    -- 'go_to_stage' — next stage becomes the specified stage_code
    -- 'skip_to_phase' — skip remaining stages and jump to phase N
    -- 'loop_back' — go back to the specified stage_code
    -- 'end_lifecycle' — terminate lifecycle (rare, e.g. claim withdrawn)
    action_type            TEXT NOT NULL CHECK (action_type IN ('go_to_stage','skip_to_phase','loop_back','end_lifecycle')),
    action_target          TEXT,  -- stage_code or phase number

    description            TEXT,  -- Human-readable explanation for admin UI

    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (stage_id, evaluation_order)
);

CREATE INDEX idx_ltsb_stage ON lifecycle_template_stage_branches(stage_id);

COMMENT ON TABLE lifecycle_template_stage_branches IS 'Conditional branching rules for a stage. Evaluated in order on stage completion. First match wins.';


-- -----------------------------------------------------------------------------
-- 1.4  lifecycle_template_stage_subtasks
-- OPTIONAL. Sub-tasks within a stage. Only used if stage's
-- subtasks_active = TRUE.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_template_stage_subtasks (
    id                     BIGSERIAL PRIMARY KEY,
    stage_id               BIGINT NOT NULL REFERENCES lifecycle_template_stages(id) ON DELETE CASCADE,

    subtask_code           TEXT NOT NULL,
    subtask_name           TEXT NOT NULL,
    description            TEXT,

    sequence_number        INT NOT NULL,
    owner_role             TEXT,
    completion_trigger     TEXT,
    required_artifacts     JSONB,

    -- Default sub-tasks appear on every claim. Surveyor can add extras.
    is_default             BOOLEAN NOT NULL DEFAULT TRUE,

    -- Is this sub-task mandatory for stage completion, or optional?
    -- If stage.subtask_completion_rule = 'all', mandatory ones must all close.
    is_mandatory           BOOLEAN NOT NULL DEFAULT TRUE,

    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (stage_id, subtask_code)
);

CREATE INDEX idx_ltss_stage ON lifecycle_template_stage_subtasks(stage_id);

COMMENT ON TABLE lifecycle_template_stage_subtasks IS 'Sub-tasks that break a stage into parallel independent pieces of work.';


-- -----------------------------------------------------------------------------
-- 1.5  lifecycle_template_time_rules
-- OPTIONAL. Time-based validity for templates. Only used if template's
-- time_rules_enabled = TRUE.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_template_time_rules (
    id                     BIGSERIAL PRIMARY KEY,
    template_id            BIGINT NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,

    -- The template is valid for claims whose date_of_intimation falls in the range.
    valid_from             TIMESTAMPTZ,       -- NULL = no lower bound
    valid_until            TIMESTAMPTZ,       -- NULL = no upper bound

    -- Match rule: defaults to using date_of_intimation but can reference
    -- any claim date field (date_of_loss, registration_date).
    match_field            TEXT NOT NULL DEFAULT 'date_of_intimation',

    description            TEXT,

    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lttr_template ON lifecycle_template_time_rules(template_id);
CREATE INDEX idx_lttr_range ON lifecycle_template_time_rules(valid_from, valid_until);

COMMENT ON TABLE lifecycle_template_time_rules IS 'Time-based validity. A template can be restricted to claims intimated within a date range.';


-- -----------------------------------------------------------------------------
-- 1.6  lifecycle_item_catalog
-- Master catalog of pending-requirement item types. Templates reference this
-- in their default checklists; surveyors can add items from here to live claims.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_item_catalog (
    id                     BIGSERIAL PRIMARY KEY,
    item_code              TEXT UNIQUE NOT NULL,
    item_name              TEXT NOT NULL,
    description            TEXT,

    -- 'document' | 'approval' | 'query' | 'internal' | 'other'
    category               TEXT NOT NULL,

    -- Default party that typically holds this item.
    -- 'insured' | 'insurer' | 'broker' | 'surveyor_internal' | 'other'
    default_pending_with   TEXT NOT NULL,

    -- Default clock behaviour when this item is open.
    firm_clock_behaviour   TEXT NOT NULL CHECK (firm_clock_behaviour IN ('pause', 'run')),
    insurer_clock_behaviour TEXT NOT NULL CHECK (insurer_clock_behaviour IN ('pause', 'run')),

    -- Evidence expected when item is closed.
    evidence_description   TEXT,

    -- Reminder cascade defaults (days after item open). JSON array of day-numbers.
    reminder_schedule_days JSONB DEFAULT '[7, 14, 21, 28]'::JSONB,

    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lic_category ON lifecycle_item_catalog(category);
CREATE INDEX idx_lic_active ON lifecycle_item_catalog(is_active) WHERE is_active;

COMMENT ON TABLE lifecycle_item_catalog IS 'Master list of pending-requirement item types. Clock behaviour and default-party live here.';


-- -----------------------------------------------------------------------------
-- 1.7  lifecycle_template_default_items
-- Links templates to their default Phase 4 item checklist. Many-to-many:
-- a template can have many default items; an item can belong to many templates.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle_template_default_items (
    id                     BIGSERIAL PRIMARY KEY,
    template_id            BIGINT NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,
    item_catalog_id        BIGINT NOT NULL REFERENCES lifecycle_item_catalog(id),

    -- Per-template overrides of catalog defaults
    override_pending_with  TEXT,
    override_firm_clock    TEXT CHECK (override_firm_clock IN ('pause', 'run')),
    override_insurer_clock TEXT CHECK (override_insurer_clock IN ('pause', 'run')),

    -- If the item doesn't apply universally, it can be conditional
    applies_if_condition   JSONB,

    is_mandatory           BOOLEAN NOT NULL DEFAULT TRUE,
    notes                  TEXT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (template_id, item_catalog_id)
);

CREATE INDEX idx_ltdi_template ON lifecycle_template_default_items(template_id);


-- =============================================================================
-- PART 2 — RUNTIME TABLES (per-claim data)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1  claim_lifecycle
-- One row per claim. Points at the resolved template version and holds the
-- current-state anchor values.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_lifecycle (
    id                     BIGSERIAL PRIMARY KEY,

    -- One and only one of claim_id / ew_claim_id is non-null.
    -- (Supports the parent-claims model and the dedicated EW model.)
    claim_id               BIGINT REFERENCES claims(id) ON DELETE CASCADE,
    ew_claim_id            BIGINT,  -- no FK because ew_vehicle_claims.id type may vary; validated by app layer

    -- The template this claim resolved to (a specific version).
    template_id            BIGINT NOT NULL REFERENCES lifecycle_templates(id),
    template_version_at_resolve INT NOT NULL,

    -- Snapshot of the dimensions used for resolution. If any of these change
    -- on the claim, the engine can re-resolve and pick a different template.
    resolved_from          JSONB,  -- {lob, policy_type, portfolio, client, size_band, ...}

    -- Top-level state
    current_phase          SMALLINT NOT NULL DEFAULT 1,
    is_complete            BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at           TIMESTAMPTZ,

    -- Clock state
    firm_clock_start       TIMESTAMPTZ,
    firm_clock_paused_at   TIMESTAMPTZ,
    firm_clock_elapsed_sec BIGINT NOT NULL DEFAULT 0,   -- accumulated non-paused time
    insurer_clock_start    TIMESTAMPTZ,
    insurer_clock_paused_at TIMESTAMPTZ,
    insurer_clock_elapsed_sec BIGINT NOT NULL DEFAULT 0,

    -- Re-open tracking
    fsr_version            INT NOT NULL DEFAULT 1,
    last_reopened_at       TIMESTAMPTZ,
    last_reopened_to_phase SMALLINT,
    last_reopened_reason   TEXT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK ((claim_id IS NOT NULL AND ew_claim_id IS NULL) OR (claim_id IS NULL AND ew_claim_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_cl_claim ON claim_lifecycle(claim_id) WHERE claim_id IS NOT NULL;
CREATE UNIQUE INDEX idx_cl_ew ON claim_lifecycle(ew_claim_id) WHERE ew_claim_id IS NOT NULL;
CREATE INDEX idx_cl_phase ON claim_lifecycle(current_phase, is_complete);
CREATE INDEX idx_cl_template ON claim_lifecycle(template_id);


-- -----------------------------------------------------------------------------
-- 2.2  claim_lifecycle_phases
-- One row per (claim, universal_phase). 7 rows per claim. Tracks phase state.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_lifecycle_phases (
    id                     BIGSERIAL PRIMARY KEY,
    claim_lifecycle_id     BIGINT NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,
    universal_phase        SMALLINT NOT NULL CHECK (universal_phase BETWEEN 1 AND 7),

    -- 'not_started' | 'active' | 'complete' | 'auto_complete'
    -- auto_complete = template has no detail stages under this phase; engine
    -- marked it done when adjacent phase closed.
    status                 TEXT NOT NULL DEFAULT 'not_started',

    activated_at           TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,

    -- Is this phase currently blocking? (Phase 4 Pending Requirements is
    -- "blocking" when any of its items are open.)
    is_blocking            BOOLEAN NOT NULL DEFAULT FALSE,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (claim_lifecycle_id, universal_phase)
);

CREATE INDEX idx_clp_lifecycle ON claim_lifecycle_phases(claim_lifecycle_id);


-- -----------------------------------------------------------------------------
-- 2.3  claim_lifecycle_stages
-- One row per (claim, stage). Tracks progress on each detail stage.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_lifecycle_stages (
    id                     BIGSERIAL PRIMARY KEY,
    claim_lifecycle_id     BIGINT NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,
    template_stage_id      BIGINT NOT NULL REFERENCES lifecycle_template_stages(id),

    -- Snapshot of the template stage's identity and config at resolution time.
    -- If the template is edited after resolution, existing claims are NOT
    -- affected — they keep these snapshot values.
    stage_code             TEXT NOT NULL,
    stage_name             TEXT NOT NULL,
    universal_phase        SMALLINT NOT NULL,
    sequence_number        INT NOT NULL,

    -- Live state
    -- 'not_started' | 'active' | 'completed' | 'skipped' | 'branched_away'
    status                 TEXT NOT NULL DEFAULT 'not_started',

    -- Timestamps
    activated_at           TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,
    due_by_firm            TIMESTAMPTZ,
    due_by_insurer         TIMESTAMPTZ,

    -- Who completed
    completed_by_user      TEXT,
    completion_notes       TEXT,

    -- Branching outcome (if branching was triggered)
    branch_outcome         JSONB,
    branched_to_stage_id   BIGINT REFERENCES lifecycle_template_stages(id),

    -- For sub-task-enabled stages: percentage complete
    subtasks_complete_pct  INT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (claim_lifecycle_id, template_stage_id)
);

CREATE INDEX idx_cls_lifecycle ON claim_lifecycle_stages(claim_lifecycle_id);
CREATE INDEX idx_cls_status ON claim_lifecycle_stages(claim_lifecycle_id, status);
CREATE INDEX idx_cls_phase ON claim_lifecycle_stages(claim_lifecycle_id, universal_phase, sequence_number);


-- -----------------------------------------------------------------------------
-- 2.4  claim_lifecycle_subtasks
-- Sub-tasks instance per claim-stage. One row per (claim-stage, sub-task).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_lifecycle_subtasks (
    id                     BIGSERIAL PRIMARY KEY,
    claim_stage_id         BIGINT NOT NULL REFERENCES claim_lifecycle_stages(id) ON DELETE CASCADE,

    -- Either references the template subtask OR is a free-form addition.
    template_subtask_id    BIGINT REFERENCES lifecycle_template_stage_subtasks(id),

    subtask_code           TEXT NOT NULL,
    subtask_name           TEXT NOT NULL,
    description            TEXT,

    status                 TEXT NOT NULL DEFAULT 'not_started',
    is_mandatory           BOOLEAN NOT NULL DEFAULT TRUE,

    owner_user             TEXT,
    completed_at           TIMESTAMPTZ,
    completed_by_user      TEXT,
    completion_notes       TEXT,
    evidence_url           TEXT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cls_sub_stage ON claim_lifecycle_subtasks(claim_stage_id);


-- -----------------------------------------------------------------------------
-- 2.5  claim_lifecycle_items
-- Phase 4 pending items. Dynamic per claim. Checklist pre-populated from
-- template defaults; surveyor can add/remove freely.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_lifecycle_items (
    id                     BIGSERIAL PRIMARY KEY,
    claim_lifecycle_id     BIGINT NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,

    -- Catalog reference (NULL if free-form, not from catalog)
    item_catalog_id        BIGINT REFERENCES lifecycle_item_catalog(id),

    item_name              TEXT NOT NULL,
    item_category          TEXT NOT NULL,

    -- Who is holding up the claim?
    pending_with           TEXT NOT NULL,  -- 'insured' | 'insurer' | 'broker' | 'surveyor_internal' | 'other'
    pending_with_label     TEXT,           -- e.g. 'Saboo Toyota', 'United India Insurance'

    -- Clock behaviour for this specific item. Defaults come from the catalog.
    firm_clock_behaviour   TEXT NOT NULL CHECK (firm_clock_behaviour IN ('pause', 'run')),
    insurer_clock_behaviour TEXT NOT NULL CHECK (insurer_clock_behaviour IN ('pause', 'run')),

    -- State
    status                 TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'received' | 'waived' | 'escalated'
    opened_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_by            TIMESTAMPTZ,
    closed_at              TIMESTAMPTZ,

    -- Evidence
    closure_evidence_url   TEXT,
    closure_notes          TEXT,

    -- Reminders — array of {sent_at, channel, recipient}
    reminders_sent         JSONB DEFAULT '[]'::JSONB,
    reminder_schedule      JSONB,  -- overrides catalog default

    -- Link to the stage that created this item (for template-defined items)
    originating_stage_id   BIGINT REFERENCES claim_lifecycle_stages(id),

    -- Free-form notes
    notes                  TEXT,
    added_by_user          TEXT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cli_lifecycle ON claim_lifecycle_items(claim_lifecycle_id);
CREATE INDEX idx_cli_status ON claim_lifecycle_items(claim_lifecycle_id, status);
CREATE INDEX idx_cli_pending ON claim_lifecycle_items(pending_with, status);


-- -----------------------------------------------------------------------------
-- 2.6  claim_lifecycle_history
-- Append-only audit log. Every state change (stage completion, phase change,
-- item open/close, re-open) creates a row.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_lifecycle_history (
    id                     BIGSERIAL PRIMARY KEY,
    claim_lifecycle_id     BIGINT NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,

    event_type             TEXT NOT NULL,
    -- 'lifecycle_created' | 'stage_activated' | 'stage_completed' | 'stage_skipped'
    -- | 'stage_branched' | 'phase_activated' | 'phase_completed' | 'phase_auto_completed'
    -- | 'item_opened' | 'item_received' | 'item_escalated' | 'clock_paused' | 'clock_resumed'
    -- | 'template_reresolved' | 'reopened' | 'fsr_finalised' | 'delivery_acknowledged'

    entity_type            TEXT,   -- 'stage' | 'phase' | 'item' | 'subtask' | 'lifecycle'
    entity_id              BIGINT,

    -- Snapshot of what changed
    prior_state            JSONB,
    new_state              JSONB,

    event_payload          JSONB,  -- additional context (reminder channel, reopen reason, branch outcome, etc.)

    actor_user             TEXT,
    actor_type             TEXT DEFAULT 'user',  -- 'user' | 'system' | 'scheduler'

    occurred_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clh_lifecycle ON claim_lifecycle_history(claim_lifecycle_id, occurred_at);
CREATE INDEX idx_clh_event ON claim_lifecycle_history(event_type);


-- =============================================================================
-- PART 3 — FREEZE THE FOUR OLD STAGE TABLES
-- =============================================================================
-- Old tables are renamed to _archive suffix. New claims write to the new engine.
-- Old claims' stage data is preserved for historical reference.
-- Views are created that keep the original table names readable (for old code
-- that reads them) but block writes via a trigger.
-- =============================================================================

-- Rename old tables
ALTER TABLE claim_stages RENAME TO claim_stages_archive;
ALTER TABLE claim_workflow RENAME TO claim_workflow_archive;
ALTER TABLE claim_workflow_history RENAME TO claim_workflow_history_archive;
ALTER TABLE ew_claim_stages RENAME TO ew_claim_stages_archive;

-- Create read-only views with the original names so any legacy code that
-- hasn't been updated yet can still read historical data.
CREATE VIEW claim_stages AS SELECT * FROM claim_stages_archive;
CREATE VIEW claim_workflow AS SELECT * FROM claim_workflow_archive;
CREATE VIEW claim_workflow_history AS SELECT * FROM claim_workflow_history_archive;
CREATE VIEW ew_claim_stages AS SELECT * FROM ew_claim_stages_archive;

-- Block writes to the views (so old code fails loudly instead of silently
-- writing to archives).
CREATE OR REPLACE FUNCTION lifecycle_engine_frozen_write_block()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'lifecycle engine cutover: the old stage tables are read-only archives. All writes must go through claim_lifecycle_* tables via /api/lifecycle/*.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_writes_claim_stages     INSTEAD OF INSERT OR UPDATE OR DELETE ON claim_stages            FOR EACH ROW EXECUTE FUNCTION lifecycle_engine_frozen_write_block();
CREATE TRIGGER block_writes_claim_workflow   INSTEAD OF INSERT OR UPDATE OR DELETE ON claim_workflow          FOR EACH ROW EXECUTE FUNCTION lifecycle_engine_frozen_write_block();
CREATE TRIGGER block_writes_claim_wf_history INSTEAD OF INSERT OR UPDATE OR DELETE ON claim_workflow_history  FOR EACH ROW EXECUTE FUNCTION lifecycle_engine_frozen_write_block();
CREATE TRIGGER block_writes_ew_claim_stages  INSTEAD OF INSERT OR UPDATE OR DELETE ON ew_claim_stages         FOR EACH ROW EXECUTE FUNCTION lifecycle_engine_frozen_write_block();

-- Add a flag on claims so we know which claims use the new engine
ALTER TABLE claims            ADD COLUMN IF NOT EXISTS uses_lifecycle_engine BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ew_vehicle_claims ADD COLUMN IF NOT EXISTS uses_lifecycle_engine BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_claims_lifecycle_engine ON claims(uses_lifecycle_engine);


-- =============================================================================
-- PART 4 — SEED DATA
-- =============================================================================
-- Working examples NISLA can use from day one. More templates can be added via
-- the admin UI after go-live.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1  Item-catalog seeds (17 items covering EW, Marine, Fire, Banking)
-- -----------------------------------------------------------------------------
INSERT INTO lifecycle_item_catalog (item_code, item_name, category, default_pending_with, firm_clock_behaviour, insurer_clock_behaviour, evidence_description, description) VALUES
  ('job_card', 'Job card / repair order', 'document', 'other', 'pause', 'run', 'PDF or scan of dealer-issued job card', 'Vehicle job card from authorised dealer/workshop'),
  ('tax_invoice', 'Tax invoice for repair', 'document', 'other', 'pause', 'run', 'GST-compliant tax invoice', 'Final invoice from dealer/workshop with GSTIN'),
  ('service_history', 'Service history records', 'document', 'insured', 'pause', 'run', 'OEM service record or dealer printout', 'Full vehicle service history for EW verification'),
  ('warranty_cert', 'Warranty certificate', 'document', 'insured', 'pause', 'run', 'OEM-issued warranty certificate', 'Required only when not already on file'),
  ('dismantling_approval', 'Dismantling approval', 'approval', 'insurer', 'pause', 'pause', 'Approval email with code', 'OEM or insurer approval before vehicle dismantling'),
  ('oem_part_availability', 'OEM part availability', 'query', 'other', 'pause', 'run', 'OEM confirmation email', 'Part availability and lead-time from OEM'),
  ('coverage_clarification', 'Coverage clarification', 'query', 'insurer', 'pause', 'pause', 'Insurer response in writing', 'Clarification on policy wording before assessment'),
  ('commercial_invoice', 'Commercial invoice', 'document', 'insured', 'pause', 'run', 'Invoice from consignor to consignee', 'Marine cargo commercial invoice'),
  ('packing_list', 'Packing list', 'document', 'insured', 'pause', 'run', 'Detailed packing list', 'Item-wise packing list from consignor'),
  ('lr_bl', 'Lorry Receipt / Bill of Lading', 'document', 'insured', 'pause', 'run', 'LR or BL copy with transit details', 'Transport contract document'),
  ('delivery_challan', 'Delivery challan with shortage remark', 'document', 'other', 'pause', 'run', 'Signed delivery challan', 'Delivery document with consignee shortage remark'),
  ('weighbridge_slip', 'Weighbridge slip', 'document', 'other', 'pause', 'run', 'Origin + destination weighbridge slips', 'Critical for bulk cargo shortage assessment'),
  ('salvage_realisation', 'Salvage realisation certificate', 'document', 'insured', 'pause', 'run', 'Salvage sale realisation proof', 'Salvage disposal certificate with realisation amount'),
  ('reinstatement_evidence', 'Reinstatement evidence', 'document', 'insured', 'pause', 'run', 'Reinstatement bills + photos', 'Proof of reinstatement under reinstatement-value policy'),
  ('fir_copy', 'FIR copy', 'document', 'insured', 'pause', 'run', 'Certified FIR copy', 'Police FIR for theft/burglary/fraud claims'),
  ('bank_statement', 'Bank transaction statement', 'document', 'insured', 'pause', 'run', 'Statement from insured''s bank', 'Used in Banking / UPI / Credit-Debit fraud claims'),
  ('fsr_internal_review', 'FSR internal review', 'internal', 'surveyor_internal', 'run', 'run', 'Reviewer sign-off in system', 'Internal FSR review by partner/reviewer');


-- -----------------------------------------------------------------------------
-- 4.2  Universal Default template (fallback for any LOB not explicitly defined)
-- -----------------------------------------------------------------------------
INSERT INTO lifecycle_templates (template_code, template_name, description, resolution_type, priority, created_by) VALUES
  ('universal_default', 'Universal Default', 'Fallback template with only the 7 universal phases, no detail stages. The engine auto-completes phases sequentially.', 'full_list', 1, 'system');


-- -----------------------------------------------------------------------------
-- 4.3  Extended Warranty — base template
-- -----------------------------------------------------------------------------
WITH ew_base AS (
    INSERT INTO lifecycle_templates (template_code, template_name, description, resolution_type, match_lob, priority, created_by)
    VALUES ('ew_base', 'Extended Warranty (base)', '6-stage simplified lifecycle for vehicle extended warranty claims. OEM overrides apply on top.', 'full_list', 'Extended Warranty', 200, 'system')
    RETURNING id
)
INSERT INTO lifecycle_template_stages (template_id, stage_code, stage_name, universal_phase, sequence_number, sequence_within_phase, firm_tat_hours, insurer_tat_hours, owner_role, completion_trigger)
SELECT id, v.stage_code, v.stage_name, v.phase, v.seq, v.seq_in_phase, v.firm_tat, v.insurer_tat, v.owner, v.trigger
FROM ew_base, (VALUES
    ('ew_intimation',       'Intimation received / Claim Registered',                         1, 1, 1,   0,   0, 'Admin',           'Claim saved; ref number generated'),
    ('ew_initial_inspection','Initial inspection done & observation shared',                   2, 2, 1,   4,   4, 'Surveyor',        'Inspection photos + observation note + policy-verification finding uploaded'),
    ('ew_kept_open',        'Kept-open done & estimate approved',                              4, 3, 1, NULL, 120, 'Surveyor',       'Dealer estimate approved + kept-open photos uploaded'),
    ('ew_reinspection',     'Reinspection done & repairing invoice received',                  4, 4, 2, NULL, 240, 'Surveyor',       'Reinspection photos + tax invoice from dealer uploaded'),
    ('ew_fsr_prepared',     'Final Survey Report prepared',                                    6, 5, 1,  24,  24, 'Lead Surveyor',   'FSR finalised in system'),
    ('ew_lot_generated',    'Lot generated',                                                   6, 6, 2,  48, NULL, 'Admin',          'Claim included in billing lot')
) AS v(stage_code, stage_name, phase, seq, seq_in_phase, firm_tat, insurer_tat, owner, trigger);

-- Default Phase 4 items for EW base
INSERT INTO lifecycle_template_default_items (template_id, item_catalog_id, is_mandatory, notes)
SELECT t.id, c.id, v.mandatory, v.notes
FROM lifecycle_templates t, lifecycle_item_catalog c, (VALUES
    ('ew_base', 'job_card',                TRUE, 'Always required'),
    ('ew_base', 'tax_invoice',              TRUE, 'Required before FSR'),
    ('ew_base', 'service_history',          TRUE, 'For warranty T&C verification'),
    ('ew_base', 'warranty_cert',            FALSE, 'Only if not on file'),
    ('ew_base', 'coverage_clarification',   FALSE, 'Only when coverage unclear')
) AS v(template_code, item_code, mandatory, notes)
WHERE t.template_code = v.template_code AND c.item_code = v.item_code;


-- -----------------------------------------------------------------------------
-- 4.4  EW → Toyota True Warranty (override)
-- Adds 2 stages: dismantling-approval gate + genuine-parts verification
-- -----------------------------------------------------------------------------
WITH toyota AS (
    INSERT INTO lifecycle_templates (template_code, template_name, description, resolution_type, parent_template_id, match_lob, match_portfolio, priority, created_by)
    VALUES ('ew_toyota_tw', 'Extended Warranty → Toyota True Warranty', 'Adds Toyota-specific dismantling approval gate and genuine-parts verification.', 'override',
            (SELECT id FROM lifecycle_templates WHERE template_code = 'ew_base'),
            'Extended Warranty', 'Toyota True Warranty', 300, 'system')
    RETURNING id
)
INSERT INTO lifecycle_template_stages (template_id, stage_code, stage_name, universal_phase, sequence_number, sequence_within_phase, firm_tat_hours, insurer_tat_hours, owner_role, completion_trigger, delta_operation)
SELECT id, v.stage_code, v.stage_name, v.phase, v.seq, v.seq_in_phase, v.firm_tat, v.insurer_tat, v.owner, v.trigger, v.delta
FROM toyota, (VALUES
    ('ew_toyota_dismantling_gate',  'Dismantling approval gate (Toyota TW)',  2, 25, 2, 24,  24, 'Lead Surveyor', 'Toyota approval code received + logged', 'add'),
    ('ew_toyota_genuine_parts',     'Genuine-parts verification (Toyota TW)', 5, 45, 1, 12,  12, 'Lead Surveyor', 'OEM-authorised parts list verified + signed',    'add')
) AS v(stage_code, stage_name, phase, seq, seq_in_phase, firm_tat, insurer_tat, owner, trigger, delta);

INSERT INTO lifecycle_template_default_items (template_id, item_catalog_id, is_mandatory, notes)
SELECT t.id, c.id, TRUE, 'Toyota TW specific'
FROM lifecycle_templates t, lifecycle_item_catalog c
WHERE t.template_code = 'ew_toyota_tw' AND c.item_code IN ('dismantling_approval', 'oem_part_availability');


-- -----------------------------------------------------------------------------
-- 4.5  Marine Cargo — UltraTech / Tiles (single template, two clients)
-- -----------------------------------------------------------------------------
WITH marine_ut AS (
    INSERT INTO lifecycle_templates (template_code, template_name, description, resolution_type, match_lob, match_client, priority, created_by)
    VALUES ('marine_ultratech_tiles', 'Marine Cargo — UltraTech / Tiles', '5-stage Marine transit shortage lifecycle shared between UltraTech cement and Tiles packaged goods.', 'full_list', 'Marine Cargo', NULL, 200, 'system')
    RETURNING id
)
INSERT INTO lifecycle_template_stages (template_id, stage_code, stage_name, universal_phase, sequence_number, sequence_within_phase, firm_tat_hours, insurer_tat_hours, owner_role, completion_trigger)
SELECT id, v.stage_code, v.stage_name, v.phase, v.seq, v.seq_in_phase, v.firm_tat, v.insurer_tat, v.owner, v.trigger
FROM marine_ut, (VALUES
    ('mar_intimation',          'Intimation received / Claim Registered',    1, 1, 1,  0,   0, 'Admin',          'Claim saved; ref number generated'),
    ('mar_jir',                 'Survey done & JIR prepared',                2, 2, 1, 24,  48, 'Surveyor',       'Joint Inspection Report uploaded + signed by consignee'),
    ('mar_docs_collected',      'Documents collected',                       4, 3, 1, NULL, 168, 'Surveyor',      'All required transit documents received'),
    ('mar_assessment_consent',  'Assessment prepared & consent received',    5, 4, 1, 24,  24, 'Lead Surveyor',   'Assessment sheet finalised with stakeholder consent'),
    ('mar_fsr_prepared',        'Final Survey Report prepared',              6, 5, 1, 48,  48, 'Lead Surveyor',   'FSR finalised')
) AS v(stage_code, stage_name, phase, seq, seq_in_phase, firm_tat, insurer_tat, owner, trigger);

-- Now make two child "client-specific" override templates with the same stages
-- but specific client matchers and per-client item defaults.
INSERT INTO lifecycle_templates (template_code, template_name, description, resolution_type, parent_template_id, match_lob, match_client, priority, created_by) VALUES
  ('marine_ultratech', 'Marine Cargo — UltraTech', 'Client-specific override of the UltraTech/Tiles template for UltraTech cement.', 'override',
   (SELECT id FROM lifecycle_templates WHERE template_code = 'marine_ultratech_tiles'),
   'Marine Cargo', 'UltraTech', 250, 'system'),
  ('marine_tiles',     'Marine Cargo — Tiles',     'Client-specific override for Tiles packaged goods.', 'override',
   (SELECT id FROM lifecycle_templates WHERE template_code = 'marine_ultratech_tiles'),
   'Marine Cargo', 'Tiles',     250, 'system');

INSERT INTO lifecycle_template_default_items (template_id, item_catalog_id, is_mandatory, notes)
SELECT t.id, c.id, v.mandatory, v.notes
FROM lifecycle_templates t, lifecycle_item_catalog c, (VALUES
    ('marine_ultratech', 'commercial_invoice', TRUE,  'Required'),
    ('marine_ultratech', 'packing_list',       TRUE,  'Required'),
    ('marine_ultratech', 'lr_bl',              TRUE,  'Required'),
    ('marine_ultratech', 'delivery_challan',   TRUE,  'With shortage remark'),
    ('marine_ultratech', 'weighbridge_slip',   TRUE,  'Critical for cement claims'),
    ('marine_tiles',     'commercial_invoice', TRUE,  'Required'),
    ('marine_tiles',     'packing_list',       TRUE,  'Required'),
    ('marine_tiles',     'lr_bl',              TRUE,  'Required'),
    ('marine_tiles',     'delivery_challan',   TRUE,  'Package-counting remark needed')
) AS v(template_code, item_code, mandatory, notes)
WHERE t.template_code = v.template_code AND c.item_code = v.item_code;


-- -----------------------------------------------------------------------------
-- 4.6  Marine Cargo — Tata Motors (separate full_list, different flow)
-- -----------------------------------------------------------------------------
WITH tata AS (
    INSERT INTO lifecycle_templates (template_code, template_name, description, resolution_type, match_lob, match_client, priority, created_by)
    VALUES ('marine_tata_motors', 'Marine Cargo — Tata Motors', 'Vehicle transit lifecycle for Tata Motors dispatch claims — joint survey, chassis-level damage, subrogation documentation.', 'full_list', 'Marine Cargo', 'Tata Motors', 300, 'system')
    RETURNING id
)
INSERT INTO lifecycle_template_stages (template_id, stage_code, stage_name, universal_phase, sequence_number, sequence_within_phase, firm_tat_hours, insurer_tat_hours, owner_role, completion_trigger)
SELECT id, v.stage_code, v.stage_name, v.phase, v.seq, v.seq_in_phase, v.firm_tat, v.insurer_tat, v.owner, v.trigger
FROM tata, (VALUES
    ('tata_intimation',           'Intimation from Tata Motors transit desk',          1, 1, 1,  0,   0, 'Admin',         'Intimation logged'),
    ('tata_contact',              'Contact with transporter + consignee',              1, 2, 2,  4,   4, 'Surveyor',      'Phone/email contact logged'),
    ('tata_joint_survey',         'Joint survey at dealer yard (with transporter rep)', 2, 3, 1, 24,  48, 'Surveyor',     'Joint survey report with transporter signature'),
    ('tata_jir',                  'Joint Inspection Report signed',                    2, 4, 2, 24,  48, 'Surveyor',      'JIR signed by both parties uploaded'),
    ('tata_docs',                 'Documents collected',                               4, 5, 1, NULL, 168, 'Surveyor',    'All transit + authorised-workshop documents received'),
    ('tata_estimate_verify',      'Estimate verification against Tata matrix',          5, 6, 1, 24,  24, 'Lead Surveyor','Workshop estimate verified against OEM matrix'),
    ('tata_subrogation',          'Subrogation documentation prepared',                5, 7, 2, 48,  48, 'Lead Surveyor', 'Subrogation pack prepared'),
    ('tata_fsr',                  'Final Survey Report prepared',                      6, 8, 1, 48,  48, 'Lead Surveyor', 'FSR finalised')
) AS v(stage_code, stage_name, phase, seq, seq_in_phase, firm_tat, insurer_tat, owner, trigger);


-- =============================================================================
-- PART 5 — HELPFUL VIEWS FOR DASHBOARD & REPORTING
-- =============================================================================

-- 5.1  Claims with current phase and breach status
CREATE OR REPLACE VIEW v_claim_lifecycle_overview AS
SELECT
    cl.id                      AS lifecycle_id,
    cl.claim_id,
    cl.ew_claim_id,
    cl.current_phase,
    cl.is_complete,
    t.template_code,
    t.template_name,
    t.match_lob,
    cl.firm_clock_start,
    cl.firm_clock_elapsed_sec,
    (cl.firm_clock_paused_at IS NOT NULL) AS firm_clock_is_paused,
    cl.insurer_clock_start,
    cl.insurer_clock_elapsed_sec,
    (cl.insurer_clock_paused_at IS NOT NULL) AS insurer_clock_is_paused,
    cl.fsr_version,
    (
        SELECT COUNT(*) FROM claim_lifecycle_items i
        WHERE i.claim_lifecycle_id = cl.id AND i.status = 'open'
    ) AS open_items_count,
    (
        SELECT COUNT(*) FROM claim_lifecycle_stages s
        WHERE s.claim_lifecycle_id = cl.id AND s.status IN ('not_started', 'active')
    ) AS pending_stages_count
FROM claim_lifecycle cl
JOIN lifecycle_templates t ON t.id = cl.template_id;


-- 5.2  TAT breach report
CREATE OR REPLACE VIEW v_claim_lifecycle_tat_breaches AS
SELECT
    cl.id AS lifecycle_id,
    cl.claim_id,
    cl.ew_claim_id,
    cls.stage_code,
    cls.stage_name,
    cls.universal_phase,
    cls.due_by_firm,
    cls.due_by_insurer,
    cls.status,
    CASE WHEN cls.due_by_firm    < NOW() AND cls.status != 'completed' THEN TRUE ELSE FALSE END AS firm_breached,
    CASE WHEN cls.due_by_insurer < NOW() AND cls.status != 'completed' THEN TRUE ELSE FALSE END AS insurer_breached
FROM claim_lifecycle cl
JOIN claim_lifecycle_stages cls ON cls.claim_lifecycle_id = cl.id
WHERE cls.status IN ('not_started', 'active')
  AND (cls.due_by_firm < NOW() OR cls.due_by_insurer < NOW());


-- =============================================================================
-- PART 6 — FUNCTIONS USED BY THE JS ENGINE
-- =============================================================================

-- 6.1  Helper: compute elapsed seconds on a clock (respecting paused state)
CREATE OR REPLACE FUNCTION lifecycle_compute_elapsed_sec(
    p_clock_start    TIMESTAMPTZ,
    p_clock_paused_at TIMESTAMPTZ,
    p_elapsed_sec    BIGINT
) RETURNS BIGINT AS $$
BEGIN
    IF p_clock_start IS NULL THEN
        RETURN 0;
    ELSIF p_clock_paused_at IS NOT NULL THEN
        RETURN p_elapsed_sec;
    ELSE
        RETURN p_elapsed_sec + EXTRACT(EPOCH FROM (NOW() - COALESCE(p_clock_paused_at, p_clock_start)))::BIGINT;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- =============================================================================
-- PART 7 — GRANTS (ADJUST TO YOUR ROLE MODEL)
-- =============================================================================
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO supabase_admin;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO supabase_admin;


-- =============================================================================
-- DONE. Commit.
-- =============================================================================
COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION QUERIES — run these to confirm success
-- =============================================================================
-- SELECT COUNT(*) FROM lifecycle_templates;            -- expect >= 6
-- SELECT COUNT(*) FROM lifecycle_template_stages;      -- expect >= 21
-- SELECT COUNT(*) FROM lifecycle_item_catalog;         -- expect >= 17
-- SELECT COUNT(*) FROM lifecycle_template_default_items; -- expect >= 12
-- SELECT template_code, template_name, resolution_type, match_lob, match_portfolio, match_client
--   FROM lifecycle_templates ORDER BY priority DESC, template_name;
-- SELECT t.template_name, COUNT(s.id) AS stages
--   FROM lifecycle_templates t LEFT JOIN lifecycle_template_stages s ON s.template_id = t.id
--   GROUP BY t.template_name ORDER BY t.template_name;
-- SELECT 'Expect error:', INSERT INTO claim_stages (claim_id, stage, stage_number) VALUES (1, 'x', 1);
--   -- should raise 'lifecycle engine cutover: the old stage tables are read-only archives...'
