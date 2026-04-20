'use client';
// =============================================================================
// /admin/lifecycle/breaches — TAT Breaches
// =============================================================================
// Filterable, sortable list of every lifecycle stage/phase currently in breach
// or approaching breach. Pulled from v1 mockup (lifecycle-engine-mockup.html
// lines 1210-1251). Supports `?phase=N` query param for drill-down from the
// dashboard per-phase grid.
//
// Columns: Ref, LOB, Current phase, Firm TAT status, Insurer TAT status,
//          Pending with, Owner, Age, Actions.
// Internal-pending items are role-gated — visible to Lead Surveyor and Admin
// only. Surveyors on the claim team see only the external pending items.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import LifecycleAdminShell, {
  Card, Note, Badge, Tag, Btn, Stat,
} from '@/components/LifecycleAdminShell';

const PHASES = [
  { n: 1, name: 'Appointment & Intake' },
  { n: 2, name: 'Survey & Investigation' },
  { n: 3, name: 'ILA / LOR' },
  { n: 4, name: 'Pending Requirements' },
  { n: 5, name: 'Assessment' },
  { n: 6, name: 'Report' },
  { n: 7, name: 'Delivery & Closure' },
];

const LOBS = ['Fire', 'Engineering', 'Marine', 'Motor', 'Misc', 'Extended Warranty'];

const STATUS_TONE = {
  'breached':     'breached',
  'approaching':  'active',
  'on-pause':     'pending',
  'on-track':     'complete',
  'n/a':          'skipped',
};

export default function BreachesPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuth();
  const role = user?.role || 'Surveyor';
  const canSeeInternal = role === 'Admin' || role === 'Lead Surveyor';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filter, setFilter] = useState({
    phase: search.get('phase') || '',
    lob: '',
    firm_status: '',
    insurer_status: '',
    owner: '',
    q: '',
    include_internal: canSeeInternal,
  });

  useEffect(() => {
    (async () => {
      try {
        const url = new URL('/api/lifecycle/breaches', window.location.origin);
        if (filter.phase) url.searchParams.set('phase', filter.phase);
        url.searchParams.set('include_internal', String(filter.include_internal));
        const r = await fetch(url.toString())
          .then(r => r.ok ? r.json() : { rows: [] })
          .catch(() => ({ rows: [] }));
        setRows(r.rows || []);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, [filter.include_internal]);  // re-fetch only when server-side toggle changes

  const filtered = useMemo(() => rows.filter(r => {
    if (filter.phase && String(r.phase) !== String(filter.phase)) return false;
    if (filter.lob && r.lob !== filter.lob) return false;
    if (filter.firm_status && r.firm_status !== filter.firm_status) return false;
    if (filter.insurer_status && r.insurer_status !== filter.insurer_status) return false;
    if (filter.owner && (r.owner_name || '').toLowerCase() !== filter.owner.toLowerCase()) return false;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      const hay = `${r.claim_ref || ''} ${r.pending_with || ''} ${r.current_stage || ''} ${r.detail || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, filter]);

  const counts = useMemo(() => {
    const c = { breached: 0, approaching: 0, on_pause: 0, total: filtered.length };
    for (const r of filtered) {
      if (r.firm_status === 'breached' || r.insurer_status === 'breached') c.breached++;
      else if (r.firm_status === 'approaching' || r.insurer_status === 'approaching') c.approaching++;
      if (r.firm_status === 'on-pause' || r.insurer_status === 'on-pause') c.on_pause++;
    }
    return c;
  }, [filtered]);

  const uniqueOwners = Array.from(new Set(rows.map(r => r.owner_name).filter(Boolean)));

  const renderStatus = (status, overdueBy, unit) => {
    if (!status || status === 'n/a') return <Badge tone="skipped">n/a</Badge>;
    if (status === 'on-track') return <Badge tone="complete">On track</Badge>;
    if (status === 'on-pause') return <Badge tone="pending">On pause</Badge>;
    if (status === 'approaching') {
      return <Badge tone="active">Approaching · {overdueBy ?? '—'}{unit === 'hours' ? 'h' : 'd'} left</Badge>;
    }
    if (status === 'breached') {
      return <Badge tone="breached">{overdueBy ?? '—'}{unit === 'hours' ? 'h' : 'd'} overdue</Badge>;
    }
    return <Badge tone={STATUS_TONE[status] || 'neutral'}>{status}</Badge>;
  };

  const exportCsv = () => {
    const cols = [
      'claim_ref', 'lob', 'phase', 'current_stage',
      'firm_status', 'firm_overdue_by', 'insurer_status', 'insurer_overdue_by',
      'pending_with', 'owner_name', 'owner_role', 'age_days', 'is_internal',
    ];
    const lines = [cols.join(',')];
    for (const r of filtered) {
      lines.push(cols.map(c => JSON.stringify(r[c] ?? '')).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifecycle-breaches-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <LifecycleAdminShell
      view="breaches"
      title="TAT Breaches"
      subtitle="Claims with stages or phases past their turn-around-time thresholds."
      stats={{ breaches: rows.length }}
      actions={<Btn onClick={exportCsv}>Export CSV</Btn>}
    >
      {loading && <Note tone="info">Loading breach list…</Note>}
      {error && <Note tone="danger">{error}</Note>}

      {filter.phase && (
        <Note tone="info">
          Filtered to <strong>Phase {filter.phase} — {PHASES.find(p => p.n === Number(filter.phase))?.name}</strong>.{' '}
          <a onClick={() => setFilter(f => ({ ...f, phase: '' }))}
             style={{ color: '#1e3a5f', cursor: 'pointer', textDecoration: 'underline' }}>
            Clear phase filter
          </a>
        </Note>
      )}

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <Stat label="Total shown"     value={counts.total}       tone="default" />
        <Stat label="Breached (TAT)"  value={counts.breached}    tone="danger"  />
        <Stat label="Approaching"     value={counts.approaching} tone="warn"    />
        <Stat label="On pause"        value={counts.on_pause}                    />
      </div>

      {/* Filter bar */}
      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 10 }}>
          <input placeholder="Search ref, party, detail…" value={filter.q}
            onChange={e => setFilter({ ...filter, q: e.target.value })} style={inp} />

          <select value={filter.phase} onChange={e => setFilter({ ...filter, phase: e.target.value })} style={inp}>
            <option value="">All phases</option>
            {PHASES.map(p => <option key={p.n} value={p.n}>P{p.n} — {p.name}</option>)}
          </select>

          <select value={filter.lob} onChange={e => setFilter({ ...filter, lob: e.target.value })} style={inp}>
            <option value="">All LOBs</option>
            {LOBS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          <select value={filter.firm_status} onChange={e => setFilter({ ...filter, firm_status: e.target.value })} style={inp}>
            <option value="">Firm clock — any</option>
            <option value="breached">Breached</option>
            <option value="approaching">Approaching</option>
            <option value="on-pause">On pause</option>
            <option value="on-track">On track</option>
          </select>

          <select value={filter.insurer_status} onChange={e => setFilter({ ...filter, insurer_status: e.target.value })} style={inp}>
            <option value="">Insurer clock — any</option>
            <option value="breached">Breached</option>
            <option value="approaching">Approaching</option>
            <option value="on-pause">On pause</option>
            <option value="on-track">On track</option>
          </select>

          <select value={filter.owner} onChange={e => setFilter({ ...filter, owner: e.target.value })} style={inp}>
            <option value="">All owners</option>
            {uniqueOwners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <div style={{
          marginTop: 10, display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', fontSize: 12, color: '#6b7280',
        }}>
          <div>Showing <strong>{filtered.length}</strong> of {rows.length} breaches</div>
          {canSeeInternal && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox"
                checked={filter.include_internal}
                onChange={e => setFilter({ ...filter, include_internal: e.target.checked })} />
              Include internal-pending items
            </label>
          )}
        </div>
      </Card>

      {/* Breach table */}
      <Card title="Breach list" subtitle="Sort by highest overdue first. Click a row for full claim lifecycle.">
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7280' }}>
            {rows.length === 0
              ? 'No active breaches — all claims are within their TAT windows.'
              : 'No breaches match the current filters.'}
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr style={tHeadRow}>
                <th style={th}>Ref</th>
                <th style={th}>LOB</th>
                <th style={th}>Current phase / stage</th>
                <th style={th}>Firm TAT</th>
                <th style={th}>Insurer TAT</th>
                <th style={th}>Pending with</th>
                <th style={th}>Owner</th>
                <th style={th}>Age</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={r.id || idx}
                    style={{ borderBottom: '1px solid #f3f4f6',
                             background: r.is_internal ? '#fefce8' : undefined }}>
                  <td style={td}>
                    <code style={{ fontFamily: 'monospace', fontSize: 11.5, fontWeight: 600 }}>
                      {r.claim_ref || r.claim_id || '—'}
                    </code>
                    {r.is_internal && <div style={{ fontSize: 10, color: '#b45309', marginTop: 2 }}>
                      <Badge tone="active">Internal</Badge>
                    </div>}
                  </td>
                  <td style={td}>
                    {r.lob ? <Badge tone="lob">{r.lob}</Badge> : '—'}
                  </td>
                  <td style={td}>
                    {r.phase && <Badge tone="portfolio">P{r.phase}</Badge>}
                    {r.current_stage && <div style={{
                      fontFamily: 'monospace', fontSize: 11, marginTop: 2,
                    }}>{r.current_stage}</div>}
                    {r.current_stage_name && <div style={{
                      fontSize: 11, color: '#6b7280',
                    }}>{r.current_stage_name}</div>}
                  </td>
                  <td style={td}>
                    {renderStatus(r.firm_status, r.firm_overdue_by, r.firm_unit)}
                    {r.firm_clock === 'paused' && <Tag tone="firm-pause">firm ⏸</Tag>}
                    {r.firm_clock === 'running' && <Tag tone="firm-run">firm ▶</Tag>}
                  </td>
                  <td style={td}>
                    {renderStatus(r.insurer_status, r.insurer_overdue_by, r.insurer_unit)}
                    {r.insurer_clock === 'paused' && <Tag tone="insurer-pause">insurer ⏸</Tag>}
                    {r.insurer_clock === 'running' && <Tag tone="insurer-run">insurer ▶</Tag>}
                  </td>
                  <td style={td}>
                    <div>{r.pending_with || '—'}</div>
                    {r.pending_party_type && <div style={{ fontSize: 10.5, color: '#6b7280' }}>
                      {r.pending_party_type}
                    </div>}
                  </td>
                  <td style={td}>
                    <div>{r.owner_name || '—'}</div>
                    {r.owner_role && <div style={{ fontSize: 10.5, color: '#6b7280' }}>
                      {r.owner_role}
                    </div>}
                  </td>
                  <td style={{ ...td, fontSize: 11.5, color: '#374151' }}>
                    {r.age_days != null ? `${r.age_days}d` : '—'}
                  </td>
                  <td style={td}>
                    <Btn size="xs" onClick={() => router.push(`/claim-detail/${r.claim_id}/lifecycle`)}>Open</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Note tone="info">
        <strong>Internal-pending items</strong> — like a reviewer delay, waiting-on-partner,
        or Lead-Surveyor QC hold — are visible to <em>Lead Surveyor</em> and <em>Admin</em>
        roles only. Surveyors on the claim team see only the external pending items (client,
        insurer, insured, etc.). Rows highlighted in yellow are internal.
      </Note>

      <Note tone="warn">
        A row is classed <strong>approaching</strong> when it will breach within the next
        48 hours (configurable per template). A row is <strong>on pause</strong> when its
        clock is paused — the firm clock pauses while waiting on the insurer; the insurer
        clock pauses while waiting on the insured.
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
const th = { padding: '9px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
