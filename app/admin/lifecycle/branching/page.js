'use client';
// =============================================================================
// /admin/lifecycle/branching — Branching Rules
// =============================================================================
// Rules that decide, at runtime, which next stage fires after a given stage
// completes. Each rule has: source stage, outcome condition, target stage,
// priority, description.
//
// Reads from /api/lifecycle/branching (if exposed) with graceful fallback to
// reading templates + stages and letting the admin see what would be editable.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Modal, FormGrid, FG, Btn,
} from '@/components/LifecycleAdminShell';

export default function BranchingRulesPage() {
  const [templates, setTemplates] = useState([]);
  const [selectedTplId, setSelectedTplId] = useState(null);
  const [stages, setStages] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tR = await fetch('/api/lifecycle/templates').then(r => r.json());
      setTemplates((tR.templates || []).filter(t => t.branching_enabled));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!selectedTplId) return;
    (async () => {
      const [sR, bR] = await Promise.all([
        fetch(`/api/lifecycle/templates/${selectedTplId}/stages`).then(r => r.json()),
        fetch(`/api/lifecycle/templates/${selectedTplId}/branching`)
          .then(r => r.ok ? r.json() : { rules: [] }).catch(() => ({ rules: [] })),
      ]);
      setStages(sR.stages || []);
      setRules(bR.rules || []);
    })();
  }, [selectedTplId]);

  const branchingCount = rules.length;
  const tpl = templates.find(t => t.id === selectedTplId);

  return (
    <LifecycleAdminShell
      view="branching"
      title="Branching Rules"
      subtitle="Outcome-based next-stage routing. Used when a stage's completion outcome affects which stage fires next."
      stats={{ branching: templates.length }}
      actions={
        selectedTplId
          ? <Btn variant="primary" onClick={() => setShowNew(true)}>+ New branch rule</Btn>
          : null
      }
    >
      {loading && <Note tone="info">Loading templates…</Note>}
      {error && <Note tone="danger">{error}</Note>}

      <Card
        title="Templates with branching enabled"
        subtitle={templates.length === 0
          ? 'No templates have the branching feature switched on yet. Turn it on inside Template → Advanced tab.'
          : `${templates.length} template${templates.length !== 1 ? 's' : ''} with branching enabled. Pick one to view/edit its rules.`}
      >
        {templates.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTplId(t.id)}
                style={{
                  padding: '8px 14px', border: '1px solid ' + (selectedTplId === t.id ? '#4B0082' : '#d1d5db'),
                  borderRadius: 6, background: selectedTplId === t.id ? '#ede9fe' : '#fff',
                  color: selectedTplId === t.id ? '#4B0082' : '#374151',
                  fontSize: 13, fontWeight: selectedTplId === t.id ? 700 : 500, cursor: 'pointer',
                }}
              >
                {t.template_name}
                {t.match_lob && <span style={{ fontSize: 10.5, color: '#6b7280', marginLeft: 6 }}>· {t.match_lob}</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      {selectedTplId && (
        <Card
          title={`Branch rules for ${tpl?.template_name}`}
          subtitle={`${branchingCount} rule${branchingCount !== 1 ? 's' : ''}. Rules fire in priority order; first match wins.`}
        >
          {rules.length === 0 ? (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6b7280' }}>
              No branching rules configured yet. Click <strong>+ New branch rule</strong> to add one.
            </div>
          ) : (
            <table style={tbl}>
              <thead>
                <tr style={tHeadRow}>
                  <th style={th}>Priority</th>
                  <th style={th}>Source stage</th>
                  <th style={th}>Outcome / condition</th>
                  <th style={th}>Target stage</th>
                  <th style={th}>Also-skip</th>
                  <th style={th}>Description</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules
                  .slice()
                  .sort((a, b) => (a.priority || 0) - (b.priority || 0))
                  .map(r => {
                    const src = stages.find(s => s.id === r.source_stage_id);
                    const tgt = stages.find(s => s.id === r.target_stage_id);
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={td}><strong>{r.priority || 0}</strong></td>
                        <td style={td}>
                          {src ? <>
                            <strong>{src.sequence_number}.{src.sequence_within_phase || 1}</strong> {src.stage_name}
                          </> : <em style={{ color: '#9ca3af' }}>missing</em>}
                        </td>
                        <td style={td}>
                          <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.condition_expression || '—'}</code>
                          {r.outcome_label && <div style={{ fontSize: 11, color: '#6b7280' }}>{r.outcome_label}</div>}
                        </td>
                        <td style={td}>
                          {tgt ? <>
                            <Badge tone="lob">{tgt.sequence_number}.{tgt.sequence_within_phase || 1}</Badge> {tgt.stage_name}
                          </> : <em style={{ color: '#9ca3af' }}>missing</em>}
                        </td>
                        <td style={td}>
                          {Array.isArray(r.also_skip_stage_ids) && r.also_skip_stage_ids.length
                            ? r.also_skip_stage_ids.length + ' stage(s)'
                            : '—'}
                        </td>
                        <td style={td}>{r.description || '—'}</td>
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
      )}

      <Note tone="info">
        <strong>How branching works —</strong>{' '}
        When a stage completes, the engine looks up rules for that source stage in priority order.
        The first rule whose condition evaluates to true advances the claim to its target stage
        (and optionally skips others). If no rule matches, the next sequential stage fires.
      </Note>

      <BranchRuleModal
        open={showNew || !!editing}
        onClose={() => { setShowNew(false); setEditing(null); }}
        editing={editing}
        templateId={selectedTplId}
        stages={stages}
        onSaved={async () => {
          setShowNew(false); setEditing(null);
          if (selectedTplId) {
            const bR = await fetch(`/api/lifecycle/templates/${selectedTplId}/branching`).then(r => r.ok ? r.json() : { rules: [] });
            setRules(bR.rules || []);
          }
        }}
      />
    </LifecycleAdminShell>
  );
}

function BranchRuleModal({ open, onClose, editing, templateId, stages, onSaved }) {
  const [form, setForm] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing || {
      source_stage_id: '', target_stage_id: '',
      condition_expression: '', outcome_label: '', description: '',
      priority: 100, also_skip_stage_ids: [],
    });
    setErr(null);
  }, [editing, open]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing
        ? `/api/lifecycle/branching/${editing.id}`
        : `/api/lifecycle/templates/${templateId}/branching`;
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
      title={editing ? 'Edit branch rule' : 'New branch rule'} large
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>}
    >
      {err && <Note tone="danger">{err}</Note>}
      <FormGrid>
        <FG label="Source stage" hint="The stage whose completion triggers this rule.">
          <select style={inp} value={form.source_stage_id || ''}
            onChange={e => setForm({ ...form, source_stage_id: parseInt(e.target.value, 10) })}>
            <option value="">—</option>
            {stages.map(s => (
              <option key={s.id} value={s.id}>
                {s.sequence_number}.{s.sequence_within_phase || 1} — {s.stage_name}
              </option>
            ))}
          </select>
        </FG>
        <FG label="Condition expression" hint='JSONLogic / mini-DSL. E.g., {"==": [{"var":"outcome"},"approved"]}'>
          <input style={inp} value={form.condition_expression || ''}
            onChange={e => setForm({ ...form, condition_expression: e.target.value })} />
        </FG>
        <FG label="Outcome label" hint="Human-readable one-liner for this branch.">
          <input style={inp} value={form.outcome_label || ''}
            onChange={e => setForm({ ...form, outcome_label: e.target.value })}
            placeholder="e.g., Approved · Rejected · Partial" />
        </FG>
        <FG label="Target stage" hint="The stage that fires when the rule matches.">
          <select style={inp} value={form.target_stage_id || ''}
            onChange={e => setForm({ ...form, target_stage_id: parseInt(e.target.value, 10) })}>
            <option value="">—</option>
            {stages.map(s => (
              <option key={s.id} value={s.id}>
                {s.sequence_number}.{s.sequence_within_phase || 1} — {s.stage_name}
              </option>
            ))}
          </select>
        </FG>
        <FG label="Also-skip stages" hint="Comma-separated stage IDs to mark as skipped when this branch fires.">
          <input style={inp}
            value={(form.also_skip_stage_ids || []).join(', ')}
            onChange={e => setForm({
              ...form,
              also_skip_stage_ids: e.target.value
                .split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n)),
            })} />
        </FG>
        <FG label="Priority" hint="Lower priority number = evaluated first. Ties are broken by id.">
          <input style={inp} type="number" value={form.priority ?? 100}
            onChange={e => setForm({ ...form, priority: parseInt(e.target.value, 10) })} />
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
