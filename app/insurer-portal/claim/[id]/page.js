'use client';
// =============================================================================
// app/insurer-portal/claim/[id]/page.js
// =============================================================================
// Phase 2 read-only single-claim view for the insurer portal.
//
// Shows:
//   - Header with ref / claim no / insured / insurer / company
//   - Key dates + status
//   - Latest approved FSR (preview iframe + download)
//   - Latest ILA submission (preview if available)
//   - Filtered timeline (status changes / submissions / closures only)
//
// What it doesn't show:
//   - In-progress FSR drafts (server side filters those out)
//   - Internal NISLA chat
//   - Survey fee bills
//
// Auth: AuthContext segregation guard pushes non-insurer users away.
// API gating: /api/insurer-portal/claims/[id] checks ownership and
// 404s if the claim doesn't belong to this insurer.
// =============================================================================

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { authedFetch } from '@/lib/api/authedFetch';

export default function InsurerClaimDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState('summary');

  useEffect(() => {
    if (!user || !id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authedFetch(`/api/insurer-portal/claims/${id}`);
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(j?.error || 'Load failed');
        setData(j);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, user]);

  if (!user) return null;

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading claim…</div>;
  if (error) return (
    <div style={pageWrapStyle}>
      <Link href="/insurer-portal" style={backLinkStyle}>← Back to dashboard</Link>
      <div style={errorBannerStyle}>⚠ {error}</div>
    </div>
  );
  if (!data) return null;

  const { claim, merged, submitted_fsr, submitted_ila, timeline } = data;
  const view = merged || claim;

  return (
    <div style={pageWrapStyle}>
      <div style={topBarStyle}>
        <Link href="/insurer-portal" style={backLinkStyle}>← Back to dashboard</Link>
        <span style={readOnlyPillStyle}>READ ONLY</span>
      </div>

      {/* Header */}
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{view.ref_number || `Claim #${id}`}</h1>
          <p style={subtitleStyle}>
            {view.insured_name && <span><strong>{view.insured_name}</strong></span>}
            {view.lob && <span> · {view.lob}{view.lob_subcategory ? ` (${view.lob_subcategory})` : ''}</span>}
            {view.policy_number && <span> · Policy <code>{view.policy_number}</code></span>}
          </p>
          <p style={metaSubtitleStyle}>
            {view.claim_number && <>Insurer claim no: <strong>{view.claim_number}</strong></>}
          </p>
        </div>
        <StatusPill status={view.status} phase={view.phase} />
      </header>

      {/* Tabs */}
      <div style={tabBarStyle}>
        {[
          { key: 'summary', label: 'Summary' },
          { key: 'fsr', label: 'Final Survey Report', count: submitted_fsr ? 1 : 0 },
          { key: 'ila', label: 'Initial Loss Advice', count: submitted_ila ? 1 : 0 },
          { key: 'timeline', label: 'Timeline', count: timeline?.length || 0 },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveView(t.key)}
            style={tabBtnStyle(activeView === t.key)}
          >
            {t.label}
            {t.count > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: '0 6px', borderRadius: 9999, background: 'rgba(255,255,255,0.25)' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      {activeView === 'summary' && <SummaryView claim={view} />}
      {activeView === 'fsr' && <FsrView fsr={submitted_fsr} />}
      {activeView === 'ila' && <IlaView ila={submitted_ila} />}
      {activeView === 'timeline' && <TimelineView timeline={timeline} />}

      <footer style={footerStyle}>
        <p>This is a read-only portal. To request changes or escalate, contact your NISLA / Acuere claims handler.</p>
      </footer>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SummaryView
// -----------------------------------------------------------------------------
function SummaryView({ claim }) {
  const rows = [
    ['Date of intimation', fmtDate(claim.date_of_intimation)],
    ['Date of loss', fmtDate(claim.date_loss)],
    ['Loss location', claim.loss_location],
    ['Sum insured', fmtINR(claim.sum_insured)],
    ['Gross loss (assessed)', fmtINR(claim.gross_loss)],
    ['Estimated loss (initial)', fmtINR(claim.estimated_loss_amount)],
    ['Policy period', claim.policy_period_from && claim.policy_period_to
      ? `${fmtDate(claim.policy_period_from)} → ${fmtDate(claim.policy_period_to)}`
      : '—'],
    ['Phase', prettyPhase(claim.phase)],
    ['Registered at', fmtDate(claim.registered_at)],
  ];
  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Claim summary</h3>
      <table style={tableStyle}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={labelCellStyle}>{k}</td>
              <td style={valueCellStyle}>{v || <span style={dimStyle}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -----------------------------------------------------------------------------
// FsrView — only the approved Final Survey Report
// -----------------------------------------------------------------------------
function FsrView({ fsr }) {
  if (!fsr) {
    return (
      <div style={emptyCardStyle}>
        <div style={{ fontSize: 36 }}>📑</div>
        <p>The Final Survey Report has not been submitted yet.</p>
        <p style={{ fontSize: 12, color: '#94a3b8' }}>
          You'll see the FSR here once the surveyor signs and submits it.
        </p>
      </div>
    );
  }
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={cardTitleStyle}>Final Survey Report</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0' }}>
            Version {fsr.version_number} · signed by <strong>{fsr.approved_by || '—'}</strong> on {fmtDate(fsr.approved_at)}
          </p>
        </div>
        <span style={statusBadgeStyle('#dcfce7', '#166534')}>✓ Submitted</span>
      </div>
      {fsr.draft_content ? (
        <div style={iframeWrapStyle}>
          <iframe
            title="Final Survey Report"
            srcDoc={fsr.draft_content}
            style={iframeStyle}
            sandbox="allow-same-origin"
          />
        </div>
      ) : (
        <p style={{ color: '#64748b', fontSize: 13 }}>
          The FSR has been signed but its rendered content isn't available — please contact NISLA to receive a copy.
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// IlaView
// -----------------------------------------------------------------------------
function IlaView({ ila }) {
  if (!ila) {
    return (
      <div style={emptyCardStyle}>
        <div style={{ fontSize: 36 }}>📋</div>
        <p>The Initial Loss Advice (ILA) has not been submitted yet.</p>
      </div>
    );
  }
  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Initial Loss Advice</h3>
      <p style={{ fontSize: 13, color: '#475569' }}>
        Submitted on <strong>{fmtDate(ila.submitted_at)}</strong> by{' '}
        <strong>{ila.signed_by_name || ila.signed_by_email || '—'}</strong>
        {ila.signer_irdai_license_no && ` (IRDAI: ${ila.signer_irdai_license_no})`}.
      </p>
      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
        For the full ILA document, contact your NISLA claims handler — the email containing the
        signed PDF was sent at the time of submission.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// TimelineView
// -----------------------------------------------------------------------------
function TimelineView({ timeline }) {
  if (!timeline || timeline.length === 0) {
    return (
      <div style={emptyCardStyle}>
        <div style={{ fontSize: 36 }}>🗓️</div>
        <p>No status changes or submissions recorded yet.</p>
      </div>
    );
  }
  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Activity timeline</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {timeline.map((row) => (
          <div key={row.id} style={timelineRowStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
              {prettyAction(row.action)}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {fmtDateTime(row.created_at)}
              {row.user_name && <> · {row.user_name}</>}
            </div>
            {row.details && (
              <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                {typeof row.details === 'string' ? row.details : JSON.stringify(row.details)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function StatusPill({ status, phase }) {
  const map = {
    'Open': '#fef3c7|#92400e',
    'In Progress': '#dbeafe|#1e40af',
    'Closed': '#dcfce7|#166534',
    'Reopened': '#fef3c7|#92400e',
    'Withdrawn': '#f3f4f6|#6b7280',
  };
  const [bg, color] = (map[status] || map.Open).split('|');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span style={statusBadgeStyle(bg, color)}>{status || 'Open'}</span>
      {phase && <span style={{ fontSize: 11, color: '#64748b' }}>Phase: {prettyPhase(phase)}</span>}
    </div>
  );
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtINR(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}
function prettyPhase(p) {
  if (!p) return '—';
  return String(p).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function prettyAction(a) {
  if (!a) return '';
  return String(a).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const pageWrapStyle = { maxWidth: 1200, margin: '0 auto', padding: '24px 32px' };

const topBarStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
};

const backLinkStyle = {
  color: '#475569', fontSize: 12, textDecoration: 'none', fontWeight: 600,
};

const readOnlyPillStyle = {
  fontSize: 10, fontWeight: 700, padding: '3px 10px',
  background: '#fef3c7', color: '#92400e',
  border: '1px solid #fde68a', borderRadius: 9999,
  letterSpacing: 0.5,
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  flexWrap: 'wrap', gap: 12,
  paddingBottom: 16, borderBottom: '1px solid #e2e8f0', marginBottom: 16,
};
const titleStyle = { margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a' };
const subtitleStyle = { margin: '4px 0 0', fontSize: 13, color: '#475569' };
const metaSubtitleStyle = { margin: '2px 0 0', fontSize: 12, color: '#64748b' };

function statusBadgeStyle(bg, color) {
  return {
    fontSize: 11, padding: '4px 12px', borderRadius: 9999,
    background: bg, color, fontWeight: 700,
  };
}

const tabBarStyle = {
  display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap',
};
function tabBtnStyle(active) {
  return {
    padding: '8px 14px', fontSize: 13, fontWeight: 600,
    background: active ? '#1e293b' : '#f1f5f9',
    color: active ? '#fff' : '#475569',
    border: 'none', borderRadius: 8, cursor: 'pointer',
  };
}

const cardStyle = {
  padding: 16, background: '#fff',
  border: '1px solid #e2e8f0', borderRadius: 10,
};
const cardTitleStyle = { margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' };

const tableStyle = { width: '100%', fontSize: 13, marginTop: 12 };
const labelCellStyle = { padding: '6px 0', color: '#64748b', width: '40%' };
const valueCellStyle = { padding: '6px 0', fontWeight: 500, color: '#0f172a' };
const dimStyle = { color: '#94a3b8', fontStyle: 'italic' };

const emptyCardStyle = {
  padding: 60, textAlign: 'center', color: '#64748b',
  background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10,
};

const errorBannerStyle = {
  padding: '10px 14px', background: '#fee2e2', color: '#991b1b',
  border: '1px solid #fecaca', borderRadius: 8, fontSize: 13,
};

const iframeWrapStyle = {
  border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', height: 800,
};
const iframeStyle = { width: '100%', height: '100%', border: 'none' };

const timelineRowStyle = {
  padding: 10, background: '#fafbfc',
  border: '1px solid #e2e8f0', borderRadius: 8,
};

const footerStyle = {
  marginTop: 24, padding: 14, fontSize: 11, color: '#94a3b8',
  textAlign: 'center', borderTop: '1px solid #e2e8f0',
};
