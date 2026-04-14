'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';

const ASSIGNMENT_STATUSES = ['Assigned', 'In Progress', 'Completed', 'Reassigned'];
const ASSIGNMENT_ROLES = ['Surveyor', 'Staff', 'Reviewer'];
const ASSIGNMENT_TYPES = ['lead_surveyor', 'supporting', 'specialist', 'general'];
const TYPE_LABELS = { lead_surveyor: 'Lead', supporting: 'Support', specialist: 'Specialist', general: 'General' };
const TYPE_COLORS = { lead_surveyor: { bg: '#dbeafe', color: '#1e40af' }, supporting: { bg: '#fef3c7', color: '#92400e' }, specialist: { bg: '#fae8ff', color: '#86198f' }, general: { bg: '#f3f4f6', color: '#374151' } };
const PRIORITY_COLORS = { Normal: { bg: '#f3f4f6', color: '#374151' }, High: { bg: '#fef3c7', color: '#92400e' }, Urgent: { bg: '#fef2f2', color: '#dc2626' } };

const STATUS_COLORS = {
  'Assigned': { bg: '#dbeafe', color: '#1e40af' },
  'In Progress': { bg: '#fef3c7', color: '#92400e' },
  'Completed': { bg: '#dcfce7', color: '#166534' },
  'Reassigned': { bg: '#fae8ff', color: '#86198f' },
};

export default function FileAssignments() {
  const { user } = useAuth();
  const { company } = useCompany();
  const [assignments, setAssignments] = useState([]);
  const [claims, setClaims] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({});
  const [alert, setAlert] = useState(null);
  const [filterUser, setFilterUser] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [workload, setWorkload] = useState([]);
  const [viewMode, setViewMode] = useState('assignments'); // 'assignments' or 'member-progress'
  const [claimSearch, setClaimSearch] = useState('');
  const [showClaimDropdown, setShowClaimDropdown] = useState(false);

  const isAdmin = user?.role === 'Admin';

  useEffect(() => {
    loadAll();
  }, [company]);

  async function loadAll() {
    try {
      setLoading(true);
      const [a, c, u, w] = await Promise.all([
        fetch(`/api/claim-assignments?company=${encodeURIComponent(company)}`).then(r => r.json()),
        fetch(`/api/claims?company=${encodeURIComponent(company)}`).then(r => r.json()),
        fetch('/api/auth/users').then(r => r.json()),
        fetch('/api/claim-assignments?workload=true').then(r => r.json()).catch(() => []),
      ]);
      setAssignments(Array.isArray(a) ? a : []);
      setClaims(Array.isArray(c) ? c : []);
      setUsers(Array.isArray(u) ? u.filter(u => u.is_active) : []);
      setWorkload(Array.isArray(w) ? w : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function getClaimLabel(claimId) {
    const claim = claims.find(c => c.id === parseInt(claimId));
    return claim ? `${claim.ref_number || ''} - ${claim.insured_name || 'Unnamed'}` : `Claim #${claimId}`;
  }

  function openNewAssignment() {
    setFormData({ role: 'Surveyor', assignment_type: 'lead_surveyor', priority: 'Normal', company, assigned_by: user?.email });
    setClaimSearch('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setFormData({});
    setClaimSearch('');
    setShowClaimDropdown(false);
  }

  async function saveAssignment() {
    if (!formData.claim_id || !formData.assigned_to) {
      showAlertMsg('Please select a claim and assign to a user', 'error');
      return;
    }
    try {
      // Denormalize the user name
      const assignee = users.find(u => u.email === formData.assigned_to);
      const payload = { ...formData, assigned_to_name: assignee?.name || formData.assigned_to };
      const res = await fetch('/api/claim-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      showAlertMsg('File assigned successfully!', 'success');
      closeModal();
      await loadAll();
    } catch (e) {
      showAlertMsg('Error: ' + e.message, 'error');
    }
  }

  async function updateStatus(id, newStatus) {
    try {
      await fetch(`/api/claim-assignments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      showAlertMsg(`Status updated to ${newStatus}`, 'success');
      await loadAll();
    } catch (e) {
      showAlertMsg('Error: ' + e.message, 'error');
    }
  }

  async function deleteAssignment(id) {
    if (!confirm('Remove this assignment?')) return;
    try {
      await fetch(`/api/claim-assignments/${id}`, { method: 'DELETE' });
      showAlertMsg('Assignment removed', 'success');
      await loadAll();
    } catch (e) {
      showAlertMsg('Error: ' + e.message, 'error');
    }
  }

  const filteredAssignments = assignments.filter(a => {
    if (filterUser && a.assigned_to !== filterUser) return false;
    if (filterStatus && a.status !== filterStatus) return false;
    if (filterType && a.assignment_type !== filterType) return false;
    if (filterPriority && a.priority !== filterPriority) return false;
    return true;
  });

  // Member progress view: group by user
  const memberProgress = {};
  assignments.forEach(a => {
    if (!memberProgress[a.assigned_to]) {
      memberProgress[a.assigned_to] = { total: 0, completed: 0, inProgress: 0, assigned: 0, claims: [] };
    }
    memberProgress[a.assigned_to].total++;
    if (a.status === 'Completed') memberProgress[a.assigned_to].completed++;
    else if (a.status === 'In Progress') memberProgress[a.assigned_to].inProgress++;
    else memberProgress[a.assigned_to].assigned++;
    memberProgress[a.assigned_to].claims.push(a);
  });

  const filteredClaims = claims.filter(c => {
    if (!claimSearch) return true;
    const s = claimSearch.toLowerCase();
    return (c.ref_number || '').toLowerCase().includes(s) || (c.insured_name || '').toLowerCase().includes(s);
  });

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>📎</span>
          File Assignments
        </h2>

        <div className="button-group" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isAdmin && <button className="success" onClick={openNewAssignment}>+ Assign File</button>}
          <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
            <button className={viewMode === 'assignments' ? 'primary' : 'secondary'}
              onClick={() => setViewMode('assignments')} style={{ fontSize: 12 }}>
              All Assignments
            </button>
            <button className={viewMode === 'member-progress' ? 'primary' : 'secondary'}
              onClick={() => setViewMode('member-progress')} style={{ fontSize: 12 }}>
              Member Progress
            </button>
          </div>
        </div>

        {/* Workload Panel */}
        {workload.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 15, overflowX: 'auto', paddingBottom: 5 }}>
            {workload.map(w => (
              <div key={w.email}
                onClick={() => setFilterUser(filterUser === w.email ? '' : w.email)}
                style={{
                  minWidth: 140, padding: '10px 14px', background: filterUser === w.email ? '#1e40af' : '#fff',
                  color: filterUser === w.email ? '#fff' : '#1e293b',
                  border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s',
                }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{w.name}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 11 }}>
                  <span style={{ color: filterUser === w.email ? '#93c5fd' : '#ef4444', fontWeight: 700 }}>{w.active} active</span>
                  <span style={{ color: filterUser === w.email ? '#86efac' : '#16a34a' }}>{w.completion_rate}%</span>
                </div>
                <div style={{ height: 4, background: filterUser === w.email ? 'rgba(255,255,255,0.3)' : '#f3f4f6', borderRadius: 2, marginTop: 6 }}>
                  <div style={{ height: '100%', width: `${w.completion_rate}%`, background: filterUser === w.email ? '#86efac' : '#22c55e', borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'assignments' && (
          <>
            <div className="filter-section">
              <h4 style={{ marginBottom: 15 }}>Filters</h4>
              <div className="filter-row">
                <select value={filterUser} onChange={e => setFilterUser(e.target.value)}>
                  <option value="">All Members</option>
                  {users.map(u => <option key={u.id} value={u.email}>{u.name}</option>)}
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">All Status</option>
                  {ASSIGNMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="">All Types</option>
                  {ASSIGNMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
                  <option value="">All Priority</option>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="loading">Loading assignments...</div>
            ) : filteredAssignments.length === 0 ? (
              <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No assignments found</p>
            ) : (
              <div className="mis-table-container">
                <table className="mis-table">
                  <thead>
                    <tr>
                      <th>Claim / File</th>
                      <th>Assigned To</th>
                      <th>Type</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Target Inspection</th>
                      <th>Target Report</th>
                      <th>Notes</th>
                      {isAdmin && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssignments.map(a => {
                      const sc = STATUS_COLORS[a.status] || { bg: '#f3f4f6', color: '#374151' };
                      return (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 600, fontSize: 13 }}>{getClaimLabel(a.claim_id)}</td>
                          <td>{a.assigned_to_name || users.find(u => u.email === a.assigned_to)?.name || a.assigned_to}</td>
                          <td>
                            {(() => { const tc = TYPE_COLORS[a.assignment_type] || TYPE_COLORS.general; return (
                              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: tc.bg, color: tc.color }}>{TYPE_LABELS[a.assignment_type] || 'General'}</span>
                            ); })()}
                          </td>
                          <td>
                            {(() => { const pc = PRIORITY_COLORS[a.priority] || PRIORITY_COLORS.Normal; return (
                              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: pc.bg, color: pc.color }}>{a.priority || 'Normal'}</span>
                            ); })()}
                          </td>
                          <td>
                            {isAdmin ? (
                              <select value={a.status} onChange={e => updateStatus(a.id, e.target.value)}
                                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: sc.bg, color: sc.color, border: 'none', fontWeight: 600 }}>
                                {ASSIGNMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            ) : (
                              <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>{a.status}</span>
                            )}
                          </td>
                          <td style={{ fontSize: 11, color: a.target_inspection_date && new Date(a.target_inspection_date) < new Date() && a.status !== 'Completed' ? '#dc2626' : '#6b7280' }}>
                            {a.target_inspection_date || '-'}
                          </td>
                          <td style={{ fontSize: 11, color: a.target_report_date && new Date(a.target_report_date) < new Date() && a.status !== 'Completed' ? '#dc2626' : '#6b7280' }}>
                            {a.target_report_date || '-'}
                          </td>
                          <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.notes || '-'}</td>
                          {isAdmin && (
                            <td className="action-buttons">
                              <button className="danger" style={{ fontSize: 11 }} onClick={() => deleteAssignment(a.id)}>Remove</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {viewMode === 'member-progress' && (
          <div style={{ marginTop: 20 }}>
            {Object.keys(memberProgress).length === 0 ? (
              <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No assignments to show</p>
            ) : (
              Object.entries(memberProgress).map(([email, data]) => {
                const memberUser = users.find(u => u.email === email);
                const completionRate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                return (
                  <div key={email} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 15 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 16 }}>{memberUser?.name || email}</h3>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>{email} | {memberUser?.role || '-'}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: completionRate >= 75 ? '#16a34a' : completionRate >= 50 ? '#d97706' : '#dc2626' }}>
                          {completionRate}%
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>Completion Rate</div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden', marginBottom: 15 }}>
                      <div style={{ height: '100%', width: `${completionRate}%`, background: completionRate >= 75 ? '#22c55e' : completionRate >= 50 ? '#f59e0b' : '#ef4444', borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>

                    <div style={{ display: 'flex', gap: 15, marginBottom: 15 }}>
                      <div style={{ padding: '8px 15px', background: '#dbeafe', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e40af' }}>{data.total}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>Total</div>
                      </div>
                      <div style={{ padding: '8px 15px', background: '#dcfce7', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#166534' }}>{data.completed}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>Completed</div>
                      </div>
                      <div style={{ padding: '8px 15px', background: '#fef3c7', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#92400e' }}>{data.inProgress}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>In Progress</div>
                      </div>
                      <div style={{ padding: '8px 15px', background: '#f3f4f6', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#374151' }}>{data.assigned}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>Pending</div>
                      </div>
                    </div>

                    {/* Claims list for this member */}
                    <div style={{ fontSize: 12 }}>
                      {data.claims.map(c => {
                        const sc = STATUS_COLORS[c.status] || { bg: '#f3f4f6', color: '#374151' };
                        return (
                          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                            <span style={{ fontWeight: 500 }}>{getClaimLabel(c.claim_id)}</span>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              {c.due_date && <span style={{ color: '#6b7280' }}>Due: {c.due_date}</span>}
                              <span style={{ padding: '2px 8px', borderRadius: 10, background: sc.bg, color: sc.color, fontWeight: 600, fontSize: 11 }}>{c.status}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        <div style={{ marginTop: 15, padding: 15, background: '#f8fafc', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
          Total Assignments: {assignments.length} | Completed: {assignments.filter(a => a.status === 'Completed').length} | In Progress: {assignments.filter(a => a.status === 'In Progress').length} | Pending: {assignments.filter(a => a.status === 'Assigned').length}
        </div>
      </div>

      {showModal && (
        <div className="modal show" onClick={e => { if (e.target.className.includes('modal show')) closeModal(); }}>
          <div className="modal-content" style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '2px solid #1e40af', paddingBottom: 15 }}>
              <h3 style={{ margin: 0 }}>Assign File to Team Member</h3>
              <span onClick={closeModal} style={{ fontSize: 24, cursor: 'pointer', color: '#666' }}>&times;</span>
            </div>

            <div className="form-group" style={{ marginBottom: 15, position: 'relative' }}>
              <label>Select Claim / File *</label>
              <input
                value={claimSearch}
                onChange={e => { setClaimSearch(e.target.value); setShowClaimDropdown(true); }}
                onFocus={() => setShowClaimDropdown(true)}
                placeholder="Search by ref number or insured name..."
                autoComplete="off"
              />
              {showClaimDropdown && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                  background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
                  maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}>
                  {filteredClaims.slice(0, 15).map(c => (
                    <div key={c.id}
                      onClick={() => {
                        setFormData(prev => ({ ...prev, claim_id: c.id }));
                        setClaimSearch(`${c.ref_number || ''} - ${c.insured_name || ''}`);
                        setShowClaimDropdown(false);
                      }}
                      style={{
                        padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', fontSize: 12
                      }}
                      onMouseEnter={e => e.target.style.background = '#eff6ff'}
                      onMouseLeave={e => e.target.style.background = '#fff'}
                    >
                      <strong>{c.ref_number || 'No Ref'}</strong> — {c.insured_name || 'Unnamed'} ({c.lob})
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group">
                <label>Assign To *</label>
                <select value={formData.assigned_to || ''} onChange={e => setFormData(prev => ({ ...prev, assigned_to: e.target.value }))}>
                  <option value="">-- Select Team Member --</option>
                  {users.map(u => <option key={u.id} value={u.email}>{u.name} ({u.role})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Assignment Type *</label>
                <select value={formData.assignment_type || 'lead_surveyor'} onChange={e => setFormData(prev => ({ ...prev, assignment_type: e.target.value }))}>
                  {ASSIGNMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group">
                <label>Priority</label>
                <select value={formData.priority || 'Normal'} onChange={e => setFormData(prev => ({ ...prev, priority: e.target.value }))}>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
              <div className="form-group">
                <label>Assignment Basis</label>
                <select value={formData.assignment_basis || ''} onChange={e => setFormData(prev => ({ ...prev, assignment_basis: e.target.value }))}>
                  <option value="">-- Select --</option>
                  <option value="Location">Location</option>
                  <option value="Expertise">Expertise</option>
                  <option value="Workload">Workload</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 15 }}>
              <label>Location of Loss</label>
              <input value={formData.location_of_loss || ''} onChange={e => setFormData(prev => ({ ...prev, location_of_loss: e.target.value }))} placeholder="City, area..." />
            </div>

            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group">
                <label>Target Inspection Date</label>
                <input type="date" value={formData.target_inspection_date || ''} onChange={e => setFormData(prev => ({ ...prev, target_inspection_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Target Report Date</label>
                <input type="date" value={formData.target_report_date || ''} onChange={e => setFormData(prev => ({ ...prev, target_report_date: e.target.value }))} />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 15 }}>
              <label>Notes</label>
              <textarea value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} rows={2} placeholder="Any special instructions..." />
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={saveAssignment}>Assign Team Member</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={closeModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
