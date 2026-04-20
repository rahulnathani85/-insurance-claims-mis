'use client';
// =============================================================================
// /admin/lifecycle/schema — DB Schema Preview
// =============================================================================
// Read-only reference card showing every lifecycle-engine table with its
// purpose, cardinality, and (collapsible) full CREATE statement. Pulled from
// v1 mockup (NISLA_Lifecycle_Engine_Mockup.html — "DB Schema" section). Live
// row counts come from /api/lifecycle/migration/status so the admin can see
// how populated each table is without leaving the page.
// =============================================================================

import { useEffect, useState, Fragment } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Btn,
} from '@/components/LifecycleAdminShell';

// Tables grouped by responsibility.
const TABLES = [
  // ---------- Template layer ----------
  { group: 'Templates', name: 'lifecycle_templates',
    purpose: 'Master list of every lifecycle template (EW_BASE, MARINE_BASE, FIRE_BASE, their LOB/portfolio/client overrides).',
    rels: ['parent_template_id → lifecycle_templates.id (self)'],
    sql: `CREATE TABLE lifecycle_templates (
  id                         bigserial PRIMARY KEY,
  template_code              text UNIQUE NOT NULL,    -- e.g. 'EW_BASE'
  template_name              text NOT NULL,
  description                text,
  lob                        text,                    -- Fire / Engg / Marine / EW / Motor / Misc
  policy_type                text,
  cause_of_loss              text,
  subject_of_loss            text,
  portfolio                  text,                    -- Retail / Corporate / SME
  client_code                text,                    -- specific insurer, e.g. 'TATA_AIG'
  claim_size_bucket          text,                    -- small / medium / large / CAT
  nature_of_claim            text,                    -- normal / litigated / CAT / salvage
  appointment_source         text,                    -- email / portal / phone / broker
  delta_operation            text CHECK (delta_operation IN ('full_list','override')),
  parent_template_id         bigint REFERENCES lifecycle_templates(id),
  priority                   int DEFAULT 100,
  is_active                  boolean DEFAULT true,
  branching_enabled          boolean DEFAULT false,
  time_rules_enabled         boolean DEFAULT false,
  report_template_id         bigint,                  -- FK to fsr_templates
  notes                      text,
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);
CREATE INDEX ON lifecycle_templates (lob, portfolio, client_code);`,
  },
  { group: 'Templates', name: 'lifecycle_template_stages',
    purpose: 'Ordered stages that belong to a template. Each stage is a step inside one of the 7 universal phases.',
    rels: ['template_id → lifecycle_templates.id'],
    sql: `CREATE TABLE lifecycle_template_stages (
  id                         bigserial PRIMARY KEY,
  template_id                bigint NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,
  stage_code                 text NOT NULL,            -- e.g. '4.2' = 2nd stage of phase 4
  stage_name                 text NOT NULL,
  phase                      int NOT NULL CHECK (phase BETWEEN 1 AND 7),
  sequence                   int NOT NULL,
  is_auto_complete           boolean DEFAULT false,
  firm_clock_behaviour       text DEFAULT 'running',   -- running / paused
  insurer_clock_behaviour    text DEFAULT 'running',
  tat_firm_hours             int,
  tat_insurer_hours          int,
  required_artifact          text,                     -- e.g. 'FSR_PDF'
  branching_enabled          boolean DEFAULT false,
  delta_operation            text CHECK (delta_operation IN ('add','replace','remove')),
  parent_stage_code          text,                     -- when override, the stage in parent this maps to
  notes                      text,
  created_at                 timestamptz DEFAULT now(),
  UNIQUE (template_id, stage_code)
);`,
  },
  { group: 'Templates', name: 'lifecycle_template_default_items',
    purpose: 'Default pending-items pre-wired to a stage (typically Phase-4 stages). These seed claim_lifecycle_items on entry.',
    rels: ['template_id → lifecycle_templates.id', 'stage_code composite → lifecycle_template_stages'],
    sql: `CREATE TABLE lifecycle_template_default_items (
  id                         bigserial PRIMARY KEY,
  template_id                bigint NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,
  stage_code                 text NOT NULL,
  item_code                  text NOT NULL REFERENCES lifecycle_item_catalog(item_code),
  is_blocking                boolean DEFAULT true,
  default_party              text,                    -- insured / insurer / partner / internal
  sequence                   int DEFAULT 100,
  notes                      text,
  created_at                 timestamptz DEFAULT now()
);`,
  },
  { group: 'Templates', name: 'lifecycle_item_catalog',
    purpose: 'The master catalogue of pending-item types. Each item defines clock behaviour, reminder cadence, category.',
    rels: [],
    sql: `CREATE TABLE lifecycle_item_catalog (
  id                         bigserial PRIMARY KEY,
  item_code                  text UNIQUE NOT NULL,     -- e.g. 'TAX_INVOICE'
  item_name                  text NOT NULL,
  category                   text NOT NULL,            -- docs / approvals / payment / access
  description                text,
  default_party              text,                     -- insured / insurer / partner / internal
  firm_clock_behaviour       text DEFAULT 'paused',    -- pauses firm clock when open
  insurer_clock_behaviour    text DEFAULT 'paused',
  reminder_schedule_days     int[],                    -- e.g. '{3,7,14}'
  is_active                  boolean DEFAULT true,
  created_at                 timestamptz DEFAULT now()
);`,
  },
  { group: 'Advanced', name: 'lifecycle_branching_rules',
    purpose: 'Conditional jumps: when stage X completes with outcome Y, go to stage Z (and optionally skip intermediate stages).',
    rels: ['template_id', 'source_stage_code → lifecycle_template_stages.stage_code'],
    sql: `CREATE TABLE lifecycle_branching_rules (
  id                         bigserial PRIMARY KEY,
  template_id                bigint NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,
  source_stage_code          text NOT NULL,
  target_stage_code          text NOT NULL,
  outcome_code               text,                     -- e.g. 'rejected'
  condition_expression       jsonb,                    -- JSONLogic
  skip_stage_codes           text[],                   -- stages to mark skipped when this branch fires
  priority                   int DEFAULT 100,
  description                text,
  is_active                  boolean DEFAULT true,
  created_at                 timestamptz DEFAULT now()
);`,
  },
  { group: 'Advanced', name: 'lifecycle_subtask_definitions',
    purpose: 'Sub-tasks inside a stage (e.g. Phase-2 might have "take photos", "interview insured"). Some are required, some optional.',
    rels: ['template_id', 'stage_code'],
    sql: `CREATE TABLE lifecycle_subtask_definitions (
  id                         bigserial PRIMARY KEY,
  template_id                bigint NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,
  stage_code                 text NOT NULL,
  subtask_code               text NOT NULL,
  subtask_name               text NOT NULL,
  is_required                boolean DEFAULT false,
  evidence_required          boolean DEFAULT false,    -- must attach a file
  owner_role                 text,                     -- 'Surveyor' / 'Lead Surveyor' / ...
  sequence                   int DEFAULT 100,
  completion_rule            text DEFAULT 'any',       -- 'any' / 'all-required' / 'all'
  description                text,
  created_at                 timestamptz DEFAULT now(),
  UNIQUE (template_id, stage_code, subtask_code)
);`,
  },
  { group: 'Advanced', name: 'lifecycle_time_rules',
    purpose: 'Rules that mutate the template (swap, add stage, auto-close item) when a claim stays in a state too long.',
    rels: ['applies_to_template_id', 'action_target_template_id'],
    sql: `CREATE TABLE lifecycle_time_rules (
  id                         bigserial PRIMARY KEY,
  rule_name                  text NOT NULL,
  applies_to_template_id     bigint REFERENCES lifecycle_templates(id),
  condition_type             text NOT NULL,            -- phase_open_time / stage_open_time / pending_item_age / total_claim_age
  threshold                  int NOT NULL,
  unit                       text DEFAULT 'days',      -- hours / days
  action_type                text NOT NULL,            -- swap_template / add_stage / auto_close_item / notify_admin
  action_target_template_id  bigint REFERENCES lifecycle_templates(id),
  priority                   int DEFAULT 100,
  description                text,
  is_active                  boolean DEFAULT true,
  created_at                 timestamptz DEFAULT now()
);`,
  },

  // ---------- Runtime layer (per-claim) ----------
  { group: 'Runtime', name: 'claim_lifecycle',
    purpose: 'Per-claim lifecycle root record. Points to the resolved template and tracks current phase.',
    rels: ['claim_id or ew_claim_id', 'template_id → lifecycle_templates.id'],
    sql: `CREATE TABLE claim_lifecycle (
  id                         bigserial PRIMARY KEY,
  claim_id                   bigint,                   -- FK to claims
  ew_claim_id                uuid,                     -- FK to ew_vehicle_claims
  template_id                bigint NOT NULL REFERENCES lifecycle_templates(id),
  resolved_dimensions        jsonb,                    -- snapshot of 9-dim resolution
  current_phase              int,
  current_stage_code         text,
  status                     text DEFAULT 'active',    -- active / closed / reopened / cancelled
  firm_clock_running         boolean DEFAULT true,
  insurer_clock_running      boolean DEFAULT true,
  firm_total_minutes         bigint DEFAULT 0,
  insurer_total_minutes      bigint DEFAULT 0,
  opened_at                  timestamptz DEFAULT now(),
  closed_at                  timestamptz,
  created_at                 timestamptz DEFAULT now(),
  CHECK ((claim_id IS NOT NULL) <> (ew_claim_id IS NOT NULL))
);`,
  },
  { group: 'Runtime', name: 'claim_lifecycle_phases',
    purpose: 'One row per phase per claim. Tracks when each phase started/ended and aggregate clock time.',
    rels: ['lifecycle_id → claim_lifecycle.id'],
    sql: `CREATE TABLE claim_lifecycle_phases (
  id                         bigserial PRIMARY KEY,
  lifecycle_id               bigint NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,
  phase                      int NOT NULL CHECK (phase BETWEEN 1 AND 7),
  state                      text DEFAULT 'pending',   -- pending / active / complete / autocomplete / skipped / breach
  started_at                 timestamptz,
  ended_at                   timestamptz,
  firm_minutes               bigint DEFAULT 0,
  insurer_minutes            bigint DEFAULT 0,
  UNIQUE (lifecycle_id, phase)
);`,
  },
  { group: 'Runtime', name: 'claim_lifecycle_stages',
    purpose: 'One row per stage per claim. Fine-grained state + timing. This is the main "current work" table.',
    rels: ['lifecycle_id → claim_lifecycle.id'],
    sql: `CREATE TABLE claim_lifecycle_stages (
  id                         bigserial PRIMARY KEY,
  lifecycle_id               bigint NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,
  stage_code                 text NOT NULL,
  stage_name                 text,
  phase                      int NOT NULL CHECK (phase BETWEEN 1 AND 7),
  sequence                   int NOT NULL,
  state                      text DEFAULT 'pending',   -- pending / active / complete / autocomplete / skipped / breach
  assigned_to_email          text,
  outcome_code               text,                     -- set on completion (feeds branching)
  started_at                 timestamptz,
  completed_at               timestamptz,
  firm_deadline_at           timestamptz,              -- computed from TAT + firm clock
  insurer_deadline_at        timestamptz,
  notes                      text,
  UNIQUE (lifecycle_id, stage_code)
);
CREATE INDEX ON claim_lifecycle_stages (lifecycle_id, state);`,
  },
  { group: 'Runtime', name: 'claim_lifecycle_items',
    purpose: 'Per-claim pending-items (Phase-4 and ad-hoc). Drives clock-pause logic.',
    rels: ['lifecycle_id → claim_lifecycle.id', 'item_code → lifecycle_item_catalog.item_code'],
    sql: `CREATE TABLE claim_lifecycle_items (
  id                         bigserial PRIMARY KEY,
  lifecycle_id               bigint NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,
  stage_code                 text,                     -- may be null for ad-hoc items
  item_code                  text NOT NULL REFERENCES lifecycle_item_catalog(item_code),
  label                      text,                     -- override of item name
  party                      text,                     -- insured / insurer / partner / internal
  is_blocking                boolean DEFAULT true,
  is_internal                boolean DEFAULT false,    -- visible only to Lead/Admin
  state                      text DEFAULT 'open',      -- open / closed / skipped
  opened_at                  timestamptz DEFAULT now(),
  closed_at                  timestamptz,
  last_reminder_at           timestamptz,
  reminder_count             int DEFAULT 0,
  closure_note               text,
  evidence_url               text,
  created_by                 text
);
CREATE INDEX ON claim_lifecycle_items (lifecycle_id, state);`,
  },
  { group: 'Runtime', name: 'claim_lifecycle_subtasks',
    purpose: 'Per-claim sub-task completions (Phase-2 photos, interviews, etc).',
    rels: ['lifecycle_id', 'stage_code', 'subtask_code'],
    sql: `CREATE TABLE claim_lifecycle_subtasks (
  id                         bigserial PRIMARY KEY,
  lifecycle_id               bigint NOT NULL REFERENCES claim_lifecycle(id) ON DELETE CASCADE,
  stage_code                 text NOT NULL,
  subtask_code               text NOT NULL,
  state                      text DEFAULT 'pending',   -- pending / complete / waived
  completed_at               timestamptz,
  completed_by               text,
  evidence_url               text,
  notes                      text,
  UNIQUE (lifecycle_id, stage_code, subtask_code)
);`,
  },
  { group: 'Runtime', name: 'claim_lifecycle_audit',
    purpose: 'Append-only audit log of every engine event. Backs the History & Audit page.',
    rels: ['lifecycle_id → claim_lifecycle.id'],
    sql: `CREATE TABLE claim_lifecycle_audit (
  id                         bigserial PRIMARY KEY,
  lifecycle_id               bigint REFERENCES claim_lifecycle(id) ON DELETE CASCADE,
  claim_id                   bigint,
  ew_claim_id                uuid,
  claim_ref                  text,
  event_type                 text NOT NULL,            -- phase_start / stage_complete / item_open / ...
  phase                      int,
  stage_code                 text,
  actor_email                text,
  actor_role                 text,
  detail                     text,
  payload                    jsonb,
  created_at                 timestamptz DEFAULT now()
);
CREATE INDEX ON claim_lifecycle_audit (lifecycle_id, created_at DESC);
CREATE INDEX ON claim_lifecycle_audit (event_type, created_at DESC);`,
  },
];

const GROUP_ORDER = ['Templates', 'Advanced', 'Runtime'];

export default function SchemaPage() {
  const [counts, setCounts] = useState({});
  const [open, setOpen] = useState({});   // which table's SQL is expanded

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/lifecycle/migration/status')
          .then(r => r.ok ? r.json() : {})
          .catch(() => ({}));
        setCounts(r.counts || {});
      } catch { /* graceful */ }
    })();
  }, []);

  const toggle = (name) => setOpen(o => ({ ...o, [name]: !o[name] }));

  const tablesByGroup = GROUP_ORDER.map(g => ({
    group: g,
    items: TABLES.filter(t => t.group === g),
  }));

  return (
    <LifecycleAdminShell
      view="schema"
      title="Database Schema"
      subtitle="All lifecycle-engine tables — purpose, relationships, and live row counts."
    >
      <Note tone="info">
        This reference is generated from the canonical schema in{' '}
        <code>supabase/migration_lifecycle_engine.sql</code>. Counts refresh on page load
        from <code>/api/lifecycle/migration/status</code>. Legacy tables (<code>claim_stages</code>,
        <code> claim_workflow</code>, <code>ew_claim_stages</code>) are archived — see the{' '}
        <strong>Migration Status</strong> page.
      </Note>

      {/* Summary stat strip */}
      <Card title="Overview" subtitle={`${TABLES.length} tables across 3 layers.`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {tablesByGroup.map(g => {
            const total = g.items.reduce((s, t) => s + (counts[t.name] || 0), 0);
            return (
              <div key={g.group} style={{
                padding: '12px 14px', borderRadius: 8,
                border: '1px solid #e5e7eb', background: '#f9fafb',
              }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5,
                              textTransform: 'uppercase', color: '#6b7280' }}>
                  {g.group}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#1e3a5f', marginTop: 6 }}>
                  {g.items.length}<span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}> tables</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#4b5563', marginTop: 3 }}>
                  {total.toLocaleString()} row{total === 1 ? '' : 's'} across the group
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* One Card per group, each containing its tables */}
      {tablesByGroup.map(g => (
        <Card key={g.group} title={`${g.group} layer`}
              subtitle={groupBlurb(g.group)}>
          <table style={tbl}>
            <thead>
              <tr style={tHeadRow}>
                <th style={th}>Table</th>
                <th style={th}>Purpose</th>
                <th style={{ ...th, width: 150 }}>Relationships</th>
                <th style={{ ...th, width: 70 }}>Rows</th>
                <th style={{ ...th, width: 100 }}>SQL</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map(t => (
                <Fragment key={t.name}>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}>
                      <code style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11.5 }}>
                        {t.name}
                      </code>
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: '#374151' }}>{t.purpose}</td>
                    <td style={{ ...td, fontSize: 10.5, color: '#6b7280' }}>
                      {t.rels.length === 0
                        ? <em>none</em>
                        : t.rels.map((r, i) => (
                            <div key={i}><code style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r}</code></div>
                          ))}
                    </td>
                    <td style={td}>
                      <strong style={{ fontSize: 13, color: '#1e3a5f' }}>
                        {counts[t.name] != null ? Number(counts[t.name]).toLocaleString() : '—'}
                      </strong>
                    </td>
                    <td style={td}>
                      <Btn size="xs" onClick={() => toggle(t.name)}>
                        {open[t.name] ? 'Hide' : 'Show'}
                      </Btn>
                    </td>
                  </tr>
                  {open[t.name] && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <pre style={{
                          margin: 0, padding: '12px 16px',
                          background: '#0f172a', color: '#e2e8f0',
                          fontFamily: 'Menlo, monospace', fontSize: 11.5,
                          lineHeight: 1.55, overflowX: 'auto',
                          whiteSpace: 'pre',
                        }}>{t.sql}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <Card title="Legacy tables — archived" subtitle="Pre-engine tables, frozen with _archive suffix. See Migration Status for full cutover plan.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {['claim_stages_archive', 'claim_workflow_archive', 'ew_claim_stages_archive', 'claim_workflow_history_archive'].map(n => (
            <div key={n} style={{
              padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <code style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{n}</code>
              <Badge tone="skipped">Read-only</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Note tone="warn">
        <strong>Never edit the schema directly.</strong> All schema changes go through
        numbered SQL migrations in <code>supabase/migration_*.sql</code>. Ad-hoc column
        adds break the audit trail and the resolver's dimension logic.
      </Note>
    </LifecycleAdminShell>
  );
}

function groupBlurb(group) {
  if (group === 'Templates') return 'What a claim’s lifecycle should look like — template-level configuration.';
  if (group === 'Advanced')  return 'Sub-tasks, branching rules, and time-based mutations.';
  if (group === 'Runtime')   return 'Per-claim state — one row per claim (or per stage / item / subtask).';
  return '';
}

const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '9px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
