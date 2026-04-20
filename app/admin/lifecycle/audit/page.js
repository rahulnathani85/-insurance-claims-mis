'use client';
// =============================================================================
// /admin/lifecycle/audit — History & Audit Log
// =============================================================================
// Chronological log of every phase transition, stage completion, item
// open/close, reopen, template change. Filter by claim, actor, date range,
// event type. Per v2 mockup.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Btn,
} from '@/components/LifecycleAdminShell';

const EVENT_TYPES = [
  { key: 'phase_start',       label: 'Phase started',    tone: 'lob' },
  { key: 'phase_complete',    label: 'Phase completed',  tone: 'complete' },
  { key: 'stage_complete',    label: 'Stage completed',  tone: 'complete' },
  { key: 'item_open',         label: 'Item opened',      tone: 'active' },
  { key: 'item_close',        label: 'Item closed',      tone: 'complete' },
  { key: 'reminder_sent',     label: 'Reminder sent',    tone: 'portfolio' },
  { key: 'claim_reopened',    label: 'Claim re-opened',  tone: 'override' },
  { key: 'template_changed',  label: 'Template changed', tone: 'override' },
  { key: 'tat_breach',        label: 'TAT breached',     tone: 'breached' },
  { key: 'subtask_complete',  label: 'Sub-task done',    tone: 'complete' },
];

export default function AuditLogPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    q: '', event_type: '', actor: '', fromDate: '', toDate: '',
    claim: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/lifecycle/audit?limit=500')
          .then(r => r.ok ? r.json() : { events: [] })
          .catch(() => ({ events: [] }));
        setEvents(r.events || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => events.filter(e => {
    const q = filter.q.toLowerCase();
    if (q && !(`${e.event_type} ${e.actor_email || ''} ${e.claim_ref || ''} ${e.detail || ''}`.toLowerCase().includes(q))) return false;
    if (filter.event_type && e.event_type !== filter.event_type) return false;
    if (filter.actor && (e.actor_email || '').toLowerCase() !== filter.actor.toLowerCase()) return false;
    if (filter.claim && !(e.claim_ref || '').includes(filter.claim)) return false;
    if (filter.fromDate && new Date(e.created_at) < new Date(filter.fromDate)) return false;
    if (filter.toDate && new Date(e.created_at) > new Date(filter.toDate + 'T23:59:59')) return false;
    return true;
  }), [events, filter]);

  const uniqActors = Array.from(new Set(events.map(e => e.actor_email).filter(Boolean)));

  const exportCsv = () => {
    const cols = ['created_at', 'event_type', 'actor_email', 'actor_role', 'claim_ref', 'phase', 'stage_code', 'detail'];
    const lines = [cols.join(',')];
    for (const e of filtered) {
      lines.push(cols.map(c => JSON.stringify(e[c] ?? '')).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lifecycle-audit-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <LifecycleAdminShell
      view="audit"
      title="History & Audit Log"
      subtitle="Chronological log of every engine event. Exportable. Admin + Reviewer only."
      actions={<>
        <Btn onClick={exportCsv}>Export CSV</Btn>
      </>}
    >
      {loading && <Note tone="info">Loading events…</Note>}

      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 10 }}>
          <input placeholder="Search text…" value={filter.q}
            onChange={e => setFilter({ ...filter, q: e.target.value })} style={inp} />
          <select value={filter.event_type} onChange={e => setFilter({ ...filter, event_type: e.target.value })} style={inp}>
            <option value="">All event types</option>
            {EVENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <select value={filter.actor} onChange={e => setFilter({ ...filter, actor: e.target.value })} style={inp}>
            <option value="">All actors</option>
            {uniqActors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" value={filter.fromDate}
            onChange={e => setFilter({ ...filter, fromDate: e.target.value })} style={inp} />
          <input type="date" value={filter.toDate}
            onChange={e => setFilter({ ...filter, toDate: e.target.value })} style={inp} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
          Showing {filtered.length} of {events.length} events
        </div>
      </Card>

      <Card title="Events" subtitle="Newest first. Click a row for full payload.">
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7280' }}>
            No events match the filters.
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr style={tHeadRow}>
                <th style={th}>When</th>
                <th style={th}>Event</th>
                <th style={th}>Actor</th>
                <th style={th}>Claim</th>
                <th style={th}>Phase / stage</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const et = EVENT_TYPES.find(t => t.key === e.event_type) || { label: e.event_type, tone: 'neutral' };
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 11.5 }}>
                      {e.created_at ? new Date(e.created_at).toLocaleString() : '—'}
                    </td>
                    <td style={td}>
                      <Badge tone={et.tone}>{et.label}</Badge>
                    </td>
                    <td style={td}>
                      {e.actor_email || '—'}
                      {e.actor_role && <div style={{ fontSize: 10.5, color: '#6b7280' }}>{e.actor_role}</div>}
                    </td>
                    <td style={td}>
                      <code style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{e.claim_ref || e.claim_id || '—'}</code>
                    </td>
                    <td style={td}>
                      {e.phase && <Badge tone="lob">P{e.phase}</Badge>}
                      {e.stage_code && <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.stage_code}</code>}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: '#374151' }}>{e.detail || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Note tone="info">
        Audit events are append-only. They cannot be edited or deleted —
        amendments to the engine must go through the Migration process.
      </Note>
    </LifecycleAdminShell>
  );
}

const inp = {
  width: '100%', padding: '7px 10px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
};
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
