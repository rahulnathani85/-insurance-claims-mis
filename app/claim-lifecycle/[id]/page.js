'use client';
// =============================================================================
// /claim-lifecycle/[id]
// =============================================================================
// Per-claim lifecycle view. Runs EXCLUSIVELY on the Lifecycle Engine.
//
// Legacy systems (22-stage IRDAI workflow, 9-stage pipeline, 8-stage EW model,
// file-tracking) have been retired — their UI used to live here and is gone.
// Historical data from claim_workflow / claim_stages lives in *_archive tables
// but is not rendered.
//
// States:
//   loading                          → spinner
//   has lifecycle                    → engine summary + 7-phase stepper + stages table
//   no lifecycle + admin             → attach panel (template picker + legacy clear)
//   no lifecycle + non-admin         → info strip ("ask admin to attach")
// =============================================================================

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

export default function ClaimLifecycleDetail() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const claimId = params.id;

  const [claim, setClaim] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadClaim(); /* eslint-disable-next-line */ }, [claimId]);

  async function loadClaim() {
    try {
      setLoading(true);
      const res = await fetch(`/api/claims/${claimId}`);
      const data = await res.json().catch(() => null);
      setClaim(data || null);
    } catch (e) { console.error(e); setClaim(null); }
    finally { setLoading(false); }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="main-content">
          <div className="loading">Loading claim lifecycle...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content">
        {/* Claim Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>📋</span>
              Claim Lifecycle: {claim?.ref_number || `Claim #${claimId}`}
            </h2>
            <p style={{ color: '#6b7280', margin: '5px 0 0', fontSize: 14 }}>
              {claim?.insured_name || ''}{claim?.insurer_name ? ` | ${claim.insurer_name}` : ''}{claim?.lob ? ` | ${claim.lob}` : ''}
              {claim?.broker_name ? ` | Broker: ${claim.broker_name}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="secondary" onClick={() => router.back()} style={{ fontSize: 12 }}>Back</button>
          </div>
        </div>

        {/* Lifecycle Engine view — this is the only claim-progress UI now */}
        <LifecycleEngineBanner claimId={claimId} claim={claim} user={user} />
      </div>
    </PageLayout>
  );
}

// =============================================================================
// LifecycleEngineBanner — shows on top of every /claim-lifecycle/[id] page.
// - If a lifecycle is attached → summary card + 7-phase stepper + stages table
// - If NOT attached AND admin → attach panel (template picker + "clear legacy")
// - If NOT attached AND non-admin → info strip
// =============================================================================
function LifecycleEngineBanner({ claimId, claim, user }) {
  const isAdmin = user?.role === 'Admin';
  const [engineLoading, setEngineLoading] = useState(true);
  const [lifecycle, setLifecycle] = useState(null);
  const [phases, setPhases] = useState([]);
  const [stages, setStages] = useState([]);
  const [openItems, setOpenItems] = useState(0);
  const [templates, setTemplates] = useState([]);
  const [selectedTplId, setSelectedTplId] = useState('');
  const [clearLegacy, setClearLegacy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!claimId) return;
    loadEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  async function loadEngine() {
    try {
      setEngineLoading(true);
      const res = await fetch(`/api/lifecycle/${encodeURIComponent(claimId)}?by=claim_id`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data?.lifecycle) {
          setLifecycle(data.lifecycle);
          setPhases(Array.isArray(data.phases) ? data.phases : []);
          setStages(Array.isArray(data.stages) ? data.stages : []);
          setOpenItems(Array.isArray(data.items) ? data.items.filter(i => i.status === 'open').length : (data.open_items_count || 0));
        } else {
          setLifecycle(null);
        }
      } else {
        setLifecycle(null);
      }
    } catch (e) { setLifecycle(null); }
    finally { setEngineLoading(false); }
  }

  async function loadTemplates() {
    try {
      const res = await fetch('/api/lifecycle/templates?is_active=true', { cache: 'no-store' });
      const data = await res.json();
      setTemplates(Array.isArray(data?.templates) ? data.templates : Array.isArray(data) ? data : []);
    } catch (e) { setTemplates([]); }
  }

  useEffect(() => {
    if (!lifecycle && isAdmin) loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycle, isAdmin]);

  async function attach() {
    if (!selectedTplId) { setMsg({ type: 'error', text: 'Pick a template first' }); return; }
    if (!confirm(`Attach this template to ${claim?.ref_number || 'this claim'}${clearLegacy ? ' AND remove its legacy stage data' : ''}? This is per-file and only affects this claim.`)) return;
    try {
      setAttaching(true); setMsg(null);
      const res = await fetch('/api/lifecycle/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: parseInt(claimId, 10),
          template_id: parseInt(selectedTplId, 10),
          clear_legacy: clearLegacy,
          user_email: user?.email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Attach failed');
      setMsg({ type: 'success', text: `Attached. ${data.stages_materialised} stages, ${data.items_seeded} items seeded.${clearLegacy ? ` Legacy cleared: ${JSON.stringify(data.legacy_cleared)}` : ''}` });
      loadEngine();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setAttaching(false);
    }
  }

  async function detach() {
    if (!lifecycle) return;
    if (!confirm('Detach the lifecycle? This deletes the lifecycle row, its phases, stages, items, and history. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/lifecycle/attach?lifecycle_id=${lifecycle.id}&user_email=${encodeURIComponent(user?.email || '')}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Detach failed');
      }
      setMsg({ type: 'success', text: 'Lifecycle detached.' });
      setLifecycle(null); setPhases([]); setStages([]); setOpenItems(0);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  }

  if (engineLoading) return null;

  // --- Attached: show full engine view ---
  if (lifecycle) {
    const activeStage = stages.find(s => s.status === 'active');
    const completedStages = stages.filter(s => s.status === 'completed').length;
    const phaseLabels = ['Appointment', 'Survey & Inspection', 'ILA & LOR', 'Pending Requirements', 'Assessment', 'Report', 'Delivery'];
    return (
      <div>
        {/* Summary card */}
        <div style={{ marginBottom: 14, padding: 14, background: 'linear-gradient(90deg, #ede9fe, #e0e7ff)', border: '1px solid #c4b5fd', borderRadius: 10 }}>
          {msg && <div style={{ marginBottom: 8, padding: 6, background: msg.type === 'error' ? '#fee2e2' : '#dcfce7', color: msg.type === 'error' ? '#991b1b' : '#166534', borderRadius: 6, fontSize: 12 }}>{msg.text}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#7c3aed', padding: '3px 10px', borderRadius: 12 }}>LIFECYCLE ENGINE</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#3b0764' }}>{claim?.ref_number || `Claim #${claimId}`}</div>
              <div style={{ fontSize: 11, color: '#6b21a8' }}>Template #{lifecycle.template_id} · v{lifecycle.template_version_at_resolve} · Phase {lifecycle.current_phase}/7 · FSR v{lifecycle.fsr_version}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
              <Stat label="Stages done" value={`${completedStages}/${stages.length}`} />
              <Stat label="Current stage" value={activeStage?.stage_name || '—'} />
              <Stat label="Open items" value={openItems} colour={openItems > 0 ? '#dc2626' : '#15803d'} />
              {isAdmin && (
                <button className="secondary" style={{ fontSize: 11, padding: '4px 10px', color: '#dc2626' }} onClick={detach}>Detach</button>
              )}
            </div>
          </div>
        </div>

        {/* 7-phase stepper */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, overflowX: 'auto' }}>
          {phaseLabels.map((pl, idx) => {
            const phaseNum = idx + 1;
            const phase = phases.find(p => p.universal_phase === phaseNum);
            const status = phase?.status || 'not_started';
            const colour = status === 'complete' || status === 'auto_complete' ? '#15803d' : status === 'active' ? '#7c3aed' : '#94a3b8';
            const bg = status === 'complete' || status === 'auto_complete' ? '#dcfce7' : status === 'active' ? '#ede9fe' : '#f1f5f9';
            return (
              <div key={phaseNum} style={{ flex: 1, minWidth: 110, padding: 8, background: bg, border: `1px solid ${colour}33`, borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: colour, fontWeight: 700 }}>PHASE {phaseNum}</div>
                <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>{pl}</div>
                <div style={{ fontSize: 9, color: colour, marginTop: 2, textTransform: 'uppercase' }}>{status.replace('_', ' ')}</div>
              </div>
            );
          })}
        </div>

        {/* Stages table */}
        {stages.length > 0 && (
          <div style={{ marginBottom: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: '#f1f5f9', fontWeight: 600, fontSize: 12 }}>Stages ({stages.length})</div>
            <table className="mis-table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Phase</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>Due (firm)</th>
                  <th>Due (insurer)</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {stages.sort((a, b) => a.sequence_number - b.sequence_number).map(s => {
                  const stColour = s.status === 'completed' ? '#15803d' : s.status === 'active' ? '#7c3aed' : s.status === 'skipped' ? '#94a3b8' : '#64748b';
                  const stBg     = s.status === 'completed' ? '#dcfce7' : s.status === 'active' ? '#ede9fe' : '#f1f5f9';
                  return (
                    <tr key={s.id} style={{ background: s.status === 'active' ? '#fefce8' : undefined }}>
                      <td>{s.sequence_number}</td>
                      <td>P{s.universal_phase}</td>
                      <td><span style={{ fontFamily: 'monospace', color: '#7c3aed', fontSize: 11 }}>{s.stage_code}</span> · {s.stage_name}</td>
                      <td><span style={{ padding: '1px 6px', borderRadius: 6, background: stBg, color: stColour, fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{s.status}</span></td>
                      <td style={{ fontSize: 11 }}>{s.due_by_firm ? new Date(s.due_by_firm).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{s.due_by_insurer ? new Date(s.due_by_insurer).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{s.completed_at ? new Date(s.completed_at).toLocaleDateString('en-IN') : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // --- NOT attached, non-admin: info strip ---
  if (!isAdmin) {
    return (
      <div style={{ marginTop: 30, padding: 20, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 13, color: '#475569', textAlign: 'center' }}>
        No lifecycle has been attached to this claim yet. Ask an admin to assign a lifecycle template to this file before progress can be tracked.
      </div>
    );
  }

  // --- NOT attached, admin: attach panel ---
  return (
    <div style={{ marginTop: 20, padding: 18, background: '#fffbeb', border: '1px dashed #fbbf24', borderRadius: 10 }}>
      {msg && <div style={{ marginBottom: 10, padding: 8, background: msg.type === 'error' ? '#fee2e2' : '#dcfce7', color: msg.type === 'error' ? '#991b1b' : '#166534', borderRadius: 6, fontSize: 12 }}>{msg.text}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#d97706', padding: '3px 10px', borderRadius: 12 }}>ADMIN · LIFECYCLE ENGINE</div>
        <div style={{ fontSize: 13, color: '#78350f' }}>
          No lifecycle is attached to this claim yet. Pick a template below to start tracking progress.
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <select value={selectedTplId} onChange={e => setSelectedTplId(e.target.value)} style={{ minWidth: 320 }}>
          <option value="">-- pick a lifecycle template --</option>
          {templates.filter(t => t.is_active).map(t => (
            <option key={t.id} value={t.id}>
              {t.template_code} — {t.template_name}{t.match_lob ? ` (${t.match_lob}` : ''}{t.match_portfolio ? `, ${t.match_portfolio}` : ''}{t.match_client ? `, ${t.match_client}` : ''}{t.match_lob ? ')' : ''}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, background: '#fee2e2', padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5' }}>
          <input type="checkbox" checked={clearLegacy} onChange={e => setClearLegacy(e.target.checked)} />
          Remove archived legacy stage data for <b>THIS file only</b>
        </label>
        <button className="success" disabled={attaching || !selectedTplId} onClick={attach}>
          {attaching ? 'Attaching...' : 'Attach lifecycle to this file'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#92400e', marginTop: 10 }}>
        The "Remove archived legacy stage data" option deletes this claim's rows from the retired <code>claim_workflow_archive</code> / <code>claim_stages_archive</code> / <code>claim_workflow_history_archive</code> tables. Use it for a clean cut-over. Other claims are untouched.
      </div>
    </div>
  );
}

function Stat({ label, value, colour }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: colour || '#3b0764' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6b21a8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}
