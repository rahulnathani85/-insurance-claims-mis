'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';

export default function BrokerMaster() {
  const { company } = useCompany();
  const [brokers, setBrokers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [alert, setAlert] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { loadBrokers(); }, [company]);

  async function loadBrokers() {
    try {
      setLoading(true);
      const data = await fetch(`/api/brokers?company=${encodeURIComponent(company)}`).then(r => r.json());
      setBrokers(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function showAlertMsg(msg, type) { setAlert({ msg, type }); setTimeout(() => setAlert(null), 5000); }

  function openNew() { setEditId(null); setFormData({ status: 'Active', company: company === 'All' ? 'NISLA' : company }); setShowModal(true); }
  function openEdit(b) { setEditId(b.id); setFormData({ ...b }); setShowModal(true); }
  function closeModal() { setShowModal(false); setEditId(null); setFormData({}); }

  async function saveBroker() {
    if (!formData.broker_name) { showAlertMsg('Broker name is required', 'error'); return; }
    try {
      if (editId) {
        const res = await fetch(`/api/brokers/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
        showAlertMsg('Broker updated', 'success');
      } else {
        const res = await fetch('/api/brokers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
        showAlertMsg('Broker created', 'success');
      }
      closeModal();
      await loadBrokers();
    } catch (e) { showAlertMsg('Error: ' + e.message, 'error'); }
  }

  async function deleteBroker(id) {
    if (!confirm('Delete this broker?')) return;
    try {
      await fetch(`/api/brokers/${id}`, { method: 'DELETE' });
      showAlertMsg('Broker deleted', 'success');
      await loadBrokers();
    } catch (e) { showAlertMsg('Error: ' + e.message, 'error'); }
  }

  const filtered = brokers.filter(b => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (b.broker_name || '').toLowerCase().includes(s) || (b.contact_person || '').toLowerCase().includes(s) || (b.city || '').toLowerCase().includes(s);
  });

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>🤝</span> Broker Master
        </h2>
        <div className="button-group"><button className="success" onClick={openNew}>+ Add New Broker</button></div>
        <div className="filter-section">
          <div className="filter-row">
            <input placeholder="Search by name, contact person, or city" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ maxWidth: 400 }} />
          </div>
        </div>

        {loading ? <div className="loading">Loading brokers...</div> : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No brokers found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Broker Name</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>City</th>
                  <th>License No.</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.broker_name}</td>
                    <td>{b.contact_person || '-'}</td>
                    <td>{b.phone || '-'}</td>
                    <td>{b.email || '-'}</td>
                    <td>{b.city || '-'}</td>
                    <td style={{ fontSize: 12 }}>{b.license_number || '-'}</td>
                    <td>
                      <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: b.status === 'Active' ? '#dcfce7' : '#fee2e2',
                        color: b.status === 'Active' ? '#166534' : '#991b1b' }}>
                        {b.status}
                      </span>
                    </td>
                    <td className="action-buttons">
                      <button className="secondary" onClick={() => openEdit(b)}>Edit</button>
                      <button className="danger" onClick={() => deleteBroker(b.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal show" onClick={e => { if (e.target.className.includes('modal show')) closeModal(); }}>
          <div className="modal-content" style={{ maxWidth: 550 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '2px solid #1e40af', paddingBottom: 15 }}>
              <h3 style={{ margin: 0 }}>{editId ? 'Edit Broker' : 'Add New Broker'}</h3>
              <span onClick={closeModal} style={{ fontSize: 24, cursor: 'pointer', color: '#666' }}>&times;</span>
            </div>
            <div className="form-group" style={{ marginBottom: 15 }}>
              <label>Broker Name *</label>
              <input value={formData.broker_name || ''} onChange={e => setFormData(p => ({ ...p, broker_name: e.target.value }))} />
            </div>
            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group"><label>Contact Person</label><input value={formData.contact_person || ''} onChange={e => setFormData(p => ({ ...p, contact_person: e.target.value }))} /></div>
              <div className="form-group"><label>Phone</label><input value={formData.phone || ''} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group"><label>Email</label><input type="email" value={formData.email || ''} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} /></div>
              <div className="form-group"><label>City</label><input value={formData.city || ''} onChange={e => setFormData(p => ({ ...p, city: e.target.value }))} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group"><label>State</label><input value={formData.state || ''} onChange={e => setFormData(p => ({ ...p, state: e.target.value }))} /></div>
              <div className="form-group"><label>License Number</label><input value={formData.license_number || ''} onChange={e => setFormData(p => ({ ...p, license_number: e.target.value }))} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 15 }}>
              <div className="form-group"><label>GST Number</label><input value={formData.gst_number || ''} onChange={e => setFormData(p => ({ ...p, gst_number: e.target.value }))} /></div>
              <div className="form-group">
                <label>Status</label>
                <select value={formData.status || 'Active'} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 15 }}>
              <label>Address</label>
              <textarea value={formData.address || ''} onChange={e => setFormData(p => ({ ...p, address: e.target.value }))} rows={2} />
            </div>
            <button className="success" style={{ width: '100%' }} onClick={saveBroker}>{editId ? 'Update Broker' : 'Create Broker'}</button>
            <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={closeModal}>Cancel</button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
