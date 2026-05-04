'use client';
import { useState, useEffect, useMemo } from 'react';
import PageLayout from '@/components/PageLayout';
import {
  OFFICE_CODE_LIST,
  OFFICE_TYPE_LABELS,
  OFFICE_TYPE_SHORT_LABELS,
  OFFICE_TYPE_DISPLAY_ORDER,
  OFFICE_TYPE_IS_SINGLETON,
  OFFICE_TYPE_COLORS,
  ALLOWED_PARENT_TYPES,
  isValidParent,
} from '@/lib/insurerOfficeTypes';

// ============================================================================
// /insurer-master
// ----------------------------------------------------------------------------
// CRUD UI for insurers and their 7-level office hierarchy. The office form
// drives the type select from OFFICE_CODE_LIST, filters the parent-office
// picker to legal options via isValidParent, and validates HO singleton
// before the API call so the user gets a friendly error instead of a 409.
//
// The list table shows a colored type badge, the parent office name,
// is_active status, sorted by OFFICE_TYPE_DISPLAY_ORDER then alphabetical
// within a level.
// ============================================================================

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
    // Default to RO — most-common case. HO is restricted (singleton).
    setOfficeForm({ office_code: 'RO', is_active: true });
    setShowOfficeModal(true);
  }

  function openEditOffice(insurer, office) {
    setSelectedInsurer(insurer);
    setEditOfficeId(office.id);
    setOfficeForm({
      office_code: office.office_code || 'BO',
      parent_office_id: office.parent_office_id ?? null,
      name: office.name || '',
      address: office.address || '',
      city: office.city || '',
      state: office.state || '',
      pin: office.pin || '',
      gstin: office.gstin || '',
      phone: office.phone || '',
      email: office.email || '',
      contact_person: office.contact_person || '',
      office_short_code: office.office_short_code || '',
      is_active: office.is_active !== false,
    });
    setShowOfficeModal(true);
  }

  // List of legal parent candidates for the currently-selected office_code,
  // filtered to siblings within the same insurer and excluding self.
  const legalParents = useMemo(() => {
    if (!selectedInsurer) return [];
    const code = officeForm.office_code;
    if (!code || code === 'HO') return [];
    const allowedTypes = ALLOWED_PARENT_TYPES[code] || [];
    return (selectedInsurer.insurer_offices || [])
      .filter((o) =>
        allowedTypes.includes(o.office_code) &&
        (editOfficeId ? o.id !== editOfficeId : true)
      )
      .sort((a, b) => {
        const da = OFFICE_TYPE_DISPLAY_ORDER[a.office_code] || 99;
        const db = OFFICE_TYPE_DISPLAY_ORDER[b.office_code] || 99;
        if (da !== db) return da - db;
        return String(a.name).localeCompare(String(b.name));
      });
  }, [officeForm.office_code, selectedInsurer, editOfficeId]);

  async function saveOffice() {
    if (!officeForm.name || !officeForm.office_code) {
      showAlert('Office name and type are required', 'error');
      return;
    }
    if (!OFFICE_CODE_LIST.includes(officeForm.office_code)) {
      showAlert('Invalid office type', 'error');
      return;
    }

    // HO: no parent. Singleton check client-side before API.
    if (officeForm.office_code === 'HO') {
      const existingHo = (selectedInsurer.insurer_offices || []).find(
        (o) => o.office_code === 'HO' && o.id !== editOfficeId
      );
      if (existingHo) {
        showAlert(`This insurer already has a Head Office: "${existingHo.name}"`, 'error');
        return;
      }
      if (officeForm.parent_office_id) {
        showAlert('HO cannot have a parent office', 'error');
        return;
      }
    } else if (officeForm.parent_office_id) {
      // Validate parent type against the chosen child type.
      const parent = (selectedInsurer.insurer_offices || []).find(
        (o) => o.id === Number(officeForm.parent_office_id)
      );
      if (!parent) {
        showAlert('Parent office not found in this insurer', 'error');
        return;
      }
      if (!isValidParent(officeForm.office_code, parent.office_code)) {
        const legal = (ALLOWED_PARENT_TYPES[officeForm.office_code] || []).join(', ');
        showAlert(
          `${officeForm.office_code} cannot have a ${parent.office_code} parent (legal: ${legal})`,
          'error'
        );
        return;
      }
    }

    try {
      const payload = {
        office_code: officeForm.office_code,
        parent_office_id: officeForm.office_code === 'HO'
          ? null
          : (officeForm.parent_office_id || null),
        name: officeForm.name,
        address: officeForm.address || null,
        city: officeForm.city || null,
        state: officeForm.state || null,
        pin: officeForm.pin || null,
        gstin: officeForm.gstin || null,
        phone: officeForm.phone || null,
        email: officeForm.email || null,
        contact_person: officeForm.contact_person || null,
        office_short_code: officeForm.office_short_code || null,
        is_active: officeForm.is_active !== false,
      };

      if (editOfficeId) {
        const res = await fetch(`/api/insurer-offices/${editOfficeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Failed to update office');
        }
        showAlert('Office updated successfully', 'success');
      } else {
        const res = await fetch(`/api/insurer-offices/${selectedInsurer.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Failed to add office');
        }
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
      const res = await fetch(`/api/insurer-offices/${officeId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
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
                  <InsurerRow
                    key={i.id}
                    insurer={i}
                    expanded={expandedInsurer === i.id}
                    onToggle={() => setExpandedInsurer(expandedInsurer === i.id ? null : i.id)}
                    onEdit={() => openEditInsurer(i)}
                    onDelete={() => deleteInsurer(i.id)}
                    onAddOffice={() => openAddOffice(i)}
                    onEditOffice={(o) => openEditOffice(i, o)}
                    onDeleteOffice={(oid) => deleteOffice(oid)}
                  />
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
                  <input value={formData.code || ''} onChange={e => setFormData({ ...formData, code: e.target.value })} placeholder="e.g. NIA, ICICI" />
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
                  <select
                    value={officeForm.office_code || ''}
                    onChange={e => setOfficeForm({
                      ...officeForm,
                      office_code: e.target.value,
                      // Reset parent when type changes — parent constraints differ.
                      parent_office_id: null,
                    })}
                  >
                    {OFFICE_CODE_LIST.map(c => (
                      <option key={c} value={c}>
                        {c} — {OFFICE_TYPE_LABELS[c]}
                        {OFFICE_TYPE_IS_SINGLETON[c] ? ' (one per insurer)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Office Name *</label>
                  <input value={officeForm.name || ''} onChange={e => setOfficeForm({ ...officeForm, name: e.target.value })} placeholder="e.g. Mumbai Regional Office" />
                </div>
              </div>

              {/* Parent picker — only meaningful for non-HO. Filter to legal parent types. */}
              {officeForm.office_code && officeForm.office_code !== 'HO' && (
                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label>Parent Office *
                      <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8, fontWeight: 400 }}>
                        (legal parent types: {(ALLOWED_PARENT_TYPES[officeForm.office_code] || []).join(', ')})
                      </span>
                    </label>
                    <select
                      value={officeForm.parent_office_id ?? ''}
                      onChange={e => setOfficeForm({
                        ...officeForm,
                        parent_office_id: e.target.value ? Number(e.target.value) : null,
                      })}
                    >
                      <option value="">— Select parent —</option>
                      {legalParents.length === 0 ? (
                        <option value="" disabled>(no eligible parent — add one of: {(ALLOWED_PARENT_TYPES[officeForm.office_code] || []).join(', ')} first)</option>
                      ) : (
                        legalParents.map(p => (
                          <option key={p.id} value={p.id}>
                            {OFFICE_TYPE_SHORT_LABELS[p.office_code] || p.office_code}: {p.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Active</label>
                    <select
                      value={officeForm.is_active === false ? 'false' : 'true'}
                      onChange={e => setOfficeForm({ ...officeForm, is_active: e.target.value === 'true' })}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
              )}

              {/* HO special-case: no parent picker, but show the active toggle */}
              {officeForm.office_code === 'HO' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Active</label>
                    <select
                      value={officeForm.is_active === false ? 'false' : 'true'}
                      onChange={e => setOfficeForm({ ...officeForm, is_active: e.target.value === 'true' })}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Office Short Code</label>
                  <input value={officeForm.office_short_code || ''} onChange={e => setOfficeForm({ ...officeForm, office_short_code: e.target.value })} placeholder="e.g. MUM-RO-01" />
                </div>
                <div className="form-group">
                  <label>GSTIN</label>
                  <input value={officeForm.gstin || ''} onChange={e => setOfficeForm({ ...officeForm, gstin: e.target.value })} placeholder="Enter GSTIN (if different from company)" maxLength={15} />
                </div>
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

// ----------------------------------------------------------------------------
// InsurerRow — one insurer row + the expandable office subtable.
// Extracted as its own component so the parent function stays readable
// and the office sort/parent-resolution can use useMemo.
// ----------------------------------------------------------------------------
function InsurerRow({
  insurer,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddOffice,
  onEditOffice,
  onDeleteOffice,
}) {
  const offices = insurer.insurer_offices || [];

  // Sort by display order, then alphabetically by name within a level.
  const sortedOffices = useMemo(() => {
    const officeById = new Map(offices.map((o) => [o.id, o]));
    return [...offices].sort((a, b) => {
      const da = OFFICE_TYPE_DISPLAY_ORDER[a.office_code] ?? 99;
      const db = OFFICE_TYPE_DISPLAY_ORDER[b.office_code] ?? 99;
      if (da !== db) return da - db;
      return String(a.name || '').localeCompare(String(b.name || ''));
    }).map((o) => ({
      ...o,
      _parentName: o.parent_office_id
        ? (officeById.get(o.parent_office_id)?.name || '(unknown)')
        : '—',
    }));
  }, [offices]);

  return (
    <>
      <tr>
        <td>{insurer.code || '-'}</td>
        <td style={{ fontWeight: 500 }}>{insurer.company_name}</td>
        <td style={{ fontSize: 12 }}>{insurer.gstin || '-'}</td>
        <td>{insurer.city || '-'}</td>
        <td>{insurer.phone || '-'}</td>
        <td>{insurer.email || '-'}</td>
        <td>
          <button className="secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={onToggle}>
            {offices.length} offices {expanded ? '▲' : '▼'}
          </button>
        </td>
        <td className="action-buttons">
          <button className="secondary" onClick={onEdit}>Edit</button>
          <button className="success" style={{ fontSize: 11, padding: '4px 8px' }} onClick={onAddOffice}>+ Office</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </td>
      </tr>
      {expanded && offices.length > 0 && (
        <tr>
          <td colSpan={8} style={{ padding: 0, background: '#f8fafc' }}>
            <table style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#e2e8f0' }}>
                  <th style={subThStyle}>Type</th>
                  <th style={subThStyle}>Name</th>
                  <th style={subThStyle}>Parent</th>
                  <th style={subThStyle}>GSTIN</th>
                  <th style={subThStyle}>City / State</th>
                  <th style={subThStyle}>Contact</th>
                  <th style={subThStyle}>Status</th>
                  <th style={subThStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedOffices.map(o => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={subTdStyle}>
                      <OfficeTypeBadge code={o.office_code} />
                    </td>
                    <td style={subTdStyle}>{o.name}</td>
                    <td style={{ ...subTdStyle, fontSize: 11, color: '#64748b' }}>
                      {o._parentName}
                    </td>
                    <td style={{ ...subTdStyle, fontSize: 11 }}>{o.gstin || '-'}</td>
                    <td style={{ ...subTdStyle, fontSize: 12 }}>
                      {o.city || '-'}
                      {o.state ? `, ${o.state}` : ''}
                    </td>
                    <td style={{ ...subTdStyle, fontSize: 11 }}>
                      {o.contact_person || '-'}
                      {o.phone ? ` | ${o.phone}` : ''}
                    </td>
                    <td style={subTdStyle}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: o.is_active === false ? '#fee2e2' : '#dcfce7',
                        color:      o.is_active === false ? '#991b1b' : '#166534',
                      }}>
                        {o.is_active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td style={subTdStyle}>
                      <button className="secondary" style={{ fontSize: 11, padding: '2px 8px', marginRight: 4 }} onClick={() => onEditOffice(o)}>Edit</button>
                      <button className="danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onDeleteOffice(o.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function OfficeTypeBadge({ code }) {
  const c = OFFICE_TYPE_COLORS[code] || OFFICE_TYPE_COLORS.BO;
  const label = OFFICE_TYPE_SHORT_LABELS[code] || code || '?';
  const full = OFFICE_TYPE_LABELS[code] || code || 'Unknown';
  return (
    <span
      title={full}
      style={{
        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
        background: c.bg, color: c.fg, letterSpacing: 0.3,
      }}
    >
      {label}
    </span>
  );
}

const subThStyle = { padding: '8px 12px', fontSize: 12, textAlign: 'left' };
const subTdStyle = { padding: '6px 12px', fontSize: 12, verticalAlign: 'top' };
