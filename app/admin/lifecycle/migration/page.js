'use client';
// =============================================================================
// /admin/lifecycle/migration — Migration Status
// =============================================================================
// Shows the big-bang migration progress from legacy stage tables to the new
// lifecycle engine. Merges:
//   v2: legacy tables (with _archive suffix) and counts per table
//   v1: 12-step migration plan with per-step risk classification
//   v1: conversion mapping old stage → new stage_code
// =============================================================================

import { useEffect, useState } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Btn,
} from '@/components/LifecycleAdminShell';

// Tables involved in the cutover
const LEGACY = [
  { name: 'claim_stages',        purpose: '9-stage pipeline', targets: 'claim_lifecycle_stages' },
  { name: 'claim_workflow',      purpose: '22-stage workflow', targets: 'claim_lifecycle_stages + claim_lifecycle_items' },
  { name: 'ew_claim_stages',     purpose: '8-stage EW pipeline', targets: 'claim_lifecycle_stages' },
  { name: 'claim_workflow_history', purpose: 'workflow audit', targets: 'claim_lifecycle_audit' },
];

const NEW = [
  'lifecycle_templates',
  'lifecycle_template_stages',
  'lifecycle_template_default_items',
  'lifecycle_item_catalog',
  'lifecycle_branching_rules',
  'lifecycle_subtask_definitions',
  'lifecycle_time_rules',
  'claim_lifecycle',
  'claim_lifecycle_phases',
  'claim_lifecycle_stages',
  'claim_lifecycle_items',
  'claim_lifecycle_subtasks',
  'claim_lifecycle_audit',
];

// 12-step plan from v1 mockup
const STEPS = [
  { n: 1,  action: 'Create 7 new tables',                              risk: 'low' },
  { n: 2,  action: 'Seed lifecycle_templates (EW_BASE, MARINE_ULTRATECH_TILES, TATA_MARINE, Fire/Engg stubs)', risk: 'low' },
  { n: 3,  action: 'Seed lifecycle_template_stages for each template', risk: 'low' },
  { n: 4,  action: 'Seed lifecycle_template_default_items for Phase-4 checklists', risk: 'low' },
  { n: 5,  action: 'Convert claim_stages rows (9-stage) → claim_lifecycle_stages', risk: 'medium' },
  { n: 6,  action: 'Convert claim_workflow rows (22-stage) → claim_lifecycle_stages + items', risk: 'medium' },
  { n: 7,  action: 'Convert ew_claim_stages rows (8-stage) → claim_lifecycle_stages', risk: 'medium' },
  { n: 8,  action: 'Validate — every claim has ≥1 stage row and counts reconcile', risk: 'low' },
  { n: 9,  action: 'Rename legacy tables to *_archive', risk: 'medium' },
  { n: 10, action: 'Deploy new API routes (/api/lifecycle/*)', risk: 'high' },
  { n: 11, action: 'Deploy new UI pages and replace dashboard bucketing', risk: 'high' },
  { n: 12, action: 'Remove old UI pages + old API routes (file-tracking, claim-workflow, ew-claim-stages)', risk: 'medium' },
];

// Conversion mapping
const CONV = [
  { src: 'ew_claim_stages',   srcStage: '1. Intimation & Registration',    tgt: '1.1', phase: 1, notes: '' },
  { src: 'ew_claim_stages',   srcStage: '2. Initial Inspection Done',      tgt: '2.1', phase: 2, notes: '' },
  { src: 'ew_claim_stages',   srcStage: '3. Observation Shared',           tgt: '— (merged into 2.1)', phase: 2, notes: 'merged' },
  { src: 'ew_claim_stages',   srcStage: '4. Dismantling Inspection',       tgt: '4.1', phase: 4, notes: '' },
  { src: 'ew_claim_stages',   srcStage: '5. Reinspection',                 tgt: '4.2', phase: 4, notes: '' },
  { src: 'ew_claim_stages',   srcStage: '6. Tax Invoice Receipt',          tgt: '— (merged into 4.2)', phase: 4, notes: 'merged' },
  { src: 'ew_claim_stages',   srcStage: '7. Assessment',                   tgt: '— (auto-phase 5)', phase: 5, notes: 'auto' },
  { src: 'ew_claim_stages',   srcStage: '8. Final Survey Report',          tgt: '6.1', phase: 6, notes: '' },
  { src: 'claim_workflow',    srcStage: 'Stage 5 Survey Completed',        tgt: '2.1', phase: 2, notes: '' },
  { src: 'claim_workflow',    srcStage: 'Stage 6 LOR Sent',                tgt: '3.1', phase: 3, notes: '' },
  { src: 'claim_workflow',    srcStage: 'Stages 8-12 Reminders',           tgt: '(discarded — → pending items)', phase: null, notes: 'discarded' },
  { src: 'claim_workflow',    srcStage: 'Stage 13 Docs Received',          tgt: '(creates pending_item closures)', phase: 4, notes: 'item closures' },
  { src: 'claim_workflow',    srcStage: 'Stage 16 Assessment Done',        tgt: '5.1', phase: 5, notes: '' },
  { src: 'claim_workflow',    srcStage: 'Stage 19 FSR Created',            tgt: '6.1', phase: 6, notes: '' },
  { src: 'claim_workflow',    srcStage: 'Stage 21 Report Dispatched',      tgt: '7.1', phase: 7, notes: '' },
];

export default function MigrationStatusPage() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastRun, setLastRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/lifecycle/migration/status')
          .then(r => r.ok ? r.json() : {})
          .catch(() => ({}));
        setCounts(r.counts || {});
        setLastRun(r.last_run);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const riskBadge = (risk) => ({
    low:    <Badge tone="complete">Low</Badge>,
    medium: <Badge tone="active">Medium</Badge>,
    high:   <Badge tone="breached">High</Badge>,
  }[risk]);

  return (
    <LifecycleAdminShell
      view="migration"
      title="Migration Status"
      subtitle="Big-bang cutover from legacy stage tables to the unified Lifecycle Engine."
    >
      {loading && <Note tone="info">Loading table counts…</Note>}
      {error && <Note tone="danger">{error}</Note>}
      {lastRun && (
        <Note tone="success">
          Last migration run: <strong>{new Date(lastRun).toLocaleString()}</strong>
        </Note>
      )}

      <Card title="Legacy tables — frozen" subtitle="Archived with _archive suffix (read-only audit trail).">
        <table style={tbl}>
          <thead>
            <tr style={tHeadRow}>
              <th style={th}>Table</th>
              <th style={th}>Purpose</th>
              <th style={th}>Converts to</th>
              <th style={th}>Rows</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {LEGACY.map(t => (
              <tr key={t.name} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>
                  <code style={{ fontFamily: 'monospace' }}>{t.name}</code>{' '}
                  <span style={{ fontSize: 11, color: '#6b7280' }}>→ <code>{t.name}_archive</code></span>
                </td>
                <td style={td}>{t.purpose}</td>
                <td style={td}>
                  <code style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{t.targets}</code>
                </td>
                <td style={td}>{counts[t.name] ?? counts[`${t.name}_archive`] ?? '—'}</td>
                <td style={td}>
                  {counts[`${t.name}_archive`] > 0
                    ? <Badge tone="complete">Archived</Badge>
                    : <Badge tone="active">Pending archive</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="New engine tables" subtitle={`${NEW.length} active tables powering the lifecycle engine.`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {NEW.map(name => (
            <div key={name} style={{
              padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <code style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{name}</code>
              <strong style={{ fontSize: 12, color: '#1e3a5f' }}>{counts[name] ?? '—'}</strong>
            </div>
          ))}
        </div>
      </Card>

      <Card title="12-step migration plan" subtitle="Executed as a coordinated deployment.">
        <table style={tbl}>
          <thead>
            <tr style={tHeadRow}>
              <th style={{ ...th, width: 40 }}>#</th>
              <th style={th}>Action</th>
              <th style={{ ...th, width: 100 }}>Risk</th>
              <th style={{ ...th, width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map(s => (
              <tr key={s.n} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><strong>{s.n}</strong></td>
                <td style={td}>{s.action}</td>
                <td style={td}>{riskBadge(s.risk)}</td>
                <td style={td}>
                  {s.n <= 4
                    ? <Badge tone="complete">Done</Badge>
                    : <Badge tone="pending">Pending</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Conversion mapping (high-level)" subtitle="Legacy stage → new stage_code / universal phase.">
        <table style={tbl}>
          <thead>
            <tr style={tHeadRow}>
              <th style={th}>Source table</th>
              <th style={th}>Source stage</th>
              <th style={th}>Target stage_code</th>
              <th style={th}>Target phase</th>
              <th style={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {CONV.map((c, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><code style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{c.src}</code></td>
                <td style={td}>{c.srcStage}</td>
                <td style={td}><code style={{ fontFamily: 'monospace' }}>{c.tgt}</code></td>
                <td style={td}>{c.phase ? `${c.phase}` : '—'}</td>
                <td style={td}>{c.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Note tone="info">
        The 22-stage reminder cascade (stages 8-12 of claim_workflow) is
        <strong> discarded</strong> in the new model — its job is now handled by
        the Phase-4 pending-items mechanism. Any currently-open reminders convert to typed
        pending-items. Closed reminders are preserved in <code>claim_workflow_archive</code>.
      </Note>
    </LifecycleAdminShell>
  );
}

const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '9px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
