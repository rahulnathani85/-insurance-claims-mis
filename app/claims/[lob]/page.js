'use client';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_COLORS, LOB_ICONS, LOB_LIST, FILE_SERVER_URL, FILE_SERVER_KEY } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';

function ClaimsLobContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { company } = useCompany();
  const lob = decodeURIComponent(params.lob);
  const clientCategory = searchParams.get('client_category') || '';

  const [claims, setClaims] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({});
  const [policies, setPolicies] = useState([]);
  const [insurers, setInsurers] = useState([]);
  const [offices, setOffices] = useState([]);
  const [policyTypes, setPolicyTypes] = useState([]);
  const [surveyors, setSurveyors] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [teamUsers, setTeamUsers] = useState([]);
  const [filterRef, setFilterRef] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterInsurer, setFilterInsurer] = useState('');
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [useManualRef, setUseManualRef] = useState(false);
  const [manualRefNumber, setManualRefNumber] = useState('');
  const [formDirty, setFormDirty] = useState(false);

  // Policy autocomplete state
  const [policySearch, setPolicySearch] = useState('');
  const [showPolicyDropdown, setShowPolicyDropdown] = useState(false);
  const [showNewPolicyForm, setShowNewPolicyForm] = useState(false);
  const [newPolicyData, setNewPolicyData] = useState({});
  const [savingPolicy, setSavingPolicy] = useState(false);
  const policyInputRef = useRef(null);
  const policyDropdownRef = useRef(null);

  // Intimation sheet upload state
  const [intimationFile, setIntimationFile] = useState(null);
  const [uploadingIntimation, setUploadingIntimation] = useState(false);

  // Draggable modal state
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const modalRef = useRef(null);

  // LOB change state (for edit mode)
  const [showLobChange, setShowLobChange] = useState(false);
  const [newLob, setNewLob] = useState('');
  const [newPolicyType, setNewPolicyType] = useState('');
  const [newLobPolicyTypes, setNewLobPolicyTypes] = useState([]);

  useEffect(() => {
    loadAll();
  }, [lob]);

  async function loadAll() {
    try {
      setLoading(true);
      const [p, i, o, pt, sv, br, tu] = await Promise.all([
        fetch('/api/policies').then(r => r.json()),
        fetch('/api/insurers').then(r => r.json()),
        fetch('/api/offices').then(r => r.json()),
        fetch(`/api/policy-types/${encodeURIComponent(lob)}`).then(r => r.json()),
        fetch('/api/surveyors').then(r => r.json()).catch(() => []),
        fetch('/api/brokers').then(r => r.json()).catch(() => []),
        fetch('/api/auth/users').then(r => r.json()).catch(() => []),
      ]);
      setPolicies(p);
      setInsurers(i);
      setOffices(o);
      setPolicyTypes(pt);
      setSurveyors(Array.isArray(sv) ? sv : []);
      setBrokers(Array.isArray(br) ? br : []);
      setTeamUsers(Array.isArray(tu) ? tu.filter(u => u.is_active) : []);
      await loadClaims();
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadClaims() {
    try {
      let url = `/api/claims?lob=${encodeURIComponent(lob)}&company=${encodeURIComponent(company)}`;
      if (filterRef) url += `&ref_number=${encodeURIComponent(filterRef)}`;
      if (filterStatus) url += `&status=${encodeURIComponent(filterStatus)}`;
      if (filterInsurer) url += `&insurer_name=${encodeURIComponent(filterInsurer)}`;
      const data = await fetch(url).then(r => r.json());
      setClaims(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load claims:', error);
      setClaims([]);
    }
  }

  useEffect(() => {
    if (!loading) {
      loadClaims();
    }
  }, [filterRef, filterStatus, filterInsurer]);

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  // Exit confirmation
  function tryCloseModal() {
    if (formDirty) {
      if (!confirm('You have unsaved changes. Are you sure you want to close? Your data will be lost.')) return;
    }
    closeModal();
  }

  function closeModal() {
    setShowModal(false);
    setEditId(null);
    setFormData({});
    setFormDirty(false);
    setUseManualRef(false);
    setManualRefNumber('');
    setShowLobChange(false);
    setNewLob('');
    setHasDragged(false);
    setModalPos({ x: 0, y: 0 });
    setPolicySearch('');
    setShowPolicyDropdown(false);
    setShowNewPolicyForm(false);
    setNewPolicyData({});
    setIntimationFile(null);
  }

  function updateFormData(updates) {
    setFormData(prev => ({ ...prev, ...updates }));
    setFormDirty(true);
  }

  async function openNewClaim() {
    setEditId(null);
    setFormData({ status: 'Open', client_category: clientCategory });
    setFormDirty(false);
    setUseManualRef(false);
    setManualRefNumber('');
    setShowLobChange(false);
    setHasDragged(false);
    setModalPos({ x: 0, y: 0 });
    setShowModal(true);
    try {
      let url = `/api/tentative-ref/${encodeURIComponent(lob)}`;
      if (lob === 'Marine Cargo' && clientCategory) url += `?client_category=${encodeURIComponent(clientCategory)}`;
      const res = await fetch(url).then(r => r.json());
      setFormData(prev => ({ ...prev, _tentative_ref: res.tentative_ref + ' (Tentative)' }));
    } catch (e) {
      setFormData(prev => ({ ...prev, _tentative_ref: 'Will be generated on save' }));
    }
  }

  async function openEditClaim(claim) {
    setEditId(claim.id);
    setFormData({ ...claim, _tentative_ref: claim.ref_number });
    setFormDirty(false);
    setUseManualRef(false);
    setManualRefNumber('');
    setShowLobChange(false);
    setNewLob('');
    setHasDragged(false);
    setModalPos({ x: 0, y: 0 });
    setPolicySearch(claim.policy_number || '');
    setShowNewPolicyForm(false);
    setNewPolicyData({});
    setShowModal(true);
  }

  function handlePolicySelect(policyNumber) {
    const policy = policies.find(p => p.policy_number === policyNumber);
    if (policy) {
      updateFormData({ policy_number: policyNumber, insured_name: policy.insured_name, insurer_name: policy.insurer });
    } else {
      updateFormData({ policy_number: policyNumber });
    }
    setPolicySearch(policyNumber);
    setShowPolicyDropdown(false);
  }

  // Policy autocomplete: filter policies based on search input
  const filteredPolicies = policies.filter(p => {
    if (!policySearch) return true;
    const search = policySearch.toLowerCase();
    return (p.policy_number || '').toLowerCase().includes(search) ||
           (p.insured_name || '').toLowerCase().includes(search) ||
           (p.insurer || '').toLowerCase().includes(search);
  });

  // Close policy dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (policyDropdownRef.current && !policyDropdownRef.current.contains(e.target) &&
          policyInputRef.current && !policyInputRef.current.contains(e.target)) {
        setShowPolicyDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Save new policy inline
  async function saveNewPolicy() {
    if (!newPolicyData.policy_number) {
      showAlertMsg('Policy number is required', 'error');
      return;
    }
    setSavingPolicy(true);
    try {
      const payload = { ...newPolicyData, company };
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create policy');
      }
      // Reload policies and select the new one
      const updatedPolicies = await fetch('/api/policies').then(r => r.json());
      setPolicies(updatedPolicies);
      handlePolicySelect(newPolicyData.policy_number);
      setShowNewPolicyForm(false);
      setNewPolicyData({});
      showAlertMsg('New policy created and selected!', 'success');
    } catch (e) {
      showAlertMsg('Failed to create policy: ' + e.message, 'error');
    } finally {
      setSavingPolicy(false);
    }
  }

  // LOB change handlers
  async function handleLobChangeToggle() {
    setShowLobChange(!showLobChange);
    if (!showLobChange) {
      setNewLob(lob);
      setNewPolicyType(formData.policy_type || '');
      // Load policy types for current LOB
      try {
        const pt = await fetch(`/api/policy-types/${encodeURIComponent(lob)}`).then(r => r.json());
        setNewLobPolicyTypes(Array.isArray(pt) ? pt : []);
      } catch (e) { setNewLobPolicyTypes([]); }
    }
  }

  async function handleNewLobSelect(selectedLob) {
    setNewLob(selectedLob);
    setNewPolicyType('');
    try {
      const pt = await fetch(`/api/policy-types/${encodeURIComponent(selectedLob)}`).then(r => r.json());
      setNewLobPolicyTypes(Array.isArray(pt) ? pt : []);
    } catch (e) { setNewLobPolicyTypes([]); }
  }

  function applyLobChange() {
    if (!newLob) return;
    updateFormData({
      lob: newLob,
      policy_type: newPolicyType,
      _lob_changed: true,
      _old_lob: lob,
      _new_lob: newLob,
    });
    setShowLobChange(false);
    showAlertMsg(`LOB will be changed to ${newLob} on save`, 'info');
  }

  // Ref number suffix based on LOB
  function getRefSuffix(targetLob) {
    const suffixes = {
      'Fire': '/Fire', 'Engineering': '/Engg', 'Business Interruption': '/BI',
      'Miscellaneous': '/Misc.', 'Liability': '/LIABILITY', 'Marine Hull': '/Hull',
      'Cat Event': '/CAT', 'Extended Warranty': 'EW-', 'Banking': 'INS-',
    };
    return suffixes[targetLob] || `/${targetLob}`;
  }

  async function saveClaim() {
    if (!formData.date_intimation || !formData.date_loss || !formData.loss_location || !formData.insured_name || !formData.status) {
      showAlertMsg('Please fill in all required fields (marked with *)', 'error');
      return;
    }

    const payload = { ...formData, lob: formData._new_lob || lob, company };
    delete payload._tentative_ref;
    delete payload.id;
    delete payload.created_at;

    // Handle manual ref number for new claims
    if (!editId && useManualRef && manualRefNumber) {
      payload._manual_ref_number = manualRefNumber;
    }

    try {
      if (editId) {
        const res = await fetch(`/api/claims/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Update failed'); }

        // Upload intimation sheet for existing claim if file selected
        if (intimationFile) {
          await uploadIntimationSheet(editId, formData.ref_number);
        }

        showAlertMsg('Claim updated successfully', 'success');
      } else {
        const res = await fetch('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Create failed'); }
        const result = await res.json();

        // Upload intimation sheet for new claim if file selected
        if (intimationFile) {
          await uploadIntimationSheet(result.id, result.ref_number);
        }

        showAlertMsg(`Claim created! Ref: ${result.ref_number}`, 'success');
      }
      closeModal();
      await loadClaims();
    } catch (e) {
      showAlertMsg('Failed: ' + e.message, 'error');
    }
  }

  async function uploadIntimationSheet(claimId, refNumber) {
    if (!intimationFile) return;
    try {
      setUploadingIntimation(true);
      const fd = new FormData();
      fd.append('file', intimationFile);
      fd.append('claim_id', claimId);
      fd.append('ref_number', refNumber || '');
      fd.append('file_type', 'intimation_sheet');
      fd.append('uploaded_by', formData.assigned_to || '');
      fd.append('company', company);

      const res = await fetch('/api/claim-documents', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json();
        console.error('Intimation upload error:', err);
      }
    } catch (err) {
      console.error('Failed to upload intimation sheet:', err);
    } finally {
      setUploadingIntimation(false);
    }
  }

  async function deleteClaim(id) {
    if (!confirm('Delete this claim? The reference number sequence will be adjusted.')) return;
    try {
      await fetch(`/api/claims/${id}`, { method: 'DELETE' });
      showAlertMsg('Claim deleted and counter adjusted', 'success');
      await loadClaims();
    } catch (e) {
      showAlertMsg('Failed to delete: ' + e.message, 'error');
    }
  }

  // Drag handlers
  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.modal-close') || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
        e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' || e.target.tagName === 'LABEL') return;
    const modal = modalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    // Only allow drag from the header area (top 50px)
    if (e.clientY - rect.top > 50) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - (hasDragged ? modalPos.x : rect.left), y: e.clientY - (hasDragged ? modalPos.y : rect.top) });
  }, [hasDragged, modalPos]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e) => {
      setModalPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
      setHasDragged(true);
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDragging, dragOffset]);

  const lobFields = {
    'Marine Cargo': ['client_category', 'consignor', 'consignee'],
    'Extended Warranty': ['model_spec', 'chassis_number', 'dealer_name', 'lot_number'],
    'Business Interruption': ['md_ref_number'],
    'Banking': ['lot_number'],
    'Marine Hull': ['vessel_name'],
  };
  const extraFields = lobFields[lob] || [];

  const modalStyle = hasDragged ? {
    position: 'fixed', left: modalPos.x, top: modalPos.y,
    transform: 'none', margin: 0,
  } : {};

  return (
    <>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 32 }}>{LOB_ICONS[lob]}</span>
          {lob} Claims
        </h2>
        <div className="button-group">
          <button className="success" onClick={openNewClaim}>+ New Claim</button>
        </div>

        <div className="filter-section">
          <h4 style={{ marginBottom: 15 }}>Filters</h4>
          <div className="filter-row">
            <input placeholder="Search by Ref Number" value={filterRef} onChange={e => setFilterRef(e.target.value)} />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="Open">Open</option>
              <option value="In Process">In Process</option>
              <option value="Submitted">Submitted</option>
            </select>
            <input placeholder="Search by Insurer" value={filterInsurer} onChange={e => setFilterInsurer(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading claims...</div>
        ) : claims.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No claims found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Ref Number</th>
                  <th>Claim Number</th>
                  <th>Insured Name</th>
                  <th>Insurer</th>
                  <th>Policy Type</th>
                  <th>Surveyor</th>
                  <th>Gross Loss</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map(c => (
                  <tr key={c.id}>
                    <td><a onClick={() => router.push(`/claim-detail/${c.id}`)} style={{ color: '#1e40af', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>{c.ref_number || '-'}</a></td>
                    <td>{c.claim_number || '-'}</td>
                    <td><a onClick={() => router.push(`/claim-detail/${c.id}`)} style={{ color: '#1e40af', cursor: 'pointer' }}>{c.insured_name || '-'}</a></td>
                    <td>{c.insurer_name || '-'}</td>
                    <td>{c.policy_type || '-'}</td>
                    <td>{c.surveyor_name || '-'}</td>
                    <td>{c.gross_loss ? parseFloat(c.gross_loss).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}</td>
                    <td>
                      <span className={`badge ${c.status.toLowerCase().replace(/\s+/g, '-')}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="action-buttons">
                      <button className="secondary" onClick={() => openEditClaim(c)}>Edit</button>
                      <button className="secondary" onClick={() => router.push(`/documents/${c.id}`)}>Docs</button>
                      <button className="primary" style={{ fontSize: 11 }} onClick={() => router.push(`/claim-lifecycle/${c.id}`)}>Lifecycle</button>
                      {c.folder_path && (
                        <>
                          <button className="secondary" style={{ fontSize: 11 }} onClick={() => {
                            const relativePath = c.folder_path.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
                            window.open(`${FILE_SERVER_URL}/browse?path=${encodeURIComponent(relativePath)}`, '_blank');
                          }}>Open</button>
                          <button className="secondary" style={{ fontSize: 11 }} onClick={() => { navigator.clipboard.writeText(c.folder_path); showAlertMsg('Folder path copied!', 'success'); }}>Copy</button>
                        </>
                      )}
                      <button className="danger" onClick={() => deleteClaim(c.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal show" onClick={e => {
          if (e.target.className.includes('modal show')) tryCloseModal();
        }}>
          <div
            ref={modalRef}
            className="modal-content wide"
            style={{ ...modalStyle, cursor: isDragging ? 'grabbing' : 'auto' }}
          >
            {/* Draggable header bar */}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab', padding: '0 0 15px 0', borderBottom: '2px solid #1e40af', marginBottom: 15, userSelect: 'none' }}
              onMouseDown={handleMouseDown}
            >
              <h3 style={{ margin: 0 }}>
                {editId ? 'Edit Claim' : 'Add New Claim'}
                {editId && formData._lob_changed && <span style={{ fontSize: 12, color: '#ea580c', marginLeft: 10 }}>(LOB changing to {formData._new_lob})</span>}
              </h3>
              <span style={{ fontSize: 14, color: '#999', cursor: 'grab' }}>Drag to move</span>
              <span className="modal-close" onClick={tryCloseModal} style={{ position: 'static', fontSize: 24, cursor: 'pointer' }}>&times;</span>
            </div>

            <div className="form-section">
              <h4>Basic Information</h4>
              {/* Reference Number with manual option */}
              <div className="form-group">
                <label>Ref Number</label>
                {!editId && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', fontWeight: 400 }}>
                      <input type="radio" checked={!useManualRef} onChange={() => { setUseManualRef(false); setManualRefNumber(''); }} /> Auto-generate
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', fontWeight: 400 }}>
                      <input type="radio" checked={useManualRef} onChange={() => setUseManualRef(true)} /> Enter manually
                    </label>
                  </div>
                )}
                {!editId && useManualRef ? (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input
                      value={manualRefNumber}
                      onChange={e => { setManualRefNumber(e.target.value); setFormDirty(true); }}
                      placeholder={`e.g. 5/26-27${getRefSuffix(lob)}`}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>Suffix ({getRefSuffix(lob)}) must be included</span>
                  </div>
                ) : (
                  <input disabled value={formData._tentative_ref || formData.ref_number || ''} />
                )}
              </div>

              <div className="form-row">
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>Policy Number</label>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <input
                      ref={policyInputRef}
                      value={policySearch || formData.policy_number || ''}
                      onChange={e => {
                        setPolicySearch(e.target.value);
                        setShowPolicyDropdown(true);
                        if (!e.target.value) updateFormData({ policy_number: '', insured_name: '', insurer_name: '' });
                      }}
                      onFocus={() => setShowPolicyDropdown(true)}
                      placeholder="Type to search policy..."
                      autoComplete="off"
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="secondary" style={{ fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}
                      onClick={() => { setShowNewPolicyForm(!showNewPolicyForm); setShowPolicyDropdown(false); setNewPolicyData({ lob, company }); }}>
                      {showNewPolicyForm ? 'Cancel' : '+ New'}
                    </button>
                  </div>
                  {showPolicyDropdown && filteredPolicies.length > 0 && (
                    <div ref={policyDropdownRef} style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                      background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
                      maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}>
                      {filteredPolicies.slice(0, 20).map(p => (
                        <div key={p.id}
                          onClick={() => handlePolicySelect(p.policy_number)}
                          style={{
                            padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6',
                            fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                          }}
                          onMouseEnter={e => e.target.style.background = '#eff6ff'}
                          onMouseLeave={e => e.target.style.background = '#fff'}
                        >
                          <span style={{ fontWeight: 600 }}>{p.policy_number}</span>
                          <span style={{ color: '#6b7280', fontSize: 11 }}>{p.insured_name} | {p.insurer}</span>
                        </div>
                      ))}
                      {filteredPolicies.length > 20 && (
                        <div style={{ padding: '6px 12px', fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
                          {filteredPolicies.length - 20} more results... Type to narrow down
                        </div>
                      )}
                    </div>
                  )}
                  {showPolicyDropdown && policySearch && filteredPolicies.length === 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                      background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
                      padding: '12px', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}>
                      <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>No matching policies found</p>
                      <button type="button" className="success" style={{ fontSize: 11, marginTop: 8, padding: '4px 12px' }}
                        onClick={() => { setShowNewPolicyForm(true); setShowPolicyDropdown(false); setNewPolicyData({ policy_number: policySearch, lob, company }); }}>
                        + Create New Policy
                      </button>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Insured Name *</label>
                  <input value={formData.insured_name || ''} onChange={e => updateFormData({ insured_name: e.target.value })} required />
                </div>
              </div>

              {/* Inline New Policy Form */}
              {showNewPolicyForm && (
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: 15, marginBottom: 15 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h4 style={{ margin: 0, fontSize: 14, color: '#166534' }}>Create New Policy</h4>
                    <button type="button" onClick={() => { setShowNewPolicyForm(false); setNewPolicyData({}); }}
                      style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#666' }}>&times;</button>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>Policy Number *</label>
                      <input value={newPolicyData.policy_number || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, policy_number: e.target.value }))} placeholder="Enter policy number" />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>Insured Name</label>
                      <input value={newPolicyData.insured_name || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, insured_name: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>Insurer</label>
                      <select value={newPolicyData.insurer || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, insurer: e.target.value }))}>
                        <option value="">-- Select Insurer --</option>
                        {insurers.map(i => <option key={i.id} value={i.company_name}>{i.company_name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>Sum Insured</label>
                      <input type="number" value={newPolicyData.sum_insured || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, sum_insured: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>Start Date</label>
                      <input type="date" value={newPolicyData.start_date || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, start_date: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>End Date</label>
                      <input type="date" value={newPolicyData.end_date || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, end_date: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>Risk Location</label>
                      <input value={newPolicyData.risk_location || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, risk_location: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: 12 }}>Insured Address</label>
                      <input value={newPolicyData.insured_address || ''} onChange={e => setNewPolicyData(prev => ({ ...prev, insured_address: e.target.value }))} />
                    </div>
                  </div>
                  <button className="success" style={{ fontSize: 12, marginTop: 5 }} onClick={saveNewPolicy} disabled={savingPolicy}>
                    {savingPolicy ? 'Saving...' : 'Save Policy & Select'}
                  </button>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Insurer Name</label>
                  <select value={formData.insurer_name || ''} onChange={e => updateFormData({ insurer_name: e.target.value })}>
                    <option value="">-- Select Insurer --</option>
                    {insurers.map(i => <option key={i.id} value={i.company_name}>{i.company_name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Claim Number</label>
                  <input value={formData.claim_number || ''} onChange={e => updateFormData({ claim_number: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Appointed By</label>
                  <select value={formData.appointing_type || ''} onChange={e => {
                    updateFormData({ appointing_type: e.target.value, appointing_office: '' });
                  }}>
                    <option value="">-- Select --</option>
                    <option value="Insured">Insured</option>
                    <option value="Broker">Broker</option>
                    <option value="Insurer">Insurer</option>
                  </select>
                </div>
                {formData.appointing_type === 'Insurer' && (
                  <div className="form-group">
                    <label>Appointing Insurer Office</label>
                    <select value={formData.appointing_office || ''} onChange={e => updateFormData({ appointing_office: e.target.value })}>
                      <option value="">-- Select Office --</option>
                      {offices.map(o => <option key={o.id} value={`${o.name} - ${o.company}`}>{o.name} - {o.company} ({o.city})</option>)}
                    </select>
                  </div>
                )}
                {formData.appointing_type === 'Broker' && (
                  <div className="form-group">
                    <label>Select Broker</label>
                    <select value={formData.broker_name || ''} onChange={e => {
                      const broker = brokers.find(b => b.broker_name === e.target.value);
                      updateFormData({ broker_name: e.target.value, broker_id: broker?.id || null });
                    }}>
                      <option value="">-- Select Broker --</option>
                      {brokers.filter(b => b.status === 'Active').map(b => <option key={b.id} value={b.broker_name}>{b.broker_name}{b.city ? ` (${b.city})` : ''}</option>)}
                    </select>
                  </div>
                )}
                {formData.appointing_type !== 'Insurer' && formData.appointing_type !== 'Broker' && (
                  <div className="form-group">
                    <label>&nbsp;</label>
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Policy Type</label>
                  <select value={formData.policy_type || ''} onChange={e => updateFormData({ policy_type: e.target.value })}>
                    <option value="">-- Select --</option>
                    {policyTypes.map(pt => <option key={pt.id} value={pt.policy_type}>{pt.policy_type}</option>)}
                  </select>
                </div>
                <div className="form-group">&nbsp;</div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Surveyor Name</label>
                  <select value={formData.surveyor_name || ''} onChange={e => updateFormData({ surveyor_name: e.target.value })}>
                    <option value="">-- Select Surveyor --</option>
                    {surveyors.map(s => <option key={s.id} value={s.name}>{s.name}{s.designation ? ` (${s.designation})` : ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Assign to Team Member</label>
                  <select value={formData.assigned_to || ''} onChange={e => updateFormData({ assigned_to: e.target.value })}>
                    <option value="">-- Select Team Member --</option>
                    {teamUsers.map(u => <option key={u.id} value={u.email}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  {editId && (
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: 12, padding: '8px 12px' }}
                      onClick={handleLobChangeToggle}
                    >
                      {showLobChange ? 'Cancel LOB Change' : 'Change LOB / Claim Type'}
                    </button>
                  )}
                </div>
                <div className="form-group">&nbsp;</div>
              </div>
            </div>

            {/* LOB Change Section (only in edit mode) */}
            {showLobChange && (
              <div className="form-section" style={{ background: '#fff7ed', borderColor: '#ea580c' }}>
                <h4 style={{ borderBottomColor: '#ea580c', color: '#ea580c' }}>Change LOB / Claim Type</h4>
                <p style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                  Select new LOB and Policy Type. The claim reference number will remain the same.
                </p>
                <div className="form-row">
                  <div className="form-group">
                    <label>New LOB</label>
                    <select value={newLob} onChange={e => handleNewLobSelect(e.target.value)}>
                      {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>New Policy Type</label>
                    <select value={newPolicyType} onChange={e => setNewPolicyType(e.target.value)}>
                      <option value="">-- Select --</option>
                      {newLobPolicyTypes.map(pt => <option key={pt.id} value={pt.policy_type}>{pt.policy_type}</option>)}
                    </select>
                  </div>
                </div>
                <button className="success" style={{ fontSize: 12 }} onClick={applyLobChange}>Apply LOB Change</button>
              </div>
            )}

            <div className="form-section">
              <h4>Contact &amp; Additional Details</h4>
              <div className="form-row">
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Insured Address</label>
                  <textarea
                    value={formData.insured_address || ''}
                    onChange={e => updateFormData({ insured_address: e.target.value })}
                    rows={2}
                    placeholder="Address of the insured party"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Insurer Address</label>
                  <textarea
                    value={formData.insurer_address || ''}
                    onChange={e => updateFormData({ insurer_address: e.target.value })}
                    rows={2}
                    placeholder="Address of the insurer office"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Claim File No.</label>
                  <input
                    value={formData.claim_file_no || ''}
                    onChange={e => updateFormData({ claim_file_no: e.target.value })}
                    placeholder="Insurer's claim file number"
                  />
                </div>
                <div className="form-group">
                  <label>Person Contacted</label>
                  <input
                    value={formData.person_contacted || ''}
                    onChange={e => updateFormData({ person_contacted: e.target.value })}
                    placeholder="Name of person contacted"
                  />
                </div>
                <div className="form-group">
                  <label>Estimated Loss Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.estimated_loss_amount || ''}
                    onChange={e => updateFormData({ estimated_loss_amount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Important Dates</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Date of Intimation *</label>
                  <input type="date" value={formData.date_intimation || ''} onChange={e => updateFormData({ date_intimation: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Date of Loss *</label>
                  <input type="date" value={formData.date_loss || ''} onChange={e => updateFormData({ date_loss: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Date of Survey</label>
                  <input type="date" value={formData.date_survey || ''} onChange={e => updateFormData({ date_survey: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Date of LOR</label>
                  <input type="date" value={formData.date_lor || ''} onChange={e => updateFormData({ date_lor: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Date of FSR</label>
                  <input type="date" value={formData.date_fsr || ''} onChange={e => updateFormData({ date_fsr: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Date of Submission</label>
                  <input type="date" value={formData.date_submission || ''} onChange={e => updateFormData({ date_submission: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Loss Information</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Loss Location *</label>
                  <input value={formData.loss_location || ''} onChange={e => updateFormData({ loss_location: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Place of Survey</label>
                  <input value={formData.place_survey || ''} onChange={e => updateFormData({ place_survey: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Gross Loss</label>
                  <input type="number" step="0.01" value={formData.gross_loss || ''} onChange={e => updateFormData({ gross_loss: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Assessed Loss</label>
                  <input type="number" step="0.01" value={formData.assessed_loss || ''} onChange={e => updateFormData({ assessed_loss: e.target.value })} />
                </div>
              </div>
            </div>

            {extraFields.length > 0 && (
              <div className="form-section">
                <h4>Additional Information</h4>
                <div className="lob-fields" style={{ display: 'block' }}>
                  {extraFields.includes('client_category') && (
                    <div className="form-group">
                      <label>Client Category</label>
                      <input disabled value={formData.client_category || clientCategory} />
                    </div>
                  )}
                  {extraFields.includes('consignor') && (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Consignor</label>
                        <input value={formData.consignor || ''} onChange={e => updateFormData({ consignor: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Consignee</label>
                        <input value={formData.consignee || ''} onChange={e => updateFormData({ consignee: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {extraFields.includes('model_spec') && (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Model / Spec / Class</label>
                        <input value={formData.model_spec || ''} onChange={e => updateFormData({ model_spec: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Chassis Number</label>
                        <input value={formData.chassis_number || ''} onChange={e => updateFormData({ chassis_number: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {extraFields.includes('dealer_name') && (
                    <div className="form-row">
                      <div className="form-group">
                        <label>Dealer Name</label>
                        <input value={formData.dealer_name || ''} onChange={e => updateFormData({ dealer_name: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Lot Number</label>
                        <input value={formData.lot_number || ''} onChange={e => updateFormData({ lot_number: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {extraFields.includes('vessel_name') && (
                    <div className="form-group">
                      <label>Vessel Name</label>
                      <input value={formData.vessel_name || ''} onChange={e => updateFormData({ vessel_name: e.target.value })} />
                    </div>
                  )}
                  {extraFields.includes('md_ref_number') && (
                    <div className="form-group">
                      <label>MD Ref Number</label>
                      <input value={formData.md_ref_number || ''} onChange={e => updateFormData({ md_ref_number: e.target.value })} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="form-section">
              <h4>Survey Fee Details</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Survey Fee Bill Number</label>
                  <input value={formData.survey_fee_bill_number || ''} onChange={e => updateFormData({ survey_fee_bill_number: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Survey Fee Bill Date</label>
                  <input type="date" value={formData.survey_fee_bill_date || ''} onChange={e => updateFormData({ survey_fee_bill_date: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Survey Fee Bill Amount</label>
                  <input type="number" step="0.01" value={formData.survey_fee_bill_amount || ''} onChange={e => updateFormData({ survey_fee_bill_amount: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Payment Receipt Date</label>
                  <input type="date" value={formData.survey_fee_payment_date || ''} onChange={e => updateFormData({ survey_fee_payment_date: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Status & Notes</h4>
              <div className="form-group">
                <label>Status *</label>
                <select value={formData.status || 'Open'} onChange={e => updateFormData({ status: e.target.value })} required>
                  <option value="">-- Select --</option>
                  <option value="Open">Open</option>
                  <option value="In Process">In Process</option>
                  <option value="Submitted">Submitted</option>
                </select>
              </div>
              <div className="form-group">
                <label>Remark</label>
                <textarea value={formData.remark || ''} onChange={e => updateFormData({ remark: e.target.value })} rows={3} />
              </div>
            </div>

            {/* Upload Intimation Sheet (PDF) */}
            <div className="form-section" style={{ background: '#fef3c7', padding: 15, borderRadius: 8, border: '1px solid #fde68a' }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#92400e' }}>Upload Intimation Sheet (PDF)</h4>
              <p style={{ fontSize: 11, color: '#78716c', margin: '0 0 10px' }}>
                Attach the intimation sheet received for this claim. This will be stored in the claim's document folder.
              </p>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setIntimationFile(file);
                  if (file) setFormDirty(true);
                }}
                style={{ fontSize: 12 }}
              />
              {intimationFile && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#065f46', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>Selected:</span> {intimationFile.name}
                  <span style={{ color: '#6b7280' }}>({(intimationFile.size / 1024).toFixed(1)} KB)</span>
                  <button type="button" onClick={() => setIntimationFile(null)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}>Remove</button>
                </div>
              )}
              {uploadingIntimation && <p style={{ fontSize: 11, color: '#0284c7', marginTop: 6 }}>Uploading...</p>}
            </div>

            {/* Upload Documents to Claim Folder */}
            {editId && formData.folder_path && (
              <div className="form-section" style={{ background: '#f0f7ff', padding: 15, borderRadius: 8 }}>
                <h4>Upload Documents to Claim Folder</h4>
                <p style={{ fontSize: 12, color: '#666', margin: '5px 0 10px' }}>
                  Files uploaded here will be saved directly to: <strong>{formData.folder_path}</strong>
                </p>
                <input
                  type="file"
                  multiple
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (!files.length) return;
                    const fd = new FormData();
                    const relativePath = formData.folder_path.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
                    fd.append('folder_path', relativePath);
                    for (let i = 0; i < files.length; i++) fd.append('files', files[i]);
                    try {
                      showAlertMsg('Uploading...', 'info');
                      const res = await fetch(`${FILE_SERVER_URL}/api/upload?folder_path=${encodeURIComponent(relativePath)}`, {
                        method: 'POST',
                        headers: { 'X-API-Key': FILE_SERVER_KEY },
                        body: fd
                      });
                      const data = await res.json();
                      if (data.success) {
                        showAlertMsg(`${data.files.length} file(s) uploaded to claim folder!`, 'success');
                      } else {
                        showAlertMsg(data.error || 'Upload failed', 'error');
                      }
                    } catch (err) {
                      showAlertMsg('Upload failed: ' + err.message, 'error');
                    }
                    e.target.value = '';
                  }}
                  style={{ fontSize: 12 }}
                />
                <button className="secondary" style={{ marginTop: 8, fontSize: 12 }} onClick={() => {
                  const relativePath = formData.folder_path.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
                  window.open(`${FILE_SERVER_URL}/browse?path=${encodeURIComponent(relativePath)}`, '_blank');
                }}>View Folder Contents</button>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <button className="success" style={{ width: '100%' }} onClick={saveClaim}>Save Claim</button>
              <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={tryCloseModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ClaimsLob() {
  return (
    <PageLayout>
      <Suspense fallback={<div className="main-content"><div className="loading">Loading...</div></div>}>
        <ClaimsLobContent />
      </Suspense>
    </PageLayout>
  );
}
