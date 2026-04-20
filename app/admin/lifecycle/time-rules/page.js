'use client';
// =============================================================================
// /admin/lifecycle/time-rules — Time-Based Template Rules
// =============================================================================
// Rules that re-resolve a claim's template or add/promote stages based on
// elapsed time. Examples:
//   - If Phase-4 pending items are open > 14 days → promote to CAT-event template
//   - If a specific stage opens > 30 days → add escalation stage
//
// Shape (from v2): rule_name, applies_to_template, condition_type, threshold,
// unit, action_type, action_target_template, is_active, priority, description.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Modal, FormGrid, FG, Btn,
} from '@/components/LifecycleAdminShell';

export default function TimeRulesPage() {
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [tR, rR] = await Promise.all([
      fetch('/api/lifecycle/templates').then(r => r.json()),
      fetch('/api/lifecycle/time-rules').then(r => r.ok ? r.json() : { rules: [] }).catch(() => ({ rules: [] })),
    ]);
    setTemplates(tR.templates || []);
    setRules(rR.rules || []);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const activeRuleCount = rules.filter(r => r.is_active).length;

  return (
    <LifecycleAdminShell
      view="timerules"
      title="Time-Based Template Rules"
      subtitle="Auto-escalate, promote, or mutate templates when a claim stays open beyond a threshold."
      stats={{ timerules: rules.length }}
      actions={<Btn variant="primary" onClick={() => setShowNew(true)}>+ New rule</Btn>}
    >
      {loading && <Note tone="info">Loading rules…</Note>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <Card title="Total rules">
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1e3a5f' }}>{rules.length}</div>
        </Card>
        <Card title="Active">
          <div style={{ fontSize: 26, fontWeight: 800, color: '#059669' }}>{activeRuleCount}</div>
        </Card>
        <Card title="Templates with time-rules enabled">
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1e3a5f' }}>
            {templates.filter(t => t.time_rules_enabled).length}
          </div>
        </Card>
      </div>

      <Card>
        {rules.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7280' }}>
            No time-based rules configured yet. Click <strong>+ New rule</strong> to add one.
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr style={tHeadRow}>
                <th style={th}>Priority</th>
                <th style={th}>Rule name</th>
                <th style={th}>Applies to</th>
                <th style={th}>Condition</th>
                <th style={th}>Threshold</th>
                <th style={th}>Action</th>
                <th style={th}>Action target</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules
                .slice().sort((a, b) => (a.priority || 100) - (b.priority || 100))
                .map(r => {
                  const appl = templates.find(t => t.id === r.applies_to_template_id);
                  const tgt = templates.find(t => t.id === r.action_target_template_id);
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td}><strong>{r.priority ?? 100}</strong></td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{r.rule_name}</div>
                        {r.description && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{r.description}</div>}
                      </td>
                      <td style={td}>{appl ? appl.template_name : <em style={{ color: '#9ca3af' }}>any</em>}</td>
                      <td style={td}><Badge tone="lob">{r.condition_type || '—'}</Badge></td>
                      <td style={td}>
                        <strong>{r.threshold ?? '—'}</strong>{' '}{r.unit || ''}
                      </td>
                      <td style={td}><Badge tone="override">{r.action_type || '—'}</Badge></td>
                      <td style={td}>{tgt ? tgt.template_name : '—'}</td>
                      <td style={td}>
                        {r.is_active ? <Badge tone="complete">Active</Badge> : <Badge tone="skipped">Inactive</Badge>}
                      </td>
                      <td style={td}>
                        <Btn size="xs" onClick={() => setEditing(r)}>Edit</Btn>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </Card>

      <Note tone="info">
        <strong>Examples —</strong><br />
        <em>Promote to CAT-event:</em> if Phase-4 open &gt; 14 days → swap to <code>FIRE_CAT_TEMPLATE</code><br />
        <em>Escalation stage:</em> if any stage open &gt; 30 days → add <code>ESCALATION_TO_LEAD</code> stage<br />
        <em>Auto-close stale items:</em> if a pending item open &gt; 90 days with no evidence → mark skipped
      </Note>

      <TimeRuleModal
        open={showNew || !!editing}
        onClose={() => { setShowNew(false); setEditing(null); }}
        editing={editing}
        templates={templates}
        onSaved={async () => {
          setShowNew(false); setEditing(null);
          await reload();
        }}
      />
    </LifecycleAdminShell>
  );
}

function TimeRuleModal({ open, onClose, editing, templates, onSaved }) {
  const [form, setForm] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing || {
      rule_name: '', applies_to_template_id: null,
      condition_type: 'phase_open_time', threshold: 14, unit: 'days',
      action_type: 'swap_template', action_target_template_id: null,
      is_active: true, priority: 100, description: '',
    });
    setErr(null);
  }, [editing, open]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing
        ? `/api/lifecycle/time-rules/${editing.id}`
        : `/api/lifecycle/time-rules`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      onSaved();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose}
      title={editing ? 'Edit time-rule' : 'New time-based rule'} large
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>}
    >
      {err && <Note tone="danger">{err}</Note>}
      <FormGrid>
        <FG label="Rule name">
          <input style={inp} value={form.rule_name || ''}
            onChange={e => setForm({ ...form, rule_name: e.target.value })} />
        </FG>
        <FG label="Applies to template" hint="Blank = applies to every template.">
          <select style={inp} value={form.applies_to_template_id || ''}
            onChange={e => setForm({ ...form, applies_to_template_id: e.target.value ? parseInt(e.target.value, 10) : null })}>
            <option value="">(any)</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
          </select>
        </FG>
        <FG label="Condition type">
          <select style={inp} value={form.condition_type || 'phase_open_time'}
            onChange={e => setForm({ ...form, condition_type: e.target.value })}>
            <option value="phase_open_time">Phase open time</option>
            <option value="stage_open_time">Stage open time</option>
            <option value="pending_item_age">Pending item age</option>
            <option value="total_claim_age">Total claim age</option>
          </select>
        </FG>
        <FG label="Threshold">
          <input style={inp} type="number" value={form.threshold ?? 14}
            onChange={e => setForm({ ...form, threshold: parseInt(e.target.value, 10) })} />
        </FG>
        <FG label="Unit">
          <select style={inp} value={form.unit || 'days'}
            onChange={e => setForm({ ...form, unit: e.target.value })}>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </FG>
        <FG label="Action">
          <select style={inp} value={form.action_type || 'swap_template'}
            onChange={e => setForm({ ...form, action_type: e.target.value })}>
            <option value="swap_template">Swap to another template</option>
            <option value="add_stage">Add escalation stage</option>
            <option value="auto_close_item">Auto-close stale item (mark skipped)</option>
            <option value="notify_admin">Notify Admin</option>
          </select>
        </FG>
        {form.action_type === 'swap_template' && (
          <FG label="Swap to template">
            <select style={inp} value={form.action_target_template_id || ''}
              onChange={e => setForm({ ...form, action_target_template_id: parseInt(e.target.value, 10) })}>
              <option value="">—</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
            </select>
          </FG>
        )}
        <FG label="Priority" hint="Lower = evaluated first.">
          <input style={inp} type="number" value={form.priority ?? 100}
            onChange={e => setForm({ ...form, priority: parseInt(e.target.value, 10) })} />
        </FG>
        <FG label="Active">
          <label style={chkWrap}>
            <input type="checkbox" checked={!!form.is_active}
              onChange={e => setForm({ ...form, is_active: e.target.checked })} />
            Active (scheduler will evaluate this rule)
          </label>
        </FG>
        <FG label="Description">
          <textarea style={{ ...inp, fontFamily: 'inherit' }} rows={2} value={form.description || ''}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </FG>
      </FormGrid>
    </Modal>
  );
}

const inp = {
  width: '100%', padding: '7px 10px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
};
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
const chkWrap = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' };
