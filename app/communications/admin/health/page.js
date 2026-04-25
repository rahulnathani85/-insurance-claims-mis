'use client';

// ============================================================
// /communications/admin/health
// ------------------------------------------------------------
// Admin-only page surfacing the three kill-switch toggles plus
// recent ingest / classify runs and the mailbox_audit feed.
//
// All data flows through /api/communications/admin/health which
// gates on requireAdmin().
// ============================================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

export default function CommsHealthAdminPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null); // scope name being toggled
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const isAdmin = user?.role === 'Admin';

  const load = async () => {
    if (!user?.email) return;
    setError(null);
    try {
      const res = await fetch('/api/communications/admin/health', {
        headers: { 'x-app-user-email': user.email },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user?.email]);

  const toggle = async (scope, paused) => {
    setBusy(scope);
    setError(null);
    try {
      const res = await fetch('/api/communications/admin/health', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-app-user-email': user.email,
        },
        body: JSON.stringify({ scope, paused }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  }
  if (!user) return null;
  if (!isAdmin) {
    return (
      <PageLayout>
        <div style={{ padding: 24, maxWidth: 700, margin: '0 auto' }}>
          <Banner kind="err">Admin access required.</Banner>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>
          Communications &mdash; Health &amp; Kill Switch
        </h2>
        <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#64748b', maxWidth: 760 }}>
          Toggle the three pause flags. The very next cron tick (within ~60s of the
          toggle) will honor the change. Pausing is non-destructive &mdash; un-pause to
          resume the feature exactly where it left off.
        </p>

        {error && <div style={{ marginBottom: 12 }}><Banner kind="err">{error}</Banner></div>}

        {/* Kill-switch toggle cards */}
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}>
          <ScopeToggle
            scope="ingestion"
            label="Ingestion"
            description="Polls Gmail every 5 min for new messages."
            paused={!!data?.config?.ingestion_paused}
            since={data?.config?.ingestion_paused_at}
            busy={busy === 'ingestion'}
            onToggle={toggle}
          />
          <ScopeToggle
            scope="classification"
            label="Classification"
            description="Runs the Gemini/Claude classifier on new messages."
            paused={!!data?.config?.classification_paused}
            since={data?.config?.classification_paused_at}
            busy={busy === 'classification'}
            onToggle={toggle}
          />
          <ScopeToggle
            scope="execution"
            label="Execution (auto-route)"
            description="Reserved for Week 5 &mdash; auto-route executor."
            paused={!!data?.config?.execution_paused}
            since={data?.config?.execution_paused_at}
            busy={busy === 'execution'}
            onToggle={toggle}
          />
        </div>

        <SectionTitle>Recent ingestion runs</SectionTitle>
        <RunsTable
          rows={data?.ingestion_runs || []}
          columns={[
            { key: 'started_at', label: 'Started' },
            { key: 'mailbox_user_email', label: 'Mailbox' },
            { key: 'company', label: 'Company' },
            { key: 'messages_fetched', label: 'Fetched' },
            { key: 'messages_new', label: 'Inserted' },
            { key: 'messages_failed', label: 'Failed' },
            { key: 'error_message', label: 'Error' },
          ]}
        />

        <SectionTitle>Recent classification runs</SectionTitle>
        <RunsTable
          rows={data?.classification_runs || []}
          columns={[
            { key: 'started_at', label: 'Started' },
            { key: 'trigger', label: 'Trigger' },
            { key: 'messages_attempted', label: 'Attempted' },
            { key: 'messages_successful', label: 'OK' },
            { key: 'messages_failed', label: 'Failed' },
            { key: 'provider_primary', label: 'Provider' },
            { key: 'provider_fallback_used', label: 'Fallbacks' },
            { key: 'error_message', label: 'Error' },
          ]}
        />

        <SectionTitle>Mailbox / kill-switch audit (last 30)</SectionTitle>
        <RunsTable
          rows={data?.audit || []}
          columns={[
            { key: 'created_at', label: 'When' },
            { key: 'event', label: 'Event' },
            { key: 'mailbox_email', label: 'Mailbox' },
            { key: 'company', label: 'Company' },
            { key: 'actor_email', label: 'Actor' },
            { key: 'details', label: 'Details' },
          ]}
        />

        <SectionTitle>Recent cron activity (last 30)</SectionTitle>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b' }}>
          Each row is one cron tick or one kill-switch toggle. The <strong>Result</strong>
          {' '}column comes from <code style={codeChip}>details.result</code> &mdash;
          {' '}<code style={codeChip}>ok</code> means the cron ran the full path,
          {' '}<code style={codeChip}>paused</code> means the kill switch short-circuited it,
          {' '}<code style={codeChip}>error</code> means it threw.
        </p>
        <RunsTable
          rows={(data?.cron_activity || []).map(parseCronActivityRow)}
          columns={[
            { key: 'created_at', label: 'When' },
            { key: 'action', label: 'Action' },
            { key: 'result', label: 'Result' },
            { key: 'mailboxes', label: 'Mailboxes' },
            { key: 'attempted', label: 'Attempted' },
            { key: 'successful', label: 'OK' },
            { key: 'error', label: 'Error' },
          ]}
        />
      </div>
    </PageLayout>
  );
}

// Parse the JSON-as-text `details` column on activity_log into
// flat fields the table can render. Tolerant of malformed/null details.
function parseCronActivityRow(row) {
  let parsed = {};
  try {
    if (typeof row.details === 'string' && row.details.length > 0) {
      parsed = JSON.parse(row.details);
    } else if (row.details && typeof row.details === 'object') {
      parsed = row.details;
    }
  } catch {
    parsed = {};
  }
  return {
    id: row.id,
    created_at: row.created_at,
    action: row.action,
    result: parsed.result ?? '',
    mailboxes: parsed.mailboxes ?? '',
    attempted: parsed.attempted ?? '',
    successful: parsed.successful ?? '',
    error: parsed.error ?? '',
  };
}

const codeChip = {
  background: '#f1f5f9',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#0f172a',
};

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------
function ScopeToggle({ scope, label, description, paused, since, busy, onToggle }) {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${paused ? '#fde68a' : '#e2e8f0'}`,
      borderLeft: `3px solid ${paused ? '#f59e0b' : '#10b981'}`,
      borderRadius: 8,
      padding: 14,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{label}</div>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          color: paused ? '#92400e' : '#065f46',
          background: paused ? '#fffbeb' : '#ecfdf5',
          padding: '2px 8px', borderRadius: 999,
        }}>
          {paused ? 'PAUSED' : 'RUNNING'}
        </span>
      </div>
      <p style={{ margin: '4px 0 8px', fontSize: 12, color: '#64748b' }}>{description}</p>
      {paused && since && (
        <div style={{ fontSize: 11, color: '#92400e', marginBottom: 6 }}>
          Paused since {new Date(since).toLocaleString()}
        </div>
      )}
      <button
        onClick={() => onToggle(scope, !paused)}
        disabled={busy}
        style={{
          background: paused ? '#10b981' : '#f59e0b',
          color: '#fff', border: 'none', borderRadius: 6,
          padding: '6px 12px', fontSize: 12, fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? '…' : paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{
      margin: '24px 0 8px', fontSize: 12, color: '#475569',
      textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
    }}>
      {children}
    </h3>
  );
}

function RunsTable({ rows, columns }) {
  if (!rows.length) {
    return <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>No rows yet.</div>;
  }
  return (
    <div style={{
      overflowX: 'auto', border: '1px solid #e2e8f0',
      borderRadius: 8, background: '#fff',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {columns.map((c) => (
              <th key={c.key} style={{
                textAlign: 'left', padding: '8px 10px',
                fontWeight: 600, color: '#475569',
                borderBottom: '1px solid #e2e8f0',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: '6px 10px', color: '#334155', verticalAlign: 'top' }}>
                  {formatCell(c.key, row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      background: c.bg, color: c.fg,
      border: `1px solid ${c.bd}`,
      padding: '10px 14px', borderRadius: 8,
      fontSize: 13,
    }}>
      {children}
    </div>
  );
}

function formatCell(key, value) {
  if (value == null || value === '') return '—';
  if (key.endsWith('_at') || key === 'created_at' || key === 'started_at' || key === 'completed_at') {
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
