'use client';
// =============================================================================
// components/FieldWithProvenance.jsx
// =============================================================================
// Inline value display + provenance popover. Wraps any field value (string,
// number, or formatted children) and surfaces:
//
//   - A small dot next to the value, colour-coded by source type +
//     extraction confidence + conflict status.
//   - A click-to-open popover with: source type / source document type /
//     source label / who captured it / when / extraction confidence /
//     "Show history" expandable that pulls full evidence rows from
//     /api/claims/<id>/field-history.
//
// Use either by passing the full provenance map (claimProvenance prop) so
// many fields on the same page share one fetch, OR pass `provenance` directly.
//
// Examples:
//
//   // Single field, parent has the map
//   <FieldWithProvenance
//     claimId={claim.id}
//     field="policy_number"
//     provenance={claimProvenance.policy_number}
//   >
//     {claim.policy_number}
//   </FieldWithProvenance>
//
//   // Multiple fields, share one fetch via the convenience hook
//   const { provenance } = useClaimProvenance(claim.id);
//   ...
//     <FieldWithProvenance claimId={claim.id} field="insured_name"
//                          provenance={provenance?.insured_name}>
//       {claim.insured_name}
//     </FieldWithProvenance>
//
// If no `provenance` prop is given the dot is grey and the popover shows
// "no provenance recorded" (i.e. legacy column-only value).
// =============================================================================

import { useEffect, useRef, useState } from 'react';

// -----------------------------------------------------------------------------
// useClaimProvenance — convenience hook so a parent can fetch the merged
// claim once and pass each field's provenance entry to the wrapper.
// -----------------------------------------------------------------------------
export function useClaimProvenance(claimId) {
  const [data, setData] = useState({ claim: null, provenance: {}, merged: null, data_quality: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!claimId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/claims/${claimId}/with-provenance`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.error) { setError(d.error); return; }
        setData({
          claim: d?.claim || null,
          provenance: d?.provenance || {},
          merged: d?.merged || null,
          data_quality: d?.data_quality || null,
        });
      })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [claimId]);

  return { ...data, loading, error };
}

// -----------------------------------------------------------------------------
// <FieldWithProvenance>
// -----------------------------------------------------------------------------
export default function FieldWithProvenance({
  claimId,
  field,
  provenance,
  children,
  className,
  style,
  showLabel = false,   // when true, prepends source type as a tiny chip before the value
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dot = pickDotStyle(provenance);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, ...style }} className={className}>
      {showLabel && provenance?.source_type && (
        <span style={chipStyle(dot.bg)}>{provenance.source_type}</span>
      )}

      <span>{children}</span>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={dot.title}
        aria-label={`Show provenance for ${field}`}
        style={dotButtonStyle(dot.bg, dot.border, !!provenance)}
      />

      {open && (
        <ProvenancePopover
          claimId={claimId}
          field={field}
          provenance={provenance}
        />
      )}
    </span>
  );
}

// -----------------------------------------------------------------------------
// ProvenancePopover — the click-to-open detail panel.
// -----------------------------------------------------------------------------
function ProvenancePopover({ claimId, field, provenance }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);  // null = not loaded yet
  const [loadingHist, setLoadingHist] = useState(false);
  const [histError, setHistError] = useState(null);

  async function loadHistory() {
    if (history !== null || loadingHist) return;
    setLoadingHist(true);
    setHistError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/field-history?field=${encodeURIComponent(field)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'history load failed');
      setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      setHistError(e.message);
      setHistory([]);
    } finally {
      setLoadingHist(false);
    }
  }

  function toggleHistory() {
    setHistoryOpen((o) => {
      const next = !o;
      if (next) loadHistory();
      return next;
    });
  }

  return (
    <div style={popoverStyle}>
      <div style={popHeaderStyle}>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, color: '#0f172a' }}>
          {field}
        </span>
      </div>

      <div style={popBodyStyle}>
        {!provenance ? (
          <div style={emptyMsgStyle}>
            No provenance recorded — value comes from the legacy <code>claims</code> column only.
            Phase A backfill will populate this once it runs for the field.
          </div>
        ) : (
          <>
            <Row label="Source type"        value={provenance.source_type} />
            <Row label="Source document"    value={provenance.source_document_type} />
            <Row label="Source label"       value={provenance.source_label} mono={false} />
            <Row label="Confidence"         value={fmtConfidence(provenance.confidence)} />
            <Row label="Captured by"        value={provenance.captured_by} />
            <Row label="Captured at"        value={fmtDate(provenance.captured_at)} />
            {provenance.has_pending_conflict && (
              <div style={conflictBadgeStyle}>
                ⚠ Pending conflict — a higher-authority source disagrees with this value. Resolve via the Issues panel.
              </div>
            )}
          </>
        )}

        {/* Show history toggle */}
        <button type="button" onClick={toggleHistory} style={historyToggleStyle(historyOpen)}>
          {historyOpen ? '▾ Hide history' : '▸ Show history'}
        </button>

        {historyOpen && (
          <HistoryList history={history} loading={loadingHist} error={histError} />
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// HistoryList
// -----------------------------------------------------------------------------
function HistoryList({ history, loading, error }) {
  if (loading) return <div style={infoLineStyle}>Loading history…</div>;
  if (error) return <div style={errorLineStyle}>⚠ {error}</div>;
  if (!history || history.length === 0) {
    return <div style={infoLineStyle}>No previous values recorded.</div>;
  }
  return (
    <div style={historyWrapStyle}>
      {history.map((row) => (
        <div key={row.id} style={historyRowStyle(row.is_current)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              {fmtDate(row.captured_at)}
            </span>
            <span style={{ fontSize: 10, color: '#64748b' }}>
              {row.source_type}
              {row.is_current && <span style={currentBadgeStyle}>current</span>}
              {row.conflict_status === 'pending' && <span style={conflictPillStyle}>conflict</span>}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#0f172a', marginTop: 2 }}>
            {fmtFieldValue(row.value)}
          </div>
          <div style={{ fontSize: 10, color: '#64748b' }}>
            {row.captured_by || row.extracted_by || '—'}
            {row.source_label && ` · ${row.source_label}`}
            {typeof row.extraction_confidence === 'number' && ` · conf ${row.extraction_confidence.toFixed(2)}`}
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function Row({ label, value, mono = true }) {
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <span style={rowValueStyle(mono)}>{value || <em style={dimStyle}>—</em>}</span>
    </div>
  );
}

function pickDotStyle(p) {
  if (!p) {
    return {
      bg: '#cbd5e1', border: '#94a3b8',
      title: 'No provenance recorded — legacy column value',
    };
  }
  if (p.has_pending_conflict) {
    return {
      bg: '#dc2626', border: '#991b1b',
      title: 'Conflict pending — a higher-authority source disagrees',
    };
  }
  const t = p.source_type;
  const conf = typeof p.confidence === 'number' ? p.confidence : null;
  if (t === 'manual') {
    return { bg: '#16a34a', border: '#15803d', title: 'Manual entry by surveyor' };
  }
  if (t === 'ai') {
    const lo = conf !== null && conf < 0.7;
    return {
      bg: lo ? '#a855f7' : '#7c3aed',
      border: '#6d28d9',
      title: `AI suggestion${conf !== null ? ` (conf ${conf.toFixed(2)})` : ''}`,
    };
  }
  if (t === 'document') {
    if (conf === null) return { bg: '#0ea5e9', border: '#0284c7', title: 'Document extraction (confidence not recorded)' };
    if (conf >= 0.85) return { bg: '#0284c7', border: '#0369a1', title: `Document extraction (high confidence ${conf.toFixed(2)})` };
    if (conf >= 0.6)  return { bg: '#f59e0b', border: '#d97706', title: `Document extraction (medium confidence ${conf.toFixed(2)})` };
    return { bg: '#dc2626', border: '#991b1b', title: `Document extraction (low confidence ${conf.toFixed(2)}) — review` };
  }
  if (t === 'email')         return { bg: '#0891b2', border: '#0e7490', title: 'Extracted from email' };
  if (t === 'computed')      return { bg: '#9333ea', border: '#7e22ce', title: 'Computed value' };
  if (t === 'external_api')  return { bg: '#0d9488', border: '#0f766e', title: 'External API' };
  if (t === 'migrated')      return { bg: '#94a3b8', border: '#64748b', title: 'Pre-provenance baseline (migration)' };
  return { bg: '#64748b', border: '#475569', title: t || 'Unknown source' };
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtConfidence(c) {
  if (c === null || c === undefined) return '';
  if (typeof c !== 'number') return String(c);
  return `${(c * 100).toFixed(0)}%`;
}

// FieldValue is a JSONB blob produced by lib/provenance/values.js. The shape
// depends on `kind` (money / date / string / etc). For the history list we
// just want a human-readable summary.
function fmtFieldValue(v) {
  if (!v) return '—';
  if (typeof v !== 'object') return String(v);
  switch (v.kind) {
    case 'money':
      return v.amount != null ? `₹${(Number(v.amount) / 100).toLocaleString('en-IN')}` : '—';
    case 'date':
    case 'datetime':
    case 'string':
    case 'enum':
    case 'pin':
    case 'phone':
    case 'email':
      return v.value ?? '—';
    case 'gps':
      return `${v.lat}, ${v.lng}`;
    default:
      return v.value ?? JSON.stringify(v);
  }
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

function dotButtonStyle(bg, border, hasProvenance) {
  return {
    width: 10, height: 10,
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: '50%', padding: 0,
    cursor: 'pointer', flexShrink: 0,
    opacity: hasProvenance ? 1 : 0.6,
  };
}

function chipStyle(bg) {
  return {
    fontSize: 9, fontWeight: 700, padding: '1px 5px',
    background: bg, color: '#fff', borderRadius: 3,
    textTransform: 'uppercase',
  };
}

const popoverStyle = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0,
  zIndex: 100,
  minWidth: 280, maxWidth: 380,
  background: '#fff',
  border: '1px solid #cbd5e1',
  boxShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
  borderRadius: 8,
  fontSize: 12,
};

const popHeaderStyle = {
  padding: '6px 10px', background: '#f1f5f9',
  borderBottom: '1px solid #cbd5e1',
  borderTopLeftRadius: 8, borderTopRightRadius: 8,
};
const popBodyStyle = { padding: 10 };

const rowStyle = { display: 'flex', gap: 8, padding: '2px 0' };
const rowLabelStyle = { width: 110, fontSize: 11, color: '#64748b', flexShrink: 0 };
function rowValueStyle(mono) {
  return {
    flex: 1, fontSize: 11, color: '#0f172a',
    fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
    wordBreak: 'break-word',
  };
}
const dimStyle = { color: '#94a3b8', fontStyle: 'italic' };

const emptyMsgStyle = {
  padding: 8, fontSize: 11, color: '#64748b',
  background: '#f8fafc', borderRadius: 4, fontStyle: 'italic',
};

const conflictBadgeStyle = {
  marginTop: 8, padding: 6, fontSize: 11,
  background: '#fee2e2', color: '#991b1b',
  border: '1px solid #fecaca', borderRadius: 4,
};

function historyToggleStyle(open) {
  return {
    marginTop: 8, padding: '4px 8px',
    background: open ? '#1e293b' : 'transparent',
    color: open ? '#fff' : '#475569',
    border: `1px solid ${open ? '#1e293b' : '#cbd5e1'}`, borderRadius: 6,
    fontSize: 11, cursor: 'pointer', fontWeight: 600,
  };
}

const historyWrapStyle = {
  marginTop: 6, maxHeight: 240, overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 6,
};
function historyRowStyle(isCurrent) {
  return {
    padding: 6, background: isCurrent ? '#dcfce7' : '#fafbfc',
    border: `1px solid ${isCurrent ? '#bbf7d0' : '#e2e8f0'}`,
    borderRadius: 4,
  };
}
const currentBadgeStyle = {
  marginLeft: 6, padding: '0 4px', fontSize: 9, fontWeight: 700,
  background: '#16a34a', color: '#fff', borderRadius: 3,
};
const conflictPillStyle = {
  marginLeft: 6, padding: '0 4px', fontSize: 9, fontWeight: 700,
  background: '#dc2626', color: '#fff', borderRadius: 3,
};

const infoLineStyle = { padding: 8, fontSize: 11, color: '#64748b', textAlign: 'center' };
const errorLineStyle = { padding: 8, fontSize: 11, color: '#991b1b', background: '#fee2e2', borderRadius: 4 };
