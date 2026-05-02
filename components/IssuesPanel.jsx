'use client';
// =============================================================================
// components/IssuesPanel.jsx
// =============================================================================
// Slice 10 — claim_issues list with severity badges + resolve / dismiss /
// reopen actions. Drops into the claim-detail page as a side panel or tab.
//
// Three states per issue:
//   open       — actively visible, surveyor needs to act
//   resolved   — fixed, hidden from default view
//   dismissed  — acknowledged but not actionable
//
// Three severities (badge colours mirror the rest of the portal UI):
//   info   blue
//   warn   amber  (default for AI-flagged gaps)
//   error  red    (default for provenance conflicts; blocks FSR submission)
//
// Props:
//   claimId       BIGINT       (required)
//   userEmail     string       used as resolved_by when the surveyor clicks
//   refreshKey    any          bump this from the parent to force a reload
//                              after an external action (e.g. an AI route
//                              that creates an issue)
//   onChange()    fn           optional. Called after any mutation so the
//                              parent can update its own counters.
// =============================================================================

import { useEffect, useState } from 'react';

const SEVERITY_STYLES = {
  error: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca', label: 'Error' },
  warn:  { bg: '#fef3c7', color: '#92400e', border: '#fde68a', label: 'Warn'  },
  info:  { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe', label: 'Info'  },
};

const SOURCE_LABELS = {
  manual:     'Manual flag',
  ai:         'AI validation',
  provenance: 'Provenance conflict',
};

export default function IssuesPanel({ claimId, userEmail, refreshKey, onChange }) {
  const [filter, setFilter] = useState('open');  // 'open' | 'resolved' | 'dismissed' | 'all'
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  async function load() {
    if (!claimId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/claim-issues?claim_id=${claimId}&status=${filter}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Load failed');
      setIssues(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [claimId, filter, refreshKey]);

  async function transition(id, status) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/claim-issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolved_by: userEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Update failed');
      await load();
      onChange?.();
    } catch (e) {
      alert('Could not update: ' + e.message);
    } finally {
      setPendingId(null);
    }
  }

  const counts = countByStatus(issues, filter);

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h4 style={titleStyle}>Issues</h4>
          <FilterTabs current={filter} onChange={setFilter} />
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((s) => !s)}
          style={addBtnStyle}
        >
          {showAddForm ? '✕ Cancel' : '+ Add issue'}
        </button>
      </div>

      {showAddForm && (
        <AddIssueForm
          claimId={claimId}
          userEmail={userEmail}
          onCreated={() => { setShowAddForm(false); load(); onChange?.(); }}
        />
      )}

      {loading && <div style={loadingStyle}>Loading…</div>}
      {error && <div style={errorStyle}>⚠ {error}</div>}

      {!loading && !error && issues.length === 0 && (
        <div style={emptyStyle}>
          {filter === 'open'
            ? '🎉 No open issues for this claim.'
            : `No ${filter === 'all' ? '' : filter} issues.`}
        </div>
      )}

      {!loading && issues.length > 0 && (
        <div style={listStyle}>
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              busy={pendingId === issue.id}
              onResolve={() => transition(issue.id, 'resolved')}
              onDismiss={() => transition(issue.id, 'dismissed')}
              onReopen={() => transition(issue.id, 'open')}
            />
          ))}
        </div>
      )}

      {!loading && issues.length > 0 && (
        <div style={countsLineStyle}>
          {counts}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// IssueRow
// -----------------------------------------------------------------------------
function IssueRow({ issue, busy, onResolve, onDismiss, onReopen }) {
  const sev = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.info;
  const isOpen = issue.status === 'open';

  return (
    <div style={rowStyle(sev)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={severityBadgeStyle(sev)}>{sev.label}</span>
        <span style={codeStyle}>{issue.code}</span>
        {issue.field && <span style={fieldChipStyle}>{issue.field}</span>}
        <span style={sourceStyle}>{SOURCE_LABELS[issue.source_type] || issue.source_type}</span>
      </div>
      <div style={messageStyle}>{issue.message}</div>
      {issue.resolution_note && (
        <div style={resolutionStyle}>
          <strong>Resolution:</strong> {issue.resolution_note}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={metaStyle}>
          {new Date(issue.created_at).toLocaleString('en-IN')}
          {issue.resolved_at && (
            <> · resolved {new Date(issue.resolved_at).toLocaleString('en-IN')}{issue.resolved_by ? ` by ${issue.resolved_by}` : ''}</>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {isOpen ? (
            <>
              <button type="button" onClick={onResolve} disabled={busy} style={resolveBtnStyle(busy)}>
                ✓ Resolve
              </button>
              <button type="button" onClick={onDismiss} disabled={busy} style={dismissBtnStyle(busy)}>
                Dismiss
              </button>
            </>
          ) : (
            <button type="button" onClick={onReopen} disabled={busy} style={reopenBtnStyle(busy)}>
              ↺ Re-open
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// AddIssueForm — minimal manual-flag form
// -----------------------------------------------------------------------------
function AddIssueForm({ claimId, userEmail, onCreated }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [field, setField] = useState('');
  const [severity, setSeverity] = useState('warn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!code.trim() || !message.trim()) {
      setError('Code and message are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/claim-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: claimId,
          severity,
          code: code.trim().toUpperCase().replace(/\s+/g, '_'),
          field: field.trim() || null,
          message: message.trim(),
          source_type: 'manual',
          created_by: userEmail || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Create failed');
      setCode(''); setMessage(''); setField(''); setSeverity('warn');
      onCreated?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 8 }}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code (e.g. POLICY_DATE_MISSING)"
          disabled={busy}
          style={inputStyle}
        />
        <input
          type="text"
          value={field}
          onChange={(e) => setField(e.target.value)}
          placeholder="Field (optional, e.g. policy_period_to)"
          disabled={busy}
          style={inputStyle}
        />
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} disabled={busy} style={inputStyle}>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="One-line explanation for the surveyor"
        rows={2}
        disabled={busy}
        style={{ ...inputStyle, marginTop: 8, resize: 'vertical' }}
      />
      {error && <div style={{ color: '#991b1b', fontSize: 11, marginTop: 6 }}>⚠ {error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="submit" disabled={busy} style={submitBtnStyle(busy)}>
          {busy ? 'Creating…' : 'Create issue'}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// FilterTabs
// -----------------------------------------------------------------------------
function FilterTabs({ current, onChange }) {
  const tabs = [
    { key: 'open',      label: 'Open' },
    { key: 'resolved',  label: 'Resolved' },
    { key: 'dismissed', label: 'Dismissed' },
    { key: 'all',       label: 'All' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          style={tabBtnStyle(current === t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function countByStatus(issues, filter) {
  if (filter !== 'all') return `${issues.length} ${filter} issue${issues.length === 1 ? '' : 's'}`;
  const by = {};
  for (const i of issues) by[i.status] = (by[i.status] || 0) + 1;
  return ['open', 'resolved', 'dismissed']
    .map((s) => `${by[s] || 0} ${s}`)
    .join(' · ');
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const wrapStyle = {
  padding: 14, background: '#fff', border: '1px solid #e2e8f0',
  borderRadius: 10,
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  flexWrap: 'wrap', gap: 8, marginBottom: 12,
};
const titleStyle = { margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' };

const addBtnStyle = {
  padding: '5px 10px', fontSize: 12, fontWeight: 600,
  background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6,
  cursor: 'pointer',
};

function tabBtnStyle(active) {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: active ? '#1e293b' : '#f1f5f9',
    color: active ? '#fff' : '#475569',
    border: '1px solid ' + (active ? '#1e293b' : '#cbd5e1'),
    borderRadius: 6, cursor: 'pointer',
  };
}

const listStyle = { display: 'flex', flexDirection: 'column', gap: 8 };

function rowStyle(sev) {
  return {
    padding: '10px 12px', background: sev.bg, border: `1px solid ${sev.border}`,
    borderRadius: 8,
  };
}

function severityBadgeStyle(sev) {
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 6px',
    background: sev.color, color: '#fff', borderRadius: 4,
    textTransform: 'uppercase',
  };
}

const codeStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11,
  fontWeight: 600, color: '#1e293b',
};
const fieldChipStyle = {
  fontSize: 10, padding: '1px 5px', background: '#fff',
  border: '1px solid #cbd5e1', borderRadius: 9999, color: '#475569',
};
const sourceStyle = { fontSize: 10, color: '#64748b', fontStyle: 'italic' };
const messageStyle = { fontSize: 13, marginTop: 6, color: '#0f172a' };
const resolutionStyle = {
  marginTop: 4, fontSize: 11, fontStyle: 'italic', color: '#475569',
  background: 'rgba(255,255,255,0.5)', padding: '4px 8px', borderRadius: 4,
};
const metaStyle = { fontSize: 10, color: '#64748b' };

function resolveBtnStyle(busy) {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: busy ? '#94a3b8' : '#059669', color: '#fff',
    border: 'none', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
  };
}
function dismissBtnStyle(busy) {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: 'transparent', color: '#475569',
    border: '1px solid #cbd5e1', borderRadius: 6,
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
  };
}
function reopenBtnStyle(busy) {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    background: 'transparent', color: '#1e40af',
    border: '1px solid #bfdbfe', borderRadius: 6,
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
  };
}

const countsLineStyle = {
  marginTop: 12, fontSize: 11, color: '#64748b', textAlign: 'right',
};

const formStyle = {
  padding: 12, background: '#f8fafc',
  border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12,
};
const inputStyle = {
  padding: '5px 8px', fontSize: 12, fontFamily: 'inherit',
  border: '1px solid #cbd5e1', borderRadius: 6,
  width: '100%',
};

function submitBtnStyle(busy) {
  return {
    padding: '5px 12px', fontSize: 12, fontWeight: 600,
    background: busy ? '#94a3b8' : '#059669', color: '#fff',
    border: 'none', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
  };
}

const loadingStyle = { padding: 20, textAlign: 'center', color: '#64748b', fontSize: 12 };
const errorStyle   = { padding: '8px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 12 };
const emptyStyle   = { padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 };
