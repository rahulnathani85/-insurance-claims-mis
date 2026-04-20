'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';

const STATUS_STYLES = {
  'Completed': { bg: '#dcfce7', color: '#166534', icon: '✅' },
  'In Progress': { bg: '#fef3c7', color: '#92400e', icon: '🔄' },
  'Pending': { bg: '#f3f4f6', color: '#6b7280', icon: '⏳' },
  'Skipped': { bg: '#f1f5f9', color: '#94a3b8', icon: '⏭️' },
};

export default function ClaimLifecycleDetail() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { company } = useCompany();
  const claimId = params.id;

  const [claim, setClaim] = useState(null);
  const [workflow, setWorkflow] = useState([]);
  const [history, setHistory] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [expandedStage, setExpandedStage] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [assignUser, setAssignUser] = useState('');
  // Workflow init form
  const [initFileHandler, setInitFileHandler] = useState('');
  const [initSurveyType, setInitSurveyType] = useState('');
  const [initSurveyorName, setInitSurveyorName] = useState('');
  const [initPanIndia, setInitPanIndia] = useState('');
  const [surveyors, setSurveyors] = useState([]);

  // New lifecycle engine — whether this claim has a lifecycle attached.
  // If true, we skip the legacy workflow UI entirely and let the engine banner
  // + engine view take over. (Set by LifecycleEngineBanner via callback.)
  const [engineAttached, setEngineAttached] = useState(null); // null = not-yet-known, true/false when known

  useEffect(() => { loadAll(); }, [claimId]);

  async function loadAll() {
    try {
      setLoading(true);
      const [c, w, h, u, sv] = await Promise.all([
        fetch(`/api/claims/${claimId}`).then(r => r.json()),
        fetch(`/api/claim-workflow?claim_id=${claimId}`).then(r => r.json()),
        fetch(`/api/claim-workflow-history?claim_id=${claimId}`).then(r => r.json()),
        fetch('/api/auth/users').then(r => r.json()),
        fetch('/api/surveyors').then(r => r.json()).catch(() => []),
      ]);
      setClaim(c);
      setWorkflow(Array.isArray(w) ? w : []);
      setHistory(Array.isArray(h) ? h : []);
      setUsers(Array.isArray(u) ? u.filter(u => u.is_active) : []);
      setSurveyors(Array.isArray(sv) ? sv : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // Initialize workflow if it doesn't exist
  async function initializeWorkflow() {
    if (!initFileHandler) {
      showAlertMsg('Please select a File Handler / Surveyor to supervise this claim', 'error');
      return;
    }
    try {
      const res = await fetch('/api/claim-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: parseInt(claimId),
          ref_number: claim?.ref_number,
          date_of_intimation: claim?.date_of_intimation,
          company: claim?.company || company,
          assigned_to: user?.email,
          assigned_by: user?.email,
          file_handler: initFileHandler,
          survey_type: initSurveyType,
          surveyor_name: initSurveyorName,
          pan_india_surveyor: initPanIndia,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      showAlertMsg('Workflow initialized with all 22 stages!', 'success');
      await loadAll();
    } catch (e) { showAlertMsg('Error: ' + e.message, 'error'); }
  }

  function showAlertMsg(msg, type) { setAlert({ msg, type }); setTimeout(() => setAlert(null), 5000); }

  async function updateStageStatus(stageId, newStatus, stage) {
    try {
      const res = await fetch(`/api/claim-workflow/${stageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          _log_action: 'status_change',
          _log_user_email: user?.email,
          _log_user_name: user?.name,
          _log_details: `Changed status of "${stage.stage_name}" to ${newStatus}`,
          _log_old_value: stage.status,
          _log_new_value: newStatus,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      showAlertMsg(`Stage "${stage.stage_name}" marked as ${newStatus}`, 'success');
      await loadAll();
    } catch (e) { showAlertMsg('Error: ' + e.message, 'error'); }
  }

  async function assignStage(stageId, stage) {
    if (!assignUser) return;
    try {
      const res = await fetch(`/api/claim-workflow/${stageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to: assignUser,
          assigned_by: user?.email,
          _log_action: 'assign',
          _log_user_email: user?.email,
          _log_user_name: user?.name,
          _log_details: `Assigned "${stage.stage_name}" to ${assignUser}`,
          _log_old_value: stage.assigned_to,
          _log_new_value: assignUser,
        }),
      });
      if (!res.ok) throw new Error('Failed to assign');
      showAlertMsg(`Assigned to ${users.find(u => u.email === assignUser)?.name || assignUser}`, 'success');
      setAssignUser('');
      await loadAll();
    } catch (e) { showAlertMsg('Error: ' + e.message, 'error'); }
  }

  async function addComment(stageId, stage) {
    if (!commentText.trim()) return;
    try {
      await fetch('/api/claim-workflow-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: stageId,
          claim_id: parseInt(claimId),
          action: 'comment',
          user_email: user?.email,
          user_name: user?.name,
          details: commentText,
        }),
      });
      // Also update the stage comments
      await fetch(`/api/claim-workflow/${stageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: commentText }),
      });
      setCommentText('');
      showAlertMsg('Comment added', 'success');
      await loadAll();
    } catch (e) { showAlertMsg('Error: ' + e.message, 'error'); }
  }

  function isOverdue(stage) {
    if (stage.status === 'Completed' || stage.status === 'Skipped') return false;
    if (!stage.due_date) return false;
    return new Date() > new Date(stage.due_date);
  }

  const completedCount = workflow.filter(s => s.status === 'Completed').length;
  const breachedCount = workflow.filter(s => isOverdue(s)).length;
  const currentStage = workflow.find(s => s.status === 'In Progress') || workflow.find(s => s.status === 'Pending');

  if (loading) return <PageLayout><div className="main-content"><div className="loading">Loading claim lifecycle...</div></div></PageLayout>;

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        {/* --- NEW: Lifecycle Engine Banner (feature/lifecycle-engine) --- */}
        <LifecycleEngineBanner
          claimId={claimId}
          claim={claim}
          user={user}
          onAttachedChange={setEngineAttached}
        />

        {/* LEGACY UI: only rendered when no new-engine lifecycle is attached.
            Once admin attaches a lifecycle via the banner above, everything
            below is hidden and the claim runs entirely on the new engine. */}
        {engineAttached !== true && (
        <>
        {/* Claim Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>📋</span>
              Claim Lifecycle: {claim?.ref_number || `Claim #${claimId}`}
            </h2>
            <p style={{ color: '#6b7280', margin: '5px 0 0', fontSize: 14 }}>
              {claim?.insured_name || ''} | {claim?.insurer_name || ''} | {claim?.lob || ''}
              {claim?.broker_name ? ` | Broker: ${claim.broker_name}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="secondary" onClick={() => router.back()} style={{ fontSize: 12 }}>Back</button>
          </div>
        </div>

        {/* Progress Summary */}
        <div style={{ display: 'flex', gap: 15, marginBottom: 25, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150, padding: 15, background: '#eff6ff', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1e40af' }}>{completedCount}/{workflow.length}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Stages Completed</div>
          </div>
          <div style={{ flex: 1, minWidth: 150, padding: 15, background: breachedCount > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: breachedCount > 0 ? '#dc2626' : '#16a34a' }}>{breachedCount}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>TAT Breached</div>
          </div>
          <div style={{ flex: 1, minWidth: 150, padding: 15, background: '#fefce8', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#92400e' }}>{currentStage?.stage_name || 'All Done'}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Current Stage</div>
          </div>
          <div style={{ flex: 1, minWidth: 150, padding: 15, background: '#f8fafc', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{claim?.date_of_intimation || '-'}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Date of Intimation</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ height: 10, background: '#e5e7eb', borderRadius: 5, marginBottom: 30, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${workflow.length > 0 ? (completedCount / workflow.length) * 100 : 0}%`, background: 'linear-gradient(90deg, #22c55e, #16a34a)', borderRadius: 5, transition: 'width 0.5s' }} />
        </div>

        {workflow.length === 0 ? (
          <div style={{ maxWidth: 600, margin: '0 auto', padding: 30 }}>
            <h3 style={{ textAlign: 'center', marginBottom: 20 }}>Initialize Claim Lifecycle (22 Stages)</h3>

            {/* File Handler Selection */}
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <h4 style={{ margin: '0 0 12px', color: '#1e40af' }}>File Handler / Supervisor *</h4>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 10px' }}>Select who will handle and supervise this claim throughout its lifecycle</p>
              <select value={initFileHandler} onChange={e => setInitFileHandler(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }}>
                <option value="">-- Select File Handler --</option>
                {users.map(u => <option key={u.id} value={u.email}>{u.name} ({u.role})</option>)}
              </select>
            </div>

            {/* Survey Assignment */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <h4 style={{ margin: '0 0 12px', color: '#166534' }}>Survey Assignment (Stage 4)</h4>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Survey Type</label>
                <select value={initSurveyType} onChange={e => setInitSurveyType(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                  <option value="">-- Select Survey Type --</option>
                  <option value="Physical Survey">Physical Survey</option>
                  <option value="Virtual Survey">Virtual Survey</option>
                  <option value="Desktop Assessment">Desktop Assessment</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Surveyor Name</label>
                <select value={initSurveyorName} onChange={e => setInitSurveyorName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                  <option value="">-- Select Surveyor --</option>
                  {surveyors.map(s => <option key={s.id} value={s.name}>{s.name}{s.designation ? ` (${s.designation})` : ''}</option>)}
                  {users.filter(u => u.role === 'Surveyor').map(u => <option key={`u-${u.id}`} value={u.name}>{u.name} (Team)</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>NISLA PAN India Team (if applicable)</label>
                <input value={initPanIndia} onChange={e => setInitPanIndia(e.target.value)}
                  placeholder="Enter PAN India surveyor/team name"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            </div>

            <button className="success" onClick={initializeWorkflow} style={{ width: '100%', padding: '14px', fontSize: 15 }}>
              Start Claim Lifecycle
            </button>
          </div>
        ) : (
          /* Vertical Timeline */
          <div style={{ position: 'relative', paddingLeft: 40 }}>
            {/* Timeline line */}
            <div style={{ position: 'absolute', left: 18, top: 0, bottom: 0, width: 3, background: '#e5e7eb' }} />

            {workflow.map((stage, idx) => {
              const ss = STATUS_STYLES[stage.status] || STATUS_STYLES['Pending'];
              const overdue = isOverdue(stage);
              const isExpanded = expandedStage === stage.id;
              const stageHistory = history.filter(h => h.workflow_id === stage.id);
              const assignedUser = users.find(u => u.email === stage.assigned_to);

              return (
                <div key={stage.id} style={{ position: 'relative', marginBottom: 8 }}>
                  {/* Timeline dot */}
                  <div style={{
                    position: 'absolute', left: -31, top: 12, width: 24, height: 24,
                    borderRadius: '50%', background: overdue ? '#fef2f2' : ss.bg,
                    border: `3px solid ${overdue ? '#dc2626' : ss.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, zIndex: 1
                  }}>
                    {overdue ? '⚠️' : ss.icon}
                  </div>

                  {/* Stage Card */}
                  <div
                    onClick={() => setExpandedStage(isExpanded ? null : stage.id)}
                    style={{
                      background: overdue ? '#fff5f5' : '#fff',
                      border: `1px solid ${overdue ? '#fecaca' : '#e5e7eb'}`,
                      borderLeft: `4px solid ${overdue ? '#dc2626' : ss.color}`,
                      borderRadius: 8, padding: '12px 16px', cursor: 'pointer',
                      transition: 'box-shadow 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, minWidth: 25 }}>#{stage.stage_number}</span>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{stage.stage_name}</span>
                        {overdue && <span style={{ fontSize: 10, padding: '2px 8px', background: '#dc2626', color: '#fff', borderRadius: 10, fontWeight: 700 }}>TAT BREACHED</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {assignedUser && <span style={{ fontSize: 11, color: '#6b7280' }}>{assignedUser.name}</span>}
                        {stage.due_date && <span style={{ fontSize: 11, color: overdue ? '#dc2626' : '#9ca3af' }}>Due: {stage.due_date}</span>}
                        <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color }}>{stage.status}</span>
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {stage.comments && <p style={{ margin: '6px 0 0 37px', fontSize: 12, color: '#6b7280' }}>{stage.comments}</p>}
                  </div>

                  {/* Expanded Stage Details */}
                  {isExpanded && (
                    <div style={{ marginLeft: 0, marginTop: 4, background: '#fafbfc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
                      <div style={{ display: 'flex', gap: 15, flexWrap: 'wrap', marginBottom: 15 }}>
                        {/* Status buttons */}
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 5 }}>Update Status:</label>
                          <div style={{ display: 'flex', gap: 5 }}>
                            {['In Progress', 'Completed', 'Skipped'].map(s => (
                              <button key={s}
                                className={stage.status === s ? 'primary' : 'secondary'}
                                style={{ fontSize: 11, padding: '4px 10px' }}
                                onClick={e => { e.stopPropagation(); updateStageStatus(stage.id, s, stage); }}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Assign user */}
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 5 }}>Assign / Reassign:</label>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <select value={assignUser} onChange={e => setAssignUser(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
                              <option value="">-- Select --</option>
                              {users.map(u => <option key={u.id} value={u.email}>{u.name}</option>)}
                            </select>
                            <button className="success" style={{ fontSize: 11, padding: '4px 10px' }}
                              onClick={e => { e.stopPropagation(); assignStage(stage.id, stage); }}>Assign</button>
                          </div>
                        </div>
                      </div>

                      {/* Add comment */}
                      <div style={{ marginBottom: 15 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 5 }}>Add Comment / Progress Note:</label>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <input value={commentText} onChange={e => setCommentText(e.target.value)}
                            placeholder="Add a progress note or comment..." style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                            onClick={e => e.stopPropagation()} />
                          <button className="success" style={{ fontSize: 11, padding: '4px 12px' }}
                            onClick={e => { e.stopPropagation(); addComment(stage.id, stage); }}>Add</button>
                        </div>
                      </div>

                      {/* Stage info */}
                      <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#6b7280', marginBottom: 10, flexWrap: 'wrap' }}>
                        <span>TAT: {stage.tat_days !== null ? `${stage.tat_days} days` : 'No fixed TAT'}</span>
                        {stage.completed_date && <span>Completed: {new Date(stage.completed_date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                        {stage.assigned_to && <span>Assigned to: {assignedUser?.name || stage.assigned_to}</span>}
                      </div>

                      {/* Stage history */}
                      {stageHistory.length > 0 && (
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 5 }}>History:</label>
                          {stageHistory.map(h => (
                            <div key={h.id} style={{ padding: '4px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
                              <span style={{ fontWeight: 600 }}>{h.user_name || h.user_email}</span>
                              <span style={{ color: '#9ca3af' }}> — {h.action}: </span>
                              <span>{h.details}</span>
                              <span style={{ color: '#d1d5db', marginLeft: 8 }}>{new Date(h.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
        {/* END LEGACY UI */}
      </div>
    </PageLayout>
  );
}

// =============================================================================
// LifecycleEngineBanner — shows on top of every /claim-lifecycle/[id] page.
// - If a lifecycle is attached → summary card with phase / stages / open items
// - If NOT attached AND admin → attach panel (template picker + "clear legacy")
// - If NOT attached AND non-admin → info strip
// =============================================================================
function LifecycleEngineBanner({ claimId, claim, user, onAttachedChange }) {
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

  // Notify the parent page whenever we learn the lifecycle's presence, so it
  // can hide the legacy UI once a lifecycle is attached.
  useEffect(() => {
    if (typeof onAttachedChange === 'function') {
      onAttachedChange(Boolean(lifecycle));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycle]);

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
    if (!confirm('Detach the lifecycle? This deletes the lifecycle row, its phases, stages, items, and history. The claim reverts to using the old workflow. This cannot be undone.')) return;
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

        {/* Phase timeline */}
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
      <div style={{ marginBottom: 18, padding: 10, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12, color: '#475569' }}>
        No lifecycle engine attached. Ask an admin to assign a lifecycle template to this file.
      </div>
    );
  }

  // --- NOT attached, admin: attach panel ---
  return (
    <div style={{ marginBottom: 18, padding: 14, background: '#fffbeb', border: '1px dashed #fbbf24', borderRadius: 10 }}>
      {msg && <div style={{ marginBottom: 8, padding: 6, background: msg.type === 'error' ? '#fee2e2' : '#dcfce7', color: msg.type === 'error' ? '#991b1b' : '#166534', borderRadius: 6, fontSize: 12 }}>{msg.text}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#d97706', padding: '3px 10px', borderRadius: 12 }}>ADMIN · LIFECYCLE ENGINE</div>
        <div style={{ fontSize: 12, color: '#78350f' }}>
          This file is using the <b>legacy workflow</b>. Attach a modern lifecycle template to switch it over.
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
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
          Remove legacy stage data for <b>THIS file only</b>
        </label>
        <button className="success" disabled={attaching || !selectedTplId} onClick={attach}>
          {attaching ? 'Attaching...' : 'Attach lifecycle to this file'}
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#92400e', marginTop: 6 }}>
        The "Remove legacy stage data" option deletes old <code>claim_workflow</code>, <code>claim_stages</code>, and <code>claim_workflow_history</code> rows for this claim only. Other files are untouched. History for all other claims stays intact.
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
