'use client';

// ============================================================
// /communications/review
// ------------------------------------------------------------
// Stage 5 — Human review queue.
//
// Shows pending_review messages that did not auto-route because:
//   - Classification confidence was below the tag threshold, OR
//   - Extraction had validation errors.
//
// Admins can approve (force-route) or reject each message.
// ============================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { IRDAI_LOBS, normaliseLob } from '@/lib/lobSubcategories';

export default function ReviewQueuePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams?.get('highlight') || null;
  const justTagged = searchParams?.get('just_tagged') === '1';
  const { user, loading } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [actionBusy, setActionBusy] = useState({});
  const [surveyors, setSurveyors] = useState([]);
  const [pollAttempts, setPollAttempts] = useState(0);
  const highlightRef = useRef(null);
  const limit = 50;

  // Load active surveyors once for the assignee picker (M3).
  useEffect(() => {
    fetch('/api/surveyors').then(r => r.ok ? r.json() : []).then(d => {
      setSurveyors(Array.isArray(d) ? d : []);
    }).catch(() => setSurveyors([]));
  }, []);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      const res = await fetch(`/api/communications/review?${params}`, {
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
  }, [user?.email, offset]);

  useEffect(() => { load(); }, [load]);

  // Auto-poll (15s × 20 attempts = 5 min) when we arrived from a just-
  // tagged triage navigation. The cron extract-pending runs every 5 min;
  // this gives the row a chance to appear in the queue without a manual
  // refresh.
  useEffect(() => {
    if (!justTagged || !highlightId) return;
    if (pollAttempts >= 20) return;
    const found = (data?.messages || []).some((m) => m.id === highlightId);
    if (found) return;
    const t = setTimeout(() => {
      setPollAttempts((n) => n + 1);
      load();
    }, 15_000);
    return () => clearTimeout(t);
  }, [justTagged, highlightId, pollAttempts, data, load]);

  // Scroll to + flash the highlighted row once it's visible.
  useEffect(() => {
    if (!highlightId) return;
    if (!data?.messages?.some((m) => m.id === highlightId)) return;
    const el = highlightRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, data]);

  async function handleAction(messageId, action, extras = {}) {
    setActionBusy((p) => ({ ...p, [messageId]: true }));
    try {
      const res = await fetch('/api/communications/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-user-email': user.email },
        body: JSON.stringify({ message_id: messageId, action, ...extras }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      // On a successful approve that created/linked a claim, navigate the
      // user forward to Pending Registration with that claim highlighted.
      // Falls back to in-place reload if no claim_id was returned.
      const claimId = json?.routing?.claimId || json?.claim_id;
      if (action === 'approve' && claimId) {
        router.push(`/communications/intimations?highlight=${encodeURIComponent(claimId)}&just_approved=1`);
        return;
      }
      await load();
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setActionBusy((p) => ({ ...p, [messageId]: false }));
    }
  }

  if (loading) return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  if (!user) return null;

  const total = data?.total || 0;
  const messages = data?.messages || [];

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>Review Queue</h2>
          {total > 0 && (
            <span style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', background: '#ede9fe', padding: '2px 10px', borderRadius: 999 }}>
              {total} pending
            </span>
          )}
        </div>
        <p style={{ margin: '4px 0 18px', fontSize: 13, color: '#64748b', maxWidth: 700 }}>
          These messages were not auto-routed — confidence was below the threshold or the extraction has validation errors.
          Review each one and either <strong>Approve</strong> (force-route to claims) or <strong>Reject</strong>.
        </p>

        {/* Just-tagged banner: shown when arriving from triage. The cron
            extract-pending runs every 5 min; this page polls every 15s
            for up to 5 min while the user waits. */}
        {justTagged && highlightId && !messages.some((m) => m.id === highlightId) && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            <strong>Message tagged — extraction in progress.</strong> The message you just tagged from triage is being processed. It will appear here within ~5 minutes if it needs human review, or auto-route directly to <Link href="/communications/intimations" style={{ color: '#1e40af', textDecoration: 'underline' }}>Pending Registration</Link>. {pollAttempts > 0 && <span style={{ color: '#64748b', fontSize: 12 }}>· checked {pollAttempts} time{pollAttempts === 1 ? '' : 's'}</span>}
          </div>
        )}

        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/communications/triage" style={{ fontSize: 12, color: '#0ea5e9' }}>
            ← Triage queue
          </Link>
          <button
            onClick={() => load()}
            disabled={busy}
            style={btnStyle('ghost', busy)}
          >
            {busy ? '…' : 'Refresh'}
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + messages.length, total)} of {total}
          </div>
        </div>

        {error && <Banner kind="err">{error}</Banner>}

        {messages.length === 0 ? (
          <div style={emptyBox}>
            {busy ? 'Loading…' : 'No messages awaiting review. '}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((m) => (
              <ReviewCard
                key={m.id}
                message={m}
                busy={!!actionBusy[m.id]}
                onApprove={(extras) => handleAction(m.id, 'approve', extras)}
                onLink={(refNumber) => handleAction(m.id, 'approve', { link_to_ref_number: refNumber })}
                onReject={() => handleAction(m.id, 'reject')}
                userEmail={user.email}
                surveyors={surveyors}
                isHighlighted={m.id === highlightId}
                rowRef={m.id === highlightId ? highlightRef : null}
              />
            ))}
          </div>
        )}

        {total > limit && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0 || busy} style={btnStyle('secondary', offset === 0 || busy)}>← Prev</button>
            <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total || busy} style={btnStyle('secondary', offset + limit >= total || busy)}>Next →</button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

function ReviewCard({ message: m, busy, onApprove, onReject, onLink, surveyors = [], isHighlighted = false, rowRef = null }) {
  const [expanded, setExpanded] = useState(isHighlighted);
  const ext = m.extraction;
  const cls = m.classification;
  const isIntimation = cls?.tag === 'intimation';

  // Brief flash animation when this row is the highlighted one (e.g. user
  // just arrived from triage). After a few seconds the outline returns to
  // normal so it doesn't stay distracting.
  const [flashing, setFlashing] = useState(isHighlighted);
  useEffect(() => {
    if (!isHighlighted) return;
    const t = setTimeout(() => setFlashing(false), 4000);
    return () => clearTimeout(t);
  }, [isHighlighted]);

  // Approve-time pickers (modifications 30-04-2026 §2):
  // - lobOverride: clerk-picked LOB (intimation only) — defaults to LLM hint
  // - assignedSurveyorId: lead surveyor (intimation only)
  // - linkRef: tag this message to an existing claim by ref_number (any tag)
  const extractedLob = ext?.extracted_data?.lob;
  const [lobOverride, setLobOverride] = useState(
    isIntimation ? normaliseLob(extractedLob) : ''
  );
  const [assignedSurveyorId, setAssignedSurveyorId] = useState('');
  const [linkRef, setLinkRef] = useState('');

  function approve() {
    const extras = {};
    if (isIntimation && lobOverride) extras.override_lob = lobOverride;
    if (isIntimation && assignedSurveyorId) extras.assigned_surveyor_id = assignedSurveyorId;
    onApprove(extras);
  }

  function linkToRef() {
    if (!linkRef.trim()) {
      alert('Enter a surveyor reference number first');
      return;
    }
    onLink(linkRef.trim());
  }

  return (
    <div
      ref={rowRef}
      style={{
        background: '#fff',
        border: isHighlighted ? '2px solid #f59e0b' : '1px solid #e2e8f0',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: flashing ? '0 0 0 4px rgba(245, 158, 11, 0.3)' : 'none',
        transition: 'box-shadow 600ms, border-color 400ms',
      }}
    >
      <div
        style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setExpanded((p) => !p)}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {m.tag_label && (
              <span style={{ fontSize: 11, fontWeight: 700, background: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                {m.tag_label}
              </span>
            )}
            {cls && (
              <ConfidenceChip confidence={cls.confidence} threshold={m.threshold} />
            )}
            {ext && !ext.is_valid && (
              <span style={{ fontSize: 11, fontWeight: 700, background: '#fef2f2', color: '#991b1b', padding: '2px 8px', borderRadius: 999 }}>
                Validation errors
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m.subject || '(no subject)'}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {m.from_address} · {formatTs(m.received_at)} · {m.company}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, fontStyle: 'italic' }}>
            Held: {m.held_reason}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={(e) => { e.stopPropagation(); approve(); }}
            disabled={busy}
            style={btnStyle('approve', busy)}
            title={isIntimation
              ? `Approve as intimation${lobOverride ? ` · LOB ${lobOverride}` : ''}${assignedSurveyorId ? ' · with assignee' : ''}`
              : 'Approve and route per tag rules'}
          >
            {busy ? '…' : 'Approve'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReject(); }}
            disabled={busy}
            style={btnStyle('reject', busy)}
          >
            Reject
          </button>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 16px', background: '#f8fafc' }}>
          <div style={{ marginBottom: 14, padding: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
              Approve options
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {isIntimation && (
                <>
                  <div>
                    <label style={lblStyle}>LOB (override)</label>
                    <select
                      value={lobOverride || ''}
                      onChange={(e) => setLobOverride(e.target.value)}
                      style={smallInputStyle}
                    >
                      <option value="">— LLM-extracted —</option>
                      {IRDAI_LOBS.map((lob) => (
                        <option key={lob} value={lob}>{lob}</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                      LLM hint: {extractedLob || '—'} → registered as {lobOverride || normaliseLob(extractedLob)}
                    </div>
                  </div>
                  <div>
                    <label style={lblStyle}>Assign to surveyor</label>
                    <select
                      value={assignedSurveyorId}
                      onChange={(e) => setAssignedSurveyorId(e.target.value)}
                      style={smallInputStyle}
                    >
                      <option value="">— No assignment yet —</option>
                      {surveyors
                        .filter((s) => s.active && s.license_status !== 'expired')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.license_status === 'expiring_soon' ? ' · ⚠ expiring' : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              )}

              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                <label style={lblStyle}>
                  Or tag this message to an existing claim by reference #
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    placeholder="e.g. 4053/26-27/Marine Cargo"
                    value={linkRef}
                    onChange={(e) => setLinkRef(e.target.value)}
                    style={{ ...smallInputStyle, flex: 1 }}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); linkToRef(); }}
                    disabled={busy || !linkRef.trim()}
                    style={btnStyle('secondary', busy || !linkRef.trim())}
                  >
                    Tag &amp; file
                  </button>
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  Bypasses tag routing — links message + attachments directly to that claim.
                </div>
              </div>
            </div>
          </div>
          {ext?.extracted_data && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Extracted data</div>
              <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%', maxWidth: 520 }}>
                <tbody>
                  {Object.entries(ext.extracted_data).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ padding: '3px 10px 3px 0', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</td>
                      <td style={{ padding: '3px 0', color: '#0f172a' }}>{String(v ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {ext?.validation_errors?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>Validation errors</div>
              {ext.validation_errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: '#b91c1c', marginBottom: 2 }}>
                  <strong>{e.field}:</strong> {e.error}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <Link href={`/communications/triage/${m.id}`} style={{ fontSize: 12, color: '#0ea5e9' }}>
              View full message →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceChip({ confidence, threshold }) {
  if (confidence === null || confidence === undefined) return null;
  const pct = Math.round(confidence * 100);
  const below = threshold !== null && confidence < threshold;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700,
      background: below ? '#fef3c7' : '#ecfdf5',
      color: below ? '#92400e' : '#065f46',
      padding: '2px 8px', borderRadius: 999,
    }}>
      {pct}% {below ? `< ${Math.round(threshold * 100)}% threshold` : 'confident'}
    </span>
  );
}

function Banner({ kind, children }) {
  const c = { ok: ['#ecfdf5', '#065f46', '#a7f3d0'], err: ['#fef2f2', '#991b1b', '#fecaca'] }[kind] || ['#fffbeb', '#92400e', '#fde68a'];
  return (
    <div style={{ background: c[0], color: c[1], border: `1px solid ${c[2]}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function formatTs(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const emptyBox = {
  background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 8,
  padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13,
};

const lblStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4,
};
const smallInputStyle = {
  width: '100%', padding: '5px 8px', fontSize: 12,
  border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff',
};

function btnStyle(variant, disabled) {
  const base = { padding: '5px 12px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
  if (variant === 'approve') return { ...base, background: '#dcfce7', color: '#166534' };
  if (variant === 'reject') return { ...base, background: '#fef2f2', color: '#991b1b' };
  if (variant === 'ghost') return { ...base, background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0' };
  return { ...base, background: '#f1f5f9', color: '#0f172a' };
}
