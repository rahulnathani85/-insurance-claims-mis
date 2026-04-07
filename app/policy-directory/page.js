'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST } from '@/lib/constants';

export default function PolicyDirectory() {
  const [policyTypes, setPolicyTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [alert, setAlert] = useState(null);
  const [filterLob, setFilterLob] = useState('');

  useEffect(() => {
    loadPolicyTypes();
  }, []);

  async function loadPolicyTypes() {
    try {
      setLoading(true);
      const res = await fetch('/api/policy-types');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setPolicyTypes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load policy types:', error);
      setPolicyTypes([]);
    } finally {
      setLoading(false);
    }
  }

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function openNewPolicyType() {
    setEditId(null);
    setFormData({ lob: '', policy_type: '', description: '' });
    setShowModal(true);
  }

  function openEditPolicyType(pt) {
    setEditId(pt.id);
    setFormData({ lob: pt.lob, policy_type: pt.policy_type, description: pt.description || '' });
    setShowModal(true);
  }

  async function savePolicyType() {
    if (!formData.policy_type || !formData.lob) {
      showAlertMsg('Policy Type and LOB are required', 'error');
      return;
    }

    try {
      if (editId) {
        const res = await fetch(`/api/policy-types?id=${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lob: formData.lob, policy_type: formData.policy_type, description: formData.description })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Update failed');
        showAlertMsg('Policy type updated successfully', 'success');
      } else {
        const res = await fetch('/api/policy-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lob: formData.lob, policy_type: formData.policy_type, description: formData.description })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Create failed');
        showAlertMsg('Policy type created successfully', 'success');
      }
      setShowModal(false);
      await loadPolicyTypes();
    } catch (e) {
      showAlertMsg('Failed: ' + e.message, 'error');
    }
  }

  async function deletePolicyType(id) {
    if (!confirm('Delete this policy type?')) return;
    try {
      const res = await fetch(`/api/policy-types?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showAlertMsg('Policy type deleted', 'success');
      await loadPolicyTypes();
    } catch (e) {
      showAlertMsg('Failed to delete: ' + e.message, 'error');
    }
  }

  const filteredPolicyTypes = filterLob
    ? policyTypes.filter(pt => pt.lob === filterLob)
    : policyTypes;

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>Policy Directory</h2>

        <div className="button-group">
          <button className="success" onClick={openNewPolicyType}>+ New Policy Type</button>
        </div>

        <div className="filter-section">
          <select value={filterLob} onChange={e => setFilterLob(e.target.value)}>
            <option value="">All LOBs</option>
            {LOB_LIST.map(lob => <option key={lob} value={lob}>{lob}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading">Loading policy types...</div>
        ) : filteredPolicyTypes.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No policy types found</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>LOB</th>
                <th>Policy Type</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPolicyTypes.map(pt => (
                <tr key={pt.id}>
                  <td>{pt.lob}</td>
                  <td>{pt.policy_type}</td>
                  <td>{pt.description || '-'}</td>
                  <td className="action-buttons">
                    <button className="secondary" onClick={() => openEditPolicyType(pt)}>Edit</button>
                    <button className="danger" onClick={() => deletePolicyType(pt.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowModal(false)}>
          <div className="modal-content">
            <span className="modal-close" onClick={() => setShowModal(false)}>&times;</span>
            <h3>{editId ? 'Edit Policy Type' : 'Add New Policy Type'}</h3>

            <div className="form-group">
              <label>LOB *</label>
              <select value={formData.lob || ''} onChange={e => setFormData({ ...formData, lob: e.target.value })} required>
                <option value="">-- Select LOB --</option>
                {LOB_LIST.map(lob => <option key={lob} value={lob}>{lob}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Policy Type *</label>
              <input value={formData.policy_type || ''} onChange={e => setFormData({ ...formData, policy_type: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} />
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={savePolicyType}>Save</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
