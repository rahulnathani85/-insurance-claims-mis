'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';

const ROLE_COLORS = {
  'Admin': { bg: '#fef2f2', color: '#991b1b' },
  'Surveyor': { bg: '#eff6ff', color: '#1e40af' },
  'Staff': { bg: '#f0fdf4', color: '#166534' },
};

export default function UserMonitoring() {
  const { user } = useAuth();
  const { company } = useCompany();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [userActivities, setUserActivities] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [sortBy, setSortBy] = useState('total_activities');
  const [sortDir, setSortDir] = useState('desc');

  const isAdmin = user?.role === 'Admin';

  useEffect(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    setFromDate(thirtyDaysAgo.toISOString().split('T')[0]);
    setToDate(now.toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    if (fromDate && toDate) loadData();
  }, [company, fromDate, toDate]);

  async function loadData() {
    try {
      setLoading(true);
      let url = '/api/user-monitoring?from_date=' + fromDate + '&to_date=' + toDate;
      if (company && company !== 'All' && company !== 'Development') url += '&company=' + encodeURIComponent(company);
      const res = await fetch(url);
      const json = await res.json();
      setData(json);
    } catch (e) { console.error('Failed to load:', e); }
    finally { setLoading(false); }
  }

  async function loadUserActivities(email) {
    setLoadingActivities(true);
    try {
      let url = '/api/activity-log?user_email=' + encodeURIComponent(email) + '&limit=200';
      if (fromDate) url += '&from_date=' + fromDate;
      if (toDate) url += '&to_date=' + toDate;
      if (company && company !== 'All' && company !== 'Development') url += '&company=' + encodeURIComponent(company);
      const res = await fetch(url);
      const json = await res.json();
      setUserActivities(Array.isArray(json) ? json : []);
    } catch (e) { console.error(e); }
    finally { setLoadingActivities(false); }
  }

  function handleUserClick(u) {
    setSelectedUser(u);
    loadUserActivities(u.email);
  }

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <div style={{ textAlign: 'center', padding: 60, color: '#dc2626' }}>
            <h2>Access Denied</h2>
            <p>Only administrators can view user monitoring.</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  const sortedUsers = data?.users
    ? [...data.users].sort((a, b) => sortDir === 'desc' ? (b[sortBy] || 0) - (a[sortBy] || 0) : (a[sortBy] || 0) - (b[sortBy] || 0))
    : [];

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  return (
    <PageLayout>
      <div className="main-content">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
          <span style={{ fontSize: 28 }}>&#128065;&#65039;</span>
          User Monitoring & Progress
        </h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 20px' }}>
          Track all users work, activity, and progress across the portal
        </p>

        {/* Date Filter */}
        <div className="filter-section">
          <div className="filter-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Period:</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              <span style={{ fontSize: 12, color: '#9ca3af' }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <button className="primary" style={{ fontSize: 12 }} onClick={loadData}>Refresh</button>
          </div>
        </div>

        {/* Summary Stats */}
        {data && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ padding: '12px 20px', background: '#eff6ff', borderRadius: 10, textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1e40af' }}>{data.users?.length || 0}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Active Users</div>
            </div>
            <div style={{ padding: '12px 20px', background: '#f0fdf4', borderRadius: 10, textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#166534' }}>{data.total_activities || 0}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Total Actions</div>
            </div>
            <div style={{ padding: '12px 20px', background: '#fefce8', borderRadius: 10, textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#92400e' }}>
                {data.users?.reduce((sum, u) => sum + u.total_messages, 0) || 0}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Messages Sent</div>
            </div>
            <div style={{ padding: '12px 20px', background: '#fdf2f8', borderRadius: 10, textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#be185d' }}>
                {data.users?.reduce((sum, u) => sum + u.total_claims_worked, 0) || 0}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Claims Worked</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="loading">Loading user monitoring data...</div>
        ) : (
          <>
            {/* Users Table */}
            <div className="mis-table-container">
              <table className="mis-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total_activities')}>
                      Actions {sortBy === 'total_activities' ? (sortDir === 'desc' ? '\u25BC' : '\u25B2') : ''}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total_claims_worked')}>
                      Claims {sortBy === 'total_claims_worked' ? (sortDir === 'desc' ? '\u25BC' : '\u25B2') : ''}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total_messages')}>
                      Messages {sortBy === 'total_messages' ? (sortDir === 'desc' ? '\u25BC' : '\u25B2') : ''}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('active_days')}>
                      Active Days {sortBy === 'active_days' ? (sortDir === 'desc' ? '\u25BC' : '\u25B2') : ''}
                    </th>
                    <th>Assignments</th>
                    <th>Last Login</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map(u => {
                    const rc = ROLE_COLORS[u.role] || { bg: '#f3f4f6', color: '#6b7280' };
                    return (
                      <tr key={u.id} style={{ background: selectedUser?.email === u.email ? '#eff6ff' : 'transparent' }}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>{u.email}</div>
                        </td>
                        <td>
                          <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: rc.bg, color: rc.color }}>
                            {u.role}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700, fontSize: 15, color: '#1e40af' }}>{u.total_activities}</td>
                        <td style={{ fontWeight: 700, fontSize: 15, color: '#166534' }}>{u.total_claims_worked}</td>
                        <td style={{ fontWeight: 700, fontSize: 15, color: '#92400e' }}>{u.total_messages}</td>
                        <td style={{ fontWeight: 600, fontSize: 14 }}>{u.active_days}</td>
                        <td>
                          <div style={{ fontSize: 12 }}>
                            <span style={{ color: '#166534' }}>{u.assignments_completed}</span>
                            <span style={{ color: '#9ca3af' }}> / </span>
                            <span style={{ color: '#1e40af' }}>{u.assignments_total}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#9ca3af' }}>Done / Total</div>
                        </td>
                        <td style={{ fontSize: 11, color: '#6b7280' }}>
                          {u.last_login ? new Date(u.last_login).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}
                        </td>
                        <td>
                          <button className="secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => handleUserClick(u)}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* User Detail Panel */}
            {selectedUser && (
              <div style={{ marginTop: 25, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18 }}>{selectedUser.name}</h3>
                    <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>{selectedUser.email} | {selectedUser.role} | {selectedUser.company}</p>
                  </div>
                  <button className="secondary" style={{ fontSize: 11 }} onClick={() => { setSelectedUser(null); setUserActivities([]); }}>Close</button>
                </div>

                {/* Action Breakdown */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                  {Object.entries(selectedUser.action_breakdown || {}).sort((a, b) => b[1] - a[1]).map(([action, count]) => (
                    <div key={action} style={{ padding: '6px 12px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#1e40af' }}>{count}</span>
                      <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>{action}</span>
                    </div>
                  ))}
                </div>

                {/* Recent Activity */}
                <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>Recent Activity ({userActivities.length})</h4>
                {loadingActivities ? (
                  <p style={{ color: '#6b7280', fontSize: 13 }}>Loading activities...</p>
                ) : userActivities.length === 0 ? (
                  <p style={{ color: '#999', fontSize: 13 }}>No activity in this period</p>
                ) : (
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {userActivities.slice(0, 50).map(a => (
                      <div key={a.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <div style={{ minWidth: 130, fontSize: 11, color: '#9ca3af' }}>
                          {new Date(a.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                        <div style={{ flex: 1 }}>
                          <span style={{
                            padding: '1px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                            background: a.action === 'create' ? '#dcfce7' : a.action === 'update' ? '#fef3c7' : a.action === 'message' ? '#dbeafe' : '#f3f4f6',
                            color: a.action === 'create' ? '#166534' : a.action === 'update' ? '#92400e' : a.action === 'message' ? '#1e40af' : '#6b7280',
                          }}>
                            {a.action}
                          </span>
                          <span style={{ marginLeft: 8, fontSize: 12, color: '#4b5563' }}>
                            {a.entity_type}{a.ref_number ? ' - ' + a.ref_number : ''}
                          </span>
                          {a.details && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>{a.details}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}
