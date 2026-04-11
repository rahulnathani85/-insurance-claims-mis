'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';

const OFFICE_TYPES = ['Regional Office', 'LCBO', 'Head Office', 'Claims Hub'];

export default function InsurerMaster() {
  const [insurers, setInsurers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showOfficeModal, setShowOfficeModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [officeForm, setOfficeForm] = useState({});
  const [editOfficeId, setEditOfficeId] = useState(null);
  const [selectedInsurer, setSelectedInsurer] = useState(null);
  const [expandedInsurer, setExpandedInsurer] = useState(null);
  const [alert, setAlert] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { loadInsurers(); }, []);

  async function loadInsurers() {
    try {
      setLoading(true);
      const data = await fetch('/api/insurers').then(r => r.json());
      setInsurers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load insurers:', error);
      setInsurers([]);
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function openNewInsurer() {
    setEditId(null);
    setFormData({ status: 'Active' });
    setShowModal(true);
  }

  function openEditInsurer(insurer) {
    setEditId(insurer.id);
    setFormData({ ...insurer });
    setShowModal(true);
  }

  async function saveInsurer() {
    if (!formData.company_name) {
      showAlert('Company name is required', 'error');
      return;
    }
    try {
      const payload = { ...formData };
      delete payload.insurer_offices;
      delete payload.id;
      delete payload.created_at;

      if (editId) {
        const res = await fetch(`/api/insurers/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Update failed');
        showAlert('Insurer updated successfully', 'success');
      } else {
        const res = await fetch('/api/insurers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Create failed');
        showAlert('Insurer created successfully', 'success');
      }
      setShowModal(false);
      await loadInsurers();
    } catch (e) {
      showAlert('Failed: ' + e.message, 'error');
    }
  }

  async function deleteInsurer(id) {
    if (!confirm('Delete this insurer and all its offices?')) return;
    try {
      await fetch(`/api/insurers/${id}`, { method: 'DELETE' });
      showAlert('Insurer deleted', 'success');
      await loadInsurers();
    } catch (e) {
      showAlert('Failed to delete: ' + e.message, 'error');
    }
  }

  function openAddOffice(insurer) {
    setSelectedInsurer(insurer);
    setEditOfficeId(null);
    setOfficeForm({ type: 'Regional Office' });
    setShowOfficeModal(true);
  }

  function openEditOffice(insurer, office) {
    setSelectedInsurer(insurer);
    setEditOfficeId(office.id);
    setOfficeForm({ ...office });
    setShowOfficeModal(true);
  }

  async function saveOffice() {
    if (!officeForm.name || !officeForm.type) {
      showAlert('Office name and type are required', 'error');
      return;
    }
    try {
      const payload = { ...officeForm };
      delete payload.id;
      delete payload.insurer_id;
      delete payload.created_at;

      if (editOfficeId) {
        const res = await fetch(`/api/insurer-offices/${editOfficeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update office');
        showAlert('Office updated successfully', 'success');
      } else {
        const res = await fetch(`/api/insurer-offices/${selectedInsurer.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to add office');
        showAlert('Office added successfully', 'success');
      }
      setShowOfficeModal(false);
      setEditOfficeId(null);
      await loadInsurers();
    } catch (e) {
      showAlert('Failed: ' + e.message, 'error');
    }
  }

  async function deleteOffice(officeId) {
    if (!confirm('Delete this office?')) return;
    try {
      await fetch(`/api/insurer-offices/${officeId}`, { method: 'DELETE' });
      showAlert('Office deleted', 'success');
      await loadInsurers();
    } catch (e) {
      showAlert('Failed: ' + e.message, 'error');
    }
  }

  const filteredInsurers = insurers.filter(i =>
    i.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.city?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>Insurer Master</h2>

        <div className="button-group">
          <button className="success" onClick={openNewInsurer}>+ New Insurer</button>
        </div>

        <div className="filter-section">
          <input placeholder="Search by company name, code, or city" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading">Loading insurers...</div>
        ) : filteredInsurers.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No insurers found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Company Name</th>
                  <th>GSTIN</th>
                  <th>City</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Offices</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInsurers.map(i => (
                  <>
                    <tr key={i.id}>
                      <td>{i.code || '-'}</td>
                      <td style={{ fontWeight: 500 }}>{i.company_name}</td>
                      <td style={{ fontSize: 12 }}>{i.gstin || '-'}</td>
                      <td>{i.city || '-'}</td>
                      <td>{i.phone || '-'}</td>
                      <td>{i.email || '-'}</td>
                      <td>
                        <button className="secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => setExpandedInsurer(expandedInsurer === i.id ? null : i.id)}>
                          {i.insurer_offices?.length || 0} offices {expandedInsurer === i.id ? '▲' : '▼'}
                        </button>
                      </td>
                      <td className="action-buttons">
                        <button className="secondary" onClick={() => openEditInsurer(i)}>Edit</button>
                        <button className="success" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openAddOffice(i)}>+ Office</button>
                        <button className="danger" onClick={() => deleteInsurer(i.id)}>Delete</button>
                      </td>
                    </tr>
                    {expandedInsurer === i.id && i.insurer_offices?.length > 0 && (
                      <tr key={`offices-${i.id}`}>
                        <td colSpan={8} style={{ padding: 0, background: '#f8fafc' }}>
                          <table style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: '#e2e8f0' }}>
                                <th style={{ padding: '8px 12px', fontSize: 12 }}>Type</th>
                                <th style={{ padding: '8px 12px', fontSize: 12 }}>Name</th>
                                <th style={{ padding: '8px 12px', fontSize: 12 }}>GSTIN</th>
                                <th style={{ padding: '8px 12px', fontSize: 12 }}>Address</th>
                                <th style={{ padding: '8px 12px', fontSize: 12 }}>City</th>
                                <th style={{ padding: '8px 12px', fontSize: 12 }}>Contact</th>
                                <th style={{ padding: '8px 12px', fontSize: 12 }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {i.insurer_offices.map(o => (
                                <tr key={o.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '6px 12px', fontSize: 12 }}>
                                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                      background: o.type === 'Head Office' ? '#dbeafe' : o.type === 'Claims Hub' ? '#fef3c7' : o.type === 'LCBO' ? '#d1fae5' : '#f3e8ff',
                                      color: o.type === 'Head Office' ? '#1e40af' : o.type === 'Claims Hub' ? '#92400e' : o.type === 'LCBO' ? '#065f46' : '#6b21a8'
                                    }}>{o.type}</span>
                                  </td>
                                  <td style={{ padding: '6px 12px', fontSize: 12 }}>{o.name}</td>
                                  <td style={{ padding: '6px 12px', fontSize: 11 }}>{o.gstin || '-'}</td>
                                  <td style={{ padding: '6px 12px', fontSize: 11, maxWidth: 200 }}>{o.address || '-'}</td>
                                  <td style={{ padding: '6px 12px', fontSize: 12 }}>{o.city || '-'}</td>
                                  <td style={{ padding: '6px 12px', fontSize: 11 }}>{o.contact_person || '-'}{o.phone ? ` | ${o.phone}` : ''}</td>
                                  <td style={{ padding: '6px 12px' }}>
                                    <button className="secondary" style={{ fontSize: 11, padding: '2px 8px', marginRight: 4 }} onClick={() => openEditOffice(i, o)}>Edit</button>
                                    <button className="danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => deleteOffice(o.id)}>Delete</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Insurer Modal */}
      {showModal && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowModal(false)}>
          <div className="modal-content wide">
            <span className="modal-close" onClick={() => setShowModal(false)}>&times;</span>
            <h3>{editId ? 'Edit Insurer' : 'Add New Insurer'}</h3>

            <div className="form-section">
              <h4>Company Details</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Company Name *</label>
                  <input value={formData.company_name || ''} onChange={e => setFormData({ ...formData, company_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Code</label>
                  <input value={formData.code || ''} onChange={e => setFormData({ ...formData, code: e.target.value })} placeholder="e.g. NIAC, ICICI" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>GSTIN</label>
                  <input value={formData.gstin || ''} onChange={e => setFormData({ ...formData, gstin: e.target.value })} placeholder="Enter GSTIN number" maxLength={15} />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={formData.status || 'Active'} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Registered Address</h4>
              <div className="form-group">
                <label>Address</label>
                <textarea value={formData.registered_address || ''} onChange={e => setFormData({ ...formData, registered_address: e.target.value })} rows={2} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>City</label>
                  <input value={formData.city || ''} onChange={e => setFormData({ ...formData, city: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input value={formData.state || ''} onChange={e => setFormData({ ...formData, state: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>PIN</label>
                  <input value={formData.pin || ''} onChange={e => setFormData({ ...formData, pin: e.target.value })} maxLength={6} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Contact</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Phone</label>
                  <input value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={saveInsurer}>Save</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Office Modal */}
      {showOfficeModal && selectedInsurer && (
        <div className="modal show" onClick={e => {
          if (e.target.className.includes('modal show')) {
            setShowOfficeModal(false);
            setEditOfficeId(null);
          }
        }}>
          <div className="modal-content wide">
            <span className="modal-close" onClick={() => { setShowOfficeModal(false); setEditOfficeId(null); }}>&times;</span>
            <h3>{editOfficeId ? 'Edit Office' : 'Add Office'} - {selectedInsurer.company_name}</h3>

            <div className="form-section">
              <div className="form-row">
                <div className="form-group">
                  <label>Office Type *</label>
                  <select value={officeForm.type || ''} onChange={e => setOfficeForm({ ...officeForm, type: e.target.value })}>
                    {OFFICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Office Name *</label>
                  <input value={officeForm.name || ''} onChange={e => setOfficeForm({ ...officeForm, name: e.target.value })} placeholder="e.g. Mumbai Regional Office" />
                </div>
              </div>
              <div className="form-group">
                <label>GSTIN</label>
                <input value={officeForm.gstin || ''} onChange={e => setOfficeForm({ ...officeForm, gstin: e.target.value })} placeholder="Enter GSTIN (if different from company)" maxLength={15} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <textarea value={officeForm.address || ''} onChange={e => setOfficeForm({ ...officeForm, address: e.target.value })} rows={2} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>City</label>
                  <input value={officeForm.city || ''} onChange={e => setOfficeForm({ ...officeForm, city: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input value={officeForm.state || ''} onChange={e => setOfficeForm({ ...officeForm, state: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>PIN</label>
                  <input value={officeForm.pin || ''} onChange={e => setOfficeForm({ ...officeForm, pin: e.target.value })} maxLength={6} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Contact Person</label>
                  <input value={officeForm.contact_person || ''} onChange={e => setOfficeForm({ ...officeForm, contact_person: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input value={officeForm.phone || ''} onChange={e => setOfficeForm({ ...officeForm, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={officeForm.email || ''} onChange={e => setOfficeForm({ ...officeForm, email: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={saveOffice}>{editOfficeId ? 'Update Office' : 'Add Office'}</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => { setShowOfficeModal(false); setEditOfficeId(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
