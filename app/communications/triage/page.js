'use client';

// ============================================================
// /communications/triage  (Stage 3b + Stage 5 updates)
// ------------------------------------------------------------
// Human-first triage queue. Lists inbox_messages newest-first.
// Shows full timestamp, sender email, company, and attachment count.
//
// Admin feature: multi-select rows and bulk-categorise in one go.
// Regular users see the same list but cannot bulk-act.
// ============================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

// ── Tag catalogue (mirrors DB seed; UI renders from API but this
//    provides the grouping labels and guidance text client-side) ──
const EXTRACTION_REQUIRED = [
  { tag: 'intimation',         label: 'New Intimation',                      guidance: 'Extract policy number, insured name, date of loss, location, and contact. A new claim record will be created.' },
  { tag: 'client_followup',    label: 'Client Follow-up',                    guidance: 'Extract claim reference and the nature of the follow-up. Link to the existing claim and log the note.' },
  { tag: 'insurer_query',      label: 'Insurer Query / Follow-up',           guidance: 'Extract claim reference, query details, and deadline. Flag for the handling surveyor.' },
  { tag: 'policy_doc',         label: 'Policy Documents',                    guidance: 'Extract policy number, insured name, LOB, sum insured, and validity dates. Archive to claim/policy folder.' },
  { tag: 'claim_documents',    label: 'Claim Documents',                     guidance: 'Extract document type, claim reference, and value amounts. File to the claim folder.' },
  { tag: 'surveyor_photos',    label: 'Survey / Site Visit Photographs',     guidance: 'Extract claim reference and image count. Images are attached to the claim gallery.' },
  { tag: 'claim_registration', label: 'Claim Registration Email (from Client/Insurer)', guidance: 'Email from the client/insurer/broker confirming a claim has been registered in their system, with the claim reference. Link to the existing claim.' },
  { tag: 'settlement_advice',  label: 'Settlement Advice',                   guidance: 'Extract settled amount, deductions, settlement date, and payment mode. Updates claim and triggers fee invoice.' },
  { tag: 'consent_email',      label: 'Consent Email',                       guidance: 'Extract claim reference, consent type, and consenting party name/date. File to claim folder.' },
];

const NON_EXTRACTION = [
  { tag: 'internal_admin',      label: 'Internal & Admin',          guidance: 'Internal team communication or system notice. No extraction needed — filed under internal.' },
  { tag: 'duplicate',           label: 'Duplicate',                 guidance: 'Suspected duplicate. Ask the sender for proof (unique claim ref or doc). If provided → Non-Extraction. If not within 48 h → Investigation Pending.' },
  { tag: 'update_from_insurer', label: 'Update Emails from Insurer', guidance: 'Status update or acknowledgement from the insurer. No structured data to extract — filed for reference.' },
  { tag: 'others',              label: 'Others',                    guidance: 'Does not fit any defined category. Add a note explaining why before dismissing.' },
];

// New action-oriented filter — replaces the raw-status dropdown.
// 'category' is sent to /api/communications/messages and the server
// joins against message_classifications when needed.
const CATEGORY_OPTIONS = [
  { value: 'all',            label: 'All Mails' },
  { value: 'unattended',     label: 'Unattended Emails' },
  { value: 'dismissed',      label: 'Attended — Dismissed' },
  { value: 'auto_routed',    label: 'Attended — Auto Routed' },
  { value: 'extraction',     label: 'Attended — Categorised (Extraction)' },
  { value: 'non_extraction', label: 'Attended — Categorised (Non Extraction)' },
];

// Tag-group sets — mirror the EXTRACTION_REQUIRED / NON_EXTRACTION
// arrays above. Used by ActionBadge to decide which "Categorised"
// label to show on a triaged message.
const EXTRACTION_TAG_SET = new Set(EXTRACTION_REQUIRED.map((t) => t.tag));
const NON_EXTRACTION_TAG_SET = new Set(NON_EXTRACTION.map((t) => t.tag));

// Quick-lookup map: workflow_tag -> human-readable label. Used by the per-row
// tag badge so clerks can see at a glance what each email was categorised as
// (vs the previous behaviour of just showing a generic "Categorised" pill).
const TAG_LABEL_BY_KEY = (() => {
  const m = new Map();
  for (const t of EXTRACTION_REQUIRED) m.set(t.tag, t.label);
  for (const t of NON_EXTRACTION)      m.set(t.tag, t.label);
  return m;
})();

// Compact display labels — shorter than the full guidance labels above so
// the row badge fits nicely. Falls back to TAG_LABEL_BY_KEY if no compact
// override is defined for a tag.
const TAG_COMPACT_LABEL = {
  intimation:          'Intimation',
  client_followup:     'Client Follow-up',
  insurer_query:       'Insurer Query',
  policy_doc:          'Policy Doc',
  claim_documents:     'Claim Docs',
  surveyor_photos:     'Surveyor Photos',
  claim_registration:  'Claim Reg',
  settlement_advice:   'Settlement',
  consent_email:       'Consent',
  internal_admin:      'Internal',
  duplicate:           'Duplicate',
  update_from_insurer: 'Insurer Update',
  others:              'Others',
};

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

export default function TriageQueuePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  // Initial category / tag come from URL so dashboard drilldowns land
  // on the right pre-filtered view. Default landing is 'unattended' (the
  // actionable filter for daily triage work) — clerks open this page to
  // process unattended mail; an "All Mails" default would hide the queue
  // behind already-handled noise. URL params still take precedence so
  // direct links like ?category=all keep working.
  const urlCategory = searchParams?.get('category') || 'unattended';
  const urlTag = searchParams?.get('tag') || '';

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState(urlCategory);
  const [tagFilter, setTagFilter] = useState(urlTag);
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // Bulk-select state (admin only)
  const [selected, setSelected] = useState(new Set());
  const [bulkTag, setBulkTag] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const isAdmin = ADMIN_ROLES.has(String(user?.role || '').toLowerCase());

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    setSelected(new Set());
    setBulkResult(null);
    try {
      const params = new URLSearchParams({ category, limit: String(limit), offset: String(offset) });
      if (q.trim()) params.set('q', q.trim());
      if (tagFilter) params.set('tag', tagFilter);
      const res = await fetch(`/api/communications/messages?${params}`, {
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
  }, [user?.email, category, tagFilter, q, offset]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const messages = data?.messages || [];
    const selectableIds = messages.filter((m) => m.status === 'received').map((m) => m.id);
    if (selectableIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  async function applyBulkTag() {
    if (!bulkTag || selected.size === 0) return;
    setBulkBusy(true);
    setBulkResult(null);
    const ids = [...selected];

    // Sentinel value 'DISMISS' switches the per-row request from
    // action=classify to action=dismiss. Everything else is treated
    // as a workflow_tag and goes through the classify path.
    const isDismiss = bulkTag === 'DISMISS';

    const settled = await Promise.allSettled(
      ids.map((message_id) =>
        fetch('/api/communications/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-app-user-email': user.email },
          body: JSON.stringify(
            isDismiss
              ? { message_id, action: 'dismiss', reason: 'Bulk dismiss from triage queue' }
              : { message_id, action: 'classify', tag: bulkTag }
          ),
        }).then((res) => (res.ok ? 'ok' : 'fail'))
      )
    );
    const ok = settled.filter((r) => r.status === 'fulfilled' && r.value === 'ok').length;
    const fail = ids.length - ok;

    setBulkResult({ ok, fail, total: ids.length, dismiss: isDismiss });
    setBulkBusy(false);
    setBulkTag('');
    await load();
  }

  if (loading) return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  if (!user) return null;

  const total = data?.total || 0;
  const messages = data?.messages || [];
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + messages.length, total);
  const selectableCount = messages.filter((m) => m.status === 'received').length;
  const allSelected = selectableCount > 0 && messages.filter((m) => m.status === 'received').every((m) => selected.has(m.id));

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>Communications — Triage queue</h2>
            <p style={{ margin: '4px 0 16px', fontSize: 13, color: '#64748b', maxWidth: 700 }}>
              Messages arrive newest-first. Pick a category for each — or dismiss if not relevant.
              Only categorised messages move on to AI extraction.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/communications/dashboard" style={{ fontSize: 13, color: '#7c3aed', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Dashboard →
            </Link>
            <Link href="/communications/review" style={{ fontSize: 13, color: '#7c3aed', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Review queue →
            </Link>
          </div>
        </div>

        {error && <Banner kind="err">{error}</Banner>}
        {bulkResult && (
          <Banner kind={bulkResult.fail > 0 ? 'warn' : 'ok'}>
            Bulk {bulkResult.dismiss ? 'dismiss' : 'categorise'}: {bulkResult.ok} succeeded, {bulkResult.fail} failed (of {bulkResult.total}).
          </Banner>
        )}

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={labelStyle}>
            Show:
            <select value={category} onChange={(e) => { setOffset(0); setCategory(e.target.value); }} style={selectStyle}>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <input
            type="text" placeholder="Search subject or sender…" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); load(); } }}
            style={inputStyle}
          />
          {tagFilter && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600,
              background: '#ede9fe', color: '#5b21b6',
              padding: '4px 10px', borderRadius: 999,
            }}>
              Tag: {tagFilter}
              <button
                onClick={() => { setOffset(0); setTagFilter(''); }}
                style={{ all: 'unset', cursor: 'pointer', fontWeight: 700, marginLeft: 2 }}
                aria-label="Clear tag filter"
                title="Clear tag filter"
              >
                ✕
              </button>
            </span>
          )}
          <button onClick={() => { setOffset(0); load(); }} disabled={busy} style={btnStyle('primary', busy)}>
            {busy ? '…' : 'Search'}
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            Showing {showingFrom}–{showingTo} of {total}
          </div>
        </div>

        {/* Admin bulk-action bar */}
        {isAdmin && (category === 'all' || category === 'unattended') && messages.length > 0 && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
              Admin bulk action
            </span>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {selected.size} selected
            </span>
            <select
              value={bulkTag}
              onChange={(e) => setBulkTag(e.target.value)}
              style={{ ...selectStyle, minWidth: 220 }}
              disabled={selected.size === 0 || bulkBusy}
            >
              <option value="">— choose action —</option>
              <optgroup label="Extraction Required">
                {EXTRACTION_REQUIRED.map((t) => <option key={t.tag} value={t.tag}>{t.label}</option>)}
              </optgroup>
              <optgroup label="No Extraction">
                {NON_EXTRACTION.map((t) => <option key={t.tag} value={t.tag}>{t.label}</option>)}
              </optgroup>
              <optgroup label="Dismiss">
                <option value="DISMISS">Dismiss (not relevant — drop without extraction)</option>
              </optgroup>
            </select>
            <button
              onClick={applyBulkTag}
              disabled={!bulkTag || selected.size === 0 || bulkBusy}
              style={btnStyle(bulkTag === 'DISMISS' ? 'danger' : 'primary', !bulkTag || selected.size === 0 || bulkBusy)}
            >
              {bulkBusy
                ? (bulkTag === 'DISMISS' ? 'Dismissing…' : 'Applying…')
                : (bulkTag === 'DISMISS' ? `Dismiss ${selected.size}` : `Apply to ${selected.size}`)}
            </button>
          </div>
        )}

        {/* Message list */}
        {messages.length === 0 ? (
          <div style={emptyBoxStyle}>
            {(category === 'all' || category === 'unattended') ? 'No messages awaiting triage. Nice work.' : 'No messages match this filter.'}
          </div>
        ) : (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
            {/* Header row (admin only) */}
            {isAdmin && (category === 'all' || category === 'unattended') && (
              <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>Select all on this page</span>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={m.id}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
                  display: 'grid',
                  gridTemplateColumns: isAdmin && (category === 'all' || category === 'unattended') ? '36px 1fr auto' : '1fr auto',
                  alignItems: 'center',
                  background: selected.has(m.id) ? '#f5f3ff' : '#fff',
                  transition: 'background 0.1s',
                }}
              >
                {/* Checkbox (admin) */}
                {isAdmin && (category === 'all' || category === 'unattended') && (
                  <div style={{ padding: '12px 0 12px 16px', display: 'flex', alignItems: 'center' }}>
                    {m.status === 'received' ? (
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggleSelect(m.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer' }}
                      />
                    ) : <span />}
                  </div>
                )}

                {/* Main row content — clickable to triage detail */}
                <Link
                  href={`/communications/triage/${m.id}`}
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: '12px 16px' }}
                  onClick={(e) => { if (selected.size > 0 && isAdmin) e.preventDefault(); }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 500 }}>
                      {m.subject || '(no subject)'}
                    </span>
                    {m.active_tag && <TagBadge tag={m.active_tag} />}
                  </div>
                  {/* Sender email + company */}
                  <div style={{ fontSize: 12, color: '#374151', marginTop: 3, fontWeight: 500 }}>
                    {m.from_address}
                    {m.from_display && m.from_display !== m.from_address && (
                      <span style={{ color: '#9ca3af', fontWeight: 400 }}> ({m.from_display})</span>
                    )}
                    <span style={{ color: '#d1d5db', margin: '0 6px' }}>·</span>
                    <span style={{ color: '#9ca3af', fontWeight: 400 }}>{m.company}</span>
                    {m.attachments_count > 0 && (
                      <span style={{ marginLeft: 8 }}>📎 {m.attachments_count}</span>
                    )}
                  </div>
                </Link>

                {/* Right: action label + full timestamp */}
                <div style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <ActionBadge status={m.status} tag={m.active_tag} />
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTs(m.received_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > limit && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0 || busy} style={btnStyle('secondary', offset === 0 || busy)}>← Prev</button>
            <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total || busy} style={btnStyle('secondary', offset + limit >= total || busy)}>Next →</button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────

// Renders the assigned workflow_tag (e.g. "Intimation", "Policy Doc") as a
// compact pill so clerks can see at a glance what each row was categorised
// as. Color follows the tag group: purple for extraction-required tags,
// blue for non-extraction tags. Unknown tags fall back to slate.
function TagBadge({ tag }) {
  if (!tag) return null;
  const label = TAG_COMPACT_LABEL[tag] || TAG_LABEL_BY_KEY.get(tag) || tag;
  let bg = '#f1f5f9';
  let fg = '#475569';
  if (EXTRACTION_TAG_SET.has(tag)) {
    bg = '#ede9fe';
    fg = '#5b21b6';
  } else if (NON_EXTRACTION_TAG_SET.has(tag)) {
    bg = '#dbeafe';
    fg = '#1e40af';
  }
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        background: bg,
        color: fg,
        padding: '1px 6px',
        borderRadius: 999,
        letterSpacing: 0.2,
      }}
      title={`Categorised as: ${label}`}
    >
      {label}
    </span>
  );
}

// Renders an action-oriented label per row. The badge reflects what
// has happened to the message rather than the raw inbox_messages.status.
function ActionBadge({ status, tag }) {
  let style = { bg: '#f1f5f9', fg: '#475569', label: status || '—' };

  if (status === 'received') {
    style = { bg: '#fffbeb', fg: '#92400e', label: 'Unattended' };
  } else if (status === 'dismissed') {
    style = { bg: '#f1f5f9', fg: '#475569', label: 'Dismissed' };
  } else if (status === 'auto_routed') {
    style = { bg: '#ecfdf5', fg: '#065f46', label: 'Auto-Routed' };
  } else if (status === 'classifying' || status === 'pending_review') {
    if (tag && EXTRACTION_TAG_SET.has(tag)) {
      style = { bg: '#ede9fe', fg: '#5b21b6', label: 'Categorised — Extraction' };
    } else if (tag && NON_EXTRACTION_TAG_SET.has(tag)) {
      style = { bg: '#dbeafe', fg: '#1e40af', label: 'Categorised — Non Extraction' };
    } else {
      style = { bg: '#dbeafe', fg: '#1e40af', label: 'Processing…' };
    }
  } else if (status === 'rejected' || status === 'error') {
    style = { bg: '#fef2f2', fg: '#991b1b', label: status === 'rejected' ? 'Rejected' : 'Error' };
  }

  return (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: style.fg, background: style.bg, padding: '2px 8px', borderRadius: 999 }}>
      {style.label}
    </span>
  );
}

function Banner({ kind, children }) {
  const c = { ok: ['#ecfdf5', '#065f46', '#a7f3d0'], warn: ['#fffbeb', '#92400e', '#fde68a'], err: ['#fef2f2', '#991b1b', '#fecaca'] }[kind] || ['#fffbeb', '#92400e', '#fde68a'];
  return (
    <div style={{ background: c[0], color: c[1], border: `1px solid ${c[2]}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function formatTs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

// ── Styles ─────────────────────────────────────────────────────

const labelStyle = { fontSize: 13, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 6 };
const selectStyle = { padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' };
const inputStyle = { flex: '1 1 220px', minWidth: 200, maxWidth: 360, padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 };
const emptyBoxStyle = { background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 8, padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 };

function btnStyle(variant, disabled) {
  const base = { padding: '6px 12px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
  if (variant === 'primary') return { ...base, background: '#1e3a5f', color: '#fff' };
  if (variant === 'danger')  return { ...base, background: '#b91c1c', color: '#fff' };
  return { ...base, background: '#f1f5f9', color: '#0f172a' };
}
