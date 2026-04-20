'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST, LOB_COLORS, LOB_ICONS } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { getClaimTatDeadline, getTatBadge } from '@/lib/pipelineStages';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tatBreaches, setTatBreaches] = useState([]);
  const [myAssignments, setMyAssignments] = useState([]);
  const [myWorkflowItems, setMyWorkflowItems] = useState([]);
  const [expandedClaims, setExpandedClaims] = useState({});
  const [unreadMentions, setUnreadMentions] = useState([]);
  const [allClaims, setAllClaims] = useState([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [dashFilterLob, setDashFilterLob] = useState('');
  // dashFilterStage removed — 9-stage pipeline retired (see Lifecycle Engine)
  const [dashFilterStatus, setDashFilterStatus] = useState('');
  const router = useRouter();
  const { company } = useCompany();
  const { user } = useAuth();

  // Group workflow items by claim
  function groupByClaim(items) {
    const grouped = {};
    items.forEach(w => {
      const key = w.claim_id;
      if (!grouped[key]) {
        grouped[key] = {
          claim_id: w.claim_id,
          ref_number: w.ref_number || `Claim #${w.claim_id}`,
          stages: [],
          hasOverdue: false,
        };
      }
      const overdue = w.due_date && new Date() > new Date(w.due_date);
      if (overdue) grouped[key].hasOverdue = true;
      grouped[key].stages.push({ ...w, overdue });
    });
    // Sort stages within each claim by stage_number
    Object.values(grouped).forEach(g => {
      g.stages.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));
    });
    return Object.values(grouped);
  }

  function toggleClaim(claimId) {
    setExpandedClaims(prev => ({ ...prev, [claimId]: !prev[claimId] }));
  }

  useEffect(() => {
    loadStats();
    loadTatBreaches();
    loadAllClaims();
    if (user?.email) { loadMyAssignments(); loadUnreadMentions(); }
  }, [company, user]);

  async function loadAllClaims() {
    try {
      setClaimsLoading(true);
      const data = await fetch(`/api/claims?company=${encodeURIComponent(company)}`).then(r => r.json());
      setAllClaims(Array.isArray(data) ? data : []);
    } catch (e) { setAllClaims([]); }
    finally { setClaimsLoading(false); }
  }

  // updateClaimPipelineStage removed — the 9-stage pipeline has been retired.
  // Claim progress is now tracked via the Lifecycle Engine. Writes to the old
  // claim_stages table are blocked by DB triggers (see migration 001).

  async function loadStats() {
    try {
      setLoading(true);
      const res = await fetch(`/api/dashboard-stats?company=${encodeURIComponent(company)}`);
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadMyAssignments() {
    try {
      const [assignments, workflowItems] = await Promise.all([
        fetch(`/api/claim-assignments?assigned_to=${encodeURIComponent(user.email)}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-workflow?company=${encodeURIComponent(company)}`).then(r => r.json()).catch(() => []),
      ]);
      setMyAssignments(Array.isArray(assignments) ? assignments.filter(a => a.status !== 'Completed') : []);
      setMyWorkflowItems(Array.isArray(workflowItems) ? workflowItems.filter(w => w.assigned_to === user.email && w.status !== 'Completed' && w.status !== 'Skipped') : []);
    } catch (e) { console.error(e); }
  }

  async function loadUnreadMentions() {
    try {
      const res = await fetch(`/api/unread-mentions?user_email=${encodeURIComponent(user.email)}&company=${encodeURIComponent(company)}`);
      const data = await res.json();
      setUnreadMentions(data.unread || []);
    } catch (e) { console.error(e); }
  }

  async function markMentionRead(messageId) {
    try {
      await fetch('/api/unread-mentions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user.email, message_id: messageId }),
      });
      setUnreadMentions(prev => prev.filter(m => m.id !== messageId));
    } catch (e) { console.error(e); }
  }

  async function loadTatBreaches() {
    try {
      const data = await fetch(`/api/claim-workflow?company=${encodeURIComponent(company)}`).then(r => r.json());
      if (Array.isArray(data)) {
        const breached = data.filter(w => {
          if (w.status === 'Completed' || w.status === 'Skipped') return false;
          if (!w.due_date) return false;
          return new Date() > new Date(w.due_date);
        });
        setTatBreaches(breached);
      }
    } catch (e) { console.error(e); }
  }

  return (
    <PageLayout>
      <div className="main-content">
        <h2>Dashboard</h2>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : stats ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 10 }}>
              {/* Row 1 */}
              <div className="stat-card" style={{ cursor: 'pointer', borderLeftColor: '#1e3a5f' }} onClick={() => router.push('/mis-portal')}>
                <div className="stat-label">Total Reported Claims</div>
                <div className="stat-value">{stats.total_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ cursor: 'pointer', borderLeftColor: '#f97316' }} onClick={() => router.push('/workflow-overview?filter=open')}>
                <div className="stat-label">Open Claims</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Survey work completed</div>
                <div className="stat-value">{stats.open_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ cursor: 'pointer', borderLeftColor: '#0284c7' }} onClick={() => router.push('/workflow-overview?filter=inprocess')}>
                <div className="stat-label">In Process</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>LOR / ILA sent</div>
                <div className="stat-value">{stats.in_process_claims || 0}</div>
              </div>
              {/* Row 2 */}
              <div className="stat-card" style={{ cursor: 'pointer', borderLeftColor: '#dc2626' }} onClick={() => router.push('/workflow-overview?filter=docspending')}>
                <div className="stat-label">Documents Pending</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Awaiting documents</div>
                <div className="stat-value" style={{ color: '#dc2626' }}>{stats.docs_pending || 0}</div>
              </div>
              <div className="stat-card" style={{ cursor: 'pointer', borderLeftColor: '#7c3aed' }} onClick={() => router.push('/workflow-overview?filter=assessment')}>
                <div className="stat-label">Assessment / Consent</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Assessment shared or consent received</div>
                <div className="stat-value" style={{ color: '#7c3aed' }}>{stats.assessment_shared || 0}</div>
              </div>
              <div className="stat-card" style={{ cursor: 'pointer', borderLeftColor: '#16a34a' }} onClick={() => router.push('/workflow-overview?filter=submitted')}>
                <div className="stat-label">Report Submitted</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Report dispatched</div>
                <div className="stat-value" style={{ color: '#16a34a' }}>{stats.report_submitted || 0}</div>
              </div>
            </div>

            {/* Unread @Mentions - Tagged Messages */}
            {unreadMentions.length > 0 && (
              <div style={{ marginTop: 20, marginBottom: 20 }}>
                <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>💬</span> You Were Tagged ({unreadMentions.length} unread)
                </h3>
                <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 10, overflow: 'hidden' }}>
                  {unreadMentions.slice(0, 8).map(msg => (
                    <div key={msg.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '12px 16px', borderBottom: '1px solid #bfdbfe', fontSize: 13,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: '#1e3a5f' }}>{msg.ref_number || `Claim #${msg.claim_id}`}</span>
                          <span style={{ fontSize: 11, color: '#6b7280' }}>from {msg.sender_name}</span>
                          <span style={{ fontSize: 10, color: '#9ca3af' }}>
                            {new Date(msg.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                          {msg.message_type === 'escalation' && <span style={{ padding: '1px 6px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>ESCALATION</span>}
                        </div>
                        <p style={{ margin: 0, color: '#374151', fontSize: 12 }}>
                          {msg.message.length > 120 ? msg.message.substring(0, 120) + '...' : msg.message}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
                        <button className="primary" style={{ fontSize: 10, padding: '4px 12px' }}
                          onClick={() => { markMentionRead(msg.id); router.push(`/claim-detail/${msg.claim_id}`); }}>
                          Open Chat
                        </button>
                        <button className="secondary" style={{ fontSize: 10, padding: '4px 8px' }}
                          onClick={() => markMentionRead(msg.id)}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                  {unreadMentions.length > 8 && (
                    <div style={{ padding: '8px 16px', textAlign: 'center', fontSize: 11, color: '#1e40af', cursor: 'pointer' }}>
                      + {unreadMentions.length - 8} more tagged messages
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* My Assigned Files - Personal Dashboard (Grouped by Claim) */}
            {(myAssignments.length > 0 || myWorkflowItems.length > 0) && (() => {
              const groupedClaims = groupByClaim(myWorkflowItems);
              const totalClaims = groupedClaims.length + (myAssignments.length > 0 ? [...new Set(myAssignments.map(a => a.claim_id))].length : 0);
              return (
              <div style={{ marginTop: 25, marginBottom: 25 }}>
                <h3 style={{ margin: '0 0 15px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>📌</span> My Assigned Files ({totalClaims} Claims, {myWorkflowItems.length + myAssignments.length} Pending Tasks)
                </h3>

                {/* Workflow items grouped by claim */}
                {groupedClaims.length > 0 && (
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 15, marginBottom: 12 }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#1e40af' }}>Workflow - Pending Stages ({myWorkflowItems.length} stages across {groupedClaims.length} claims)</h4>
                    {groupedClaims.map(group => {
                      const isExpanded = expandedClaims[group.claim_id];
                      return (
                        <div key={group.claim_id} style={{ marginBottom: 6, border: '1px solid #dbeafe', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                          {/* Claim header - click to expand */}
                          <div
                            onClick={() => toggleClaim(group.claim_id)}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                              background: isExpanded ? '#dbeafe' : '#f0f7ff',
                              transition: 'background 0.15s',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                              <span style={{ fontWeight: 700, color: '#1e3a5f' }}>{group.ref_number}</span>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>— {group.stages.length} pending stage{group.stages.length > 1 ? 's' : ''}</span>
                              {group.hasOverdue && (
                                <span style={{ padding: '1px 7px', background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>OVERDUE</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button className="primary" style={{ fontSize: 10, padding: '2px 10px' }}
                                onClick={(e) => { e.stopPropagation(); router.push(`/claim-lifecycle/${group.claim_id}`); }}>
                                Open Lifecycle
                              </button>
                            </div>
                          </div>

                          {/* Expanded stages */}
                          {isExpanded && (
                            <div style={{ padding: '0 14px 10px', background: '#fff' }}>
                              {group.stages.map((w, idx) => (
                                <div key={w.id} style={{
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  padding: '7px 0',
                                  borderBottom: idx < group.stages.length - 1 ? '1px solid #e5e7eb' : 'none',
                                  fontSize: 12,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                      width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      background: w.overdue ? '#fef2f2' : '#f0fdf4',
                                      color: w.overdue ? '#dc2626' : '#16a34a',
                                      fontSize: 10, fontWeight: 700, border: `1px solid ${w.overdue ? '#fecaca' : '#bbf7d0'}`,
                                    }}>
                                      {w.stage_number}
                                    </span>
                                    <span style={{ color: '#374151' }}>{w.stage_name}</span>
                                    <span style={{
                                      padding: '1px 6px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                                      background: w.status === 'In Progress' ? '#fef3c7' : '#e0e7ff',
                                      color: w.status === 'In Progress' ? '#92400e' : '#3730a3',
                                    }}>{w.status || 'Pending'}</span>
                                    {w.overdue && <span style={{ padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>OVERDUE</span>}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {w.due_date && <span style={{ color: w.overdue ? '#dc2626' : '#6b7280', fontSize: 11 }}>Due: {w.due_date}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* File assignments grouped by claim */}
                {myAssignments.length > 0 && (() => {
                  const assignmentGroups = {};
                  myAssignments.forEach(a => {
                    const key = a.claim_id;
                    if (!assignmentGroups[key]) {
                      assignmentGroups[key] = { claim_id: a.claim_id, items: [] };
                    }
                    assignmentGroups[key].items.push(a);
                  });
                  const groups = Object.values(assignmentGroups);
                  return (
                    <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: 15 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#92400e' }}>File Assignments ({myAssignments.length} across {groups.length} claims)</h4>
                      {groups.map(g => (
                        <div key={g.claim_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #fde68a', fontSize: 12 }}>
                          <div>
                            <span style={{ fontWeight: 600 }}>Claim #{g.claim_id}</span>
                            <span style={{ marginLeft: 8, color: '#6b7280' }}>{g.items.length} task{g.items.length > 1 ? 's' : ''}</span>
                            {g.items.some(a => a.due_date && new Date() > new Date(a.due_date)) && (
                              <span style={{ marginLeft: 6, padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>OVERDUE</span>
                            )}
                          </div>
                          <button className="primary" style={{ fontSize: 10, padding: '2px 8px' }}
                            onClick={() => router.push(`/claim-detail/${g.claim_id}`)}>Open</button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              );
            })()}

            {/* TAT Breach Alert Section */}
            {tatBreaches.length > 0 && (
              <div style={{ marginTop: 25, marginBottom: 25 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                  <h3 style={{ margin: 0, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>⚠️</span> TAT Breached ({tatBreaches.length})
                  </h3>
                  <button className="secondary" style={{ fontSize: 12 }} onClick={() => router.push('/workflow-overview')}>View All Workflows</button>
                </div>
                <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#fef2f2' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#991b1b' }}>Ref Number</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#991b1b' }}>Stage</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#991b1b' }}>Due Date</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#991b1b' }}>Overdue By</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#991b1b' }}>Assigned To</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: '#991b1b' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tatBreaches.slice(0, 10).map(b => {
                        const overdueDays = Math.ceil((new Date() - new Date(b.due_date)) / (1000 * 60 * 60 * 24));
                        return (
                          <tr key={b.id} style={{ borderBottom: '1px solid #fecaca' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{b.ref_number || `Claim #${b.claim_id}`}</td>
                            <td style={{ padding: '8px 12px' }}>{b.stage_name}</td>
                            <td style={{ padding: '8px 12px', color: '#dc2626' }}>{b.due_date}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ padding: '2px 8px', background: '#dc2626', color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                                {overdueDays} day{overdueDays !== 1 ? 's' : ''}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', fontSize: 12 }}>{b.assigned_to || 'Unassigned'}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                              <button className="primary" style={{ fontSize: 11, padding: '3px 10px' }}
                                onClick={() => router.push(`/claim-lifecycle/${b.claim_id}`)}>Open</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {tatBreaches.length > 10 && (
                    <div style={{ padding: '8px', textAlign: 'center', fontSize: 12, color: '#991b1b', cursor: 'pointer' }}
                      onClick={() => router.push('/workflow-overview')}>
                      + {tatBreaches.length - 10} more breaches — View all
                    </div>
                  )}
                </div>
              </div>
            )}

            <h3 style={{ marginTop: 30, marginBottom: 20 }}>Claims by Line of Business</h3>
            <div className="stats-grid">
              {LOB_LIST.map((lob) => {
                const count = stats.lob_distribution?.find(d => d.lob === lob)?.count || 0;
                return (
                  <div key={lob} className="stat-card" style={{ cursor: 'pointer', borderLeftColor: LOB_COLORS[lob], textAlign: 'center' }}
                    onClick={() => router.push(`/claims/${encodeURIComponent(lob)}`)}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>{LOB_ICONS[lob]}</div>
                    <div className="stat-label">{lob}</div>
                    <div style={{ fontSize: 24, marginTop: 10, fontWeight: 700, color: LOB_COLORS[lob] }}>{count}</div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="alert error">Failed to load statistics</div>
        )}

        {/* Master Claims Table */}
        <div style={{ marginTop: 30, background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
          <h3 style={{ margin: '0 0 15px', color: '#1e293b' }}>All Claims</h3>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 15, flexWrap: 'wrap' }}>
            <select value={dashFilterLob} onChange={e => setDashFilterLob(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}>
              <option value="">All LOBs</option>
              {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={dashFilterStatus} onChange={e => setDashFilterStatus(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}>
              <option value="">All Status</option>
              <option value="Open">Open</option>
              <option value="In Process">In Process</option>
              <option value="Submitted">Submitted</option>
            </select>
            {(dashFilterLob || dashFilterStatus) && (
              <button onClick={() => { setDashFilterLob(''); setDashFilterStatus(''); }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#f1f5f9', fontSize: 12, cursor: 'pointer' }}>Clear</button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
              {(() => {
                let filtered = allClaims;
                if (dashFilterLob) filtered = filtered.filter(c => c.lob === dashFilterLob);
                if (dashFilterStatus) filtered = filtered.filter(c => c.status === dashFilterStatus);
                return `${filtered.length} claims`;
              })()}
            </span>
          </div>

          {claimsLoading ? (
            <p style={{ textAlign: 'center', padding: 30, color: '#94a3b8' }}>Loading claims...</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
                    {['File No.', 'LOB', 'Insured', 'Insurer', 'Surveyor', 'TAT', 'Days Open', 'Status', 'Action'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let filtered = allClaims;
                    if (dashFilterLob) filtered = filtered.filter(c => c.lob === dashFilterLob);
                    if (dashFilterStatus) filtered = filtered.filter(c => c.status === dashFilterStatus);
                    return filtered.slice(0, 50).map(c => {
                      const daysOpen = c.created_at ? Math.floor((new Date() - new Date(c.created_at)) / 86400000) : '-';
                      const tatInfo = getClaimTatDeadline(c.lob, c.date_of_intimation || c.date_intimation, c.pipeline_stage_number || 1);
                      const tatBadge = tatInfo ? getTatBadge(tatInfo.deadline) : null;
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                            <a onClick={() => router.push(`/claim-detail/${c.id}`)} style={{ color: '#1e40af', cursor: 'pointer', textDecoration: 'underline' }}>{c.ref_number || '-'}</a>
                          </td>
                          <td style={{ padding: '8px 10px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{LOB_ICONS[c.lob] || ''} {c.lob}</span></td>
                          <td style={{ padding: '8px 10px' }}>{c.insured_name || '-'}</td>
                          <td style={{ padding: '8px 10px' }}>{c.insurer_name || '-'}</td>
                          <td style={{ padding: '8px 10px' }}>{c.surveyor_name || '-'}</td>
                          <td style={{ padding: '8px 10px' }}>
                            {tatBadge ? <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: 9, fontWeight: 700, background: tatBadge.bg, color: tatBadge.color }}>{tatBadge.label}</span> : '-'}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: daysOpen > 30 ? '#dc2626' : daysOpen > 15 ? '#d97706' : '#16a34a' }}>{daysOpen}</td>
                          <td style={{ padding: '8px 10px' }}><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: c.status === 'Submitted' ? '#dcfce7' : c.status === 'In Process' ? '#fef3c7' : '#dbeafe', color: c.status === 'Submitted' ? '#166534' : c.status === 'In Process' ? '#92400e' : '#1e40af' }}>{c.status}</span></td>
                          <td style={{ padding: '8px 10px' }}>
                            <button onClick={() => router.push(`/claim-detail/${c.id}`)} style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>View</button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
