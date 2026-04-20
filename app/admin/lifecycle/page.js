'use client';
// =============================================================================
// /admin/lifecycle — Dashboard
// =============================================================================
// Merges both mockups:
//  • v1 "Phase Dashboard"     — 7-column stat grid, per-phase breach/longest-waiting
//  • v2 Admin landing page    — system health, template count, item catalog count,
//                               branching/subtask/time-rule indicators, recent audit
// Counts come from /api/lifecycle/dashboard + /api/lifecycle/templates +
// /api/lifecycle/items/catalog. Inactive/missing data → 0.
// =============================================================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LifecycleAdminShell, { Card, Stat, Note, Badge, Btn } from '@/components/LifecycleAdminShell';

const PHASE_NAMES = {
  1: 'Appointment',
  2: 'Survey & Inspection',
  3: 'ILA & LOR',
  4: 'Pending Requirements',
  5: 'Assessment',
  6: 'Report',
  7: 'Delivery',
};

export default function LifecycleDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [dR, tR, iR] = await Promise.all([
          fetch('/api/lifecycle/dashboard').then(r => r.json()).catch(() => ({})),
          fetch('/api/lifecycle/templates').then(r => r.json()).catch(() => ({ templates: [] })),
          fetch('/api/lifecycle/items/catalog').then(r => r.json()).catch(() => ({ items: [] })),
        ]);
        setDashboard(dR);
        setTemplates(tR.templates || []);
        setItems(iR.items || []);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const byPhase = dashboard?.by_phase || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  const breaches = dashboard?.breaches || [];
  const breachesByPhase = {};
  for (const b of breaches) {
    const ph = b.current_phase || b.universal_phase || 0;
    if (!breachesByPhase[ph]) breachesByPhase[ph] = { firm: 0, insurer: 0, longest: null };
    if (b.firm_overdue_hours)    breachesByPhase[ph].firm++;
    if (b.insurer_overdue_hours) breachesByPhase[ph].insurer++;
    const longest = Math.max(b.firm_overdue_hours || 0, b.insurer_overdue_hours || 0);
    if (!breachesByPhase[ph].longest || longest > breachesByPhase[ph].longest.hrs) {
      breachesByPhase[ph].longest = {
        hrs: longest,
        ref: b.claim_ref || b.reference_number || b.claim_id || '—',
      };
    }
  }

  const fmtHrs = (h) => {
    if (!h) return '—';
    if (h < 24)  return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  };

  const counts = {
    templates: templates.length,
    items: items.length,
    branching: templates.filter(t => t.branching_enabled).length,
    timerules: templates.filter(t => t.time_rules_enabled).length,
  };

  return (
    <LifecycleAdminShell
      view="dashboard"
      title="Lifecycle Engine Dashboard"
      subtitle="System health at a glance — open claims, per-phase counts, TAT breaches, and config inventory"
      stats={counts}
      actions={
        <>
          <Btn onClick={() => router.push('/admin/lifecycle/breaches')}>⚠️ View All Breaches</Btn>
          <Btn variant="primary" onClick={() => router.push('/admin/lifecycle/templates')}>Manage Templates</Btn>
        </>
      }
    >
      {loading && <Note tone="info">Loading engine state…</Note>}
      {error && <Note tone="danger">Failed to load: {error}</Note>}

      {/* System health strip (v2 landing) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <Stat label="Open claims"        value={dashboard?.open ?? '—'}      sub="currently inside the engine" />
        <Stat label="Completed claims"   value={dashboard?.completed ?? '—'} sub="reached Phase 7 — Delivery" />
        <Stat
          label="TAT breaches"
          value={dashboard?.breach_count ?? breaches.length ?? 0}
          sub="active overdue claims (firm or insurer side)"
          tone={(dashboard?.breach_count ?? 0) > 0 ? 'danger' : 'success'}
        />
        <Stat
          label="Active templates"
          value={templates.filter(t => t.is_active).length}
          sub={`${templates.length} total · ${counts.branching} branching · ${counts.timerules} time-ruled`}
        />
      </div>

      {/* 7-phase grid (v1 phase dashboard) */}
      <Card
        title="Open claims per universal phase"
        subtitle="Each phase is a column. Click a phase to drill into its claims."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
          {[1, 2, 3, 4, 5, 6, 7].map(ph => (
            <div
              key={ph}
              onClick={() => router.push(`/admin/lifecycle/breaches?phase=${ph}`)}
              style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Phase {ph}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e3a5f', margin: '4px 0 2px' }}>
                {byPhase[ph] || 0}
              </div>
              <div style={{ fontSize: 11, color: '#374151', fontWeight: 500 }}>
                {PHASE_NAMES[ph]}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Per-phase TAT breach breakdown (v1 — table under the grid) */}
      <Card
        title="Per-phase TAT breach breakdown"
        subtitle="Firm-side breach counts (clock may be paused in Phase 4) and insurer-facing breach counts."
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '9px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase' }}>Phase</th>
              <th style={{ padding: '9px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase' }}>Open</th>
              <th style={{ padding: '9px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase' }}>Firm breaches</th>
              <th style={{ padding: '9px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase' }}>Insurer breaches</th>
              <th style={{ padding: '9px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase' }}>Longest-waiting</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map(ph => {
              const br = breachesByPhase[ph] || { firm: 0, insurer: 0, longest: null };
              return (
                <tr key={ph} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px' }}><strong>{ph}. {PHASE_NAMES[ph]}</strong></td>
                  <td style={{ padding: '10px' }}>{byPhase[ph] || 0}</td>
                  <td style={{ padding: '10px' }}>
                    {ph === 4
                      ? <Badge tone="complete">0 (paused)</Badge>
                      : br.firm > 0
                        ? <Badge tone="breached">{br.firm}</Badge>
                        : <Badge tone="complete">0</Badge>}
                  </td>
                  <td style={{ padding: '10px' }}>
                    {br.insurer > 0
                      ? <Badge tone="breached">{br.insurer}</Badge>
                      : <Badge tone="complete">0</Badge>}
                  </td>
                  <td style={{ padding: '10px', color: '#374151' }}>
                    {br.longest
                      ? <span>{fmtHrs(br.longest.hrs)} <span style={{ color: '#6b7280' }}>({br.longest.ref})</span></span>
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Config snapshot cards (v2) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        <Card
          title="Templates"
          subtitle={`${templates.length} total · ${templates.filter(t => t.is_active).length} active`}
          actions={<Btn size="sm" onClick={() => router.push('/admin/lifecycle/templates')}>Open →</Btn>}
        >
          {templates.length === 0
            ? <div style={{ color: '#6b7280', fontSize: 12 }}>No templates configured yet. Create one from the Template Library.</div>
            : (
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {templates.slice(0, 6).map(t => (
                  <div key={t.id} style={{
                    padding: '7px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12.5,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{t.template_name}</div>
                      <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 1 }}>
                        {t.template_code}
                        {t.match_lob && ` · LOB: ${t.match_lob}`}
                        {t.match_portfolio && ` · Portfolio: ${t.match_portfolio}`}
                      </div>
                    </div>
                    <div>
                      <Badge tone={t.resolution_type === 'override' ? 'override' : 'full'}>
                        {t.resolution_type === 'override' ? 'Override' : 'Full'}
                      </Badge>
                      <Badge tone={t.is_active ? 'complete' : 'skipped'}>
                        {t.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                ))}
                {templates.length > 6 && (
                  <div style={{ padding: '6px 0', fontSize: 11, color: '#6b7280', textAlign: 'center' }}>
                    +{templates.length - 6} more…
                  </div>
                )}
              </div>
            )}
        </Card>

        <Card
          title="Item Catalog"
          subtitle={`${items.length} item types defined`}
          actions={<Btn size="sm" onClick={() => router.push('/admin/lifecycle/items')}>Open →</Btn>}
        >
          {items.length === 0
            ? <div style={{ color: '#6b7280', fontSize: 12 }}>No catalog items yet.</div>
            : (
              <div style={{ fontSize: 12.5 }}>
                {['document', 'approval', 'query', 'internal'].map(cat => {
                  const count = items.filter(i => i.category === cat).length;
                  return (
                    <div key={cat} style={{
                      padding: '7px 0', borderBottom: '1px solid #f3f4f6',
                      display: 'flex', justifyContent: 'space-between',
                    }}>
                      <span style={{ textTransform: 'capitalize', color: '#374151' }}>{cat}</span>
                      <strong style={{ color: '#1e3a5f' }}>{count}</strong>
                    </div>
                  );
                })}
              </div>
            )}
        </Card>

        <Card
          title="Feature toggles"
          subtitle="Templates with optional engine features enabled"
          actions={<Btn size="sm" onClick={() => router.push('/admin/lifecycle/branching')}>Open →</Btn>}
        >
          <div style={{ fontSize: 12.5 }}>
            <div style={{ padding: '7px 0', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
              <span>Branching-enabled templates</span>
              <strong style={{ color: '#1e3a5f' }}>{counts.branching}</strong>
            </div>
            <div style={{ padding: '7px 0', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtasks-enabled templates</span>
              <strong style={{ color: '#1e3a5f' }}>{templates.filter(t => t.subtasks_enabled).length}</strong>
            </div>
            <div style={{ padding: '7px 0', display: 'flex', justifyContent: 'space-between' }}>
              <span>Time-rules-enabled templates</span>
              <strong style={{ color: '#1e3a5f' }}>{counts.timerules}</strong>
            </div>
          </div>
        </Card>
      </div>

      <Note tone="info">
        <strong>Quick links —</strong>{' '}
        Live Claim View lets you drill into any claim's live phase state.{' '}
        Resolution Debugger lets you simulate template matching for a hypothetical claim.{' '}
        Migration Status shows the cutover progress from the legacy stage tables.
      </Note>
    </LifecycleAdminShell>
  );
}
