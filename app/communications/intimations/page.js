'use client';

// ============================================================
// /communications/intimations
// ------------------------------------------------------------
// List of claims currently at phase='intimation' — auto-created
// by the comms pipeline from inbound intimation emails, but not
// yet formally registered. Each row has a Register button that
// flips the claim to phase='registered'.
// ============================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { isPlaceholderRef } from '@/lib/refNumber';

export default function IntimationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams?.get('highlight') || null;
  const justApproved = searchParams?.get('just_approved') === '1';
  const highlightRef = useRef(null);
  const { user, loading } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Per-row edits and saving state. Keyed by claim id. Edits are
  // local until the user hits Save on that row, then PUT'd.
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);

  function patchEdit(id, field, value) {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  }

  async function saveRow(claim) {
    const patch = edits[claim.id];
    if (!patch || Object.keys(patch).length === 0) return;
    if (patch.ref_number && isPlaceholderRef(patch.ref_number)) {
      setError('Ref # cannot start with INTAKE/ — type a real surveyor reference or click Auto-generate.');
      return;
    }
    setSavingId(claim.id);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claim.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-app-user-email': user.email },
        // Important: explicitly preserve phase='intimation' here.
        // The PUT route auto-flips intimation → registered when phase
        // is undefined; for inline edits we want the row to stay on
        // this page, so we send phase explicitly.
        body: JSON.stringify({ ...patch, phase: 'intimation' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEdits((prev) => { const n = { ...prev }; delete n[claim.id]; return n; });
      await load();
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  }

  // Hits /api/tentative-ref/<lob> — read-only preview of the next
  // available ref number for that LOB. The counter doesn't bump until
  // the user clicks Save changes (and the PUT promotes the placeholder).
  async function autoGenerateRef(claim) {
    const lob = (edits[claim.id]?.lob ?? claim.lob ?? '').trim();
    if (!lob) {
      setError('Set LOB before auto-generating Ref #.');
      return;
    }
    setError(null);
    try {
      const qs = claim.client_category
        ? `?client_category=${encodeURIComponent(claim.client_category)}`
        : '';
      const res = await fetch(`/api/tentative-ref/${encodeURIComponent(lob)}${qs}`, {
        headers: { 'x-app-user-email': user.email },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.tentative_ref) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      patchEdit(claim.id, 'ref_number', json.tentative_ref);
    } catch (err) {
      setError(`Auto-generate failed: ${err.message}`);
    }
  }

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/claims/intimations', {
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
  }, [user?.email]);

  useEffect(() => { load(); }, [load]);

  // Per-row discard state for MANUAL/ drafts. Keyed by claim id so the
  // user can see which row is being discarded, and a confirm dialog gates
  // the destructive call.
  const [discardingId, setDiscardingId] = useState(null);

  async function discardManualDraft(claim) {
    const ref = claim.ref_number || '';
    if (!ref.startsWith('MANUAL/')) return; // belt-and-braces — UI only shows the button on MANUAL/
    if (claim.phase && claim.phase !== 'intimation') return;
    const ok = window.confirm(
      `Discard this manual draft?\n\n${ref}\n\nThis cannot be undone — the claim shell, any uploaded documents, and the AI extraction for it will be deleted.`
    );
    if (!ok) return;
    setDiscardingId(claim.id);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/discard-draft`, {
        method: 'DELETE',
        headers: { 'x-app-user-email': user.email },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(`Discard failed: ${err.message}`);
    } finally {
      setDiscardingId(null);
    }
  }

  // Creates a manual claim shell (ref_number='MANUAL/<co>/<8-char-uuid>',
  // phase='intimation', no intake_message_id) and redirects to the
  // registration page where the clerk uploads documents + submits.
  const [creatingManual, setCreatingManual] = useState(false);
  async function createManualClaim() {
    if (creatingManual) return;
    setCreatingManual(true);
    setError(null);
    try {
      const res = await fetch('/api/claims/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-user-email': user.email,
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json?.id) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      router.push(`/claim-registration/${encodeURIComponent(json.id)}`);
    } catch (err) {
      setError(`Could not create manual claim: ${err.message}`);
      setCreatingManual(false);
    }
  }

  // Scroll to + flash the highlighted row when arriving from review queue.
  useEffect(() => {
    if (!highlightId) return;
    if (!data?.claims?.some((c) => String(c.id) === String(highlightId))) return;
    const el = highlightRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, data]);

  if (loading) return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  if (!user) return null;

  const claims = data?.claims || [];

  // Per-LOB breakdown (Item 4) — counts pending registration per LOB.
  const byLob = claims.reduce((acc, c) => {
    const k = c.lob || '(no LOB)';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>Intimations — Pending Registration</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link href="/communications/dashboard" style={navLinkStyle}>Dashboard →</Link>
            <Link href="/communications/triage" style={navLinkStyle}>Triage queue →</Link>
            <button
              type="button"
              onClick={createManualClaim}
              disabled={creatingManual}
              title="Start a fresh registration for a claim that didn't come in by email"
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 700,
                border: 'none', borderRadius: 6,
                background: creatingManual ? '#cbd5e1' : '#1e3a5f',
                color: '#fff',
                cursor: creatingManual ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {creatingManual ? 'Creating…' : '+ New Manual Claim'}
            </button>
          </div>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 13, color: '#64748b', maxWidth: 720 }}>
          These claims were auto-created from inbound intimation emails. Review the details, then click <strong>Register</strong> to formally register the claim — that moves it from the Intimation phase to the Registration phase.
        </p>

        {/* Just-approved banner — shown once arriving from review queue. */}
        {justApproved && highlightId && claims.some((c) => String(c.id) === String(highlightId)) && (
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            <strong>✓ Approved.</strong> The intimation has been approved and the claim shell is now in the queue below. Click <strong>Register Claim →</strong> on that row to complete registration.
          </div>
        )}

        {/* Count summary — total + per-LOB chips. Item 4. */}
        {claims.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>
              {claims.length} pending registration
            </span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>·</span>
            {Object.entries(byLob).sort((a, b) => b[1] - a[1]).map(([lob, count]) => (
              <span key={lob} style={{ fontSize: 11, fontWeight: 600, background: '#fff', color: '#92400e', padding: '2px 8px', borderRadius: 999, border: '1px solid #fde68a' }}>
                {lob}: {count}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#92400e' }}>
              <em>Once a claim is intimated it stays here until registered.</em>
            </span>
          </div>
        )}

        {error && <Banner kind="err">{error}</Banner>}

        {busy && !data && <div style={{ padding: 24, color: '#94a3b8' }}>Loading intimations…</div>}

        {claims.length === 0 ? (
          <div style={emptyBoxStyle}>
            No claims are currently in the Intimation phase. Nice work — everything is registered.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {claims.map((c) => {
              const e = edits[c.id] || {};
              // For ref_number we deliberately blank the input when the
              // saved value is still an INTAKE/ placeholder — the clerk
              // should type or auto-generate, not edit the placeholder.
              const v = (field) => {
                if (e[field] !== undefined) return e[field];
                if (field === 'ref_number' && isPlaceholderRef(c.ref_number)) return '';
                return c[field] ?? '';
              };
              const refIsPlaceholder = isPlaceholderRef(c.ref_number);
              const effectiveLob = e.lob ?? c.lob ?? '';
              const dirty = Object.keys(e).length > 0;
              const isSaving = savingId === c.id;
              const isHighlighted = String(c.id) === String(highlightId);
              return (
                <div
                  key={c.id}
                  ref={isHighlighted ? highlightRef : null}
                  style={{
                    ...cardStyle,
                    border: isHighlighted ? '2px solid #f59e0b' : cardStyle.border,
                    boxShadow: isHighlighted ? '0 0 0 4px rgba(245, 158, 11, 0.25)' : cardStyle.boxShadow,
                  }}
                >
                  {/* Header: caption switches from "Intake Ref" → "Ref"
                      once the placeholder is replaced with a real value. */}
                  <div style={cardHeaderStyle}>
                    <div>
                      <div style={miniLabelStyle}>{refIsPlaceholder ? 'Intake Ref' : 'Ref'}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 14, color: refIsPlaceholder ? '#78350f' : '#0f172a', fontWeight: 600 }}>
                        {c.ref_number || 'Pending'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={miniLabelStyle}>Received</div>
                      <div style={{ fontSize: 13, color: '#0f172a' }}>{fmtDateTime(c.intake_received_at || c.created_at)}</div>
                      {c.intake_email_from && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>From: {c.intake_email_from}</div>
                      )}
                    </div>
                  </div>

                  {/* Field grid: full-width inputs in 2 columns. */}
                  <div style={fieldGridStyle}>
                    <Field label="Insured Name">
                      <input
                        value={v('insured_name')}
                        onChange={(ev) => patchEdit(c.id, 'insured_name', ev.target.value)}
                        placeholder="Insured / company name"
                        style={fullInputStyle}
                      />
                    </Field>
                    <Field label="Policy Number">
                      <input
                        value={v('policy_number')}
                        onChange={(ev) => patchEdit(c.id, 'policy_number', ev.target.value)}
                        placeholder="Policy number"
                        style={fullInputStyle}
                      />
                    </Field>
                    <Field label="Company's Reference Number">
                      <input
                        value={v('claim_number')}
                        onChange={(ev) => patchEdit(c.id, 'claim_number', ev.target.value)}
                        placeholder="Insurer / broker / client reference"
                        style={fullInputStyle}
                      />
                    </Field>
                    <Field label="LOB">
                      <select
                        value={v('lob')}
                        onChange={(ev) => patchEdit(c.id, 'lob', ev.target.value)}
                        style={fullInputStyle}
                      >
                        <option value="">— Select LOB —</option>
                        {LOB_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Date of Loss">
                      <input
                        type="date"
                        value={v('date_loss') ? String(v('date_loss')).slice(0, 10) : ''}
                        onChange={(ev) => patchEdit(c.id, 'date_loss', ev.target.value || null)}
                        style={fullInputStyle}
                      />
                    </Field>
                    <Field label="Loss Location">
                      <input
                        value={v('loss_location')}
                        onChange={(ev) => patchEdit(c.id, 'loss_location', ev.target.value)}
                        placeholder="City, area, full address"
                        style={fullInputStyle}
                      />
                    </Field>
                    <Field label="Ref #">
                      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                        <input
                          value={v('ref_number')}
                          onChange={(ev) => patchEdit(c.id, 'ref_number', ev.target.value)}
                          placeholder="e.g. 4053/26-27/Marine Cargo"
                          style={{ ...fullInputStyle, flex: 1 }}
                        />
                        <button
                          type="button"
                          onClick={() => autoGenerateRef(c)}
                          disabled={!effectiveLob}
                          title={effectiveLob ? `Generate next available ref for ${effectiveLob}` : 'Pick LOB first'}
                          style={{ ...btnStyle('secondary', !effectiveLob), padding: '7px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
                        >
                          Auto-generate
                        </button>
                      </div>
                    </Field>
                  </div>

                  {/* Footer: needs chips + action buttons */}
                  <div style={cardFooterStyle}>
                    <div>
                      <div style={miniLabelStyle}>Needs</div>
                      <MissingFieldChips fields={c.missing_fields || []} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => saveRow(c)}
                        disabled={!dirty || isSaving}
                        style={{ ...btnStyle('secondary', !dirty || isSaving), padding: '8px 14px' }}
                      >
                        {isSaving ? 'Saving…' : 'Save changes'}
                      </button>
                      <Link
                        href={`/claim-registration/${encodeURIComponent(c.id)}`}
                        style={{ ...btnStyle('primary', false), padding: '8px 14px', textDecoration: 'none', display: 'inline-block' }}
                      >
                        Register Claim →
                      </Link>
                      <Link
                        href={`/claims/${encodeURIComponent(resolveLob(c.lob))}?editId=${encodeURIComponent(c.id)}&from=intimation`}
                        style={{ ...btnStyle('secondary', false), padding: '8px 14px', textDecoration: 'none', display: 'inline-block', fontSize: 12 }}
                        title="Legacy single-column form"
                      >
                        Legacy form
                      </Link>
                      {/* Discard — only shown for MANUAL/ drafts. INTAKE/
                          placeholders trace back to a real email and shouldn't
                          be deleted from this page. */}
                      {String(c.ref_number || '').startsWith('MANUAL/') && (
                        <button
                          type="button"
                          onClick={() => discardManualDraft(c)}
                          disabled={discardingId === c.id}
                          title="Delete this empty manual draft. Cannot be undone."
                          style={{
                            ...btnStyle('secondary', discardingId === c.id),
                            padding: '8px 14px',
                            fontSize: 12,
                            color: discardingId === c.id ? '#94a3b8' : '#b91c1c',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                          }}
                        >
                          {discardingId === c.id ? 'Discarding…' : 'Discard draft'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// LOB options shown in the dropdown. Mirrors the canonical LOB
// names used elsewhere in the portal.
const LOB_OPTIONS = [
  'Motor', 'Marine Cargo', 'Fire', 'Engineering',
  'Business Interruption', 'Liability', 'Miscellaneous',
];

// Card layout helpers (the page uses one card per intimation rather
// than a cramped table — fields need full-width readable inputs).
function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={miniLabelStyle}>{label}</label>
      {children}
    </div>
  );
}

const cardStyle = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
  padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
};
const cardHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  paddingBottom: 12, borderBottom: '1px solid #f1f5f9', gap: 16,
};
const cardFooterStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  paddingTop: 10, borderTop: '1px solid #f1f5f9', gap: 16, flexWrap: 'wrap',
};
const fieldGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12,
};
const miniLabelStyle = {
  fontSize: 10, color: '#475569', fontWeight: 700,
  letterSpacing: 0.5, textTransform: 'uppercase',
};
const fullInputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 6,
  background: '#fff', boxSizing: 'border-box', color: '#0f172a',
};

// Field-name → human-readable label for the "Needs" column. Keeps the
// chip list short and recognisable.
const FIELD_LABEL = {
  insured_name: 'Insured',
  policy_number: 'Policy #',
  claim_number: 'Company Ref',
  date_loss: 'Date of loss',
  loss_location: 'Location',
  ref_number: 'Ref #',
};
function MissingFieldChips({ fields }) {
  if (!fields || fields.length === 0) {
    return <span style={{ color: '#15803d', fontSize: 11, fontWeight: 600 }}>Complete ✓</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {fields.map((f) => (
        <span key={f} style={{
          background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 600,
          padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
        }}>
          {FIELD_LABEL[f] || f}
        </span>
      ))}
    </div>
  );
}

const fadedStyle = { color: '#cbd5e1' };

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

// Map the LOB hint stored on the claim row (often a lower-cased
// extraction value like "motor" or "general") to one of the LOB
// folders the claims page knows how to render. The claims page
// expects display-cased names that match the LOB picker.
const LOB_LOOKUP = {
  motor: 'Motor', mc: 'Motor', vehicle: 'Motor',
  marine: 'Marine Cargo', 'marine cargo': 'Marine Cargo',
  fire: 'Fire',
  engineering: 'Engineering', engg: 'Engineering',
  miscellaneous: 'Miscellaneous', misc: 'Miscellaneous',
  bi: 'Business Interruption', 'business interruption': 'Business Interruption',
  liability: 'Liability',
  general: 'Miscellaneous',
};
function resolveLob(raw) {
  if (!raw) return 'Miscellaneous';
  const key = String(raw).trim().toLowerCase();
  return LOB_LOOKUP[key] || raw; // fall back to the original string if no mapping
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

const navLinkStyle = { fontSize: 13, color: '#7c3aed', fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none' };
const emptyBoxStyle = { background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 8, padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 };

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = { textAlign: 'left', padding: '10px 14px', background: '#f8fafc', color: '#475569', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' };
const tdStyle = { padding: '10px 14px', borderTop: '1px solid #f1f5f9', color: '#0f172a', verticalAlign: 'top' };

function btnStyle(variant, disabled) {
  const base = { padding: '5px 12px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
  return variant === 'primary'
    ? { ...base, background: '#1e3a5f', color: '#fff' }
    : { ...base, background: '#f1f5f9', color: '#0f172a' };
}
