'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST, LOB_COLORS, LOB_ICONS } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tatBreaches, setTatBreaches] = useState([]);
  const router = useRouter();
  const { company } = useCompany();

  useEffect(() => {
    loadStats();
    loadTatBreaches();
  }, [company]);

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
