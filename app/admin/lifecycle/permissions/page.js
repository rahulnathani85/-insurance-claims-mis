'use client';
// =============================================================================
// /admin/lifecycle/permissions — Role Permissions Matrix
// =============================================================================
// Exact matrix from v2 mockup. Rows = actions, Cols = 4 roles.
// Each cell is a three-state toggle: Allow / Allow (own claims) / Deny.
// Changes are persisted to /api/lifecycle/permissions (writes the full matrix).
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Btn,
} from '@/components/LifecycleAdminShell';

const ROLES = ['Surveyor', 'Lead Surveyor', 'Reviewer', 'Admin'];

// Exact action list from v2 mockup permissions page
const ACTIONS = [
  { key: 'view_live',                 label: 'View live claim state',                group: 'Operational' },
  { key: 'advance_stage',             label: 'Advance stage (mark complete)',        group: 'Operational' },
  { key: 'open_close_items',          label: 'Open / close pending items',           group: 'Operational' },
  { key: 'send_reminders',            label: 'Send reminders to parties',            group: 'Operational' },
  { key: 'add_adhoc_items',           label: 'Add ad-hoc pending items',             group: 'Operational' },
  { key: 'add_subtasks',              label: 'Add sub-tasks on a stage',             group: 'Operational' },
  { key: 'reopen',                    label: 'Re-open a completed phase / stage',   group: 'Operational' },
  { key: 're_resolve',                label: 'Re-resolve template on a live claim', group: 'Operational' },
  { key: 'edit_templates',            label: 'Edit lifecycle templates',             group: 'Admin config' },
  { key: 'edit_catalog',              label: 'Edit item-type catalog',               group: 'Admin config' },
  { key: 'edit_branching',            label: 'Edit branching rules',                 group: 'Admin config' },
  { key: 'deactivate_delete_tpl',     label: 'Deactivate / delete templates',        group: 'Admin config' },
  { key: 'override_artifacts',        label: 'Override required-artifact blocks',    group: 'Admin config' },
  { key: 'view_audit',                label: 'View audit log',                       group: 'Visibility' },
  { key: 'view_internal_pending',     label: 'View internal-pending items',          group: 'Visibility' },
  { key: 'export_data',               label: 'Export reports / CSV',                 group: 'Visibility' },
];

const STATES = [
  { key: 'deny',      label: 'Deny',       tone: 'breached', short: '—' },
  { key: 'own',       label: 'Own claims', tone: 'active',   short: '◐' },
  { key: 'allow',     label: 'Allow',      tone: 'complete', short: '✓' },
];

// Sensible defaults — admin writable before anything is loaded
const DEFAULT_MATRIX = {
  'view_live':              { Surveyor: 'own',   'Lead Surveyor': 'allow', Reviewer: 'allow', Admin: 'allow' },
  'advance_stage':          { Surveyor: 'own',   'Lead Surveyor': 'allow', Reviewer: 'deny',  Admin: 'allow' },
  'open_close_items':       { Surveyor: 'own',   'Lead Surveyor': 'allow', Reviewer: 'deny',  Admin: 'allow' },
  'send_reminders':         { Surveyor: 'own',   'Lead Surveyor': 'allow', Reviewer: 'deny',  Admin: 'allow' },
  'add_adhoc_items':        { Surveyor: 'deny',  'Lead Surveyor': 'allow', Reviewer: 'deny',  Admin: 'allow' },
  'add_subtasks':           { Surveyor: 'deny',  'Lead Surveyor': 'allow', Reviewer: 'deny',  Admin: 'allow' },
  'reopen':                 { Surveyor: 'deny',  'Lead Surveyor': 'deny',  Reviewer: 'deny',  Admin: 'allow' },
  're_resolve':             { Surveyor: 'deny',  'Lead Surveyor': 'deny',  Reviewer: 'deny',  Admin: 'allow' },
  'edit_templates':         { Surveyor: 'deny',  'Lead Surveyor': 'deny',  Reviewer: 'deny',  Admin: 'allow' },
  'edit_catalog':           { Surveyor: 'deny',  'Lead Surveyor': 'deny',  Reviewer: 'deny',  Admin: 'allow' },
  'edit_branching':         { Surveyor: 'deny',  'Lead Surveyor': 'deny',  Reviewer: 'deny',  Admin: 'allow' },
  'deactivate_delete_tpl':  { Surveyor: 'deny',  'Lead Surveyor': 'deny',  Reviewer: 'deny',  Admin: 'allow' },
  'override_artifacts':     { Surveyor: 'deny',  'Lead Surveyor': 'deny',  Reviewer: 'deny',  Admin: 'allow' },
  'view_audit':             { Surveyor: 'own',   'Lead Surveyor': 'allow', Reviewer: 'allow', Admin: 'allow' },
  'view_internal_pending':  { Surveyor: 'deny',  'Lead Surveyor': 'allow', Reviewer: 'allow', Admin: 'allow' },
  'export_data':            { Surveyor: 'deny',  'Lead Surveyor': 'allow', Reviewer: 'allow', Admin: 'allow' },
};

export default function PermissionsPage() {
  const [matrix, setMatrix] = useState(DEFAULT_MATRIX);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/lifecycle/permissions')
        .then(r => r.ok ? r.json() : { matrix: DEFAULT_MATRIX })
        .catch(() => ({ matrix: DEFAULT_MATRIX }));
      setMatrix(r.matrix || DEFAULT_MATRIX);
    } finally {
      setLoading(false);
      setDirty(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const set = (action, role, state) => {
    setMatrix(prev => ({
      ...prev,
      [action]: { ...(prev[action] || {}), [role]: state },
    }));
    setDirty(true);
    setMessage(null);
  };

  const save = async () => {
    setMessage(null);
    try {
      const res = await fetch('/api/lifecycle/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setMessage({ tone: 'success', text: 'Permissions saved' });
      setDirty(false);
    } catch (e) {
      setMessage({ tone: 'danger', text: String(e.message || e) });
    }
  };

  const groups = [...new Set(ACTIONS.map(a => a.group))];

  return (
    <LifecycleAdminShell
      view="permissions"
      title="Role Permissions"
      subtitle="Who can do what. Changes take effect immediately and are written to the audit log."
      actions={<>
        <Btn onClick={reload}>Reset to saved</Btn>
        <Btn variant="primary" onClick={save} disabled={!dirty}>
          {dirty ? 'Save changes' : 'Saved'}
        </Btn>
      </>}
    >
      {loading && <Note tone="info">Loading permissions…</Note>}
      {message && <Note tone={message.tone}>{message.text}</Note>}

      <Card>
        <table style={tbl}>
          <thead>
            <tr style={tHeadRow}>
              <th style={{ ...th, width: 280 }}>Action</th>
              {ROLES.map(r => (
                <th key={r} style={{ ...th, textAlign: 'center' }}>{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(gr => (
              <>
                <tr key={`gr-${gr}`}>
                  <td colSpan={1 + ROLES.length} style={{
                    padding: '10px 12px', background: '#f3f4f6',
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    color: '#374151', letterSpacing: 0.5,
                  }}>{gr}</td>
                </tr>
                {ACTIONS.filter(a => a.group === gr).map(a => (
                  <tr key={a.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{a.label}</td>
                    {ROLES.map(r => {
                      const v = matrix[a.key]?.[r] || 'deny';
                      return (
                        <td key={r} style={{ ...td, textAlign: 'center' }}>
                          <select
                            value={v}
                            onChange={e => set(a.key, r, e.target.value)}
                            style={{
                              padding: '4px 6px', borderRadius: 4, fontSize: 12,
                              border: '1px solid ' + (v === 'allow' ? '#86efac' : v === 'own' ? '#fcd34d' : '#fca5a5'),
                              background: v === 'allow' ? '#ecfdf5' : v === 'own' ? '#fef3c7' : '#fef2f2',
                              cursor: 'pointer',
                            }}
                          >
                            {STATES.map(s => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Legend">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span><Badge tone="complete">Allow</Badge> role can do this on any claim</span>
          <span><Badge tone="active">Own claims</Badge> only claims where role is assigned</span>
          <span><Badge tone="breached">Deny</Badge> never permitted — UI hides the control</span>
        </div>
      </Card>

      <Note tone="warn">
        Admin always has full access — the Admin column is editable but Admin=Deny on critical
        actions is discouraged because it can lock you out of the engine. A sanity check prevents
        saving a matrix where every role is Deny on <em>edit_templates</em>.
      </Note>
    </LifecycleAdminShell>
  );
}

const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '10px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '8px 10px', verticalAlign: 'middle' };
