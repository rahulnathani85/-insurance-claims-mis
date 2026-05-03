'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';

const LICENSE_CATEGORIES = ['A', 'B', 'Fellow', 'Associate'];
const PERIL_TYPES = [
  'Fire', 'Marine Cargo', 'Marine Hull', 'Engineering',
  'Electronic Equipment', 'Bankers Indemnity', 'Sports & Media',
  'Extended Warranty', 'Credit / UPI', 'Liability & Product Recall',
  'Business Interruption', 'Miscellaneous',
];
const REGIONS = ['West', 'North', 'South', 'East', 'Central'];

export default function SurveyorMaster() {
  const [surveyors, setSurveyors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [alert, setAlert] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [includeInactive, setIncludeInactive] = useState(false);

  useEffect(() => { loadSurveyors(); }, [includeInactive]);

  async function loadSurveyors() {
    try {
      setLoading(true);
      const url = includeInactive ? '/api/surveyors?include_inactive=true' : '/api/surveyors';
      const data = await fetch(url).then(r => r.json());
      setSurveyors(Array.isArray(data) ? data : []);
    } catch (e) {
      showAlert('Failed to load surveyors: ' + e.message, 'error');
      setSurveyors([]);
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function openNew() {
    setEditId(null);
    setFormData({ active: true, company: 'NISLA', peril_specialties: [] });
    setShowModal(true);
  }

  function openEdit(s) {
    setEditId(s.id);
    setFormData({
      ...s,
      peril_specialties: s.peril_specialties || [],
    });
    setShowModal(true);
  }

  async function save() {
    if (!formData.name || !formData.name.trim()) {
      showAlert('Name is required', 'error');
      return;
    }
    try {
      const payload = { ...formData };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.license_status;
      delete payload.days_until_expiry;

      const url = editId ? `/api/surveyors/${editId}` : '/api/surveyors';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }
      showAlert(editId ? 'Surveyor updated' : 'Surveyor created', 'success');
      setShowModal(false);
      await loadSurveyors();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function deactivate(id) {
    if (!confirm('Deactivate this surveyor? They will no longer appear in assignment dropdowns.')) return;
    try {
      const res = await fetch(`/api/surveyors/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showAlert('Surveyor deactivated', 'success');
      await loadSurveyors();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  function togglePeril(p) {
    const list = formData.peril_specialties || [];
    if (list.includes(p)) {
      setFormData({ ...formData, peril_specialties: list.filter(x => x !== p) });
    } else {
      setFormData({ ...formData, peril_specialties: [...list, p] });
    }
  }

  const filtered = surveyors.filter(s => {
    const matchesText = !searchTerm
      || s.name?.toLowerCase().includes(searchTerm.toLowerCase())
      || s.license_number?.toLowerCase().includes(searchTerm.toLowerCase())
      || s.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || s.license_status === filterStatus;
    return matchesText && matchesStatus;
  });

  const summary = surveyors.reduce((acc, s) => {
    acc[s.license_status] = (acc[s.license_status] || 0) + 1;
    return acc;
  }, {});

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>Surveyor Master</h2>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: -8 }}>
          IRDAI license tracking. Surveyors with expired or missing licenses are blocked from new assignments per spec §7.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <StatBox label="Valid" value={summary.valid || 0} color="#15803d" bg="#dcfce7" />
          <StatBox label="Expiring within 60 days" value={summary.expiring_soon || 0} color="#b45309" bg="#fef3c7" />
          <StatBox label="Expired" value={summary.expired || 0} color="#b91c1c" bg="#fee2e2" />
          <StatBox label="No license recorded" value={summary.unknown || 0} color="#475569" bg="#f1f5f9" />
        </div>

        <div className="button-group" style={{ marginTop: 16 }}>
          <button className="success" onClick={openNew}>+ New Surveyor</button>
        </div>

        <div className="filter-section" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Search name / license / email"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All license statuses</option>
            <option value="valid">Valid</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="unknown">No license recorded</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={e => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>
        </div>

        {loading ? (
          <div className="loading">Loading surveyors...</div>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            {surveyors.length === 0 ? 'No surveyors yet — click "+ New Surveyor" to add one.' : 'No surveyors match your filters.'}
          </p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>License #</th>
                  <th>Cat.</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th>Region</th>
                  <th>Specialties</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500 }}>{s.name}{s.designation ? <div style={{ fontSize: 11, color: '#64748b' }}>{s.designation}</div> : null}</td>
                    <td style={{ fontSize: 12 }}>{s.license_number || <span style={{ color: '#dc2626' }}>—</span>}</td>
                    <td style={{ fontSize: 12 }}>{s.license_category || '-'}</td>
                    <td style={{ fontSize: 12 }}>
                      {s.license_expiry_date || '-'}
                      {typeof s.days_until_expiry === 'number' && (
                        <div style={{ fontSize: 10, color: '#64748b' }}>
                          {s.days_until_expiry < 0 ? `${-s.days_until_expiry}d ago` : `in ${s.days_until_expiry}d`}
                        </div>
                      )}
                    </td>
                    <td><LicenseBadge status={s.license_status} /></td>
                    <td style={{ fontSize: 12 }}>{s.region || '-'}</td>
                    <td style={{ fontSize: 11 }}>
                      {s.peril_specialties?.length
                        ? s.peril_specialties.slice(0, 3).join(', ') + (s.peril_specialties.length > 3 ? ` +${s.peril_specialties.length - 3}` : '')
                        : '-'}
                    </td>
                    <td>{s.active ? 'Yes' : <span style={{ color: '#94a3b8' }}>No</span>}</td>
                    <td className="action-buttons">
                      <button className="secondary" onClick={() => openEdit(s)}>Edit</button>
                      {s.active && <button className="danger" onClick={() => deactivate(s.id)}>Deactivate</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowModal(false)}>
          <div className="modal-content wide">
            <span className="modal-close" onClick={() => setShowModal(false)}>&times;</span>
            <h3>{editId ? 'Edit Surveyor' : 'Add New Surveyor'}</h3>

            <div className="form-section">
              <h4>Identity</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Name *</label>
                  <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Designation</label>
                  <input value={formData.designation || ''} onChange={e => setFormData({ ...formData, designation: e.target.value })} placeholder="e.g. Senior Surveyor" />
                </div>
                <div className="form-group">
                  <label>Company</label>
                  <select value={formData.company || 'NISLA'} onChange={e => setFormData({ ...formData, company: e.target.value })}>
                    <option value="NISLA">NISLA</option>
                    <option value="Acuere">Acuere</option>
                    <option value="All">All</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Phone</label>
                  <input value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Region</label>
                  <select value={formData.region || ''} onChange={e => setFormData({ ...formData, region: e.target.value })}>
                    <option value="">— Select —</option>
                    {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>IRDAI Licence</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>License Number</label>
                  <input
                    value={formData.license_number || ''}
                    onChange={e => setFormData({ ...formData, license_number: e.target.value })}
                    placeholder="IRDAI/CORP/SLA-200025"
                  />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select value={formData.license_category || ''} onChange={e => setFormData({ ...formData, license_category: e.target.value })}>
                    <option value="">— Select —</option>
                    {LICENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Issued Date</label>
                  <input type="date" value={formData.license_issued_date || ''} onChange={e => setFormData({ ...formData, license_issued_date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Expiry Date</label>
                  <input type="date" value={formData.license_expiry_date || ''} onChange={e => setFormData({ ...formData, license_expiry_date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Max Concurrent Claims</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.max_concurrent_claims || ''}
                    onChange={e => setFormData({ ...formData, max_concurrent_claims: e.target.value })}
                    placeholder="e.g. 25"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Peril Specialties</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PERIL_TYPES.map(p => {
                    const checked = (formData.peril_specialties || []).includes(p);
                    return (
                      <label key={p} style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', borderRadius: 6, fontSize: 12,
                        background: checked ? '#dbeafe' : '#f1f5f9',
                        color: checked ? '#1e40af' : '#475569',
                        border: `1px solid ${checked ? '#3b82f6' : '#cbd5e1'}`,
                        cursor: 'pointer',
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePeril(p)}
                          style={{ marginRight: 2 }}
                        />
                        {p}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Tax & Address</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>PAN</label>
                  <input value={formData.pan || ''} onChange={e => setFormData({ ...formData, pan: e.target.value })} maxLength={10} />
                </div>
                <div className="form-group">
                  <label>GSTIN</label>
                  <input value={formData.gstin || ''} onChange={e => setFormData({ ...formData, gstin: e.target.value })} maxLength={15} />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <textarea rows={2} value={formData.address || ''} onChange={e => setFormData({ ...formData, address: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea rows={2} value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Internal notes — performance, languages, vehicle, etc." />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={formData.active !== false}
                    onChange={e => setFormData({ ...formData, active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={save}>{editId ? 'Update' : 'Create'}</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function StatBox({ label, value, color, bg }) {
  return (
    <div style={{
      flex: 1, minWidth: 160, padding: '10px 14px',
      background: bg, color, borderRadius: 8,
      border: `1px solid ${color}20`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function LicenseBadge({ status }) {
  const cfg = {
    valid: { label: 'Valid', bg: '#dcfce7', color: '#15803d' },
    expiring_soon: { label: 'Expiring soon', bg: '#fef3c7', color: '#b45309' },
    expired: { label: 'Expired', bg: '#fee2e2', color: '#b91c1c' },
    unknown: { label: 'Not recorded', bg: '#f1f5f9', color: '#475569' },
  }[status] || { label: status || '-', bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color,
    }}>{cfg.label}</span>
  );
}
