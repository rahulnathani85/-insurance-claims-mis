'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { LOB_LIST } from '@/lib/constants';

// Bulk-attach lifecycle template to multiple claim files in one go.
// Admin-only. Works for both classic claims (claims.id) and EW claims (ew_vehicle_claims.id).
// Calls /api/lifecycle/attach once per selected claim, sequentially, with the
// same template and the same clear_legacy flag.

export default function LifecycleBulkAttach() {
  const router = useRouter();
  const { user } = useAuth();
  const { company } = useCompany();
  const isAdmin = user?.role === 'Admin';

  const [source, setSource] = useState('claims'); // 'claims' | 'ew'
  const [lob, setLob] = useState('');
  const [search, setSearch] = useState('');
  const [onlyWithoutLifecycle, setOnlyWithoutLifecycle] = useState(true);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [clearLegacy, setClearLegacy] = useState(false);
  const [selected, setSelected] = useState({}); // { id: true }
  const [progress, setProgress] = useState(null); // { total, done, errors }
  const [log, setLog] = useState([]);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    fetch('/api/lifecycle/templates?is_active=true')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setTemplates([]); return; }
        const list = Array.isArray(data?.templates) ? data.templates : Array.isArray(data) ? data : [];
        setTemplates(list.filter(t => t.is_active));
      })
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => { loadClaims(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source, company]);

  async function loadClaims() {
    try {
      setLoading(true);
      setSelected({});
      const url = source === 'ew'
        ? `/api/ew-claims?company=${encodeURIComponent(company || 'NISLA')}&t=${Date.now()}`
        : `/api/claims?company=${encodeURIComponent(company || 'NISLA')}&t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); setClaims([]); }
    finally { setLoading(false); }
  }

  const filteredTemplates = useMemo(() => {
    if (source === 'ew') return templates.filter(t => !t.match_lob || t.match_lob === 'Extended Warranty');
    if (lob) return templates.filter(t => !t.match_lob || t.match_lob === lob);
    return templates;
  }, [templates, source, lob]);

  const filteredClaims = useMemo(() => {
    return claims.filter(c => {
      if (onlyWithoutLifecycle && c.uses_lifecycle_engine) return false;
      if (source === 'claims' && lob && c.lob !== lob) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [c.ref_number, c.insured_name, c.customer_name, c.vehicle_reg_no, c.chassis_number, c.claim_file_no].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [claims, onlyWithoutLifecycle, lob, search, source]);

  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const selectedCount = selectedIds.length;

  function toggleAll(on) {
    const map = {};
    if (on) filteredClaims.forEach(c => { map[c.id] = true; });
    setSelected(map);
  }

  function showAlertMsg(msg, type = 'success') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  async function runBulk() {
    if (!templateId) { showAlertMsg('Pick a lifecycle template first', 'error'); return; }
    if (selectedCount === 0) { showAlertMsg('Select at least one claim', 'error'); return; }

    const confirmText = `Attach template to ${selectedCount} ${source === 'ew' ? 'EW ' : ''}claim(s)?${clearLegacy ? '\n\nThis WILL remove legacy stage data for each of those files.' : ''}`;
    if (!confirm(confirmText)) return;

    setProgress({ total: selectedCount, done: 0, errors: 0 });
    setLog([]);

    const body = (claimId) => source === 'ew'
      ? { ew_claim_id: claimId, template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email }
      : { claim_id: parseInt(claimId, 10), template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email };

    let done = 0, errors = 0;
    const logRows = [];
    for (const id of selectedIds) {
      try {
        const res = await fetch('/api/lifecycle/attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body(id)),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'attach failed');
        done += 1;
        const claim = claims.find(c => String(c.id) === String(id));
        logRows.push({ id, ref: claim?.ref_number || id, ok: true, detail: `${data.stages_materialised || 0} stages, ${data.items_seeded || 0} items` });
      } catch (e) {
        errors += 1;
        const claim = claims.find(c => String(c.id) === String(id));
        logRows.push({ id, ref: claim?.ref_number || id, ok: false, detail: e.message });
      }
      setProgress({ total: selectedCount, done: done + errors, errors });
      setLog([...logRows]);
    }
    showAlertMsg(`Bulk attach complete: ${done} ok, ${errors} failed`, errors > 0 ? 'error' : 'success');
    // Refresh claims so uses_lifecycle_engine reflects
    loadClaims();
  }

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <h2>Bulk Attach Lifecycle</h2>
          <p style={{ padding: 40, textAlign: 'center', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>Admin access required.</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="secondary" style={{ fontSize: 12 }} onClick={() => router.push('/lifecycle-templates')}>&larr; Templates</button>
          <h2 style={{ margin: 0 }}>Bulk Attach Lifecycle <span style={{ fontSize: 11, background: '#7c3aed', color: '#fff', padding: '2px 8px', borderRadius: 10, marginLeft: 8, verticalAlign: 'middle' }}>ADMIN</span></h2>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          Apply the same lifecycle template to multiple existing claim files in one go. Each file is attached individually — if one fails, the rest continue.
        </p>

        {/* Source picker + template picker */}
        <div style={{ marginTop: 14, padding: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <Field label="Claim source">
              <select value={source} onChange={e => { setSource(e.target.value); setTemplateId(''); }}>
                <option value="claims">Main Claims (all LOBs)</option>
                <option value="ew">Extended Warranty</option>
              </select>
            </Field>
            {source === 'claims' && (
              <Field label="Filter by LOB">
                <select value={lob} onChange={e => setLob(e.target.value)}>
                  <option value="">All LOBs</option>
                  {(LOB_LIST || []).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            )}
            <Field label="Lifecycle template to attach *">
              <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">-- pick a template --</option>
                {filteredTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.template_code} — {t.template_name}
                    {t.match_portfolio ? ` (${t.match_portfolio})` : ''}
                    {t.match_client ? ` [${t.match_client}]` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Search (ref / name / reg / chassis)">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="type to filter..." />
            </Field>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={onlyWithoutLifecycle} onChange={e => setOnlyWithoutLifecycle(e.target.checked)} /> Only show claims without a lifecycle attached
            </label>
            <label style={{ fontSize: 13, background: '#fee2e2', padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5' }}>
              <input type="checkbox" checked={clearLegacy} onChange={e => setClearLegacy(e.target.checked)} /> Remove legacy stage data for each selected file
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>
              {filteredClaims.length} candidate file(s) · {selectedCount} selected
            </span>
          </div>
        </div>

        {/* Action bar */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="secondary" onClick={() => toggleAll(true)}>Select all visible</button>
          <button className="secondary" onClick={() => toggleAll(false)}>Clear selection</button>
          <span style={{ flex: 1 }} />
          <button className="success" onClick={runBulk} disabled={!templateId || selectedCount === 0 || !!progress}>
            {progress ? `Working ${progress.done}/${progress.total}...` : `Attach to ${selectedCount} file(s)`}
          </button>
        </div>

        {/* Progress */}
        {progress && (
          <div style={{ marginTop: 10, padding: 10, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe', fontSize: 12 }}>
            <div style={{ fontWeight: 600 }}>
              Progress: {progress.done}/{progress.total}  {progress.errors > 0 && <span style={{ color: '#dc2626' }}>· {progress.errors} error(s)</span>}
            </div>
            <div style={{ height: 6, background: '#dbeafe', borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(progress.done / progress.total) * 100}%`, background: progress.errors > 0 ? '#dc2626' : '#2563eb', transition: 'width 0.2s' }} />
            </div>
          </div>
        )}

        {/* Claims list */}
        <div style={{ marginTop: 14 }}>
          {loading ? (
            <p style={{ padding: 40, textAlign: 'center' }}>Loading claims...</p>
          ) : filteredClaims.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', color: '#999' }}>No claims match the current filter.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="mis-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input type="checkbox"
                        checked={selectedCount > 0 && selectedCount === filteredClaims.length}
                        onChange={e => toggleAll(e.target.checked)}
                      />
                    </th>
                    <th>Ref No</th>
                    {source === 'claims' && <th>LOB</th>}
                    <th>{source === 'ew' ? 'Customer / Insured' : 'Insured Name'}</th>
                    <th>Insurer</th>
                    {source === 'ew' && <th>Reg No</th>}
                    {source === 'ew' && <th>Chassis</th>}
                    <th>Current</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map(c => {
                    const checked = Boolean(selected[c.id]);
                    const alreadyOnEngine = c.uses_lifecycle_engine;
                    return (
                      <tr key={c.id} style={{ background: alreadyOnEngine ? '#f1f5f9' : checked ? '#ede9fe' : undefined, color: alreadyOnEngine ? '#94a3b8' : undefined }}>
                        <td>
                          <input type="checkbox"
                            disabled={alreadyOnEngine}
                            checked={checked}
                            onChange={e => setSelected({ ...selected, [c.id]: e.target.checked })}
                          />
                        </td>
                        <td style={{ fontWeight: 600, color: alreadyOnEngine ? '#94a3b8' : '#7c3aed' }}>{c.ref_number || `#${c.id}`}</td>
                        {source === 'claims' && <td>{c.lob || '-'}</td>}
                        <td>{c.insured_name || c.customer_name || '-'}</td>
                        <td>{c.insurer_name || '-'}</td>
                        {source === 'ew' && <td style={{ fontFamily: 'monospace' }}>{c.vehicle_reg_no || '-'}</td>}
                        {source === 'ew' && <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.chassis_number || '-'}</td>}
                        <td>
                          {alreadyOnEngine
                            ? <span style={{ padding: '1px 6px', fontSize: 10, background: '#dcfce7', color: '#166534', borderRadius: 6 }}>on engine</span>
                            : <span style={{ padding: '1px 6px', fontSize: 10, background: '#fef3c7', color: '#92400e', borderRadius: 6 }}>legacy</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Log */}
        {log.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h4>Results</h4>
            <table className="mis-table" style={{ fontSize: 11 }}>
              <thead><tr><th>Ref</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {log.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.ref}</td>
                    <td>
                      <span style={{ padding: '1px 6px', fontSize: 10, borderRadius: 6, background: l.ok ? '#dcfce7' : '#fee2e2', color: l.ok ? '#166534' : '#991b1b' }}>
                        {l.ok ? 'OK' : 'FAIL'}
                      </span>
                    </td>
                    <td style={{ color: l.ok ? '#475569' : '#991b1b' }}>{l.detail}</td>
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
