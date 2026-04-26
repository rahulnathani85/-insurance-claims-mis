'use client';

// ============================================================
// /communications/triage
// ------------------------------------------------------------
// Stage 3b — triage queue for human-first message review.
//
// Lists inbox_messages with status='received' (the default
// triage queue). Optional filters: status (any enum), substring
// search on subject / from_address, pagination.
//
// Click a row to drill into the detail page where the human
// picks a workflow tag or dismisses.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const STATUS_OPTIONS = [
  { value: 'received', label: 'Awaiting triage' },
  { value: 'classifying', label: 'Triaged (extracting)' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All statuses' },
];

export default function TriageQueuePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('received');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        limit: String(limit),
        offset: String(offset),
      });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(
        `/api/communications/messages?${params.toString()}`,
        {
          headers: { 'x-app-user-email': user.email },
          cache: 'no-store',
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [user?.email, status, q, offset]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  }
  if (!user) return null;

  const total = data?.total || 0;
  const messages = data?.messages || [];
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + messages.length, total);

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>
          Communications &mdash; Triage queue
        </h2>
        <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#64748b', maxWidth: 760 }}>
          Read each message and pick a workflow tag &mdash; or dismiss it as not
          relevant. Only categorised messages move on to AI extraction (Stage 3c).
          Dismissed messages are terminal and never touched by AI.
        </p>

        {error && <Banner kind="err">{error}</Banner>}

        {/* Filter bar */}
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: 12,
        }}>
          <label style={labelStyle}>
            Status:
            <select
              value={status}
              onChange={(e) => { setOffset(0); setStatus(e.target.value); }}
              style={selectStyle}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <input
            type="text"
            placeholder="Search subject or sender…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); load(); } }}
            style={inputStyle}
          />
          <button
            onClick={() => { setOffset(0); load(); }}
            disabled={busy}
            style={buttonStyle('primary', busy)}
          >
            {busy ? '…' : 'Search'}
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            Showing {showingFrom}–{showingTo} of {total}
          </div>
        </div>

        {/* Message list */}
        {messages.length === 0 ? (
          <div style={emptyBoxStyle}>
            {status === 'received'
              ? 'No messages awaiting triage. Nice work.'
              : 'No messages match this filter.'}
          </div>
        ) : (
          <div style={{
            border: '1px solid #e2e8f0', borderRadius: 8,
            background: '#fff', overflow: 'hidden',
          }}>
            {messages.map((m, i) => (
              <Link
                key={m.id}
                href={`/communications/triage/${m.id}`}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div style={{
                  padding: '12px 16px',
                  borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 16,
                  alignItems: 'center',
                  background: '#fff',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 600, color: '#0f172a',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {m.subject || '(no subject)'}
                    </div>
                    <div style={{
                      fontSize: 12, color: '#64748b', marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {m.from_display || m.from_address}
                      {m.attachments_count > 0 && (
                        <span style={{ marginLeft: 8 }}>📎 {m.attachments_count}</span>
                      )}
                      <span style={{ marginLeft: 8 }}>· {m.company}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <StatusBadge status={m.status} />
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                      {formatRelative(m.received_at)}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > limit && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0 || busy}
              style={buttonStyle('secondary', offset === 0 || busy)}
            >
              ← Prev
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total || busy}
              style={buttonStyle('secondary', offset + limit >= total || busy)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------
function StatusBadge({ status }) {
  const map = {
    received:        { bg: '#fffbeb', fg: '#92400e', label: 'Awaiting triage' },
    classifying:     { bg: '#dbeafe', fg: '#1e40af', label: 'Extracting…' },
    pending_review:  { bg: '#ede9fe', fg: '#5b21b6', label: 'Pending review' },
    auto_routed:     { bg: '#ecfdf5', fg: '#065f46', label: 'Auto-routed' },
    rejected:        { bg: '#fef2f2', fg: '#991b1b', label: 'Rejected' },
    dismissed:       { bg: '#f1f5f9', fg: '#475569', label: 'Dismissed' },
    error:           { bg: '#fef2f2', fg: '#991b1b', label: 'Error' },
  };
  const c = map[status] || { bg: '#f1f5f9', fg: '#475569', label: status };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
      color: c.fg, background: c.bg,
      padding: '2px 8px', borderRadius: 999,
    }}>{c.label}</span>
  );
}

function Banner({ kind, children }) {
  const map = {
    ok:   { bg: '#ecfdf5', fg: '#065f46', bd: '#a7f3d0' },
    warn: { bg: '#fffbeb', fg: '#92400e', bd: '#fde68a' },
    err:  { bg: '#fef2f2', fg: '#991b1b', bd: '#fecaca' },
  };
  const c = map[kind] || map.warn;
  return (
    <div style={{
      background: c.bg, color: c.fg, border: `1px solid ${c.bd}`,
      padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const dSec = Math.round((Date.now() - t) / 1000);
  if (dSec < 60) return `${dSec}s ago`;
  if (dSec < 3600) return `${Math.round(dSec / 60)}m ago`;
  if (dSec < 86_400) return `${Math.round(dSec / 3600)}h ago`;
  if (dSec < 7 * 86_400) return `${Math.round(dSec / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ------------------------------------------------------------
// Inline styles
// ------------------------------------------------------------
const labelStyle = {
  fontSize: 13, color: '#475569',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

const selectStyle = {
  padding: '6px 8px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff',
};

const inputStyle = {
  flex: '1 1 220px', minWidth: 200, maxWidth: 360,
  padding: '6px 10px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 6,
};

const emptyBoxStyle = {
  background: '#fff', border: '1px dashed #cbd5e1',
  borderRadius: 8, padding: 32, textAlign: 'center',
  color: '#94a3b8', fontSize: 13,
};

function buttonStyle(variant, disabled) {
  const base = {
    padding: '6px 12px', fontSize: 13, fontWeight: 600,
    border: 'none', borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
  if (variant === 'primary') {
    return { ...base, background: '#1e3a5f', color: '#fff' };
  }
  return { ...base, background: '#f1f5f9', color: '#0f172a' };
}
