'use client';

// ============================================================
// /communications/dashboard
// ------------------------------------------------------------
// Operational dashboard for the comms pipeline. Date-range
// filtered, company-scoped (NISLA users see NISLA only).
//
// Top: 6 KPI cards.
// Middle: per-day table.
// Bottom: tag distribution.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const RANGE_PRESETS = [
  { value: '1',  label: 'Today' },
  { value: '7',  label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const TAG_LABELS = {
  intimation:          'New Intimation',
  client_followup:     'Client Follow-up',
  insurer_query:       'Insurer Query',
  policy_doc:          'Policy Documents',
  claim_documents:     'Claim Documents',
  surveyor_photos:     'Survey / Site Photos',
  claim_registration:  'Claim Registration Email (from Client/Insurer)',
  settlement_advice:   'Settlement Advice',
  consent_email:       'Consent Email',
  internal_admin:      'Internal & Admin',
  duplicate:           'Duplicate',
  update_from_insurer: 'Insurer Updates',
  others:              'Others',
};

export default function CommsDashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rangeDays, setRangeDays] = useState('7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Intimation-phase claims pending registration. Loaded once on mount,
  // independent of the date-range picker because it represents a current
  // backlog rather than a windowed metric.
  const [pendingRegistration, setPendingRegistration] = useState(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setBusy(true);
    setError(null);

    const params = new URLSearchParams();
    if (rangeDays === 'custom' && customFrom && customTo) {
      params.set('from', customFrom);
      params.set('to', customTo);
    } else if (rangeDays !== 'custom') {
      const days = parseInt(rangeDays, 10);
      const to = new Date(); to.setUTCHours(23, 59, 59, 999);
      const from = new Date(to); from.setUTCDate(to.getUTCDate() - (days - 1)); from.setUTCHours(0, 0, 0, 0);
      params.set('from', from.toISOString());
      params.set('to', to.toISOString());
    }

    try {
      const res = await fetch(`/api/communications/dashboard?${params}`, {
        headers: { 'x-app-user-email': user.email },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [user?.email, rangeDays, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  // Pending-registration count is independent of the date-range picker.
  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/claims/intimations', {
          headers: { 'x-app-user-email': user.email },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!cancelled && res.ok) setPendingRegistration(json.total || 0);
      } catch { /* silently ignored — card just shows 0 */ }
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  if (loading) return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  if (!user) return null;

  const totals = data?.totals || {};
  const byDay = data?.by_day || [];
  const byTag = data?.by_tag || [];

  const autoRouteRate = totals.total > 0
    ? Math.round((totals.auto_routed / totals.total) * 1000) / 10
    : 0;

  const intimationCount = (byTag.find((t) => t.tag === 'intimation') || {}).count || 0;

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>Communications — Dashboard</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/communications/triage" style={navLinkStyle}>Triage queue →</Link>
            <Link href="/communications/review" style={navLinkStyle}>Review queue →</Link>
          </div>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 13, color: '#64748b' }}>
          Operational overview of the email pipeline — ingestion, triage, auto-routing, and dismissals.
        </p>

        {/* Date range */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <label style={labelStyle}>
            Range:
            <select value={rangeDays} onChange={(e) => setRangeDays(e.target.value)} style={selectStyle}>
              {RANGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {rangeDays === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: 12, color: '#94a3b8' }}>to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle} />
              <button onClick={load} disabled={!customFrom || !customTo || busy} style={btnStyle('primary', !customFrom || !customTo || busy)}>
                Apply
              </button>
            </>
          )}
          {data?.range && (
            <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
              {fmtDate(data.range.from)} → {fmtDate(data.range.to)}
            </div>
          )}
        </div>

        {error && <Banner kind="err">{error}</Banner>}
        {busy && !data && <div style={{ padding: 24, color: '#94a3b8' }}>Loading metrics…</div>}

        {/* KPI cards — every card links into the triage queue, pre-filtered. */}
        <div style={{
          display: 'grid', gap: 12, marginBottom: 20,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}>
          <KpiCard label="Total received"     value={totals.total || 0}            color="#0f172a" href="/communications/triage?category=all" />
          <KpiCard label="New Intimation"     value={intimationCount}              color="#7c3aed" sub="Click to drilldown" href="/communications/triage?tag=intimation" />
          <KpiCard label="Pending Registration" value={pendingRegistration ?? 0}   color="#b45309" sub={(pendingRegistration ?? 0) > 0 ? 'Claims waiting to register' : 'All clear'} href="/communications/intimations" />
          <KpiCard label="Unattended"         value={totals.received || 0}         color="#92400e" sub={totals.received > 0 ? 'Action needed' : 'All clear'} href="/communications/triage?category=unattended" />
          <KpiCard label="Auto-routed"        value={totals.auto_routed || 0}      color="#065f46" sub={`${autoRouteRate}% of total`} href="/communications/triage?category=auto_routed" />
          <KpiCard label="Pending review"     value={totals.pending_review || 0}   color="#5b21b6" href="/communications/review" />
          <KpiCard label="Extracting"         value={totals.classifying || 0}      color="#1e40af" href="/communications/triage?category=classifying" />
          <KpiCard label="Dismissed"          value={totals.dismissed || 0}        color="#475569" href="/communications/triage?category=dismissed" />
        </div>

        {/* Per-day table */}
        <SectionTitle>Daily breakdown</SectionTitle>
        {byDay.length === 0 ? (
          <div style={emptyBoxStyle}>No emails received in this range.</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thNumStyle}>Total</th>
                  <th style={thNumStyle}>Unattended</th>
                  <th style={thNumStyle}>Extracting</th>
                  <th style={thNumStyle}>Pending review</th>
                  <th style={thNumStyle}>Auto-routed</th>
                  <th style={thNumStyle}>Dismissed</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.date}>
                    <td style={tdStyle}>{fmtDay(d.date)}</td>
                    <td style={tdNumStyle}><strong>{d.total}</strong></td>
                    <td style={tdNumStyle}>{d.received || 0}</td>
                    <td style={tdNumStyle}>{d.classifying || 0}</td>
                    <td style={tdNumStyle}>{d.pending_review || 0}</td>
                    <td style={{ ...tdNumStyle, color: '#065f46', fontWeight: 600 }}>{d.auto_routed || 0}</td>
                    <td style={tdNumStyle}>{d.dismissed || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tag distribution */}
        <SectionTitle>Tag distribution</SectionTitle>
        {byTag.length === 0 ? (
          <div style={emptyBoxStyle}>No messages have been categorised in this range yet.</div>
        ) : (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
            {byTag.map((t, i) => {
              const pct = totals.total > 0 ? (t.count / totals.total) * 100 : 0;
              return (
                <Link
                  key={t.tag}
                  href={`/communications/triage?tag=${encodeURIComponent(t.tag)}`}
                  style={{
                    display: 'block',
                    padding: '10px 14px',
                    borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
                    textDecoration: 'none', color: 'inherit',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fafaff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      {TAG_LABELS[t.tag] || t.tag}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                      {t.count} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ background: '#f1f5f9', borderRadius: 999, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: '#7c3aed', borderRadius: 999 }} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

function KpiCard({ label, value, color, sub, href }) {
  const inner = (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>
      )}
    </>
  );
  const cardStyle = {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '14px 16px', minHeight: 86,
    transition: 'border-color 0.1s, box-shadow 0.1s',
  };
  if (!href) return <div style={cardStyle}>{inner}</div>;
  return (
    <Link
      href={href}
      style={{
        ...cardStyle,
        textDecoration: 'none', color: 'inherit', display: 'block',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(124,58,237,0.15)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      {inner}
    </Link>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{ margin: '24px 0 10px', fontSize: 13, fontWeight: 700, color: '#475569', letterSpacing: 0.5, textTransform: 'uppercase' }}>
      {children}
    </h3>
  );
}

function Banner({ kind, children }) {
  const c = kind === 'err'
    ? ['#fef2f2', '#991b1b', '#fecaca']
    : ['#fffbeb', '#92400e', '#fde68a'];
  return (
    <div style={{ background: c[0], color: c[1], border: `1px solid ${c[2]}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDay(yyyymmdd) {
  if (!yyyymmdd) return '';
  const d = new Date(yyyymmdd + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

const labelStyle = { fontSize: 13, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 6 };
const selectStyle = { padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' };
const inputStyle = { padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 };
const emptyBoxStyle = { background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 8, padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 };
const navLinkStyle = { fontSize: 13, color: '#7c3aed', fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none' };

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = { textAlign: 'left', padding: '10px 14px', background: '#f8fafc', color: '#475569', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' };
const thNumStyle = { ...thStyle, textAlign: 'right' };
const tdStyle = { padding: '10px 14px', borderTop: '1px solid #f1f5f9', color: '#0f172a' };
const tdNumStyle = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#475569' };

function btnStyle(variant, disabled) {
  const base = { padding: '6px 12px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
  return variant === 'primary'
    ? { ...base, background: '#1e3a5f', color: '#fff' }
    : { ...base, background: '#f1f5f9', color: '#0f172a' };
}
