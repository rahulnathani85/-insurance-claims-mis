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
  const router = useRouter();
  const { company } = useCompany();
  const { user } = useAuth();

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

            {/* My Assigned Files - Personal Dashboard */}
            {(myAssignments.length > 0 || myWorkflowItems.length > 0) && (
              <div style={{ marginTop: 25, marginBottom: 25 }}>
                <h3 style={{ margin: '0 0 15px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>📌</span> My Assigned Files ({myAssignments.length + myWorkflowItems.length})
                </h3>

                {/* Workflow stages assigned to me */}
                {myWorkflowItems.length > 0 && (
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 15, marginBottom: 12 }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#1e40af' }}>Workflow Stages Pending ({myWorkflowItems.length})</h4>
                    {myWorkflowItems.slice(0, 8).map(w => {
                      const overdue = w.due_date && new Date() > new Date(w.due_date);
                      return (
                        <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #dbeafe', fontSize: 12 }}>
                          <div>
                            <span style={{ fontWeight: 600 }}>{w.ref_number || `Claim #${w.claim_id}`}</span>
                            <span style={{ color: '#6b7280', marginLeft: 8 }}>{w.stage_name}</span>
                            {overdue && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>OVERDUE</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {w.due_date && <span style={{ color: overdue ? '#dc2626' : '#6b7280', fontSize: 11 }}>Due: {w.due_date}</span>}
                            <button className="primary" style={{ fontSize: 10, padding: '2px 8px' }}
                              onClick={() => router.push(`/claim-lifecycle/${w.claim_id}`)}>Action</button>
                          </div>
                        </div>
                      );
                    })}
                    {myWorkflowItems.length > 8 && <p style={{ fontSize: 11, color: '#6b7280', margin: '6px 0 0', cursor: 'pointer' }} onClick={() => router.push('/workflow-overview')}>+ {myWorkflowItems.length - 8} more...</p>}
                  </div>
                )}

                {/* File assignments to me */}
                {myAssignments.length > 0 && (
                  <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: 15 }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#92400e' }}>File Assignments ({myAssignments.length})</h4>
                    {myAssignments.slice(0, 8).map(a => {
                      const overdue = a.due_date && new Date() > new Date(a.due_date) && a.status !== 'Completed';
                      return (
                        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #fde68a', fontSize: 12 }}>
                          <div>
                            <span style={{ fontWeight: 600 }}>Claim #{a.claim_id}</span>
                            <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                              background: a.status === 'In Progress' ? '#fef3c7' : '#dbeafe',
                              color: a.status === 'In Progress' ? '#92400e' : '#1e40af' }}>{a.status}</span>
                            {overdue && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>OVERDUE</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {a.due_date && <span style={{ color: overdue ? '#dc2626' : '#6b7280', fontSize: 11 }}>Due: {a.due_date}</span>}
                            <button className="primary" style={{ fontSize: 10, padding: '2px 8px' }}
                              onClick={() => router.push(`/claim-detail/${a.claim_id}`)}>Open</button>
                          </div>
                        </div>
                      );
                    })}
                    {myAssignments.length > 8 && <p style={{ fontSize: 11, color: '#6b7280', margin: '6px 0 0', cursor: 'pointer' }} onClick={() => router.push('/file-assignments')}>+ {myAssignments.length - 8} more...</p>}
                  </div>
                )}
              </div>
            )}

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
