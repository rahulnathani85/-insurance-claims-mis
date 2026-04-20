'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const PHASES = [
  { n: 1, label: 'Appointment' },
  { n: 2, label: 'Survey & Inspection' },
  { n: 3, label: 'ILA & LOR' },
  { n: 4, label: 'Pending Requirements' },
  { n: 5, label: 'Assessment' },
  { n: 6, label: 'Report' },
  { n: 7, label: 'Delivery' },
];

const OWNER_ROLES = ['Admin', 'Surveyor', 'Lead Surveyor', 'Reviewer', 'Auto', 'Other'];
const DELTA_OPS = ['add', 'replace', 'remove', 'modify'];

export default function LifecycleTemplateEditor() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const tplId = params.id;

  const [tpl, setTpl] = useState(null);
  const [stages, setStages] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [defaultItems, setDefaultItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [saving, setSaving] = useState(false);

  // New stage row
  const [ns, setNs] = useState({
    stage_code: '', stage_name: '',
    universal_phase: 1, sequence_number: 10, sequence_within_phase: 1,
    firm_tat_hours: '', insurer_tat_hours: '',
    owner_role: 'Surveyor', completion_trigger: '',
    delta_operation: 'add',
  });

  useEffect(() => { load(); }, [tplId]);

  async function load() {
    try {
      setLoading(true);
      // NOTE: /api/lifecycle/templates returns a LIST ({ templates: [...] }) even
      // when an ?id= is given. Filter client-side to grab the single row we need.
      const [tRes, sRes, cRes] = await Promise.all([
        fetch('/api/lifecycle/templates').then(r => r.ok ? r.json() : null),
        fetch(`/api/lifecycle/templates/${tplId}/stages`).then(r => r.ok ? r.json() : null),
        fetch('/api/lifecycle/items/catalog').then(r => r.ok ? r.json() : null),
      ]);

      const allTemplates = Array.isArray(tRes?.templates) ? tRes.templates
                         : Array.isArray(tRes) ? tRes
                         : [];
      const matched = allTemplates.find(t => String(t.id) === String(tplId));
      setTpl(matched || null);

      setStages(Array.isArray(sRes?.stages) ? sRes.stages : Array.isArray(sRes) ? sRes : []);
      setCatalog(Array.isArray(cRes?.items)  ? cRes.items  : Array.isArray(cRes)  ? cRes  : []);

      // Default items for Phase 4 — try a dedicated endpoint; if backend doesn't
      // expose one, just show an empty list (not critical for editing).
      try {
        const diRes = await fetch(`/api/lifecycle/templates/${tplId}/default-items`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);
        const list = Array.isArray(diRes?.items) ? diRes.items
                   : Array.isArray(diRes?.default_items) ? diRes.default_items
                   : Array.isArray(diRes) ? diRes
                   : [];
        setDefaultItems(list);
      } catch (e) { setDefaultItems([]); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function showAlertMsg(msg, type = 'success') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  }

  async function saveMeta() {
    if (!tpl) return;
    const numericTplId = tpl.id || parseInt(tplId, 10);
    if (!numericTplId) {
      showAlertMsg('Template id missing — reload the page and try again', 'error');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        id: numericTplId,
        template_name: tpl.template_name,
        description: tpl.description,
        match_lob: tpl.match_lob,
        match_policy_type: tpl.match_policy_type,
        match_portfolio: tpl.match_portfolio,
        match_client: tpl.match_client,
        match_cause_of_loss: tpl.match_cause_of_loss,
        match_subject_matter: tpl.match_subject_matter,
        priority: tpl.priority,
        branching_enabled: tpl.branching_enabled,
        subtasks_enabled: tpl.subtasks_enabled,
        time_rules_enabled: tpl.time_rules_enabled,
        is_active: tpl.is_active,
      };
      const res = await fetch('/api/lifecycle/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      showAlertMsg('Template metadata saved');
    } catch (e) { showAlertMsg(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function addStage() {
    if (!ns.stage_code.trim() || !ns.stage_name.trim()) {
      showAlertMsg('stage_code and stage_name are required', 'error');
      return;
    }
    // Always take template_id from the URL param — don't depend on tpl.id
    // which can be undefined if the template fetch hasn't finished yet.
    const numericTplId = parseInt(tplId, 10);
    if (!numericTplId) {
      showAlertMsg('Template id missing from URL — reload and try again', 'error');
      return;
    }
    try {
      const body = { ...ns, template_id: numericTplId };
      if (body.firm_tat_hours === '')     body.firm_tat_hours    = null; else body.firm_tat_hours    = parseInt(body.firm_tat_hours, 10);
      if (body.insurer_tat_hours === '')  body.insurer_tat_hours = null; else body.insurer_tat_hours = parseInt(body.insurer_tat_hours, 10);
      const res = await fetch(`/api/lifecycle/templates/${numericTplId}/stages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Add failed');
      }
      showAlertMsg('Stage added');
      setNs({ stage_code: '', stage_name: '',
        universal_phase: 1, sequence_number: (ns.sequence_number || 0) + 10, sequence_within_phase: 1,
        firm_tat_hours: '', insurer_tat_hours: '',
        owner_role: 'Surveyor', completion_trigger: '', delta_operation: 'add' });
      load();
    } catch (e) { showAlertMsg(e.message, 'error'); }
  }

  async function deleteStage(s) {
    if (!confirm(`Remove stage ${s.stage_code}?`)) return;
    const numericTplId = (tpl && tpl.id) || parseInt(tplId, 10);
    try {
      const res = await fetch(`/api/lifecycle/templates/${numericTplId}/stages?stage_id=${s.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showAlertMsg('Stage removed');
      load();
    } catch (e) { showAlertMsg(e.message, 'error'); }
  }

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <p style={{ padding: 40, textAlign: 'center', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>Admin access required.</p>
        </div>
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="main-content">
          <p style={{ padding: 40, textAlign: 'center' }}>Loading template...</p>
        </div>
      </PageLayout>
    );
  }
  if (!tpl) {
    return (
      <PageLayout>
        <div className="main-content">
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 18, color: '#991b1b', marginBottom: 10 }}>Template #{tplId} not found</p>
            <p style={{ color: '#64748b', marginBottom: 20 }}>It may have been deleted, or the URL id is invalid.</p>
            <button className="secondary" onClick={() => router.push('/lifecycle-templates')}>&larr; Back to Templates</button>
          </div>
        </div>
      </PageLayout>
    );
  }

  const stagesByPhase = PHASES.map(p => ({ ...p, items: stages.filter(s => s.universal_phase === p.n).sort((a, b) => a.sequence_number - b.sequence_number) }));

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <button className="secondary" style={{ fontSize: 12 }} onClick={() => router.push('/lifecycle-templates')}>&larr; Templates</button>
          <h2 style={{ margin: 0 }}>
            {tpl.template_name}
            <span style={{ fontSize: 11, marginLeft: 10, padding: '2px 8px', borderRadius: 10, background: '#ede9fe', color: '#5b21b6', fontFamily: 'monospace' }}>{tpl.template_code}</span>
            <span style={{ fontSize: 11, marginLeft: 6, color: '#64748b' }}>v{tpl.version}</span>
          </h2>
        </div>

        {/* Metadata editor */}
        <div style={{ marginTop: 10, padding: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <h4 style={{ marginBottom: 10 }}>Metadata</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <Field label="Template name"><input value={tpl.template_name || ''} onChange={e => setTpl({ ...tpl, template_name: e.target.value })} /></Field>
            <Field label="Match LOB"><input value={tpl.match_lob || ''} onChange={e => setTpl({ ...tpl, match_lob: e.target.value })} /></Field>
            <Field label="Match policy type"><input value={tpl.match_policy_type || ''} onChange={e => setTpl({ ...tpl, match_policy_type: e.target.value })} /></Field>
            <Field label="Match portfolio"><input value={tpl.match_portfolio || ''} onChange={e => setTpl({ ...tpl, match_portfolio: e.target.value })} /></Field>
            <Field label="Match client"><input value={tpl.match_client || ''} onChange={e => setTpl({ ...tpl, match_client: e.target.value })} /></Field>
            <Field label="Match cause of loss"><input value={tpl.match_cause_of_loss || ''} onChange={e => setTpl({ ...tpl, match_cause_of_loss: e.target.value })} /></Field>
            <Field label="Match subject matter"><input value={tpl.match_subject_matter || ''} onChange={e => setTpl({ ...tpl, match_subject_matter: e.target.value })} /></Field>
            <Field label="Priority"><input type="number" value={tpl.priority || 0} onChange={e => setTpl({ ...tpl, priority: parseInt(e.target.value, 10) || 0 })} /></Field>
          </div>
          <Field label="Description">
            <textarea value={tpl.description || ''} onChange={e => setTpl({ ...tpl, description: e.target.value })} rows={2} style={{ width: '100%' }} />
          </Field>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, padding: 10, background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, width: '100%', marginBottom: 4 }}>Features passed on to claim users:</div>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!tpl.branching_enabled}  onChange={e => setTpl({ ...tpl, branching_enabled:  e.target.checked })} /> Branching rules</label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!tpl.subtasks_enabled}   onChange={e => setTpl({ ...tpl, subtasks_enabled:   e.target.checked })} /> Sub-tasks per stage</label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!tpl.time_rules_enabled} onChange={e => setTpl({ ...tpl, time_rules_enabled: e.target.checked })} /> Time-based validity</label>
            <label style={{ fontSize: 13, marginLeft: 'auto' }}><input type="checkbox" checked={!!tpl.is_active} onChange={e => setTpl({ ...tpl, is_active: e.target.checked })} /> Active</label>
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="success" onClick={saveMeta} disabled={saving}>{saving ? 'Saving...' : 'Save metadata'}</button>
          </div>
        </div>

        {/* Stages — expandable tree grouped by phase */}
        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
          <h4 style={{ margin: 0 }}>Stages ({stages.length})</h4>
          <span style={{ fontSize: 11, color: '#64748b' }}>Click phase headers to collapse/expand. Use "+ Add stage" in any phase to drop a new stage directly into that phase.</span>
        </div>
        <div style={{ marginTop: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          {stagesByPhase.map(p => (
            <PhaseSection
              key={p.n}
              phase={p}
              onDeleteStage={deleteStage}
              onAddHere={() => {
                setNs({
                  ...ns,
                  universal_phase: p.n,
                  sequence_within_phase: (p.items.length || 0) + 1,
                  sequence_number: p.items.length > 0
                    ? Math.max(...p.items.map(i => i.sequence_number || 0)) + 10
                    : (p.n * 10),
                });
                // Scroll to the add-stage form
                setTimeout(() => {
                  const el = document.getElementById('add-stage-form');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 50);
              }}
            />
          ))}
        </div>

        {/* Add stage form */}
        <div id="add-stage-form" style={{ marginTop: 14, padding: 14, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8 }}>
          <h4 style={{ marginBottom: 10 }}>Add new stage — Phase {ns.universal_phase}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <Field label="Stage code *"><input value={ns.stage_code} onChange={e => setNs({ ...ns, stage_code: e.target.value.trim() })} /></Field>
            <Field label="Stage name *"><input value={ns.stage_name} onChange={e => setNs({ ...ns, stage_name: e.target.value })} /></Field>
            <Field label="Phase">
              <select value={ns.universal_phase} onChange={e => setNs({ ...ns, universal_phase: parseInt(e.target.value, 10) })}>
                {PHASES.map(p => <option key={p.n} value={p.n}>{p.n}. {p.label}</option>)}
              </select>
            </Field>
            <Field label="Sequence #"><input type="number" value={ns.sequence_number} onChange={e => setNs({ ...ns, sequence_number: parseInt(e.target.value, 10) || 0 })} /></Field>
            <Field label="Seq in phase"><input type="number" value={ns.sequence_within_phase} onChange={e => setNs({ ...ns, sequence_within_phase: parseInt(e.target.value, 10) || 1 })} /></Field>
            <Field label="Firm TAT (hrs)"><input type="number" value={ns.firm_tat_hours} onChange={e => setNs({ ...ns, firm_tat_hours: e.target.value })} /></Field>
            <Field label="Insurer TAT (hrs)"><input type="number" value={ns.insurer_tat_hours} onChange={e => setNs({ ...ns, insurer_tat_hours: e.target.value })} /></Field>
            <Field label="Owner role">
              <select value={ns.owner_role} onChange={e => setNs({ ...ns, owner_role: e.target.value })}>
                {OWNER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Delta operation">
              <select value={ns.delta_operation} onChange={e => setNs({ ...ns, delta_operation: e.target.value })}>
                {DELTA_OPS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Completion trigger (what marks this stage done)">
            <input value={ns.completion_trigger} onChange={e => setNs({ ...ns, completion_trigger: e.target.value })} />
          </Field>
          <div style={{ marginTop: 10 }}>
            <button className="success" onClick={addStage}>+ Add stage</button>
          </div>
        </div>

        {/* Default items for Phase 4 */}
        {defaultItems.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h4 style={{ marginBottom: 10 }}>Default Phase-4 items ({defaultItems.length})</h4>
            <p style={{ fontSize: 12, color: '#64748b' }}>Items automatically opened when a claim using this template reaches Phase 4. Edit the master catalog in the <a href="/lifecycle-templates/items-catalog" style={{ color: '#7c3aed' }}>Item Catalog</a>.</p>
            <table className="mis-table" style={{ fontSize: 12 }}>
              <thead><tr><th>Item</th><th>Category</th><th>Pending with</th><th>Mandatory?</th><th>Notes</th></tr></thead>
              <tbody>
                {defaultItems.map(di => (
                  <tr key={di.id}>
                    <td>{di.item_catalog?.item_name || di.item_code}</td>
                    <td>{di.item_catalog?.category}</td>
                    <td>{di.override_pending_with || di.item_catalog?.default_pending_with}</td>
                    <td>{di.is_mandatory ? 'Yes' : 'No'}</td>
                    <td style={{ fontSize: 11, color: '#475569' }}>{di.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

// Collapsible section for a single universal phase — shows its detail stages,
// provides a "+ Add stage in this phase" button that pre-fills the add-form.
function PhaseSection({ phase, onDeleteStage, onAddHere }) {
  const [open, setOpen] = useState(true);
  const p = phase;
  return (
    <div style={{ borderTop: p.n === 1 ? 'none' : '1px solid #e2e8f0' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: '10px 14px',
          background: '#f1f5f9',
          fontWeight: 600,
          fontSize: 12,
          color: '#334155',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10, color: '#7c3aed', width: 14 }}>{open ? '▼' : '▶'}</span>
        <span>Phase {p.n} — {p.label}</span>
        <span style={{ fontWeight: 400, color: '#64748b' }}>({p.items.length} stage{p.items.length === 1 ? '' : 's'})</span>
        <button
          className="success"
          style={{ marginLeft: 'auto', fontSize: 10, padding: '3px 8px' }}
          onClick={e => { e.stopPropagation(); onAddHere && onAddHere(); }}
          title={`Add a new stage inside Phase ${p.n}`}
        >
          + Add stage in this phase
        </button>
      </div>
      {open && (
        p.items.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: '#94a3b8', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>No detail stages. This phase auto-completes when its neighbours do. Add a stage if you need explicit tracking.</span>
          </div>
        ) : (
          <table className="mis-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>Seq</th>
                <th>Code</th>
                <th>Name</th>
                <th>TAT (firm / insurer hrs)</th>
                <th>Owner</th>
                <th>Completion trigger</th>
                <th>Delta</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {p.items.map(s => (
                <tr key={s.id}>
                  <td>{s.sequence_number}</td>
                  <td style={{ fontFamily: 'monospace', color: '#7c3aed' }}>{s.stage_code}</td>
                  <td>{s.stage_name}</td>
                  <td>{s.firm_tat_hours ?? '-'} / {s.insurer_tat_hours ?? '-'}</td>
                  <td>{s.owner_role || '-'}</td>
                  <td style={{ fontSize: 11, color: '#475569' }}>{s.completion_trigger || '-'}</td>
                  <td style={{ fontSize: 11 }}>{s.delta_operation || 'add'}</td>
                  <td>
                    <button
                      className="secondary"
                      style={{ fontSize: 11, padding: '2px 6px', color: '#dc2626', background: '#fee2e2', border: '1px solid #fca5a5' }}
                      onClick={() => onDeleteStage(s)}
                      title={`Remove ${s.stage_code}`}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
