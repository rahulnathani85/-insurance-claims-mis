'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST, LOB_COLORS, LOB_ICONS } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tatBreaches, setTatBreaches] = useState([]);
  const [myAssignments, setMyAssignments] = useState([]);
  const [myWorkflowItems, setMyWorkflowItems] = useState([]);
  const [expandedClaims, setExpandedClaims] = useState({});
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
    if (user?.email) loadMyAssignments();
  }, [company, user]);

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
            <div className="stats-grid">
              <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => router.push('/mis-portal')}>
                <div className="stat-label">Total Claims</div>
                <div className="stat-value">{stats.total_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#f97316', cursor: 'pointer' }} onClick={() => router.push('/mis-portal?status=Open')}>
                <div className="stat-label">Open Claims</div>
                <div className="stat-value">{stats.open_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#0284c7', cursor: 'pointer' }} onClick={() => router.push('/mis-portal?status=In%20Process')}>
                <div className="stat-label">In Process</div>
                <div className="stat-value">{stats.in_process_claims || 0}</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#16a34a', cursor: 'pointer' }} onClick={() => router.push('/mis-portal?status=Submitted')}>
                <div className="stat-label">Submitted</div>
                <div className="stat-value">{stats.submitted_claims || 0}</div>
              </div>
            </div>

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
      </div>
    </PageLayout>
  );
}
