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
          date_intimation: claim?.date_intimation,
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
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{claim?.date_intimation || '-'}</div>
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
      </div>
    </PageLayout>
  );
}
