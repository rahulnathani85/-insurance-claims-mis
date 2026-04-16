'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';

export default function EwLotsListPage() {
  const router = useRouter();
  const { company } = useCompany();
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [alert, setAlert] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => { loadLots(); }, [company]);

  async function loadLots() {
    try {
      setLoading(true);
      const res = await fetch(`/api/ew-lots?company=${encodeURIComponent(company)}`);
      const data = await res.json();
      setLots(Array.isArray(data) ? data : []);
    } catch (e) {
      setLots([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id, number) {
    try {
      const res = await fetch(`/api/ew-lots?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setAlert({ msg: `Lot ${number} deleted`, type: 'success' });
      setDeleteConfirm(null);
      loadLots();
    } catch (e) {
      setAlert({ msg: e.message, type: 'error' });
    }
  }

  function downloadExcel(id) {
    // Triggers file download through the API route
    window.open(`/api/ew-lots/${id}/excel`, '_blank');
  }

  const statusColors = {
    'Draft': { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    'Finalized': { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
    'Invoiced': { bg: '#ede9fe', color: '#6d28d9', border: '#c4b5fd' },
    'Paid': { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  };

  const filtered = lots.filter(l => {
    const matchStatus = !statusFilter || l.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || [l.lot_number, l.ew_program, l.insurer_name, l.notes]
      .some(v => (v || '').toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });

  const totalAmount = filtered.reduce((s, l) => s + (parseFloat(l.total_amount) || 0), 0);

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>&#x1F4E6;</span> EW Lots
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Bundle EW claims with completed FSRs into billing lots
            </p>
          </div>
          <button
            onClick={() => router.push('/ew-lots/new')}
            style={{
              padding: '10px 20px', background: '#7c3aed', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
            }}
          >
            <span style={{ fontSize: 18 }}>+</span> Create Lot
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search by lot number, program, insurer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }}
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          >
            <option value="">All Status</option>
            <option value="Draft">Draft</option>
            <option value="Finalized">Finalized</option>
            <option value="Invoiced">Invoiced</option>
            <option value="Paid">Paid</option>
          </select>
          {(search || statusFilter) && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); }}
              style={{ padding: '10px 16px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#475569' }}
            >
              Clear
            </button>
          )}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading lots...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>&#x1F4E6;</div>
              <div>No lots found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Click "Create Lot" to bundle FSR-completed claims</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Lot No.', 'Date', 'EW Program', 'Insurer', 'Claims', 'Prof. Fee', 'Total Bill', 'GST', 'Total', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => {
                  const sc = statusColors[l.status] || statusColors['Draft'];
                  return (
                    <tr
                      key={l.id}
                      onClick={() => router.push(`/ew-lots/${l.id}`)}
                      style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#7c3aed' }}>#{l.lot_number}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#475569' }}>
                        {l.lot_date ? new Date(l.lot_date).toLocaleDateString('en-IN') : '-'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>{l.ew_program || '-'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12 }}>{l.insurer_name || '-'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{l.claim_count || 0}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                        {l.total_professional_fee != null ? `₹${parseFloat(l.total_professional_fee).toLocaleString('en-IN')}` : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                        {l.total_bill != null ? `₹${parseFloat(l.total_bill).toLocaleString('en-IN')}` : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                        {l.total_gst != null ? `₹${parseFloat(l.total_gst).toLocaleString('en-IN')}` : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 700 }}>
                        {l.total_amount != null ? `₹${parseFloat(l.total_amount).toLocaleString('en-IN')}` : '-'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 12,
                          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                          fontSize: 11, fontWeight: 600,
                        }}>{l.status}</span>
                      </td>
                      <td style={{ padding: '10px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          onClick={e => { e.stopPropagation(); downloadExcel(l.id); }}
                          title="Download Excel"
                          style={{ padding: '4px 8px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Excel
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: l.id, number: l.lot_number }); }}
                          title="Delete lot"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16, padding: '2px 6px' }}
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

        <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', textAlign: 'right', display: 'flex', justifyContent: 'space-between' }}>
          <span>Showing {filtered.length} lot{filtered.length !== 1 ? 's' : ''}</span>
          <span>Total Value: <strong style={{ color: '#166534' }}>₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
        </div>

        {deleteConfirm && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#1e293b' }}>Delete Lot?</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b' }}>
                Are you sure you want to delete lot <strong>#{deleteConfirm.number}</strong>? All line items in this lot will be removed. This action cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.number)}
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
