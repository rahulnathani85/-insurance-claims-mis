'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { LOB_LIST } from '@/lib/constants';

const RESOLUTION_TYPES = [
  { v: 'full_list', l: 'Full list (replaces any parent)' },
  { v: 'override',  l: 'Override (applies deltas on parent)' },
];

export default function LifecycleTemplatesList() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterLob, setFilterLob] = useState('');
  const [filterActive, setFilterActive] = useState('active');

  // Create-form state
  const [nt, setNt] = useState({
    template_code: '',
    template_name: '',
    description: '',
    resolution_type: 'full_list',
    parent_template_id: '',
    match_lob: '',
    match_policy_type: '',
    match_portfolio: '',
    match_client: '',
    priority: 200,
    branching_enabled: false,
    subtasks_enabled: false,
    time_rules_enabled: false,
    is_active: true,
  });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch('/api/lifecycle/templates', { cache: 'no-store' });
      const data = await res.json();
      setTemplates(Array.isArray(data?.templates) ? data.templates : Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); setTemplates([]); }
    finally { setLoading(false); }
  }

  function showAlertMsg(msg, type = 'success') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  }

  async function createTemplate() {
    if (!nt.template_code.trim() || !nt.template_name.trim()) {
      showAlertMsg('template_code and template_name are required', 'error');
      return;
    }
    try {
      const payload = { ...nt, created_by: user?.email || null };
      if (!payload.parent_template_id) delete payload.parent_template_id;
      if (!payload.match_lob) delete payload.match_lob;
      if (!payload.match_policy_type) delete payload.match_policy_type;
      if (!payload.match_portfolio) delete payload.match_portfolio;
      if (!payload.match_client) delete payload.match_client;
      const res = await fetch('/api/lifecycle/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      showAlertMsg(`Template ${nt.template_code} created`);
      setShowCreate(false);
      setNt({
        template_code: '', template_name: '', description: '',
        resolution_type: 'full_list', parent_template_id: '',
        match_lob: '', match_policy_type: '', match_portfolio: '', match_client: '',
        priority: 200,
        branching_enabled: false, subtasks_enabled: false, time_rules_enabled: false,
        is_active: true,
      });
      load();
    } catch (e) { showAlertMsg(e.message, 'error'); }
  }

  async function toggleActive(t) {
    try {
      const res = await fetch('/api/lifecycle/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, is_active: !t.is_active }),
      });
      if (!res.ok) throw new Error('Update failed');
      showAlertMsg(`${t.template_code} ${t.is_active ? 'deactivated' : 'activated'}`);
      load();
    } catch (e) { showAlertMsg(e.message, 'error'); }
  }

  const filtered = templates.filter(t => {
    if (filterLob && t.match_lob !== filterLob) return false;
    if (filterActive === 'active'   && !t.is_active) return false;
    if (filterActive === 'inactive' && t.is_active)  return false;
    return true;
  });

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <h2>Lifecycle Templates</h2>
          <p style={{ padding: 40, textAlign: 'center', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>
            Admin access required. Templates are only editable by administrators.
          </p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Lifecycle Templates <span style={{ fontSize: 11, background: '#7c3aed', color: '#fff', padding: '2px 8px', borderRadius: 10, marginLeft: 8, verticalAlign: 'middle' }}>ADMIN</span></h2>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Define lifecycle templates per LOB / portfolio / client. Enable feature toggles here to decide what's passed on to other users.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary" onClick={() => router.push('/lifecycle-templates/items-catalog')}>Item Catalog</button>
            <button className="success" onClick={() => setShowCreate(s => !s)}>
              {showCreate ? '- Cancel' : '+ New Template'}
            </button>
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <div style={{ marginTop: 16, padding: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <h4 style={{ marginBottom: 12 }}>Create new template</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <Field label="Template code *" hint="short_snake_case, unique">
                <input value={nt.template_code} onChange={e => setNt({ ...nt, template_code: e.target.value.trim() })} />
              </Field>
              <Field label="Template name *">
                <input value={nt.template_name} onChange={e => setNt({ ...nt, template_name: e.target.value })} />
              </Field>
              <Field label="Resolution type">
                <select value={nt.resolution_type} onChange={e => setNt({ ...nt, resolution_type: e.target.value })}>
                  {RESOLUTION_TYPES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </Field>
              <Field label="Parent template (for override)">
                <select value={nt.parent_template_id} onChange={e => setNt({ ...nt, parent_template_id: e.target.value })}>
                  <option value="">(none)</option>
                  {templates.filter(t => t.resolution_type === 'full_list').map(t => (
                    <option key={t.id} value={t.id}>{t.template_code} — {t.template_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Match LOB">
                <select value={nt.match_lob} onChange={e => setNt({ ...nt, match_lob: e.target.value })}>
                  <option value="">Any LOB</option>
                  {(LOB_LIST || []).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Match policy type"><input value={nt.match_policy_type} onChange={e => setNt({ ...nt, match_policy_type: e.target.value })} /></Field>
              <Field label="Match portfolio"><input value={nt.match_portfolio} onChange={e => setNt({ ...nt, match_portfolio: e.target.value })} /></Field>
              <Field label="Match client"><input value={nt.match_client} onChange={e => setNt({ ...nt, match_client: e.target.value })} /></Field>
              <Field label="Priority (higher = wins tie)"><input type="number" value={nt.priority} onChange={e => setNt({ ...nt, priority: parseInt(e.target.value, 10) || 0 })} /></Field>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14, padding: 10, background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, width: '100%', marginBottom: 4 }}>Feature toggles — decide what's enabled for claims using this template:</div>
              <label style={{ fontSize: 13 }}>
                <input type="checkbox" checked={nt.branching_enabled} onChange={e => setNt({ ...nt, branching_enabled: e.target.checked })} /> Branching rules
              </label>
              <label style={{ fontSize: 13 }}>
                <input type="checkbox" checked={nt.subtasks_enabled} onChange={e => setNt({ ...nt, subtasks_enabled: e.target.checked })} /> Sub-tasks per stage
              </label>
              <label style={{ fontSize: 13 }}>
                <input type="checkbox" checked={nt.time_rules_enabled} onChange={e => setNt({ ...nt, time_rules_enabled: e.target.checked })} /> Time-based validity rules
              </label>
              <label style={{ fontSize: 13, marginLeft: 'auto' }}>
                <input type="checkbox" checked={nt.is_active} onChange={e => setNt({ ...nt, is_active: e.target.checked })} /> Active / published
              </label>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="success" onClick={createTemplate}>Create template</button>
              <button className="secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ marginTop: 20, padding: 10, background: '#f1f5f9', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12 }}>
            LOB:&nbsp;
            <select value={filterLob} onChange={e => setFilterLob(e.target.value)}>
              <option value="">All</option>
              {(LOB_LIST || []).map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Status:&nbsp;
            <select value={filterActive} onChange={e => setFilterActive(e.target.value)}>
              <option value="all">All</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>{filtered.length} of {templates.length} templates</span>
        </div>

        {/* Templates table */}
        <div style={{ marginTop: 14 }}>
          {loading ? (
            <p style={{ padding: 40, textAlign: 'center' }}>Loading templates...</p>
          ) : filtered.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', color: '#999' }}>No templates match the current filter.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="mis-table" style={{ minWidth: 1100 }}>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Parent</th>
                    <th>Match</th>
                    <th>Flags</th>
                    <th>Priority</th>
                    <th>Ver</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const parent = templates.find(x => x.id === t.parent_template_id);
                    const flagChips = [];
                    if (t.branching_enabled)  flagChips.push('B');
                    if (t.subtasks_enabled)   flagChips.push('S');
                    if (t.time_rules_enabled) flagChips.push('T');
                    return (
                      <tr key={t.id} style={{ background: t.is_active ? undefined : '#fafafa', color: t.is_active ? undefined : '#94a3b8' }}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#7c3aed' }}>{t.template_code}</td>
                        <td>{t.template_name}</td>
                        <td style={{ fontSize: 11 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 10, background: t.resolution_type === 'full_list' ? '#dbeafe' : '#fef3c7', color: t.resolution_type === 'full_list' ? '#1e40af' : '#92400e' }}>
                            {t.resolution_type}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: '#64748b' }}>{parent ? parent.template_code : '-'}</td>
                        <td style={{ fontSize: 11 }}>
                          {t.match_lob && <span style={{ marginRight: 4 }}>{t.match_lob}</span>}
                          {t.match_policy_type && <span style={{ fontSize: 10, color: '#64748b', marginRight: 4 }}>{t.match_policy_type}</span>}
                          {t.match_portfolio && <span style={{ fontSize: 10, color: '#64748b', marginRight: 4 }}>@{t.match_portfolio}</span>}
                          {t.match_client && <span style={{ fontSize: 10, color: '#64748b' }}>[{t.match_client}]</span>}
                          {!t.match_lob && !t.match_policy_type && !t.match_portfolio && !t.match_client && <span style={{ color: '#cbd5e1' }}>*</span>}
                        </td>
                        <td style={{ fontSize: 10, fontFamily: 'monospace' }} title="B=Branching, S=Subtasks, T=Time rules">
                          {flagChips.length > 0 ? flagChips.join(' ') : <span style={{ color: '#cbd5e1' }}>-</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>{t.priority}</td>
                        <td style={{ fontSize: 11, color: '#64748b' }}>v{t.version}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: t.is_active ? '#dcfce7' : '#f1f5f9', color: t.is_active ? '#166534' : '#475569' }}>
                            {t.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="secondary" style={{ fontSize: 11, padding: '4px 8px', marginRight: 4 }} onClick={() => router.push(`/lifecycle-templates/${t.id}`)}>Edit</button>
                          <button className="secondary" style={{ fontSize: 11, padding: '4px 8px', color: t.is_active ? '#dc2626' : '#15803d' }} onClick={() => toggleActive(t)}>{t.is_active ? 'Deactivate' : 'Activate'}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: 30, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12 }}>
          <b>How this affects other users:</b> Only <b>Active</b> templates are candidates when the engine resolves a claim's lifecycle. Feature flags (Branching / Subtasks / Time rules) are inherited by every claim using the template — this is how you control which capabilities downstream users see.
        </div>
      </div>
    </PageLayout>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 4 }}>
        {label} {hint && <span style={{ fontWeight: 400, color: '#94a3b8' }}>({hint})</span>}
      </div>
      {children}
    </label>
  );
}
