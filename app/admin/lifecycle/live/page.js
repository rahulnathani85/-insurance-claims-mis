'use client';
// =============================================================================
// /admin/lifecycle/live — Live Claim Picker
// =============================================================================
// Index of every claim that currently has an active lifecycle. Click a row to
// drill into /claim-detail/[id]/lifecycle for the full stepper + stage table +
// pending-items + action buttons view. Also supports a "jump to claim ref"
// direct lookup box at the top.
//
// v2 mockup calls for: LOB badge, current phase, current stage_code, days in
// phase, firm/insurer clock state, pending items count, owner, template,
// status (active/breach/closed), search+filter.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import LifecycleAdminShell, {
  Card, Note, Badge, Tag, Btn, Stat,
} from '@/components/LifecycleAdminShell';

const LOBS = ['Fire', 'Engineering', 'Marine', 'Motor', 'Misc', 'Extended Warranty'];
const PHASES = [1, 2, 3, 4, 5, 6, 7];
const STATES = ['active', 'breach', 'on-pause', 'closed', 'reopened'];

export default function LiveClaimPickerPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [jumpRef, setJumpRef] = useState('');
  const [detachingId, setDetachingId] = useState(null);
  const [filter, setFilter] = useState({
    q: '', lob: '', phase: '', status: '', template: '', owner: '',
  });

  async function loadRows() {
    try {
      setLoading(true);
      const r = await fetch('/api/lifecycle/live?t=' + Date.now(), { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { rows: [] })
        .catch(() => ({ rows: [] }));
      setRows(r.rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRows(); }, []);

  async function detachLifecycle(row) {
    const ref = row.claim_ref || row.claim_id || row.id;
    if (!window.confirm(
      `Detach the lifecycle from ${ref}?\n\n` +
      `This will WIPE all phase / stage / item / subtask rows for the claim and ` +
      `return it to legacy mode. The claim file itself is kept — you can re-attach a ` +
      `different template from the bulk-attach page or from the claim detail view.`
    )) return;

    setDetachingId(row.lifecycle_id || row.id);
    try {
      const res = await fetch(`/api/lifecycle/${row.lifecycle_id || row.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user?.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Detach failed');
      await loadRows();
    } catch (e) {
      alert(`Detach failed: ${e.message}`);
    } finally {
      setDetachingId(null);
    }
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (filter.lob && r.lob !== filter.lob) return false;
    if (filter.phase && String(r.current_phase) !== String(filter.phase)) return false;
    if (filter.status && r.status !== filter.status) return false;
    if (filter.template && r.template_code !== filter.template) return false;
    if (filter.owner && (r.owner_name || '').toLowerCase() !== filter.owner.toLowerCase()) return false;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      const hay = `${r.claim_ref || ''} ${r.insured_name || ''} ${r.template_code || ''} ${r.owner_name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, filter]);

  const counts = useMemo(() => {
    const c = { total: filtered.length, active: 0, breach: 0, closed: 0, pause: 0 };
    for (const r of filtered) {
      if (r.status === 'active') c.active++;
      else if (r.status === 'breach') c.breach++;
      else if (r.status === 'closed') c.closed++;
      if (r.firm_clock === 'paused' || r.insurer_clock === 'paused') c.pause++;
    }
    return c;
  }, [filtered]);

  const uniqueTemplates = Array.from(new Set(rows.map(r => r.template_code).filter(Boolean)));
  const uniqueOwners    = Array.from(new Set(rows.map(r => r.owner_name).filter(Boolean)));

  const jump = () => {
    const ref = jumpRef.trim();
    if (!ref) return;
    // Try to match a claim_ref in the loaded rows; else pass through as id
    const match = rows.find(r =>
      (r.claim_ref || '').toLowerCase() === ref.toLowerCase()
    );
    if (match) {
      router.push(`/claim-detail/${match.claim_id}/lifecycle`);
    } else {
      router.push(`/claim-detail/${encodeURIComponent(ref)}/lifecycle`);
    }
  };

  return (
    <LifecycleAdminShell
      view="live"
      title="Live Claim View"
      subtitle="Every claim currently running in the lifecycle engine. Click a row to drill in."
      actions={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={jumpRef}
            placeholder="Jump to claim ref…"
            onKeyDown={e => e.key === 'Enter' && jump()}
            onChange={e => setJumpRef(e.target.value)}
            style={{ ...inp, width: 200 }}
          />
          <Btn variant="primary" onClick={jump}>Open</Btn>
        </div>
      }
    >
      {loading && <Note tone="info">Loading live claims…</Note>}

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        <Stat label="Total live" value={counts.total} />
        <Stat label="Active"     value={counts.active}  tone="success" />
        <Stat label="In breach"  value={counts.breach}  tone="danger" />
        <Stat label="On pause"   value={counts.pause}   tone="warn" />
        <Stat label="Closed"     value={counts.closed} />
      </div>

      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 10 }}>
          <input placeholder="Search ref, insured, template…" value={filter.q}
            onChange={e => setFilter({ ...filter, q: e.target.value })} style={inp} />

          <select value={filter.lob} onChange={e => setFilter({ ...filter, lob: e.target.value })} style={inp}>
            <option value="">All LOBs</option>
            {LOBS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          <select value={filter.phase} onChange={e => setFilter({ ...filter, phase: e.target.value })} style={inp}>
            <option value="">All phases</option>
            {PHASES.map(p => <option key={p} value={p}>Phase {p}</option>)}
          </select>

          <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} style={inp}>
            <option value="">All statuses</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filter.template} onChange={e => setFilter({ ...filter, template: e.target.value })} style={inp}>
            <option value="">All templates</option>
            {uniqueTemplates.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select value={filter.owner} onChange={e => setFilter({ ...filter, owner: e.target.value })} style={inp}>
            <option value="">All owners</option>
            {uniqueOwners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
          Showing <strong>{filtered.length}</strong> of {rows.length} live claims
        </div>
      </Card>

      <Card title="Live claims"
            subtitle="Sorted by current-phase age desc. Rows in red have an active breach.">
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7280' }}>
            {rows.length === 0
              ? 'No live claims yet. Once the engine is wired to the claim registration flow, new claims will appear here.'
              : 'No live claims match the filters.'}
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr style={tHeadRow}>
                <th style={th}>Ref</th>
                <th style={th}>LOB</th>
                <th style={th}>Insured</th>
                <th style={th}>Template</th>
                <th style={th}>Current phase</th>
                <th style={th}>Stage</th>
                <th style={th}>Age in phase</th>
                <th style={th}>Clocks</th>
                <th style={th}>Pending</th>
                <th style={th}>Owner</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isBreach = r.status === 'breach';
                return (
                  <tr key={r.claim_id || r.id} style={{
                    borderBottom: '1px solid #f3f4f6',
                    background: isBreach ? '#fef2f2' : undefined,
                  }}>
                    <td style={td}>
                      <code style={{ fontFamily: 'monospace', fontSize: 11.5, fontWeight: 600 }}>
                        {r.claim_ref || r.claim_id || '—'}
                      </code>
                    </td>
                    <td style={td}>{r.lob ? <Badge tone="lob">{r.lob}</Badge> : '—'}</td>
                    <td style={{ ...td, fontSize: 11.5 }}>{r.insured_name || '—'}</td>
                    <td style={td}>
                      <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.template_code || '—'}</code>
                    </td>
                    <td style={td}>
                      {r.current_phase ? <Badge tone="portfolio">P{r.current_phase}</Badge> : '—'}
                      {r.current_phase_name && <div style={{ fontSize: 10.5, color: '#6b7280' }}>
                        {r.current_phase_name}
                      </div>}
                    </td>
                    <td style={td}>
                      <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.current_stage_code || '—'}</code>
                      {r.current_stage_name && <div style={{ fontSize: 10.5, color: '#6b7280' }}>
                        {r.current_stage_name}
                      </div>}
                    </td>
                    <td style={{ ...td, fontSize: 11.5 }}>
                      {r.age_in_phase_days != null ? `${r.age_in_phase_days}d` : '—'}
                    </td>
                    <td style={td}>
                      {r.firm_clock === 'paused'
                        ? <Tag tone="firm-pause">firm ⏸</Tag>
                        : <Tag tone="firm-run">firm ▶</Tag>}
                      {r.insurer_clock === 'paused'
                        ? <Tag tone="insurer-pause">ins ⏸</Tag>
                        : <Tag tone="insurer-run">ins ▶</Tag>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {(r.open_items_count || 0) > 0
                        ? <Badge tone="active">{r.open_items_count}</Badge>
                        : <span style={{ fontSize: 11.5, color: '#9ca3af' }}>—</span>}
                    </td>
                    <td style={td}>
                      <div style={{ fontSize: 11.5 }}>{r.owner_name || '—'}</div>
                      {r.owner_role && <div style={{ fontSize: 10.5, color: '#6b7280' }}>
                        {r.owner_role}
                      </div>}
                    </td>
                    <td style={td}>
                      {r.status === 'active'   && <Badge tone="active">Active</Badge>}
                      {r.status === 'breach'   && <Badge tone="breached">Breach</Badge>}
                      {r.status === 'on-pause' && <Badge tone="pending">On pause</Badge>}
                      {r.status === 'closed'   && <Badge tone="complete">Closed</Badge>}
                      {r.status === 'reopened' && <Badge tone="override">Re-opened</Badge>}
                      {!r.status && <Badge tone="neutral">—</Badge>}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Btn size="xs"
                          onClick={() => router.push(`/claim-detail/${r.claim_id}/lifecycle`)}>
                          Open
                        </Btn>
                        {isAdmin && (
                          <Btn size="xs" variant="danger"
                            disabled={detachingId === (r.lifecycle_id || r.id)}
                            title="Detach the lifecycle from this claim (wipe phase/stage/item/subtask rows, return claim to legacy mode). Use when the wrong template was attached."
                            onClick={() => detachLifecycle(r)}>
                            {detachingId === (r.lifecycle_id || r.id) ? '…' : 'Detach'}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Note tone="info">
        The <strong>Jump to claim ref</strong> box accepts any claim reference (e.g.{' '}
        <code>NISLA/2025/00123</code>) and opens its live lifecycle view directly — useful
        when you already know the ref and don't want to filter.
      </Note>
    </LifecycleAdminShell>
  );
}

const inp = {
  padding: '7px 10px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
};
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '9px 8px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 8px', verticalAlign: 'top' };
