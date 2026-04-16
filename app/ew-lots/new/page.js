'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';

// Mirror of the server-side EW fee slab for live preview.
function calcEwFee(loss) {
  const a = parseFloat(loss) || 0;
  if (a <= 0) return 0;
  let fee;
  if (a <= 50000) fee = 2500;
  else if (a <= 200000) fee = a * 0.04;
  else if (a <= 500000) fee = 8000 + (a - 200000) * 0.03;
  else fee = 17000 + (a - 500000) * 0.02;
  return Math.round(fee * 100) / 100;
}
function r2(x) { return Math.round((parseFloat(x) || 0) * 100) / 100; }

export default function NewEwLotPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { company } = useCompany();
  const { user } = useAuth();

  const [availableClaims, setAvailableClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showAllFsr, setShowAllFsr] = useState(false); // if true, show claims without FSR tracking too

  // Selected claim IDs with their fee overrides
  // shape: { [ew_claim_id]: { professional_fee, reinspection_fee, conveyance, photographs, location, workshop_name, breakdown_details, service_request_number, admissibility } }
  const [selected, setSelected] = useState({});

  const [form, setForm] = useState({
    lot_number: '',
    lot_date: new Date().toISOString().split('T')[0],
    ew_program: '',
    insurer_name: '',
    notes: '',
  });

  useEffect(() => { loadClaims(); }, [company, showAllFsr]);

  async function loadClaims() {
    try {
      setLoading(true);
      const res = await fetch(`/api/ew-claims?company=${encodeURIComponent(company)}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      // Keep only real EW claims (not `_needs_ew_setup` placeholders)
      const realEw = list.filter(c => !c._needs_ew_setup && c.id);
      setAvailableClaims(realEw);

      // Pre-select any claim_ids passed via ?ids=a,b,c  (from the EW claims "Create Lot with selection" flow)
      const idsParam = searchParams?.get('ids');
      if (idsParam) {
        const ids = idsParam.split(',').filter(Boolean);
        const next = {};
        ids.forEach(id => {
          const match = realEw.find(c => c.id === id);
          if (match) next[id] = defaultFeeShape(match);
        });
        setSelected(next);
      }
    } catch (e) {
      setAvailableClaims([]);
    } finally {
      setLoading(false);
    }
  }

  function defaultFeeShape(claim) {
    const loss = parseFloat(claim.gross_assessed_amount || claim.net_adjusted_amount || claim.estimated_loss_amount || 0);
    return {
      professional_fee: calcEwFee(loss),
      reinspection_fee: 0,
      conveyance: 0,
      photographs: 0,
      admissibility: 'Admissible',
      location: claim.survey_location || '',
      workshop_name: claim.dealer_name || '',
      breakdown_details: claim.customer_complaint || claim.dismantled_observation || '',
      service_request_number: claim.claim_file_no || '',
    };
  }

  // Filter claims shown in the selection table
  const visibleClaims = useMemo(() => {
    let list = availableClaims;
    if (!showAllFsr) list = list.filter(c => c.fsr_generated_at);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(c => [c.ref_number, c.customer_name, c.insured_name, c.vehicle_reg_no, c.chassis_number, c.claim_file_no, c.policy_number]
        .some(v => (v || '').toLowerCase().includes(q)));
    }
    return list;
  }, [availableClaims, showAllFsr, search]);

  function toggleSelect(claim) {
    setSelected(prev => {
      const next = { ...prev };
      if (next[claim.id]) {
        delete next[claim.id];
      } else {
        next[claim.id] = defaultFeeShape(claim);
      }
      return next;
    });
  }

  function updateFee(claimId, field, value) {
    setSelected(prev => ({
      ...prev,
      [claimId]: { ...prev[claimId], [field]: value },
    }));
  }

  // Live totals
  const totals = useMemo(() => {
    const t = { count: 0, prof: 0, rein: 0, conv: 0, photo: 0, bill: 0, gst: 0, total: 0 };
    Object.entries(selected).forEach(([cid, f]) => {
      const prof = r2(f.professional_fee);
      const rein = r2(f.reinspection_fee);
      const conv = r2(f.conveyance);
      const photo = r2(f.photographs);
      const bill = r2(prof + rein + conv + photo);
      const gst = r2(bill * 0.18);
      const total = r2(bill + gst);
      t.count += 1;
      t.prof += prof;
      t.rein += rein;
      t.conv += conv;
      t.photo += photo;
      t.bill += bill;
      t.gst += gst;
      t.total += total;
    });
    return t;
  }, [selected]);

  async function saveLot() {
    const ids = Object.keys(selected);
    if (ids.length === 0) {
      setAlert({ msg: 'Select at least one claim', type: 'error' });
      return;
    }
    try {
      setSaving(true);
      const payload = {
        company,
        lot_number: form.lot_number?.trim() || undefined, // undefined → auto-assign
        lot_date: form.lot_date,
        ew_program: form.ew_program,
        insurer_name: form.insurer_name,
        notes: form.notes,
        created_by: user?.email,
        claims: ids.map(id => ({ ew_claim_id: id, ...selected[id] })),
      };
      const res = await fetch('/api/ew-lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create lot');
      setAlert({ msg: `Lot ${data.lot_number} created with ${ids.length} claim(s)`, type: 'success' });
      setTimeout(() => router.push(`/ew-lots/${data.id}`), 500);
    } catch (e) {
      setAlert({ msg: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = Object.keys(selected).length;

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1500, margin: '0 auto' }}>
        {alert && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 8,
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
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#1e293b' }}>Create EW Lot</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Select FSR-completed claims, adjust fees if needed, then save.
            </p>
          </div>
          <button
            onClick={() => router.push('/ew-lots')}
            style={{ padding: '8px 14px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
          >
            &larr; Back to Lots
          </button>
        </div>

        {/* Lot meta form */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Lot Number</label>
              <input
                placeholder="Auto-generate if blank"
                value={form.lot_number}
                onChange={e => setForm({ ...form, lot_number: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Lot Date</label>
              <input
                type="date"
                value={form.lot_date}
                onChange={e => setForm({ ...form, lot_date: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>EW Program</label>
              <input
                placeholder="e.g. Jeep Extended Warranty"
                value={form.ew_program}
                onChange={e => setForm({ ...form, ew_program: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Insurer</label>
              <input
                value={form.insurer_name}
                onChange={e => setForm({ ...form, insurer_name: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          </div>
        </div>

        {/* Search + filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
          <input
            placeholder="Search ref, customer, chassis, claim file..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
            <input type="checkbox" checked={showAllFsr} onChange={e => setShowAllFsr(e.target.checked)} />
            Include claims without FSR tracked
          </label>
        </div>

        {/* Selection table */}
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'auto', maxHeight: '55vh' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>Loading claims...</div>
          ) : visibleClaims.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No FSR-generated claims found. Either generate FSR on an EW claim first, or enable "Include claims without FSR tracked".
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 2 }}>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  {['', 'Ref', 'Customer', 'Vehicle', 'Chassis', 'Policy #', 'Assessed', 'Prof Fee', 'Reinsp.', 'Conv.', 'Photos', 'Admiss.', 'Bill', 'GST', 'Total'].map(h => (
                    <th key={h} style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleClaims.map(c => {
                  const sel = selected[c.id];
                  const checked = Boolean(sel);
                  const row = sel || defaultFeeShape(c);
                  const bill = r2(r2(row.professional_fee) + r2(row.reinspection_fee) + r2(row.conveyance) + r2(row.photographs));
                  const gst = r2(bill * 0.18);
                  const total = r2(bill + gst);
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: checked ? '#faf5ff' : '#fff' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleSelect(c)} />
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 600, color: '#7c3aed' }}>
                        {c.ref_number || '-'}
                        {c.fsr_generated_at && <span title="FSR generated" style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 6, background: '#dcfce7', color: '#166534', fontWeight: 600 }}>FSR</span>}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{c.customer_name || c.insured_name || '-'}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11 }}>{c.vehicle_make || ''} {c.model_fuel_type || ''}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{c.chassis_number || '-'}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11 }}>{c.policy_number || '-'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', textAlign: 'right' }}>
                        {c.gross_assessed_amount ? parseFloat(c.gross_assessed_amount).toLocaleString('en-IN') : '-'}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {checked ? (
                          <input type="number" step="0.01" value={row.professional_fee}
                            onChange={e => updateFee(c.id, 'professional_fee', e.target.value)}
                            style={{ width: 80, padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, textAlign: 'right' }} />
                        ) : <span style={{ color: '#94a3b8' }}>{calcEwFee(c.gross_assessed_amount || c.net_adjusted_amount).toLocaleString('en-IN')}</span>}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {checked ? (
                          <input type="number" step="0.01" value={row.reinspection_fee}
                            onChange={e => updateFee(c.id, 'reinspection_fee', e.target.value)}
                            style={{ width: 65, padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, textAlign: 'right' }} />
                        ) : '-'}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {checked ? (
                          <input type="number" step="0.01" value={row.conveyance}
                            onChange={e => updateFee(c.id, 'conveyance', e.target.value)}
                            style={{ width: 60, padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, textAlign: 'right' }} />
                        ) : '-'}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {checked ? (
                          <input type="number" step="0.01" value={row.photographs}
                            onChange={e => updateFee(c.id, 'photographs', e.target.value)}
                            style={{ width: 60, padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, textAlign: 'right' }} />
                        ) : '-'}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {checked ? (
                          <select value={row.admissibility} onChange={e => updateFee(c.id, 'admissibility', e.target.value)}
                            style={{ padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }}>
                            <option>Admissible</option>
                            <option>Non-Admissible</option>
                            <option>Partial</option>
                          </select>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', textAlign: 'right' }}>{checked ? bill.toLocaleString('en-IN') : '-'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', textAlign: 'right' }}>{checked ? gst.toLocaleString('en-IN') : '-'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', textAlign: 'right', fontWeight: 700 }}>{checked ? total.toLocaleString('en-IN') : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Totals / actions */}
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#475569' }}>
            <div><strong style={{ color: '#1e293b' }}>{totals.count}</strong> selected</div>
            <div>Prof. Fee: <strong>₹{totals.prof.toLocaleString('en-IN')}</strong></div>
            <div>Reinsp.: <strong>₹{totals.rein.toLocaleString('en-IN')}</strong></div>
            <div>Bill: <strong>₹{totals.bill.toLocaleString('en-IN')}</strong></div>
            <div>GST: <strong>₹{totals.gst.toLocaleString('en-IN')}</strong></div>
            <div>Total: <strong style={{ color: '#166534', fontSize: 14 }}>₹{totals.total.toLocaleString('en-IN')}</strong></div>
          </div>
          <button
            onClick={saveLot}
            disabled={saving || selectedCount === 0}
            style={{
              padding: '10px 20px',
              background: saving || selectedCount === 0 ? '#cbd5e1' : '#7c3aed',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: saving || selectedCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : `Create Lot (${selectedCount})`}
          </button>
        </div>
      </div>
    </PageLayout>
  );
}
