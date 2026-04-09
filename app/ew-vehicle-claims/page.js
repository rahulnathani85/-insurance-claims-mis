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
                  {['Ref No.', 'Customer', 'Vehicle', 'Reg No.', 'Current Stage', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {claims.map(c => {
                  const sc = statusColors[c.status] || statusColors['Open'];
                  return (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/ew-vehicle-claims/${c.id}`)}
                      style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#7c3aed' }}>{c.ref_number || '-'}</td>
                      <td style={{ padding: '10px 12px' }}>{c.customer_name || '-'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#64748b' }}>{c.vehicle_make} {c.model_fuel_type || ''}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{c.vehicle_reg_no || '-'}</td>
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
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#64748b' }}>
                        {c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN') : '-'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
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
