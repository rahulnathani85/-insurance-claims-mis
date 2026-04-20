'use client';
// =============================================================================
// /admin/lifecycle/subtasks — Sub-task Editor
// =============================================================================
// Stage-scoped sub-tasks. When a stage has subtasks_active=true, the engine
// will not auto-complete it until sub-task completion rule is satisfied
// (all / at-least-N / any).
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Modal, FormGrid, FG, Btn,
} from '@/components/LifecycleAdminShell';

export default function SubtaskEditorPage() {
  const [templates, setTemplates] = useState([]);
  const [tplId, setTplId] = useState(null);
  const [stages, setStages] = useState([]);
  const [stageId, setStageId] = useState(null);
  const [subtasks, setSubtasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const tR = await fetch('/api/lifecycle/templates').then(r => r.json());
    setTemplates((tR.templates || []).filter(t => t.subtasks_enabled));
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!tplId) return;
    (async () => {
      const sR = await fetch(`/api/lifecycle/templates/${tplId}/stages`).then(r => r.json());
      const active = (sR.stages || []).filter(s => s.subtasks_active);
      setStages(active);
      setStageId(active[0]?.id || null);
    })();
  }, [tplId]);

  useEffect(() => {
    if (!stageId) { setSubtasks([]); return; }
    (async () => {
      const res = await fetch(`/api/lifecycle/stages/${stageId}/subtasks`)
        .then(r => r.ok ? r.json() : { subtasks: [] })
        .catch(() => ({ subtasks: [] }));
      setSubtasks(res.subtasks || []);
    })();
  }, [stageId]);

  const currentStage = stages.find(s => s.id === stageId);
  const tpl = templates.find(t => t.id === tplId);

  return (
    <LifecycleAdminShell
      view="subtasks"
      title="Sub-task Editor"
      subtitle="Each stage can require completion of individual sub-tasks before the stage itself is allowed to close."
      actions={stageId ? <Btn variant="primary" onClick={() => setShowNew(true)}>+ New sub-task</Btn> : null}
    >
      {loading && <Note tone="info">Loading templates…</Note>}

      <Card title="Templates with subtasks enabled">
        {templates.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6b7280' }}>
            No templates have the subtasks feature switched on yet. Turn it on inside <em>Template → Advanced</em>
            and also mark individual stages as <code>subtasks_active</code>.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {templates.map(t => (
              <button key={t.id} onClick={() => { setTplId(t.id); setStageId(null); }}
                style={tabBtn(tplId === t.id)}>
                {t.template_name}
              </button>
            ))}
          </div>
        )}
      </Card>

      {tplId && (
        <Card
          title={`Stages with subtasks · ${tpl?.template_name}`}
          subtitle={stages.length === 0
            ? 'None of this template\'s stages have subtasks_active=true. Flip the toggle on a stage in the Template Library → Stages tab.'
            : 'Pick a stage to view/edit its sub-tasks.'}
        >
          {stages.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {stages.map(s => (
                <button key={s.id} onClick={() => setStageId(s.id)} style={tabBtn(stageId === s.id)}>
                  {s.sequence_number}.{s.sequence_within_phase || 1} — {s.stage_name}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {stageId && currentStage && (
        <Card
          title={`Sub-tasks for ${currentStage.stage_name}`}
          subtitle={
            <>
              Completion rule: <Badge tone="lob">{currentStage.subtask_completion_rule || 'all'}</Badge>
              {currentStage.subtask_min_count && (
                <> · min count: <strong>{currentStage.subtask_min_count}</strong></>
              )}
            </>
          }
        >
          {subtasks.length === 0 ? (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6b7280' }}>
              No sub-tasks defined yet. Add one to unlock granular completion tracking.
            </div>
          ) : (
            <table style={tbl}>
              <thead>
                <tr style={tHeadRow}>
                  <th style={th}>#</th>
                  <th style={th}>Sub-task</th>
                  <th style={th}>Owner role</th>
                  <th style={th}>Required</th>
                  <th style={th}>Evidence</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subtasks
                  .slice().sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0))
                  .map(st => (
                    <tr key={st.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td}><strong>{st.sequence_number}</strong></td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{st.subtask_name}</div>
                        {st.description && (
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{st.description}</div>
                        )}
                      </td>
                      <td style={td}>{st.owner_role || '—'}</td>
                      <td style={td}>
                        {st.is_required ? <Badge tone="breached">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
                      </td>
                      <td style={td}>
                        {st.evidence_required ? <Badge tone="lob">Evidence needed</Badge> : '—'}
                      </td>
                      <td style={td}>
                        <Btn size="xs" onClick={() => setEditing(st)}>Edit</Btn>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Note tone="info">
        <strong>Completion rules —</strong>
        <em> all</em> = every required sub-task must be completed;
        <em> at-least-N</em> = min count of <code>subtask_min_count</code> must be done;
        <em> any</em> = one done unlocks the stage. Optional sub-tasks are tracked but never block.
      </Note>

      <SubtaskModal
        open={showNew || !!editing}
        onClose={() => { setShowNew(false); setEditing(null); }}
        editing={editing}
        stageId={stageId}
        existing={subtasks}
        onSaved={async () => {
          setShowNew(false); setEditing(null);
          if (stageId) {
            const r = await fetch(`/api/lifecycle/stages/${stageId}/subtasks`).then(r => r.ok ? r.json() : { subtasks: [] });
            setSubtasks(r.subtasks || []);
          }
        }}
      />
    </LifecycleAdminShell>
  );
}

function SubtaskModal({ open, onClose, editing, stageId, existing, onSaved }) {
  const [form, setForm] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing || {
      subtask_code: '', subtask_name: '', description: '',
      sequence_number: (existing?.length || 0) + 1,
      owner_role: 'Surveyor', is_required: true, evidence_required: false,
    });
    setErr(null);
  }, [editing, open, existing]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing
        ? `/api/lifecycle/subtasks/${editing.id}`
        : `/api/lifecycle/stages/${stageId}/subtasks`;
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
      title={editing ? 'Edit sub-task' : 'New sub-task'}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>}
    >
      {err && <Note tone="danger">{err}</Note>}
      <FormGrid>
        <FG label="Code">
          <input style={inp} value={form.subtask_code || ''}
            onChange={e => setForm({ ...form, subtask_code: e.target.value.toUpperCase() })} />
        </FG>
        <FG label="Name">
          <input style={inp} value={form.subtask_name || ''}
            onChange={e => setForm({ ...form, subtask_name: e.target.value })} />
        </FG>
        <FG label="Description">
          <textarea style={{ ...inp, fontFamily: 'inherit' }} rows={2} value={form.description || ''}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </FG>
        <FG label="Sequence">
          <input style={inp} type="number" value={form.sequence_number || 1}
            onChange={e => setForm({ ...form, sequence_number: parseInt(e.target.value, 10) })} />
        </FG>
        <FG label="Owner role">
          <select style={inp} value={form.owner_role || ''}
            onChange={e => setForm({ ...form, owner_role: e.target.value })}>
            <option>Admin</option><option>Surveyor</option>
            <option>Lead Surveyor</option><option>Reviewer</option>
          </select>
        </FG>
        <FG label="Flags">
          <label style={chkWrap}>
            <input type="checkbox" checked={!!form.is_required}
              onChange={e => setForm({ ...form, is_required: e.target.checked })} />
            Required (counts toward completion rule)
          </label>
          <label style={chkWrap}>
            <input type="checkbox" checked={!!form.evidence_required}
              onChange={e => setForm({ ...form, evidence_required: e.target.checked })} />
            Evidence needed to mark done
          </label>
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
const tabBtn = (active) => ({
  padding: '7px 12px',
  border: '1px solid ' + (active ? '#4B0082' : '#d1d5db'),
  borderRadius: 6, background: active ? '#ede9fe' : '#fff',
  color: active ? '#4B0082' : '#374151',
  fontSize: 12.5, fontWeight: active ? 700 : 500, cursor: 'pointer',
});
