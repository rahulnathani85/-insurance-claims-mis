'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';

const ACTION_COLORS = {
  'login': '#3b82f6',
  'create': '#22c55e',
  'update': '#f59e0b',
  'delete': '#ef4444',
  'view': '#8b5cf6',
  'generate': '#06b6d4',
  'assign': '#ec4899',
};

export default function ActivityLog() {
  const { user } = useAuth();
  const { company } = useCompany();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterClaimId, setFilterClaimId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [users, setUsers] = useState([]);

  const isAdmin = user?.role === 'Admin';

  useEffect(() => {
    loadLogs();
    loadUsers();
  }, [company]);

  async function loadUsers() {
    try {
      const data = await fetch('/api/auth/users').then(r => r.json());
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
  }

  async function loadLogs() {
    try {
      setLoading(true);
      let url = '/api/activity-log?limit=500';
      if (company && company !== 'All' && company !== 'Development') url += `&company=${encodeURIComponent(company)}`;
      if (filterUser) url += `&user_email=${encodeURIComponent(filterUser)}`;
      if (filterAction) url += `&action=${encodeURIComponent(filterAction)}`;
      if (filterClaimId) url += `&claim_id=${encodeURIComponent(filterClaimId)}`;
      if (fromDate) url += `&from_date=${fromDate}`;
      if (toDate) url += `&to_date=${toDate}`;
      const data = await fetch(url).then(r => r.json());
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load logs:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!loading) loadLogs();
  }, [filterUser, filterAction, filterClaimId, fromDate, toDate]);

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <div style={{ textAlign: 'center', padding: 60, color: '#dc2626' }}>
            <h2>Access Denied</h2>
            <p>Only administrators can view activity logs.</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  // Group logs by date for readability
  const uniqueActions = [...new Set(logs.map(l => l.action).filter(Boolean))];

  return (
    <PageLayout>
      <div className="main-content">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>📋</span>
          Activity Log
        </h2>

        <div className="filter-section">
          <h4 style={{ marginBottom: 15 }}>Filters</h4>
          <div className="filter-row">
            <select value={filterUser} onChange={e => setFilterUser(e.target.value)}>
              <option value="">All Users</option>
              {users.map(u => <option key={u.id} value={u.email}>{u.name} ({u.email})</option>)}
            </select>
            <select value={filterAction} onChange={e => setFilterAction(e.target.value)}>
              <option value="">All Actions</option>
              {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <input placeholder="Filter by Claim ID" value={filterClaimId} onChange={e => setFilterClaimId(e.target.value)} style={{ maxWidth: 140 }} />
          </div>
          <div className="filter-row" style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280' }}>From:</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280' }}>To:</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <button className="secondary" style={{ fontSize: 12 }} onClick={() => { setFilterUser(''); setFilterAction(''); setFilterClaimId(''); setFromDate(''); setToDate(''); }}>
              Clear Filters
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading activity logs...</div>
        ) : logs.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No activity logs found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Ref Number</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: '#6b7280' }}>
                      {new Date(l.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{l.user_name || '-'}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{l.user_email}</div>
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: (ACTION_COLORS[l.action] || '#6b7280') + '20',
                        color: ACTION_COLORS[l.action] || '#6b7280'
                      }}>
                        {l.action}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{l.entity_type}{l.entity_id ? ` #${l.entity_id}` : ''}</td>
                    <td style={{ fontSize: 12, fontWeight: 500 }}>{l.ref_number || '-'}</td>
                    <td style={{ fontSize: 12, color: '#4b5563', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.details || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 15, padding: 15, background: '#f8fafc', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
          Showing {logs.length} log entries
        </div>
      </div>
    </PageLayout>
  );
}
