'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';

export default function EwLotDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [lot, setLot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => { if (id) loadLot(); }, [id]);

  async function loadLot() {
    try {
      setLoading(true);
      const res = await fetch(`/api/ew-lots?id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setLot(data);
      setForm({
        lot_number: data.lot_number || '',
        lot_date: data.lot_date || '',
        ew_program: data.ew_program || '',
        insurer_name: data.insurer_name || '',
        notes: data.notes || '',
        status: data.status || 'Draft',
      });
    } catch (e) {
      setAlert({ msg: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function saveMeta() {
    try {
      setSaving(true);
      const res = await fetch('/api/ew-lots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setAlert({ msg: 'Lot updated', type: 'success' });
      loadLot();
    } catch (e) {
      setAlert({ msg: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function downloadExcel() {
    window.open(`/api/ew-lots/${id}/excel`, '_blank');
  }

  const statusColors = {
    'Draft': { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    'Finalized': { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
    'Invoiced': { bg: '#ede9fe', color: '#6d28d9', border: '#c4b5fd' },
    'Paid': { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  };

  if (loading) {
    return <PageLayout><div style={{ padding: 40, textAlign: 'center' }}>Loading lot...</div></PageLayout>;
  }

  if (!lot) {
    return <PageLayout><div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Lot not found</div></PageLayout>;
  }

  const items = lot.items || [];
  const sc = statusColors[lot.status] || statusColors['Draft'];

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1500, margin: '0 auto' }}>
        {alert && (
          <div style={{
            padding: '10px 16px', marginBottom: 14, borderRadius: 8,
            background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: alert.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${alert.type === 'success' ? '#86efac' : '#fca5a5'}`,
            fontSize: 13,
          }}>
            {alert.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => router.push('/ew-lots')}
              style={{ padding: '6px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
            >
              &larr; Lots
            </button>
            <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>
              Lot #{lot.lot_number}
              <span style={{
                marginLeft: 10, padding: '3px 10px', borderRadius: 12,
                background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                fontSize: 11, fontWeight: 600, verticalAlign: 'middle',
              }}>{lot.status}</span>
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={downloadExcel}
              style={{ padding: '10px 18px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              &#x2B07; Download Excel
            </button>
          </div>
        </div>

        {/* Meta edit form */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Lot Number</label>
              <input value={form.lot_number} onChange={e => setForm({ ...form, lot_number: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Date</label>
              <input type="date" value={form.lot_date} onChange={e => setForm({ ...form, lot_date: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>EW Program</label>
              <input value={form.ew_program} onChange={e => setForm({ ...form, ew_program: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Insurer</label>
              <input value={form.insurer_name} onChange={e => setForm({ ...form, insurer_name: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}>
                <option>Draft</option>
                <option>Finalized</option>
                <option>Invoiced</option>
                <option>Paid</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>&nbsp;</label>
              <button onClick={saveMeta} disabled={saving}
                style={{ width: '100%', padding: '7px 9px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Notes</label>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Claims', value: lot.claim_count },
            { label: 'Prof. Fee', value: `₹${parseFloat(lot.total_professional_fee || 0).toLocaleString('en-IN')}` },
            { label: 'Reinsp.', value: `₹${parseFloat(lot.total_reinspection || 0).toLocaleString('en-IN')}` },
            { label: 'Bill (Pre-GST)', value: `₹${parseFloat(lot.total_bill || 0).toLocaleString('en-IN')}` },
            { label: 'GST @ 18%', value: `₹${parseFloat(lot.total_gst || 0).toLocaleString('en-IN')}` },
            { label: 'Total', value: `₹${parseFloat(lot.total_amount || 0).toLocaleString('en-IN')}`, highlight: true },
          ].map(card => (
            <div key={card.label} style={{
              padding: '10px 14px', borderRadius: 10,
              background: card.highlight ? '#dcfce7' : '#f8fafc',
              border: `1px solid ${card.highlight ? '#86efac' : '#e2e8f0'}`,
            }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>{card.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: card.highlight ? '#166534' : '#1e293b' }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Items table */}
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Sr.', 'Ref', 'Intimation', 'Claim #', 'Policy', 'Insured', 'VIN', 'Veh. No.', 'Report', 'Assessed', 'Admiss.', 'Prof. Fee', 'Reinsp.', 'Conv.', 'Photos', 'Bill', 'GST', 'Total'].map(h => (
                  <th key={h} style={{ padding: '8px 9px', textAlign: 'left', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 9px', color: '#94a3b8' }}>{idx + 1}</td>
                  <td style={{ padding: '6px 9px', fontWeight: 600, color: '#7c3aed' }}>{it.ref_number}</td>
                  <td style={{ padding: '6px 9px', fontSize: 11 }}>{it.date_of_intimation ? new Date(it.date_of_intimation).toLocaleDateString('en-IN') : '-'}</td>
                  <td style={{ padding: '6px 9px', fontSize: 11 }}>{it.claim_file_no || '-'}</td>
                  <td style={{ padding: '6px 9px', fontSize: 11 }}>{it.policy_number || '-'}</td>
                  <td style={{ padding: '6px 9px' }}>{it.insured_name || it.customer_name}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', fontSize: 11 }}>{it.chassis_number || '-'}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', fontSize: 11 }}>{it.vehicle_reg_no || '-'}</td>
                  <td style={{ padding: '6px 9px', fontSize: 11 }}>{it.report_date ? new Date(it.report_date).toLocaleDateString('en-IN') : '-'}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right' }}>
                    {it.gross_assessed_amount ? parseFloat(it.gross_assessed_amount).toLocaleString('en-IN') : '-'}
                  </td>
                  <td style={{ padding: '6px 9px', fontSize: 11 }}>{it.admissibility || '-'}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right' }}>{parseFloat(it.professional_fee || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right' }}>{parseFloat(it.reinspection_fee || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right' }}>{parseFloat(it.conveyance || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right' }}>{parseFloat(it.photographs || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right' }}>{parseFloat(it.total_bill || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right' }}>{parseFloat(it.gst || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '6px 9px', fontFamily: 'monospace', textAlign: 'right', fontWeight: 700 }}>{parseFloat(it.total_amount || 0).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageLayout>
  );
}
