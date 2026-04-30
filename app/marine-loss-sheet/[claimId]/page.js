'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const fmtINR = (n) => {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
};

const STATUS_OPTIONS = ['draft', 'under_review', 'approved', 'superseded'];

export default function MarineLossSheetPage({ params }) {
  const { user } = useAuth();
  const claimId = params.claimId;

  const [claim, setClaim] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [headerSaving, setHeaderSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const headerTimer = useRef(null);

  useEffect(() => { loadAll(); }, [claimId]);
  useEffect(() => () => clearTimeout(headerTimer.current), []);

  async function loadAll() {
    try {
      setLoading(true);
      const [claimRes, sheetRes] = await Promise.all([
        fetch(`/api/claims/${claimId}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/claims/${claimId}/marine-loss-sheet`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setClaim(claimRes);
      if (sheetRes) {
        setSheet(sheetRes.sheet);
        setItems(sheetRes.items || []);
        setSummary(sheetRes.summary);
      }
    } catch (e) {
      showAlert('Failed to load Marine loss sheet: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  const queueHeaderSave = useCallback((updates) => {
    clearTimeout(headerTimer.current);
    headerTimer.current = setTimeout(async () => {
      setHeaderSaving(true);
      try {
        const res = await fetch(`/api/claims/${claimId}/marine-loss-sheet`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...updates, updated_by: user?.email || null }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Save failed');
        }
        const data = await res.json();
        setSheet(data.sheet);
        setItems(data.items || []);
        setSummary(data.summary);
      } catch (e) {
        showAlert(e.message, 'error');
      } finally {
        setHeaderSaving(false);
      }
    }, 800);
  }, [claimId, user?.email]);

  function setHeaderField(key, value) {
    setSheet((prev) => {
      const next = { ...prev, [key]: value };
      queueHeaderSave({ [key]: value });
      return next;
    });
  }

  async function addItem() {
    try {
      const res = await fetch(`/api/claims/${claimId}/marine-loss-sheet/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'New item',
          damaged_qty: 1,
          rate: 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Add failed');
      }
      await loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function updateItem(itemId, patch) {
    try {
      const res = await fetch(`/api/marine-loss-sheet-items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Update failed');
      }
      await loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  async function deleteItem(itemId) {
    if (!confirm('Delete this line item?')) return;
    try {
      const res = await fetch(`/api/marine-loss-sheet-items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="main-content"><div className="loading">Loading Marine loss sheet…</div></div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content" style={{ maxWidth: 1500, margin: '0 auto' }}>
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Marine Loss Sheet · {claim?.ref_number || `Claim #${claimId}`}</h2>
            <p style={{ color: '#475569', fontSize: 13, margin: '4px 0 0' }}>
              {claim?.insured_name || ''} · {claim?.lob || ''}
              {sheet?.status && <> · status <strong>{sheet.status}</strong></>}
            </p>
          </div>
          {headerSaving && <span style={{ fontSize: 12, color: '#3b82f6' }}>Saving…</span>}
        </div>

        {/* Header inputs */}
        <div style={paneStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(140px, 1fr))', gap: 12 }}>
            <Field label="Insurance %">
              <input type="number" min="0" max="100" step="0.1"
                value={sheet?.insurance_rate_pct ?? 1}
                onChange={(e) => setHeaderField('insurance_rate_pct', Number(e.target.value || 0))}
                style={inputStyle} />
            </Field>
            <Field label="GST %">
              <input type="number" min="0" max="100" step="0.1"
                value={sheet?.gst_rate_pct ?? 18}
                onChange={(e) => setHeaderField('gst_rate_pct', Number(e.target.value || 0))}
                style={inputStyle} />
            </Field>
            <Field label="Handling %">
              <input type="number" min="0" max="100" step="0.1"
                value={sheet?.handling_rate_pct ?? 10}
                onChange={(e) => setHeaderField('handling_rate_pct', Number(e.target.value || 0))}
                style={inputStyle} />
            </Field>
            <Field label="Salvage (₹)">
              <input type="number" min="0"
                value={sheet?.salvage_amount ?? 0}
                onChange={(e) => setHeaderField('salvage_amount', Number(e.target.value || 0))}
                style={inputStyle} />
            </Field>
            <Field label="Excess (₹)">
              <input type="number" min="0"
                value={sheet?.excess_amount ?? 0}
                onChange={(e) => setHeaderField('excess_amount', Number(e.target.value || 0))}
                style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 12 }}>
            <Field label="Status">
              <select value={sheet?.status || 'draft'} onChange={(e) => setHeaderField('status', e.target.value)} style={inputStyle}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <input value={sheet?.notes || ''} onChange={(e) => setHeaderField('notes', e.target.value)} placeholder="Internal note" style={inputStyle} />
            </Field>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 1fr)', gap: 16, marginTop: 16, alignItems: 'start' }}>
          <div style={paneStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14, color: '#1e40af' }}>Line items ({items.length})</h4>
              <button className="success" onClick={addItem} style={{ fontSize: 12 }}>+ Add item</button>
            </div>
            {items.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                No line items yet. Click <strong>+ Add item</strong>.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={th}>#</th>
                      <th style={th}>LR No</th>
                      <th style={th}>Invoice</th>
                      <th style={th}>Description</th>
                      <th style={th}>Pack</th>
                      <th style={thR}>Damaged Qty</th>
                      <th style={thR}>Rate (₹)</th>
                      <th style={thR}>Amount</th>
                      <th style={thR}>Ins %</th>
                      <th style={thR}>Ins ₹</th>
                      <th style={thR}>Line total</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <ItemRow key={item.id} item={item} sheetInsRate={sheet?.insurance_rate_pct ?? 1}
                        onUpdate={(patch) => updateItem(item.id, patch)}
                        onDelete={() => deleteItem(item.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <SummaryPane summary={summary} sheet={sheet} />
        </div>
      </div>
    </PageLayout>
  );
}

function ItemRow({ item, sheetInsRate, onUpdate, onDelete }) {
  const [draft, setDraft] = useState(item);
  useEffect(() => { setDraft(item); }, [item]);

  function commit(field, value) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (item[field] === value) return;
    onUpdate({ [field]: value });
  }

  return (
    <tr>
      <td style={td}>{draft.item_no}</td>
      <td style={td}>
        <input value={draft.lr_no || ''} onChange={(e) => setDraft({ ...draft, lr_no: e.target.value })}
          onBlur={(e) => commit('lr_no', e.target.value)} style={cellInput} />
      </td>
      <td style={td}>
        <input value={draft.invoice_no || ''} onChange={(e) => setDraft({ ...draft, invoice_no: e.target.value })}
          onBlur={(e) => commit('invoice_no', e.target.value)} style={cellInput} />
      </td>
      <td style={td}>
        <input value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          onBlur={(e) => commit('description', e.target.value)} style={cellInput} />
      </td>
      <td style={td}>
        <input value={draft.pack_size || ''} onChange={(e) => setDraft({ ...draft, pack_size: e.target.value })}
          onBlur={(e) => commit('pack_size', e.target.value)} style={cellInput} placeholder="20L / box" />
      </td>
      <td style={tdR}>
        <input type="number" min="0" step="0.01"
          value={draft.damaged_qty ?? 1}
          onChange={(e) => setDraft({ ...draft, damaged_qty: Number(e.target.value) })}
          onBlur={(e) => commit('damaged_qty', Number(e.target.value || 0))}
          style={cellInputR} />
      </td>
      <td style={tdR}>
        <input type="number" min="0"
          value={draft.rate ?? 0}
          onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) })}
          onBlur={(e) => commit('rate', Number(e.target.value || 0))}
          style={cellInputR} />
      </td>
      <td style={tdR}>{fmtINR(draft.amount)}</td>
      <td style={tdR}>
        <input type="number" min="0" max="100" step="0.1"
          value={draft.insurance_rate_pct ?? sheetInsRate}
          onChange={(e) => setDraft({ ...draft, insurance_rate_pct: Number(e.target.value) })}
          onBlur={(e) => commit('insurance_rate_pct', Number(e.target.value || 0))}
          style={{ ...cellInputR, background: draft.insurance_rate_pct !== null && draft.insurance_rate_pct !== sheetInsRate ? '#fef3c7' : '#fff' }}
          title="Per-line override of sheet default" />
      </td>
      <td style={tdR}>{fmtINR(draft.insurance_value)}</td>
      <td style={{ ...tdR, fontWeight: 600 }}>{fmtINR(draft.line_total)}</td>
      <td style={td}>
        <button onClick={onDelete} style={{ fontSize: 11, padding: '2px 6px', color: '#b91c1c', background: 'transparent', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}>✕</button>
      </td>
    </tr>
  );
}

function SummaryPane({ summary, sheet }) {
  return (
    <aside style={{ ...paneStyle, position: 'sticky', top: 20 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#1e40af' }}>Summary</h4>

      <SummaryRow label="Subtotal (Σ amount)" value={fmtINR(summary?.subtotal_amount)} />
      <SummaryRow label={`Insurance @ ${summary?.insurance_rate_pct ?? '-'}%`} value={fmtINR(summary?.insurance_total)} />
      <SummaryRow label="Pre-GST" value={fmtINR(summary?.pre_gst_total)} />

      <div style={{ borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />

      <SummaryRow label={`GST @ ${summary?.gst_rate_pct ?? '-'}%`} value={fmtINR(summary?.gst_amount)} />
      <SummaryRow label="After GST" value={fmtINR(summary?.after_gst_total)} />
      <SummaryRow label={`Handling @ ${summary?.handling_rate_pct ?? '-'}%`} value={fmtINR(summary?.handling_amount)} />
      <SummaryRow label="After handling" value={fmtINR(summary?.after_handling_total)} />

      <div style={{ borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />

      <SummaryRow label="Less: Salvage" value={fmtINR(summary?.salvage_applied)} />
      <SummaryRow label="Net Loss" value={fmtINR(summary?.net_loss)} />
      <SummaryRow label="Less: Excess" value={fmtINR(summary?.excess_applied)} />

      <div style={{ borderTop: '2px solid #1e40af', margin: '10px 0', paddingTop: 10 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>Net Adjusted Loss</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#1e40af' }}>{fmtINR(summary?.net_adjusted_loss)}</span>
      </div>

      <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 12, lineHeight: 1.4 }}>
        Marine flow: <em>amount → +insurance% → +GST% → +handling% → −salvage → −excess</em>. Recomputed on every line-item change. Mirrors the Kansai Nerolac / Qutone working-sheet conventions.
      </p>
    </aside>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#475569' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const paneStyle = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginTop: 16 };
const inputStyle = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '4px 8px', borderBottom: '1px solid #f1f5f9' };
const tdR = { ...td, textAlign: 'right' };
const cellInput = { width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid transparent', borderRadius: 3, background: 'transparent' };
const cellInputR = { ...cellInput, textAlign: 'right' };
