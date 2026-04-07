'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { COMPANIES } from '@/lib/constants';

const ROLES = ['Admin', 'Surveyor', 'Staff', 'Reviewer', 'Viewer'];

export default function UserManagement() {
  const { user } = useAuth();
  const { company } = useCompany();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [alert, setAlert] = useState(null);
  const [filterRole, setFilterRole] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [searchText, setSearchText] = useState('');

  const isAdmin = user?.role === 'Admin';

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await fetch('/api/auth/users').then(r => r.json());
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setLoading(false);
    }
  }

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function openNewUser() {
    setEditId(null);
    setFormData({ role: 'Staff', company: company === 'All' || company === 'Development' ? 'NISLA' : company, is_active: true });
    setShowModal(true);
  }

  function openEditUser(u) {
    setEditId(u.id);
    setFormData({ name: u.name, email: u.email, role: u.role, company: u.company, is_active: u.is_active, password: '' });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditId(null);
    setFormData({});
  }

  async function saveUser() {
    if (!formData.name || !formData.email) {
      showAlertMsg('Name and email are required', 'error');
      return;
    }
    if (!editId && !formData.password) {
      showAlertMsg('Password is required for new users', 'error');
      return;
    }

    try {
      if (editId) {
        const res = await fetch(`/api/auth/users/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
        showAlertMsg('User updated successfully', 'success');
      } else {
        const res = await fetch('/api/auth/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
        showAlertMsg('User created successfully', 'success');
      }
      closeModal();
      await loadUsers();
    } catch (e) {
      showAlertMsg('Error: ' + e.message, 'error');
    }
  }

  async function toggleActive(u) {
    try {
      await fetch(`/api/auth/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      showAlertMsg(`User ${u.is_active ? 'deactivated' : 'activated'}`, 'success');
      await loadUsers();
    } catch (e) {
      showAlertMsg('Error: ' + e.message, 'error');
    }
  }

  const filteredUsers = users.filter(u => {
    if (filterRole && u.role !== filterRole) return false;
    if (filterActive === 'active' && !u.is_active) return false;
    if (filterActive === 'inactive' && u.is_active) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      if (!(u.name || '').toLowerCase().includes(s) && !(u.email || '').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  // Non-admin users cannot access this page
  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <div style={{ textAlign: 'center', padding: 60, color: '#dc2626' }}>
            <h2>Access Denied</h2>
            <p>Only administrators can access the User Management tool.</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>👥</span>
          User Management
        </h2>

        <div className="button-group">
          <button className="success" onClick={openNewUser}>+ Add New User</button>
        </div>

        <div className="filter-section">
          <h4 style={{ marginBottom: 15 }}>Filters</h4>
          <div className="filter-row">
            <input placeholder="Search by name or email" value={searchText} onChange={e => setSearchText(e.target.value)} />
            <select value={filterRole} onChange={e => setFilterRole(e.target.value)}>
              <option value="">All Roles</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={filterActive} onChange={e => setFilterActive(e.target.value)}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading users...</div>
        ) : filteredUsers.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No users found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: u.role === 'Admin' ? '#fef3c7' : u.role === 'Surveyor' ? '#dbeafe' : '#f3e8ff',
                        color: u.role === 'Admin' ? '#92400e' : u.role === 'Surveyor' ? '#1e40af' : '#6b21a8'
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td>{u.company}</td>
                    <td>
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: u.is_active ? '#dcfce7' : '#fee2e2',
                        color: u.is_active ? '#166534' : '#991b1b'
                      }}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>
                      {u.last_login ? new Date(u.last_login).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}
                    </td>
                    <td className="action-buttons">
                      <button className="secondary" onClick={() => openEditUser(u)}>Edit</button>
                      <button className={u.is_active ? 'danger' : 'success'} style={{ fontSize: 11 }}
                        onClick={() => toggleActive(u)}>
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 15, padding: 15, background: '#f8fafc', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
          Total Users: {users.length} | Active: {users.filter(u => u.is_active).length} | Inactive: {users.filter(u => !u.is_active).length}
        </div>
      </div>

      {showModal && (
        <div className="modal show" onClick={e => { if (e.target.className.includes('modal show')) closeModal(); }}>
          <div className="modal-content" style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '2px solid #1e40af', paddingBottom: 15 }}>
              <h3 style={{ margin: 0 }}>{editId ? 'Edit User' : 'Add New User'}</h3>
              <span onClick={closeModal} style={{ fontSize: 24, cursor: 'pointer', color: '#666' }}>&times;</span>
            </div>

            <div className="form-group" style={{ marginBottom: 15 }}>
              <label>Full Name *</label>
              <input value={formData.name || ''} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="Enter full name" />
            </div>
            <div className="form-group" style={{ marginBottom: 15 }}>
              <label>Email (Login ID) *</label>
              <input type="email" value={formData.email || ''} onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))} placeholder="user@company.com" />
            </div>
            <div className="form-group" style={{ marginBottom: 15 }}>
              <label>{editId ? 'New Password (leave blank to keep current)' : 'Password *'}</label>
              <input type="password" value={formData.password || ''} onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))} placeholder={editId ? 'Leave blank to keep current' : 'Enter password'} />
            </div>
            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group">
                <label>Role</label>
                <select value={formData.role || 'Staff'} onChange={e => setFormData(prev => ({ ...prev, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Company</label>
                <select value={formData.company || 'NISLA'} onChange={e => setFormData(prev => ({ ...prev, company: e.target.value }))}>
                  {COMPANIES.filter(c => c.value !== 'All' && c.value !== 'Development').map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {editId && (
              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={formData.is_active || false} onChange={e => setFormData(prev => ({ ...prev, is_active: e.target.checked }))} />
                  Active Account
                </label>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={saveUser}>
                {editId ? 'Update User' : 'Create User'}
              </button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={closeModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
