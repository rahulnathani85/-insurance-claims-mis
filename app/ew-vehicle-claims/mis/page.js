'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';

const STATUS_LIST = ['Open', 'In Progress', 'Assessment', 'Report Ready', 'Completed', 'Closed'];

const STATUS_COLORS = {
  'Open':         { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
  'In Progress':  { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  'Assessment':   { bg: '#fce7f3', color: '#9d174d', border: '#f9a8d4' },
  'Report Ready': { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  'Completed':    { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  'Closed':       { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
};

export default function EWMISPortal() {
  const router = useRouter();
  const { company } = useCompany();
  const isAllMode = company === 'All';

  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [showFilters, setShowFilters] = useState(true);

  // Filters
  const [filterRef, setFilterRef] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterInsurer, setFilterInsurer] = useState('');
  const [filterRegNo, setFilterRegNo] = useState('');
  const [filterChassis, setFilterChassis] = useState('');
  const [filterDealer, setFilterDealer] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterLot, setFilterLot] = useState('');

  useEffect(() => { loadClaims(); }, [company]);

  async function loadClaims() {
    try {
      setLoading(true);
      const url = `/api/ew-claims?company=${encodeURIComponent(company)}&t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load EW claims:', e);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }

  function showAlertMsg(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  }

  function clearFilters() {
    setFilterRef(''); setFilterCustomer(''); setFilterInsurer(''); setFilterRegNo('');
    setFilterChassis(''); setFilterDealer(''); setFilterStatus(''); setFilterStage('');
    setFilterDateFrom(''); setFilterDateTo(''); setFilterCompany(''); setFilterLot('');
  }

  // Unique list of lots present in the current dataset, for the dropdown.
  const lotOptions = Array.from(new Set(
    claims.map(c => c.lot_number).filter(Boolean)
  )).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const filtered = claims.filter(c => {
    if (filterRef && !c.ref_number?.toLowerCase().includes(filterRef.toLowerCase())) return false;
    if (filterCustomer && !c.customer_name?.toLowerCase().includes(filterCustomer.toLowerCase())) return false;
    if (filterInsurer && !c.insurer_name?.toLowerCase().includes(filterInsurer.toLowerCase())) return false;
    if (filterRegNo && !c.vehicle_reg_no?.toLowerCase().includes(filterRegNo.toLowerCase())) return false;
    if (filterChassis && !c.chassis_number?.toLowerCase().includes(filterChassis.toLowerCase())) return false;
    if (filterDealer && !c.dealer_name?.toLowerCase().includes(filterDealer.toLowerCase())) return false;
    if (filterStatus && c.status !== filterStatus) return false;
    if (filterStage && String(c.current_stage) !== String(filterStage)) return false;
    if (filterCompany && c.company !== filterCompany) return false;
    if (filterLot) {
      const lf = filterLot.toLowerCase();
      if (lf === '__any__') {
        if (!c.lot_number) return false;
      } else if (lf === '__none__') {
        if (c.lot_number) return false;
      } else {
        if (!c.lot_number || !String(c.lot_number).toLowerCase().includes(lf)) return false;
      }
    }
    if (filterDateFrom || filterDateTo) {
      const d = c.created_at ? c.created_at.split('T')[0] : '';
      if (filterDateFrom && d < filterDateFrom) return false;
      if (filterDateTo && d > filterDateTo) return false;
    }
    return true;
  });

  function exportToExcel() {
    try {
      const headers = ['Ref Number', 'Lot No', 'Customer', 'Insured Name', 'Insurer', 'Vehicle Make', 'Model/Fuel', 'Reg No', 'Chassis No', 'Dealer', 'Claim File No', 'Current Stage', 'Stage Name', 'Status', 'Created Date'];
      if (isAllMode) headers.splice(1, 0, 'Company');
      const rows = filtered.map(c => {
        const row = [
          c.ref_number || '', c.lot_number ? `Lot #${c.lot_number}` : '',
          c.customer_name || '', c.insured_name || '', c.insurer_name || '',
          c.vehicle_make || '', c.model_fuel_type || '', c.vehicle_reg_no || '', c.chassis_number || '',
          c.dealer_name || '', c.claim_file_no || '', c.current_stage || '', c.current_stage_name || '',
          c.status || '', c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN') : '',
        ];
        if (isAllMode) row.splice(1, 0, c.company || '');
        return row;
      });
      const csv = [headers, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `EW_MIS_${company}_${new Date().toISOString().split('T')[0]}.csv`);
      link.click();
      showAlertMsg('Exported to Excel', 'success');
    } catch (e) {
      showAlertMsg('Export failed: ' + e.message, 'error');
    }
  }

  const activeFilterCount = [filterRef, filterCustomer, filterInsurer, filterRegNo, filterChassis, filterDealer, filterStatus, filterStage, filterDateFrom, filterDateTo, filterCompany, filterLot].filter(Boolean).length;

  const lotsInLotCount = claims.filter(c => c.lot_number).length;

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>
          Extended Warranty MIS
          {isAllMode && <span style={{ fontSize: 14, color: '#7c3aed', fontWeight: 400 }}> (Combined View - All Firms)</span>}
        </h2>
        <p style={{ margin: '4px 0 16px', fontSize: 13, color: '#64748b' }}>
          Shows only Extended Warranty vehicle claims. For other LOBs use the main MIS Portal.
        </p>

        <div className="button-group">
          <button className="success" onClick={exportToExcel}>Export to Excel</button>
          <button className="secondary" onClick={() => setShowFilters(!showFilters)}>
            {showFilters ? 'Hide' : 'Show'} Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button className="secondary" onClick={clearFilters} style={{ color: '#dc2626' }}>Clear All Filters</button>
          )}
          <button className="secondary" onClick={() => router.push('/ew-vehicle-claims/dashboard')}>EW Dashboard</button>
          <button className="secondary" onClick={() => router.push('/ew-vehicle-claims')}>All EW Claims</button>
        </div>

        {showFilters && (
          <div className="filter-section">
            <h4 style={{ marginBottom: 15 }}>Search & Filter</h4>
            <div className="filter-row">
              <input placeholder="Ref Number" value={filterRef} onChange={e => setFilterRef(e.target.value)} />
              <input placeholder="Customer Name" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} />
              <input placeholder="Insurer" value={filterInsurer} onChange={e => setFilterInsurer(e.target.value)} />
              <input placeholder="Dealer" value={filterDealer} onChange={e => setFilterDealer(e.target.value)} />
            </div>
            <div className="filter-row">
              <input placeholder="Vehicle Reg No" value={filterRegNo} onChange={e => setFilterRegNo(e.target.value)} />
              <input placeholder="Chassis Number" value={filterChassis} onChange={e => setFilterChassis(e.target.value)} />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">All Status</option>
                {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterStage} onChange={e => setFilterStage(e.target.value)}>
                <option value="">All Stages</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(s => (
                  <option key={s} value={s}>Stage {s}</option>
                ))}
              </select>
            </div>
            <div className="filter-row">
              <input
                placeholder="Lot Number (e.g. 1, 2...)"
                value={filterLot === '__any__' || filterLot === '__none__' ? '' : filterLot}
                onChange={e => setFilterLot(e.target.value)}
              />
              <select value={filterLot} onChange={e => setFilterLot(e.target.value)}>
                <option value="">All Lots</option>
                <option value="__any__">In any Lot ({lotsInLotCount})</option>
                <option value="__none__">Not in a Lot ({claims.length - lotsInLotCount})</option>
                {lotOptions.map(l => (
                  <option key={l} value={l}>Lot #{l}</option>
                ))}
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
                <span>Created Date:</span>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
                <span>to</span>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="loading">Loading EW claims...</div>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: '#999' }}>No EW claims found</p>
        ) : (
          <div className="mis-table-container">
            <table className="mis-table">
              <thead>
                <tr>
                  <th>Ref Number</th>
                  <th>Lot No</th>
                  {isAllMode && <th>Company</th>}
                  <th>Customer</th>
                  <th>Insured Name</th>
                  <th>Insurer</th>
                  <th>Vehicle</th>
                  <th>Reg No</th>
                  <th>Chassis</th>
                  <th>Dealer</th>
                  <th>Claim File No</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const sc = STATUS_COLORS[c.status] || STATUS_COLORS['Open'];
                  const inLot = Boolean(c.lot_number);
                  const rowStyle = inLot ? { background: '#f0fdf4' } : undefined;
                  return (
                    <tr key={c.id} style={rowStyle} title={inLot ? `In Lot #${c.lot_number}` : undefined}>
                      <td style={{ fontWeight: 600, color: '#7c3aed', whiteSpace: 'nowrap' }}>
                        {!c._needs_ew_setup ? (
                          <a onClick={() => router.push(`/ew-vehicle-claims/${c.id}`)} style={{ color: '#7c3aed', cursor: 'pointer', textDecoration: 'underline' }}>
                            {c.ref_number || '-'}
                          </a>
                        ) : (
                          <span>{c.ref_number || '-'} <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: '#fef3c7', color: '#92400e', marginLeft: 4 }}>NEW</span></span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {inLot ? (
                          <a
                            onClick={() => router.push(`/ew-lots`)}
                            title={`Open Lots list`}
                            style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                              fontSize: 11, fontWeight: 700,
                              background: '#dcfce7', color: '#166534',
                              border: '1px solid #86efac', cursor: 'pointer',
                              textDecoration: 'none',
                            }}
                          >
                            Lot #{c.lot_number}
                          </a>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: 11 }}>&mdash;</span>
                        )}
                      </td>
                      {isAllMode && <td><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: c.company === 'NISLA' ? '#dbeafe' : '#dcfce7', color: c.company === 'NISLA' ? '#1e40af' : '#15803d' }}>{c.company}</span></td>}
                      <td>{c.customer_name || '-'}</td>
                      <td>{c.insured_name || '-'}</td>
                      <td>{c.insurer_name || '-'}</td>
                      <td>{c.vehicle_make || '-'} {c.model_fuel_type || ''}</td>
                      <td style={{ fontFamily: 'monospace' }}>{c.vehicle_reg_no || '-'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.chassis_number || '-'}</td>
                      <td>{c.dealer_name || '-'}</td>
                      <td>{c.claim_file_no || '-'}</td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 600, color: '#7c3aed',
                        }}>
                          <span style={{
                            background: '#7c3aed', color: '#fff', width: 20, height: 20,
                            borderRadius: '50%', display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 10,
                          }}>{c.current_stage || 0}</span>
                          {c.current_stage_name || '-'}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 12,
                          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                          fontSize: 11, fontWeight: 600,
                        }}>{c.status || 'Open'}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN') : '-'}</td>
                      <td className="action-buttons" style={{ whiteSpace: 'nowrap' }}>
                        {!c._needs_ew_setup && (
                          <button className="secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => router.push(`/ew-vehicle-claims/${c.id}`)}>Open</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ marginTop: 20, color: '#666', fontSize: 12 }}>Total Records: {filtered.length}</p>
      </div>
    </PageLayout>
  );
}
