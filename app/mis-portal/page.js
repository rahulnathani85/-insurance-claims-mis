'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST, FILE_SERVER_URL, FILE_SERVER_KEY } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';
import { PIPELINE_STAGE_NAMES } from '@/lib/pipelineStages';

function MISPortalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { company } = useCompany();
  const isAllMode = company === 'All';
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [alert, setAlert] = useState(null);
  const [showFilters, setShowFilters] = useState(true);

  // All filters
  const [filterLob, setFilterLob] = useState('');
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '');
  const [filterRef, setFilterRef] = useState('');
  const [filterInsurer, setFilterInsurer] = useState('');
  const [filterInsured, setFilterInsured] = useState('');
  const [filterPolicyNumber, setFilterPolicyNumber] = useState('');
  const [filterClaimNumber, setFilterClaimNumber] = useState('');
  const [filterPolicyType, setFilterPolicyType] = useState('');
  const [filterPipeline, setFilterPipeline] = useState('');
  const [filterDateLossFrom, setFilterDateLossFrom] = useState('');
  const [filterDateLossTo, setFilterDateLossTo] = useState('');
  const [filterDateIntFrom, setFilterDateIntFrom] = useState('');
  const [filterDateIntTo, setFilterDateIntTo] = useState('');
  const [filterDateSubFrom, setFilterDateSubFrom] = useState('');
  const [filterDateSubTo, setFilterDateSubTo] = useState('');
  const [filterCompany, setFilterCompany] = useState('');

  useEffect(() => { loadClaims(); }, [filterLob, filterStatus, filterRef, filterInsurer, filterInsured, filterPolicyNumber, filterClaimNumber, filterPolicyType, filterDateLossFrom, filterDateLossTo, filterDateIntFrom, filterDateIntTo, filterDateSubFrom, filterDateSubTo, company, filterCompany]);

  async function loadClaims() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('company', company);
      if (filterLob) params.append('lob', filterLob);
      if (filterStatus) params.append('status', filterStatus);
      if (filterRef) params.append('ref_number', filterRef);
      if (filterInsurer) params.append('insurer_name', filterInsurer);
      if (filterInsured) params.append('insured_name', filterInsured);
      if (filterPolicyNumber) params.append('policy_number', filterPolicyNumber);
      if (filterClaimNumber) params.append('claim_number', filterClaimNumber);
      if (filterDateLossFrom) params.append('date_loss_from', filterDateLossFrom);
      if (filterDateLossTo) params.append('date_loss_to', filterDateLossTo);
      if (filterDateIntFrom) params.append('date_intimation_from', filterDateIntFrom);
      if (filterDateIntTo) params.append('date_intimation_to', filterDateIntTo);

      const data = await fetch('/api/claims?' + params.toString()).then(r => r.json());
      let result = Array.isArray(data) ? data : [];

      // Always exclude Extended Warranty claims — they have a dedicated Extended Warranty MIS page
      result = result.filter(c => c.lob !== 'Extended Warranty');

      // Client-side filters
      if (filterPolicyType) result = result.filter(c => c.policy_type?.toLowerCase().includes(filterPolicyType.toLowerCase()));
      if (filterPipeline) result = result.filter(c => c.pipeline_stage === filterPipeline);
      if (filterDateSubFrom) result = result.filter(c => c.date_submission >= filterDateSubFrom);
      if (filterDateSubTo) result = result.filter(c => c.date_submission <= filterDateSubTo);
      if (isAllMode && filterCompany) result = result.filter(c => c.company === filterCompany);

      setClaims(result);
    } catch (error) {
      console.error('Failed to load claims:', error);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setFilterLob(''); setFilterStatus(''); setFilterRef(''); setFilterInsurer('');
    setFilterInsured(''); setFilterPolicyNumber(''); setFilterClaimNumber('');
    setFilterPolicyType(''); setFilterDateLossFrom(''); setFilterDateLossTo('');
    setFilterDateIntFrom(''); setFilterDateIntTo(''); setFilterDateSubFrom(''); setFilterDateSubTo('');
    setFilterCompany('');
  }

  function openViewModal(claim) {
    setSelectedClaim(claim);
    setShowViewModal(true);
  }

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  async function exportToExcel() {
    try {
      const headers = ['Ref Number', 'Claim Number', 'LOB', 'Policy Number', 'Policy Type', 'Insured Name', 'Insurer', 'Surveyor', 'Appointed By', 'Appointing Office', 'Date Intimation', 'Date Loss', 'Loss Location', 'Place of Survey', 'Gross Loss', 'Assessed Loss', 'Date Survey', 'Date LOR', 'Date FSR', 'Date Submission', 'Status', 'Survey Fee Bill No', 'Survey Fee Amount', 'Survey Fee Payment Date', 'Remark', 'Folder Path'];
      if (isAllMode) headers.splice(2, 0, 'Company');
      const rows = claims.map(c => {
        const row = [
          c.ref_number || '', c.claim_number || '', c.lob || '', c.policy_number || '', c.policy_type || '',
          c.insured_name || '', c.insurer_name || '', c.surveyor_name || '', c.appointing_type || '', c.appointing_office || '', c.date_of_intimation || '', c.date_loss || '',
          c.loss_location || '', c.place_survey || '',
          c.gross_loss || '', c.assessed_loss || '',
          c.date_survey || '', c.date_lor || '', c.date_fsr || '', c.date_submission || '', c.status || '',
          c.survey_fee_bill_number || '', c.survey_fee_bill_amount || '', c.survey_fee_payment_date || '',
          c.remark || '', c.folder_path || ''
        ];
        if (isAllMode) row.splice(2, 0, c.company || '');
        return row;
      });
      const csvContent = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `MIS_${company}_${new Date().toISOString().split('T')[0]}.csv`);
      link.click();
      showAlertMsg('Exported to Excel', 'success');
    } catch (error) {
      showAlertMsg('Export failed: ' + error.message, 'error');
    }
  }

  const activeFilterCount = [filterLob, filterStatus, filterRef, filterInsurer, filterInsured, filterPolicyNumber, filterClaimNumber, filterPolicyType, filterDateLossFrom, filterDateLossTo, filterDateIntFrom, filterDateIntTo, filterDateSubFrom, filterDateSubTo, filterCompany].filter(Boolean).length;

  return (
    <div className="main-content">
      {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
      <h2>MIS Portal {isAllMode && <span style={{ fontSize: 14, color: '#7c3aed', fontWeight: 400 }}>(Combined View - All Firms)</span>}</h2>

      <div className="button-group">
        <button className="success" onClick={exportToExcel}>Export to Excel</button>
        <button className="secondary" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? 'Hide' : 'Show'} Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
        </button>
        {activeFilterCount > 0 && (
          <button className="secondary" onClick={clearFilters} style={{ color: '#dc2626' }}>Clear All Filters</button>
        )}
      </div>

      {showFilters && (
        <div className="filter-section">
          <h4 style={{ marginBottom: 15 }}>Search & Filter</h4>
          <div className="filter-row">
            <input placeholder="Ref Number" value={filterRef} onChange={e => setFilterRef(e.target.value)} />
            <input placeholder="Claim Number" value={filterClaimNumber} onChange={e => setFilterClaimNumber(e.target.value)} />
            <input placeholder="Insured Name" value={filterInsured} onChange={e => setFilterInsured(e.target.value)} />
            <input placeholder="Policy Number" value={filterPolicyNumber} onChange={e => setFilterPolicyNumber(e.target.value)} />
          </div>
          <div className="filter-row">
            <select value={filterLob} onChange={e => setFilterLob(e.target.value)}>
              <option value="">All LOBs (excl. Extended Warranty)</option>
              {LOB_LIST.filter(lob => lob !== 'Extended Warranty').map(lob => <option key={lob} value={lob}>{lob}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="Open">Open</option>
              <option value="In Process">In Process</option>
              <option value="Submitted">Submitted</option>
            </select>
            <input placeholder="Insurer Name" value={filterInsurer} onChange={e => setFilterInsurer(e.target.value)} />
            <input placeholder="Policy Type" value={filterPolicyType} onChange={e => setFilterPolicyType(e.target.value)} />
            <select value={filterPipeline} onChange={e => setFilterPipeline(e.target.value)}>
              <option value="">All Pipeline Stages</option>
              {PIPELINE_STAGE_NAMES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {isAllMode && (
            <div className="filter-row">
              <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}>
                <option value="">All Companies</option>
                <option value="NISLA">NISLA</option>
                <option value="Acuere">Acuere</option>
              </select>
            </div>
          )}
          <div className="filter-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <span>Loss Date:</span>
              <input type="date" value={filterDateLossFrom} onChange={e => setFilterDateLossFrom(e.target.value)} />
              <span>to</span>
              <input type="date" value={filterDateLossTo} onChange={e => setFilterDateLossTo(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <span>Intimation:</span>
              <input type="date" value={filterDateIntFrom} onChange={e => setFilterDateIntFrom(e.target.value)} />
              <span>to</span>
              <input type="date" value={filterDateIntTo} onChange={e => setFilterDateIntTo(e.target.value)} />
            </div>
          </div>
          <div className="filter-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <span>Submission:</span>
              <input type="date" value={filterDateSubFrom} onChange={e => setFilterDateSubFrom(e.target.value)} />
              <span>to</span>
              <input type="date" value={filterDateSubTo} onChange={e => setFilterDateSubTo(e.target.value)} />
            </div>
          </div>
        </div>
      )}

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
                <th>Claim No</th>
                {isAllMode && <th>Company</th>}
                <th>LOB</th>
                <th>Policy No</th>
                <th>Policy Type</th>
                <th>Insured Name</th>
                <th>Insurer</th>
                <th>Surveyor</th>
                <th>Appointed By</th>
                <th>Appointing Office</th>
                <th>Date Intimation</th>
                <th>Date Loss</th>
                <th>Loss Location</th>
                <th>Gross Loss</th>
                <th>Assessed Loss</th>
                <th>Date Survey</th>
                <th>Date LOR</th>
                <th>Date FSR</th>
                <th>Date Submission</th>
                <th>Status</th>
                <th>Pipeline</th>
                <th>Survey Fee</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}><a onClick={() => router.push(`/claim-detail/${c.id}`)} style={{ color: '#1e40af', cursor: 'pointer', textDecoration: 'underline' }}>{c.ref_number || '-'}</a></td>
                  <td>{c.claim_number || '-'}</td>
                  {isAllMode && <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: c.company === 'NISLA' ? '#dbeafe' : '#dcfce7', color: c.company === 'NISLA' ? '#1e40af' : '#15803d' }}>{c.company}</span></td>}
                  <td>{c.lob || '-'}</td>
                  <td>{c.policy_number || '-'}</td>
                  <td>{c.policy_type || '-'}</td>
                  <td>{c.insured_name || '-'}</td>
                  <td>{c.insurer_name || '-'}</td>
                  <td>{c.surveyor_name || '-'}</td>
                  <td>{c.appointing_type || '-'}</td>
                  <td>{c.appointing_office || '-'}</td>
                  <td>{c.date_of_intimation || '-'}</td>
                  <td>{c.date_loss || '-'}</td>
                  <td>{c.loss_location || '-'}</td>
                  <td>{c.gross_loss ? parseFloat(c.gross_loss).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}</td>
                  <td>{c.assessed_loss ? parseFloat(c.assessed_loss).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}</td>
                  <td>{c.date_survey || '-'}</td>
                  <td>{c.date_lor || '-'}</td>
                  <td>{c.date_fsr || '-'}</td>
                  <td>{c.date_submission || '-'}</td>
                  <td><span className={`badge ${c.status?.toLowerCase().replace(/\s+/g, '-')}`}>{c.status}</span></td>
                  <td style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>{c.pipeline_stage || '-'}</td>
                  <td style={{ fontSize: 11 }}>{c.survey_fee_bill_number || '-'}{c.survey_fee_bill_amount ? ` (₹${parseFloat(c.survey_fee_bill_amount).toLocaleString('en-IN')})` : ''}</td>
                  <td className="action-buttons" style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openViewModal(c)}>View</button>
                    {!isAllMode && <button className="secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => router.push(`/documents/${c.id}`)}>Docs</button>}
                    {c.folder_path && !isAllMode && (
                      <>
                        <button className="secondary" style={{ fontSize: 11, padding: '4px 6px' }} onClick={() => {
                          const relativePath = c.folder_path.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
                          window.open(`${FILE_SERVER_URL}/browse?path=${encodeURIComponent(relativePath)}`, '_blank');
                        }}>Open</button>
                        <button className="secondary" style={{ fontSize: 11, padding: '4px 6px' }} onClick={() => { navigator.clipboard.writeText(c.folder_path); showAlertMsg('Path copied!', 'success'); }}>Copy</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ marginTop: 20, color: '#666', fontSize: 12 }}>Total Records: {claims.length}</p>

      {/* View Modal */}
      {showViewModal && selectedClaim && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowViewModal(false)}>
          <div className="modal-content" style={{ maxWidth: 950 }}>
            <span className="modal-close" onClick={() => setShowViewModal(false)}>&times;</span>
            <h3>Claim Details - {selectedClaim.ref_number}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
              <div>
                <h4 style={{ marginBottom: 15, color: '#1e3a8a' }}>Basic Information</h4>
                {[['Ref Number', selectedClaim.ref_number], ['Claim Number', selectedClaim.claim_number], ['LOB', selectedClaim.lob], ['Policy Number', selectedClaim.policy_number], ['Policy Type', selectedClaim.policy_type], ['Insured Name', selectedClaim.insured_name], ['Insurer', selectedClaim.insurer_name], ['Surveyor', selectedClaim.surveyor_name], ['Appointed By', selectedClaim.appointing_type], ['Appointing Office', selectedClaim.appointing_office], ['Company', selectedClaim.company]].map(([l, v]) => (
                  <div key={l} style={{ marginBottom: 8, fontSize: 13 }}><strong>{l}:</strong> {v || '-'}</div>
                ))}
              </div>
              <div>
                <h4 style={{ marginBottom: 15, color: '#1e3a8a' }}>Dates</h4>
                {[['Date Intimation', selectedClaim.date_of_intimation], ['Date Loss', selectedClaim.date_loss], ['Date Survey', selectedClaim.date_survey], ['Date LOR', selectedClaim.date_lor], ['Date FSR', selectedClaim.date_fsr], ['Date Submission', selectedClaim.date_submission]].map(([l, v]) => (
                  <div key={l} style={{ marginBottom: 8, fontSize: 13 }}><strong>{l}:</strong> {v || '-'}</div>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 15 }}>
              <div>
                <h4 style={{ marginBottom: 15, color: '#1e3a8a' }}>Loss Information</h4>
                {[['Loss Location', selectedClaim.loss_location], ['Place of Survey', selectedClaim.place_survey], ['Gross Loss', selectedClaim.gross_loss ? `₹${parseFloat(selectedClaim.gross_loss).toLocaleString('en-IN')}` : '-'], ['Assessed Loss', selectedClaim.assessed_loss ? `₹${parseFloat(selectedClaim.assessed_loss).toLocaleString('en-IN')}` : '-'], ['Status', selectedClaim.status]].map(([l, v]) => (
                  <div key={l} style={{ marginBottom: 8, fontSize: 13 }}><strong>{l}:</strong> {v || '-'}</div>
                ))}
              </div>
              <div>
                <h4 style={{ marginBottom: 15, color: '#1e3a8a' }}>Survey Fee Details</h4>
                {[['Bill Number', selectedClaim.survey_fee_bill_number], ['Bill Date', selectedClaim.survey_fee_bill_date], ['Bill Amount', selectedClaim.survey_fee_bill_amount ? `₹${parseFloat(selectedClaim.survey_fee_bill_amount).toLocaleString('en-IN')}` : '-'], ['Payment Date', selectedClaim.survey_fee_payment_date]].map(([l, v]) => (
                  <div key={l} style={{ marginBottom: 8, fontSize: 13 }}><strong>{l}:</strong> {v || '-'}</div>
                ))}
              </div>
            </div>
            {selectedClaim.folder_path && (
              <div style={{ marginTop: 15, padding: 10, background: '#f0f7ff', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong>Folder Path:</strong> {selectedClaim.folder_path}
                <button className="secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { navigator.clipboard.writeText(selectedClaim.folder_path); showAlertMsg('Path copied!', 'success'); }}>Copy</button>
                {!isAllMode && (
                  <button className="primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => {
                    const relativePath = selectedClaim.folder_path.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
                    window.open(`${FILE_SERVER_URL}/browse?path=${encodeURIComponent(relativePath)}`, '_blank');
                  }}>Open Folder</button>
                )}
              </div>
            )}
            {selectedClaim.remark && (
              <div style={{ marginTop: 15 }}><h4 style={{ color: '#1e3a8a' }}>Remarks</h4><p style={{ color: '#666', fontSize: 13 }}>{selectedClaim.remark}</p></div>
            )}
            {(selectedClaim.client_category || selectedClaim.consignor || selectedClaim.vessel_name || selectedClaim.model_spec || selectedClaim.chassis_number || selectedClaim.md_ref_number) && (
              <div style={{ marginTop: 15 }}>
                <h4 style={{ color: '#1e3a8a', marginBottom: 10 }}>Additional Details</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  {selectedClaim.client_category && <div style={{ fontSize: 13 }}><strong>Client Category:</strong> {selectedClaim.client_category}</div>}
                  {selectedClaim.consignor && <div style={{ fontSize: 13 }}><strong>Consignor:</strong> {selectedClaim.consignor}</div>}
                  {selectedClaim.consignee && <div style={{ fontSize: 13 }}><strong>Consignee:</strong> {selectedClaim.consignee}</div>}
                  {selectedClaim.vessel_name && <div style={{ fontSize: 13 }}><strong>Vessel:</strong> {selectedClaim.vessel_name}</div>}
                  {selectedClaim.model_spec && <div style={{ fontSize: 13 }}><strong>Model/Spec:</strong> {selectedClaim.model_spec}</div>}
                  {selectedClaim.chassis_number && <div style={{ fontSize: 13 }}><strong>Chassis:</strong> {selectedClaim.chassis_number}</div>}
                  {selectedClaim.dealer_name && <div style={{ fontSize: 13 }}><strong>Dealer:</strong> {selectedClaim.dealer_name}</div>}
                  {selectedClaim.lot_number && <div style={{ fontSize: 13 }}><strong>Lot Number:</strong> {selectedClaim.lot_number}</div>}
                  {selectedClaim.md_ref_number && <div style={{ fontSize: 13 }}><strong>MD Ref:</strong> {selectedClaim.md_ref_number}</div>}
                </div>
              </div>
            )}
            <div style={{ marginTop: 20 }}>
              <button className="secondary" style={{ width: '100%' }} onClick={() => setShowViewModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MISPortal() {
  return (
    <PageLayout>
      <Suspense fallback={<div className="main-content"><div className="loading">Loading...</div></div>}>
        <MISPortalContent />
      </Suspense>
    </PageLayout>
  );
}
