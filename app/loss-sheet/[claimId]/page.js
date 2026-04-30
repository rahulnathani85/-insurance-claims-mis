'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { DEPRECIATION_OPTIONS } from '@/lib/lossSheet';

const fmtINR = (n) => {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
};

const STATUS_OPTIONS = ['draft', 'under_review', 'approved', 'superseded'];

export default function LossSheetPage({ params }) {
  const router = useRouter();
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
        fetch(`/api/claims/${claimId}/loss-sheet`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setClaim(claimRes);
      if (sheetRes) {
        setSheet(sheetRes.sheet);
        setItems(sheetRes.items || []);
        setSummary(sheetRes.summary);
      }
    } catch (e) {
      showAlert('Failed to load loss sheet: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  // Debounced header save (sum_insured / excess / status / notes)
  const queueHeaderSave = useCallback((updates) => {
    clearTimeout(headerTimer.current);
    headerTimer.current = setTimeout(async () => {
      setHeaderSaving(true);
      try {
        const res = await fetch(`/api/claims/${claimId}/loss-sheet`, {
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
      const res = await fetch(`/api/claims/${claimId}/loss-sheet/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'New item',
          category: 'machinery_general',
          replacement_value: 0,
          age_years: null,
          salvage_value: 0,
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
      const res = await fetch(`/api/loss-sheet-items/${itemId}`, {
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
      const res = await fetch(`/api/loss-sheet-items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="main-content"><div className="loading">Loading loss sheet…</div></div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content" style={{ maxWidth: 1400, margin: '0 auto' }}>
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Loss Sheet · {claim?.ref_number || `Claim #${claimId}`}</h2>
            <p style={{ color: '#475569', fontSize: 13, margin: '4px 0 0' }}>
              {claim?.insured_name || ''} · {claim?.lob || ''}
              {sheet?.status && <> · status <strong>{sheet.status}</strong></>}
            </p>
          </div>
          {headerSaving && <span style={{ fontSize: 12, color: '#3b82f6' }}>Saving…</span>}
        </div>

        {/* Header inputs */}
        <div style={paneStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))', gap: 12 }}>
            <Field label="Sum Insured (₹)">
              <input
                type="number"
                min="0"
                value={sheet?.sum_insured ?? ''}
                onChange={(e) => setHeaderField('sum_insured', e.target.value === '' ? null : Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
            <Field label="Excess / deductible (₹)">
              <input
                type="number"
                min="0"
                value={sheet?.excess_amount ?? 0}
                onChange={(e) => setHeaderField('excess_amount', Number(e.target.value || 0))}
                style={inputStyle}
              />
            </Field>
            <Field label="Status">
              <select
                value={sheet?.status || 'draft'}
                onChange={(e) => setHeaderField('status', e.target.value)}
                style={inputStyle}
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <input
                value={sheet?.notes || ''}
                onChange={(e) => setHeaderField('notes', e.target.value)}
                placeholder="Internal note (optional)"
                style={inputStyle}
              />
            </Field>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 1fr)', gap: 16, marginTop: 16, alignItems: 'start' }}>
          {/* Items table */}
          <div style={paneStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14, color: '#1e40af' }}>Line items ({items.length})</h4>
              <button className="success" onClick={addItem} style={{ fontSize: 12 }}>+ Add item</button>
            </div>
            {items.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                No line items yet. Click <strong>+ Add item</strong> to start.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={th}>#</th>
                      <th style={th}>Description</th>
                      <th style={th}>Category</th>
                      <th style={th}>Qty</th>
                      <th style={thR}>RV (₹)</th>
                      <th style={thR}>Age (yrs)</th>
                      <th style={thR}>Dep %</th>
                      <th style={thR}>Dep'd value</th>
                      <th style={thR}>Salvage</th>
                      <th style={thR}>Net loss</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onUpdate={(patch) => updateItem(item.id, patch)}
                        onDelete={() => deleteItem(item.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary panel */}
          <SummaryPane summary={summary} sheet={sheet} />
        </div>
      </div>
    </PageLayout>
  );
}

function ItemRow({ item, onUpdate, onDelete }) {
  // Local state so typing in numeric fields doesn't roundtrip on every keystroke.
  const [draft, setDraft] = useState(item);
  useEffect(() => { setDraft(item); }, [item]);

  function commit(field, value) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    // Don't fire if unchanged (avoid useless server roundtrip)
    if (item[field] === value) return;
    onUpdate({ [field]: value });
  }

  function commitDepOverride(value) {
    onUpdate({
      depreciation_pct: Number(value),
      depreciation_pct_override: true,
    });
  }

  function clearDepOverride() {
    onUpdate({
      depreciation_pct_override: false,
    });
  }

  return (
    <tr>
      <td style={td}>{draft.item_no}</td>
      <td style={td}>
        <input
          value={draft.description || ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          onBlur={(e) => commit('description', e.target.value)}
          style={cellInput}
        />
      </td>
      <td style={td}>
        <select
          value={draft.category || ''}
          onChange={(e) => commit('category', e.target.value)}
          style={cellInput}
        >
          {DEPRECIATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      <td style={tdR}>
        <input
          type="number"
          min="0"
          step="0.01"
          value={draft.quantity ?? 1}
          onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
          onBlur={(e) => commit('quantity', Number(e.target.value || 0))}
          style={cellInputR}
        />
      </td>
      <td style={tdR}>
        <input
          type="number"
          min="0"
          value={draft.replacement_value ?? 0}
          onChange={(e) => setDraft({ ...draft, replacement_value: Number(e.target.value) })}
          onBlur={(e) => commit('replacement_value', Number(e.target.value || 0))}
          style={cellInputR}
        />
      </td>
      <td style={tdR}>
        <input
          type="number"
          min="0"
          step="0.5"
          value={draft.age_years ?? ''}
          onChange={(e) => setDraft({ ...draft, age_years: e.target.value === '' ? null : Number(e.target.value) })}
          onBlur={(e) => commit('age_years', e.target.value === '' ? null : Number(e.target.value))}
          style={cellInputR}
        />
      </td>
      <td style={{ ...tdR, position: 'relative' }}>
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={draft.depreciation_pct ?? 0}
          onChange={(e) => setDraft({ ...draft, depreciation_pct: Number(e.target.value) })}
          onBlur={(e) => commitDepOverride(e.target.value)}
          style={{ ...cellInputR, background: draft.depreciation_pct_override ? '#fef3c7' : '#fff' }}
          title={draft.depreciation_pct_override ? 'Manually overridden — click ↺ to revert to auto' : 'Auto from category × age'}
        />
        {draft.depreciation_pct_override && (
          <button
            onClick={clearDepOverride}
            style={{ position: 'absolute', top: 4, right: 4, fontSize: 10, padding: '0 4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#b45309' }}
            title="Revert to auto"
          >↺</button>
        )}
      </td>
      <td style={tdR}>{fmtINR(draft.depreciated_value)}</td>
      <td style={tdR}>
        <input
          type="number"
          min="0"
          value={draft.salvage_value ?? 0}
          onChange={(e) => setDraft({ ...draft, salvage_value: Number(e.target.value) })}
          onBlur={(e) => commit('salvage_value', Number(e.target.value || 0))}
          style={cellInputR}
        />
      </td>
      <td style={{ ...tdR, fontWeight: 600 }}>{fmtINR(draft.net_loss)}</td>
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

      <SummaryRow label="Value at Risk (Σ RV)" value={fmtINR(summary?.value_at_risk)} />
      <SummaryRow label="Sum Insured" value={fmtINR(sheet?.sum_insured)} />

      <div style={{ borderTop: '1px solid #e2e8f0', margin: '10px 0', paddingTop: 10 }} />

      <SummaryRow label="Gross Loss (Σ net loss)" value={fmtINR(summary?.gross_loss)} />

      {summary?.underinsurance_factor !== null && summary?.underinsurance_factor !== undefined && (
        <>
          <SummaryRow
            label="Underinsurance"
            value={`${(summary.underinsurance_factor * 100).toFixed(2)}% applied`}
            subtext={summary.underinsurance_pct > 0 ? `(${summary.underinsurance_pct.toFixed(2)}% short of VAR)` : '(fully insured)'}
            highlight={summary.underinsurance_pct > 0}
          />
          <SummaryRow label="Adjusted Loss" value={fmtINR(summary.adjusted_loss)} />
        </>
      )}

      <SummaryRow label="Excess applied" value={fmtINR(summary?.excess_applied)} />

      <div style={{ borderTop: '2px solid #1e40af', margin: '10px 0', paddingTop: 10 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>Net Payable</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#1e40af' }}>{fmtINR(summary?.net_payable)}</span>
      </div>

      <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 12, lineHeight: 1.4 }}>
        Auto-recomputed on every line-item change. Underinsurance (if SI &lt; VAR) is applied to gross loss before the excess deduction. Per CLAUDE.md §7.
      </p>
    </aside>
  );
}

function SummaryRow({ label, value, subtext, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#475569' }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: highlight ? '#b45309' : '#0f172a' }}>{value}</div>
        {subtext && <div style={{ fontSize: 10, color: '#94a3b8' }}>{subtext}</div>}
      </div>
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
