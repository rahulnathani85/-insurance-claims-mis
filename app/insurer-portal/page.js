'use client';
// =============================================================================
// app/insurer-portal/page.js
// =============================================================================
// Phase 2 insurer dashboard. Read-only listing of claims that NISLA /
// Acuere is currently handling for the logged-in insurer's company.
//
// The list comes from /api/insurer-portal/claims, which gates on the
// session user's role + insurer_id (server-side filter, mirrors
// scopeClaimsForInsurer from lib/auth/insurer.js).
//
// What insurers see here:
//   - Their own claims only — never a competing insurer's pipeline
//   - Read-only: no "Edit" / "Add" / "Reassign" buttons anywhere
//   - Status, surveyor, key dates, latest activity, FSR submission
//     status (so they know if the FSR is still in draft or has been
//     submitted to them)
//
// What they don't see:
//   - Internal NISLA chat / surveyor notes
//   - In-progress FSR draft content (only the approved Final)
//   - Survey fee bills (those are between NISLA and the insurer's
//     accounts team — not the dealing officer's view)
// =============================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { authedFetch } from '@/lib/api/authedFetch';

const STATUS_STYLE = {
  'Open': { bg: '#fef3c7', color: '#92400e', icon: '🟡' },
  'In Progress': { bg: '#dbeafe', color: '#1e40af', icon: '🔵' },
  'Closed': { bg: '#dcfce7', color: '#166534', icon: '✅' },
  'Withdrawn': { bg: '#f3f4f6', color: '#6b7280', icon: '⚪' },
  'Reopened': { bg: '#fef3c7', color: '#92400e', icon: '🔄' },
};

export default function InsurerPortalDashboard() {
  const { user, logout } = useAuth();
  const [claims, setClaims] = useState([]);
  const [insurer, setInsurer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authedFetch('/api/insurer-portal/claims');
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data?.error || 'Load failed');
        setClaims(Array.isArray(data?.claims) ? data.claims : []);
        setInsurer(data?.insurer || null);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  const filtered = claims.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [c.ref_number, c.claim_number, c.insured_name, c.policy_number]
      .filter(Boolean).map((s) => String(s).toLowerCase()).some((s) => s.includes(q));
  });

  const statusCounts = claims.reduce((acc, c) => {
    acc[c.status || 'Open'] = (acc[c.status || 'Open'] || 0) + 1;
    return acc;
  }, {});

  if (!user) return null;

  return (
    <div style={pageWrapStyle}>
      {/* Header bar */}
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{insurer?.name || 'Insurer Portal'}</h1>
          <p style={subtitleStyle}>
            Read-only view of claims NISLA / Acuere are handling on your behalf.
            Logged in as <strong>{user.name}</strong> · {user.email}
          </p>
        </div>
        <button type="button" onClick={logout} style={logoutBtnStyle}>
          Log out
        </button>
      </header>

      {/* Stats strip */}
      <div style={statsStripStyle}>
        <Stat label="Total claims" value={claims.length} primary />
        {Object.entries(statusCounts).map(([s, n]) => (
          <Stat key={s} label={s} value={n} accent={STATUS_STYLE[s]?.color} />
        ))}
      </div>

      {/* Toolbar */}
      <div style={toolbarStyle}>
        <input
          type="search"
          placeholder="Search by ref / claim no / insured / policy"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchStyle}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">All statuses ({claims.length})</option>
          {Object.keys(statusCounts).map((s) => (
            <option key={s} value={s}>{s} ({statusCounts[s]})</option>
          ))}
        </select>
      </div>

      {error && <div style={errorBannerStyle}>⚠ {error}</div>}

      {loading ? (
        <div style={loadingStyle}>Loading your claims…</div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>
          {claims.length === 0
            ? <>📂 No claims for {insurer?.name || 'your account'} yet. New claims appear here as soon as NISLA registers them.</>
            : <>No claims match your filter.</>
          }
        </div>
      ) : (
        <div style={listStyle}>
          <div style={listHeaderRowStyle}>
            <span style={{ ...colStyle, flex: 1.4 }}>Surveyor reference</span>
            <span style={{ ...colStyle, flex: 1 }}>Claim no.</span>
            <span style={{ ...colStyle, flex: 1.3 }}>Insured</span>
            <span style={{ ...colStyle, flex: 0.8 }}>LOB</span>
            <span style={{ ...colStyle, flex: 1 }}>Date of loss</span>
            <span style={{ ...colStyle, flex: 0.8 }}>Status</span>
            <span style={{ ...colStyle, flex: 1, textAlign: 'right' }}>Gross loss</span>
          </div>
          {filtered.map((c) => (
            <Link key={c.id} href={`/insurer-portal/claim/${c.id}`} style={rowLinkStyle}>
              <span style={{ ...colStyle, flex: 1.4, fontWeight: 600 }}>{c.ref_number || `#${c.id}`}</span>
              <span style={{ ...colStyle, flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{c.claim_number || '—'}</span>
              <span style={{ ...colStyle, flex: 1.3 }}>{c.insured_name || '—'}</span>
              <span style={{ ...colStyle, flex: 0.8 }}>{c.lob || '—'}</span>
              <span style={{ ...colStyle, flex: 1 }}>{fmtDate(c.date_loss)}</span>
              <span style={{ ...colStyle, flex: 0.8 }}>
                <StatusBadge status={c.status} />
              </span>
              <span style={{ ...colStyle, flex: 1, textAlign: 'right' }}>{fmtINR(c.gross_loss)}</span>
            </Link>
          ))}
        </div>
      )}

      <footer style={footerStyle}>
        <p>This is a read-only portal. To request changes or escalate, contact your NISLA / Acuere claims handler directly.</p>
      </footer>
    </div>
  );
}

// -----------------------------------------------------------------------------
// helpers + sub-components
// -----------------------------------------------------------------------------

function Stat({ label, value, primary, accent }) {
  return (
    <div style={statBoxStyle(primary)}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || (primary ? '#0f172a' : '#475569'), marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.Open;
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 9999,
      background: s.bg, color: s.color, fontWeight: 600,
    }}>
      {s.icon} {status || 'Open'}
    </span>
  );
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtINR(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const pageWrapStyle = {
  maxWidth: 1300, margin: '0 auto', padding: '24px 32px', fontFamily: 'inherit',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  flexWrap: 'wrap', gap: 12,
  paddingBottom: 16, borderBottom: '1px solid #e2e8f0', marginBottom: 16,
};
const titleStyle = { margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a' };
const subtitleStyle = { margin: '4px 0 0', fontSize: 12, color: '#64748b' };

const logoutBtnStyle = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600,
  background: 'transparent', color: '#475569',
  border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer',
};

const statsStripStyle = {
  display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16,
};
function statBoxStyle(primary) {
  return {
    padding: '10px 16px',
    background: primary ? '#f8fafc' : '#fff',
    border: `1px solid ${primary ? '#cbd5e1' : '#e2e8f0'}`,
    borderRadius: 8, minWidth: 130,
  };
}

const toolbarStyle = {
  display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap',
};
const searchStyle = {
  flex: 1, minWidth: 240, padding: '8px 12px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 8,
};
const selectStyle = {
  padding: '8px 12px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff',
  cursor: 'pointer',
};

const errorBannerStyle = {
  padding: '10px 14px', background: '#fee2e2', color: '#991b1b',
  border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, marginBottom: 16,
};

const loadingStyle = { padding: 60, textAlign: 'center', color: '#64748b', fontSize: 13 };
const emptyStyle = {
  padding: 60, textAlign: 'center', color: '#64748b', fontSize: 13,
  background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8,
};

const listStyle = {
  border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff',
};
const listHeaderRowStyle = {
  display: 'flex', gap: 10, padding: '8px 14px',
  background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
  fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
};
const rowLinkStyle = {
  display: 'flex', gap: 10, padding: '10px 14px', alignItems: 'center',
  borderBottom: '1px solid #f1f5f9', textDecoration: 'none', color: '#0f172a',
  fontSize: 13,
  transition: 'background 0.15s ease',
};
const colStyle = {
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

const footerStyle = {
  marginTop: 24, padding: 14, fontSize: 11, color: '#94a3b8',
  textAlign: 'center', borderTop: '1px solid #e2e8f0',
};
