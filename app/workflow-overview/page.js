'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';

export default function WorkflowOverview() {
  const router = useRouter();
  const { user } = useAuth();
  const { company } = useCompany();
  const [claims, setClaims] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBreach, setFilterBreach] = useState(false);
  const [searchRef, setSearchRef] = useState('');

  useEffect(() => { loadAll(); }, [company]);

  async function loadAll() {
    try {
      setLoading(true);
      const [c, w] = await Promise.all([
        fetch(`/api/claims?company=${encodeURIComponent(company)}`).then(r => r.json()),
        fetch(`/api/claim-workflow?company=${encodeURIComponent(company)}`).then(r => r.json()),
      ]);
      setClaims(Array.isArray(c) ? c : []);
      setWorkflows(Array.isArray(w) ? w : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // Group workflows by claim_id
  const claimWorkflows = {};
  workflows.forEach(w => {
    if (!claimWorkflows[w.claim_id]) claimWorkflows[w.claim_id] = [];
    claimWorkflows[w.claim_id].push(w);
  });

  // Build claim summary with workflow info
  const claimSummaries = claims.map(c => {
    const stages = claimWorkflows[c.id] || [];
    const total = stages.length;
    const completed = stages.filter(s => s.status === 'Completed').length;
    const breached = stages.filter(s => {
      if (s.status === 'Completed' || s.status === 'Skipped') return false;
      if (!s.due_date) return false;
      return new Date() > new Date(s.due_date);
    }).length;
    const currentStage = stages.find(s => s.status === 'In Progress') || stages.find(s => s.status === 'Pending');
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { ...c, stages, total, completed, breached, currentStage, progress, hasWorkflow: total > 0 };
  });

  // Filter
  const filtered = claimSummaries.filter(c => {
    if (filterBreach && c.breached === 0) return false;
    if (filterStatus === 'with_workflow' && !c.hasWorkflow) return false;
    if (filterStatus === 'no_workflow' && c.hasWorkflow) return false;
    if (searchRef && !(c.ref_number || '').toLowerCase().includes(searchRef.toLowerCase()) && !(c.insured_name || '').toLowerCase().includes(searchRef.toLowerCase())) return false;
    return true;
  });

  // Stats
  const totalWithWorkflow = claimSummaries.filter(c => c.hasWorkflow).length;
  const totalBreached = claimSummaries.filter(c => c.breached > 0).length;

  return (
    <PageLayout>
      <div className="main-content">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>🔄</span> Workflow Overview
        </h2>

        {/* Summary Cards */}
        <div style={{ display: 'flex', gap: 15, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140, padding: 15, background: '#eff6ff', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#1e40af' }}>{claims.length}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Total Claims</div>
          </div>
          <div style={{ flex: 1, minWidth: 140, padding: 15, background: '#f0fdf4', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>{totalWithWorkflow}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>With Workflow</div>
          </div>
          <div style={{ flex: 1, minWidth: 140, padding: 15, background: totalBreached > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: 10, textAlign: 'center', cursor: 'pointer' }}
            onClick={() => setFilterBreach(!filterBreach)}>
            <div style={{ fontSize: 24, fontWeight: 700, color: totalBreached > 0 ? '#dc2626' : '#16a34a' }}>{totalBreached}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>TAT Breached {filterBreach ? '(filtered)' : ''}</div>
          </div>
          <div style={{ flex: 1, minWidth: 140, padding: 15, background: '#fefce8', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#92400e' }}>{claims.length - totalWithWorkflow}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>No Workflow Yet</div>
          </div>
        </div>

        <div className="filter-section">
          <div className="filter-row">
            <input placeholder="Search by ref number or insured name" value={searchRef} onChange={e => setSearchRef(e.target.value)} />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Claims</option>
              <option value="with_workflow">With Workflow</option>
              <option value="no_workflow">Without Workflow</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={filterBreach} onChange={e => setFilterBreach(e.target.checked)} />
              TAT Breached Only
            </label>
          </div>
        </div>

        {loading ? <div className="loading">Loading...</div> : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No claims found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Ref Number</th>
                  <th>Insured</th>
                  <th>LOB</th>
                  <th>Current Stage</th>
                  <th>Progress</th>
                  <th>TAT Breached</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ background: c.breached > 0 ? '#fff5f5' : 'transparent' }}>
                    <td style={{ fontWeight: 600 }}>{c.ref_number || '-'}</td>
                    <td>{c.insured_name || '-'}</td>
                    <td style={{ fontSize: 12 }}>{c.lob || '-'}</td>
                    <td style={{ fontSize: 12 }}>
                      {c.hasWorkflow ? (
                        <span style={{ fontWeight: 500 }}>{c.currentStage?.stage_name || 'All Completed'}</span>
                      ) : (
                        <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not started</span>
                      )}
                    </td>
                    <td>
                      {c.hasWorkflow ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
                            <div style={{ height: '100%', width: `${c.progress}%`, background: c.progress >= 75 ? '#22c55e' : c.progress >= 50 ? '#f59e0b' : '#3b82f6', borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11, color: '#6b7280', minWidth: 40 }}>{c.completed}/{c.total}</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td>
                      {c.breached > 0 ? (
                        <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#fef2f2', color: '#dc2626' }}>
                          {c.breached} stage{c.breached > 1 ? 's' : ''}
                        </span>
                      ) : c.hasWorkflow ? (
                        <span style={{ fontSize: 11, color: '#16a34a' }}>On Track</span>
                      ) : '-'}
                    </td>
                    <td className="action-buttons">
                      <button className="primary" style={{ fontSize: 11 }} onClick={() => router.push(`/claim-lifecycle/${c.id}`)}>
                        {c.hasWorkflow ? 'View Lifecycle' : 'Start Workflow'}
                      </button>
                    </td>
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
