'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { LOB_LIST, FILE_SERVER_URL, FILE_SERVER_KEY } from '@/lib/constants';

export default function PolicyMaster() {
  const { company } = useCompany();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [alert, setAlert] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [insurers, setInsurers] = useState([]);
  const [policyTypes, setPolicyTypes] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);

  useEffect(() => {
    loadAll();
  }, [company]);

  async function loadAll() {
    try {
      setLoading(true);
      const [p, i] = await Promise.all([
        fetch(`/api/policies?company=${encodeURIComponent(company)}`).then(r => r.json()),
        fetch('/api/insurers').then(r => r.json()),
      ]);
      setPolicies(Array.isArray(p) ? p : []);
      setInsurers(Array.isArray(i) ? i : []);
    } catch (error) {
      console.error('Failed to load data:', error);
      setPolicies([]);
      setInsurers([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadPolicyTypes(lob) {
    if (!lob) { setPolicyTypes([]); return; }
    try {
      // cache-bust with timestamp + no-store so we always get the latest list from Supabase
      const url = `/api/policy-types/${encodeURIComponent(lob)}?t=${Date.now()}`;
      const data = await fetch(url, { cache: 'no-store' }).then(r => r.json());
      setPolicyTypes(Array.isArray(data) ? data : []);
    } catch { setPolicyTypes([]); }
  }

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  async function handleFileUpload(file) {
    if (!file) return;
    setUploadedFile(file);
    setExtracting(true);

    try {
      // Extract details from the document
      const extractForm = new FormData();
      extractForm.append('file', file);
      const extractRes = await fetch('/api/extract-policy', { method: 'POST', body: extractForm });
      const extractData = await extractRes.json();

      if (extractData.fields && Object.keys(extractData.fields).length > 0) {
        setFormData(prev => {
          const updated = { ...prev };
          Object.entries(extractData.fields).forEach(([key, value]) => {
            if (value && !prev[key]) {
              updated[key] = value;
            }
          });
          return updated;
        });
        // If LOB was extracted, load policy types
        if (extractData.fields.lob) loadPolicyTypes(extractData.fields.lob);
        showAlertMsg(extractData.message, 'success');
      } else {
        showAlertMsg(extractData.message || 'No fields could be auto-detected.', 'warning');
      }
    } catch (e) {
      showAlertMsg('Failed to extract: ' + e.message, 'error');
    } finally {
      setExtracting(false);
    }
  }

  async function uploadPolicyCopy(policyId) {
    if (!uploadedFile) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', uploadedFile);
      const res = await fetch(`/api/policies/${policyId}/upload-copy`, { method: 'POST', body: form });
      if (!res.ok) throw new Error('Upload failed');
    } catch (e) {
      console.error('Upload policy copy error:', e);
    } finally {
      setUploading(false);
    }
  }

  function openNewPolicy() {
    setEditId(null);
    setFormData({ company });
    setPolicyTypes([]);
    setUploadedFile(null);
    setShowModal(true);
  }

  function openEditPolicy(policy) {
    setEditId(policy.id);
    setFormData(policy);
    setUploadedFile(null);
    if (policy.lob) loadPolicyTypes(policy.lob);
    setShowModal(true);
  }

  async function savePolicy() {
    if (!formData.policy_number || !formData.insured_name || !formData.insurer) {
      showAlertMsg('Policy Number, Insured Name, and Insurer are required', 'error');
      return;
    }

    const payload = { ...formData, company };
    delete payload.id;
    delete payload.created_at;

    try {
      if (editId) {
        const res = await fetch(`/api/policies/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Update failed');
        }
        if (uploadedFile) await uploadPolicyCopy(editId);
        showAlertMsg('Policy updated successfully', 'success');
      } else {
        const res = await fetch('/api/policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Create failed');
        }
        const result = await res.json();
        if (uploadedFile && result.id) await uploadPolicyCopy(result.id);
        showAlertMsg('Policy created successfully', 'success');
      }
      setShowModal(false);
      await loadAll();
    } catch (e) {
      showAlertMsg('Failed: ' + e.message, 'error');
    }
  }

  async function deletePolicy(id) {
    if (!confirm('Delete this policy?')) return;
    try {
      await fetch(`/api/policies/${id}`, { method: 'DELETE' });
      showAlertMsg('Policy deleted', 'success');
      await loadAll();
    } catch (e) {
      showAlertMsg('Failed to delete: ' + e.message, 'error');
    }
  }

  const filteredPolicies = policies.filter(p =>
    p.policy_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.insured_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>Policy Master</h2>

        <div className="button-group">
          <button className="success" onClick={openNewPolicy}>+ New Policy</button>
        </div>

        <div className="filter-section">
          <input placeholder="Search by policy number or insured name" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading">Loading policies...</div>
        ) : filteredPolicies.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No policies found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Policy Number</th>
                  <th>Insured Name</th>
                  <th>Insurer</th>
                  <th>LOB</th>
                  <th>Policy Type</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th>Sum Assured</th>
                  <th>Risk Location</th>
                  <th>Folder</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.map(p => (
                  <tr key={p.id}>
                    <td>{p.policy_number}</td>
                    <td>{p.insured_name}</td>
                    <td>{p.insurer}</td>
                    <td>{p.lob || '-'}</td>
                    <td>{p.policy_type || '-'}</td>
                    <td>{p.start_date || '-'}</td>
                    <td>{p.end_date || '-'}</td>
                    <td>{p.sum_insured ? parseFloat(p.sum_insured).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}</td>
                    <td>{p.risk_location || '-'}</td>
                    <td style={{ fontSize: 11, color: '#666', maxWidth: 200, wordBreak: 'break-all' }}>{p.folder_path || '-'}</td>
                    <td className="action-buttons">
                      <button className="secondary" onClick={() => openEditPolicy(p)}>Edit</button>
                      {p.policy_copy_url && (
                        <a href={p.policy_copy_url} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 12px', background: '#3b82f6', color: 'white', borderRadius: 4, fontSize: 12, textDecoration: 'none' }}>Doc</a>
                      )}
                      {p.folder_path && (
                        <>
                          <button className="secondary" style={{ fontSize: 11 }} onClick={() => {
                            const relativePath = p.folder_path.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
                            window.open(`${FILE_SERVER_URL}/browse?path=${encodeURIComponent(relativePath)}`, '_blank');
                          }}>📁 Open</button>
                          <button className="secondary" style={{ fontSize: 11 }} onClick={() => { navigator.clipboard.writeText(p.folder_path); showAlertMsg('Folder path copied!', 'success'); }}>📋</button>
                        </>
                      )}
                      <button className="danger" onClick={() => deletePolicy(p.id)}>Delete</button>
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
            <h3>{editId ? 'Edit Policy' : 'Add New Policy'}</h3>

            <div className="form-section" style={{ background: '#f0f7ff', border: '2px dashed #3b82f6', borderRadius: 8, padding: 20 }}>
              <h4 style={{ color: '#1e40af', marginBottom: 10 }}>Upload Policy Document</h4>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>Upload a PDF or Word document to auto-extract policy details</p>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={e => handleFileUpload(e.target.files[0])}
                style={{ marginBottom: 10 }}
              />
              {extracting && (
                <div style={{ color: '#3b82f6', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }}></span>
                  Extracting details from document...
                </div>
              )}
              {uploadedFile && !extracting && (
                <div style={{ fontSize: 13, color: '#16a34a' }}>
                  ✓ {uploadedFile.name} attached — will be uploaded on save
                </div>
              )}
            </div>

            <div className="form-section">
              <h4>Basic Information</h4>
              <div className="form-group">
                <label>Policy Number *</label>
                <input value={formData.policy_number || ''} onChange={e => setFormData({ ...formData, policy_number: e.target.value })} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Insured Name *</label>
                  <input value={formData.insured_name || ''} onChange={e => setFormData({ ...formData, insured_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Insurer *</label>
                  <select value={formData.insurer || ''} onChange={e => setFormData({ ...formData, insurer: e.target.value })} required>
                    <option value="">-- Select Insurer --</option>
                    {insurers.map(i => <option key={i.id} value={i.company_name}>{i.company_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Line of Business</label>
                  <select value={formData.lob || ''} onChange={e => { setFormData({ ...formData, lob: e.target.value, policy_type: '' }); loadPolicyTypes(e.target.value); }}>
                    <option value="">-- Select LOB --</option>
                    {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Type of Policy</label>
                  <input
                    list="policy-type-options"
                    value={formData.policy_type || ''}
                    onChange={e => setFormData({ ...formData, policy_type: e.target.value })}
                    placeholder={formData.lob ? 'Select or type a policy type' : 'Select an LOB first'}
                    disabled={!formData.lob}
                  />
                  <datalist id="policy-type-options">
                    {policyTypes.map(pt => <option key={pt.id} value={pt.policy_type} />)}
                  </datalist>
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    Pick from the list or type a custom value. Manage the list in Policy Directory.
                  </small>
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Policy Details</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Start Date</label>
                  <input type="date" value={formData.start_date || ''} onChange={e => setFormData({ ...formData, start_date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>End Date</label>
                  <input type="date" value={formData.end_date || ''} onChange={e => setFormData({ ...formData, end_date: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Sum Assured</label>
                  <input type="number" step="0.01" value={formData.sum_insured || ''} onChange={e => setFormData({ ...formData, sum_insured: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Premium</label>
                  <input type="number" step="0.01" value={formData.premium || ''} onChange={e => setFormData({ ...formData, premium: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Risk Location</label>
                <input value={formData.risk_location || ''} onChange={e => setFormData({ ...formData, risk_location: e.target.value })} placeholder="Enter risk location" />
              </div>
            </div>

            <div className="form-section">
              <h4>Contact Details</h4>
              <div className="form-group">
                <label>Insured Address</label>
                <input value={formData.insured_address || ''} onChange={e => setFormData({ ...formData, insured_address: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>City</label>
                  <input value={formData.city || ''} onChange={e => setFormData({ ...formData, city: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={savePolicy}>Save</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
