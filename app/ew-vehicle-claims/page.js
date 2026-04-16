'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';

export default function EWVehicleClaimsPage() {
  const router = useRouter();
  const { company } = useCompany();
  const { user } = useAuth();

  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  // Lot selection mode: when toggled on, checkboxes appear next to
  // FSR-generated claims and the user can bulk-create a lot.
  const [lotMode, setLotMode] = useState(false);
  const [selectedForLot, setSelectedForLot] = useState(new Set());

  useEffect(() => { loadClaims(); }, [company, search, statusFilter]);

  async function loadClaims() {
    try {
      setLoading(true);
      let url = `/api/ew-claims?company=${encodeURIComponent(company)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(url);
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load EW claims:', e);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }

  // When user clicks an unlinked claim (from claims table), auto-create EW record
  async function handleClaimClick(claim) {
    if (claim._needs_ew_setup) {
      try {
        setAlert({ msg: 'Setting up EW lifecycle for this claim...', type: 'success' });
        const res = await fetch('/api/ew-claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claim_id: claim.claim_id,
            ref_number: claim.ref_number,
            company: claim.company,
            insured_name: claim.insured_name,
            customer_name: claim.customer_name || claim.insured_name,
            vehicle_reg_no: claim.vehicle_reg_no || null,
            vehicle_make: claim.vehicle_make || null,
            chassis_number: claim.chassis_number || null,
            dealer_name: claim.dealer_name || null,
            created_by: user?.email,
          }),
        });
        if (!res.ok) throw new Error('Failed to create EW record');
        const ewClaim = await res.json();
        router.push(`/ew-vehicle-claims/${ewClaim.id}`);
      } catch (e) {
        setAlert({ msg: e.message, type: 'error' });
      }
    } else {
      router.push(`/ew-vehicle-claims/${claim.id}`);
    }
  }

  async function handleDelete(id, ref) {
    try {
      const res = await fetch(`/api/ew-claims?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setAlert({ msg: `Claim ${ref} deleted`, type: 'success' });
      setDeleteConfirm(null);
      loadClaims();
    } catch (e) {
      setAlert({ msg: e.message, type: 'error' });
    }
  }

  // Inline advance: complete current stage from list page
  async function advanceStage(claimId, currentStage) {
    try {
      setAlert({ msg: 'Advancing stage...', type: 'success' });
      const res = await fetch('/api/ew-claim-stages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ew_claim_id: claimId, stage_number: currentStage, status: 'Completed', updated_by: user?.email || '' }),
      });
      if (!res.ok) throw new Error('Stage advance failed');
      setAlert({ msg: 'Stage advanced!', type: 'success' });
      loadClaims();
    } catch (e) {
      setAlert({ msg: e.message, type: 'error' });
    }
  }

  const statusColors = {
    'Open': { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
    'In Progress': { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    'Assessment': { bg: '#fce7f3', color: '#9d174d', border: '#f9a8d4' },
    'Report Ready': { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
    'Completed': { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    'Closed': { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
  };

  const statusList = ['Open', 'In Progress', 'Assessment', 'Report Ready', 'Completed', 'Closed'];

  // Status summary counts
  const statusCounts = {};
  statusList.forEach(s => { statusCounts[s] = claims.filter(c => c.status === s).length; });

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
        {/* Alert */}
        {alert && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 8,
            background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: alert.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${alert.type === 'success' ? '#86efac' : '#fca5a5'}`,
            fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{alert.msg}</span>
            <span onClick={() => setAlert(null)} style={{ cursor: 'pointer', fontWeight: 700 }}>&#x2715;</span>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>&#x1F6E1;</span> EW Vehicle Claims
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Extended Warranty vehicle claim lifecycle management
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {lotMode ? (
              <>
                <span style={{ fontSize: 12, color: '#475569' }}>
                  <strong>{selectedForLot.size}</strong> selected
                </span>
                <button
                  onClick={() => {
                    if (selectedForLot.size === 0) {
                      setAlert({ msg: 'Select at least one FSR-generated claim', type: 'error' });
                      return;
                    }
                    const ids = Array.from(selectedForLot).join(',');
                    router.push(`/ew-lots/new?ids=${ids}`);
                  }}
                  style={{
                    padding: '10px 18px', background: '#22c55e', color: '#fff', border: 'none',
                    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Create Lot ({selectedForLot.size})
                </button>
                <button
                  onClick={() => { setLotMode(false); setSelectedForLot(new Set()); }}
                  style={{ padding: '10px 14px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setLotMode(true)}
                title="Bulk-select FSR-completed claims to create a Lot"
                style={{
                  padding: '10px 16px', background: '#fff', color: '#7c3aed', border: '1px solid #7c3aed',
                  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                &#x1F4E6; Create Lot
              </button>
            )}
            <button
              onClick={() => router.push('/ew-vehicle-claims/register')}
              style={{
                padding: '10px 20px', background: '#7c3aed', color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
              }}
            >
              <span style={{ fontSize: 18 }}>+</span> New EW Claim
            </button>
          </div>
        </div>

        {/* Status Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
          {statusList.map(s => {
            const sc = statusColors[s];
            const isActive = statusFilter === s;
            return (
              <div
                key={s}
                onClick={() => setStatusFilter(isActive ? '' : s)}
                style={{
                  padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  background: isActive ? sc.color : sc.bg,
                  color: isActive ? '#fff' : sc.color,
                  border: `2px solid ${isActive ? sc.color : sc.border}`,
                  textAlign: 'center', transition: 'all 0.2s',
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 700 }}>{statusCounts[s]}</div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>{s}</div>
              </div>
            );
          })}
        </div>

        {/* Search & Filter Bar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search by ref, customer, vehicle, chassis, claim file..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8,
              fontSize: 13, outline: 'none',
            }}
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          >
            <option value="">All Statuses</option>
            {statusList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(search || statusFilter) && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); }}
              style={{
                padding: '10px 16px', background: '#f1f5f9', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#475569',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Claims Table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading claims...</div>
          ) : claims.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>&#x1F4CB;</div>
              <div>No EW vehicle claims found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Click "New EW Claim" to register one</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {lotMode && (
                    <th style={{ padding: '10px 12px', textAlign: 'left', width: 30 }}>
                      <input
                        type="checkbox"
                        checked={(() => {
                          const eligible = claims.filter(c => !c._needs_ew_setup && c.fsr_generated_at);
                          return eligible.length > 0 && eligible.every(c => selectedForLot.has(c.id));
                        })()}
                        onChange={e => {
                          const eligible = claims.filter(c => !c._needs_ew_setup && c.fsr_generated_at).map(c => c.id);
                          setSelectedForLot(e.target.checked ? new Set(eligible) : new Set());
                        }}
                      />
                    </th>
                  )}
                  {['Ref No.', 'Customer', 'Vehicle', 'Reg No.', 'Surveyor', 'Current Stage', 'Status', 'SLA Due', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {claims.map(c => {
                  const sc = statusColors[c.status] || statusColors['Open'];
                  const isSelected = selectedForLot.has(c.id);
                  const canSelect = !c._needs_ew_setup && c.fsr_generated_at;
                  return (
                    <tr
                      key={c.id}
                      onClick={e => {
                        if (lotMode && canSelect) {
                          setSelectedForLot(prev => {
                            const next = new Set(prev);
                            next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                            return next;
                          });
                          return;
                        }
                        handleClaimClick(c);
                      }}
                      style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.15s', background: lotMode && isSelected ? '#faf5ff' : 'transparent' }}
                      onMouseEnter={e => { if (!(lotMode && isSelected)) e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={e => { if (!(lotMode && isSelected)) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {lotMode && (
                        <td style={{ padding: '10px 12px' }}>
                          {canSelect ? (
                            <input type="checkbox" checked={isSelected} onChange={() => { /* handled by row onClick */ }} onClick={e => e.stopPropagation()} />
                          ) : (
                            <span title={c._needs_ew_setup ? 'Not an EW claim yet' : 'FSR not generated'} style={{ fontSize: 14, color: '#cbd5e1' }}>&#x2013;</span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#7c3aed' }}>
                        {c.ref_number || '-'}
                        {c._needs_ew_setup && <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 6px', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>NEW</span>}
                        {c.fsr_generated_at && <span title={`FSR generated on ${new Date(c.fsr_generated_at).toLocaleDateString('en-IN')}`} style={{ marginLeft: 6, fontSize: 9, padding: '2px 6px', borderRadius: 8, background: '#dcfce7', color: '#166534', fontWeight: 600 }}>FSR</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>{c.customer_name || '-'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#64748b' }}>{c.vehicle_make} {c.model_fuel_type || ''}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{c.vehicle_reg_no || '-'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#475569' }}>{c.assigned_surveyor_name || '-'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 600, color: '#7c3aed',
                        }}>
                          <span style={{
                            background: '#7c3aed', color: '#fff', width: 20, height: 20,
                            borderRadius: '50%', display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 10,
                          }}>{c.current_stage}</span>
                          {c.current_stage_name}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 12,
                          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                          fontSize: 11, fontWeight: 600,
                        }}>{c.status}</span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 11 }}>
                        {c.sla_due_date ? (
                          <span style={{
                            color: new Date(c.sla_due_date) < new Date() ? '#ef4444' :
                              new Date(c.sla_due_date) < new Date(Date.now() + 2*86400000) ? '#d97706' : '#059669',
                            fontWeight: 600,
                          }}>
                            {new Date(c.sla_due_date).toLocaleDateString('en-IN')}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', display: 'flex', gap: 4, alignItems: 'center' }}>
                        {!c._needs_ew_setup && c.status !== 'Completed' && (
                          <button
                            onClick={e => { e.stopPropagation(); advanceStage(c.id, c.current_stage); }}
                            title="Complete current stage & advance"
                            style={{
                              padding: '3px 8px', background: '#22c55e', color: '#fff',
                              border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            Next &rarr;
                          </button>
                        )}
                        {!c._needs_ew_setup ? (
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: c.id, ref: c.ref_number }); }}
                            title="Delete claim"
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: '#ef4444', fontSize: 16, padding: '2px 6px',
                            }}
                          >
                            &#x1F5D1;
                          </button>
                        ) : (
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>Click to setup</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Total count */}
        <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>
          Showing {claims.length} claim{claims.length !== 1 ? 's' : ''}
        </div>

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999,
          }}>
            <div style={{
              background: '#fff', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#1e293b' }}>Delete EW Claim?</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b' }}>
                Are you sure you want to delete claim <strong>{deleteConfirm.ref}</strong>? This will also remove all stages and media. This action cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.ref)}
                  style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
