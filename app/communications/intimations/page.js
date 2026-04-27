'use client';

// ============================================================
// /communications/intimations
// ------------------------------------------------------------
// List of claims currently at phase='intimation' — auto-created
// by the comms pipeline from inbound intimation emails, but not
// yet formally registered. Each row has a Register button that
// flips the claim to phase='registered'.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

export default function IntimationsPage() {
  const router = useRouter();
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

  if (loading) return <PageLayout><div style={{ padding: 24 }}>Loading…</div></PageLayout>;
  if (!user) return null;

  const claims = data?.claims || [];

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>Intimations — Pending Registration</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/communications/dashboard" style={navLinkStyle}>Dashboard →</Link>
            <Link href="/communications/triage" style={navLinkStyle}>Triage queue →</Link>
          </div>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 13, color: '#64748b', maxWidth: 720 }}>
          These claims were auto-created from inbound intimation emails. Review the details, then click <strong>Register</strong> to formally register the claim — that moves it from the Intimation phase to the Registration phase.
        </p>

        {error && <Banner kind="err">{error}</Banner>}

        {busy && !data && <div style={{ padding: 24, color: '#94a3b8' }}>Loading intimations…</div>}

        {claims.length === 0 ? (
          <div style={emptyBoxStyle}>
            No claims are currently in the Intimation phase. Nice work — everything is registered.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Intake Ref</th>
                  <th style={thStyle}>Insured / From</th>
                  <th style={thStyle}>Policy #</th>
                  <th style={thStyle}>Company Ref #</th>
                  <th style={thStyle}>LOB</th>
                  <th style={thStyle}>DOL</th>
                  <th style={thStyle}>Loss Location</th>
                  <th style={thStyle}>Needs</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => {
                  const e = edits[c.id] || {};
                  // Helper that returns the current edit value if set,
                  // otherwise the value from the server.
                  const v = (field) => (e[field] !== undefined ? e[field] : (c[field] ?? ''));
                  const dirty = Object.keys(e).length > 0;
                  const isSaving = savingId === c.id;
                  return (
                    <tr key={c.id}>
                      <td style={tdStyle}>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                          {c.ref_number || 'Pending'}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {fmtDateTime(c.intake_received_at || c.created_at)}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={v('insured_name')}
                          onChange={(ev) => patchEdit(c.id, 'insured_name', ev.target.value)}
                          placeholder={c.intake_email_from ? `From: ${c.intake_email_from}` : 'Insured name'}
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={v('policy_number')}
                          onChange={(ev) => patchEdit(c.id, 'policy_number', ev.target.value)}
                          placeholder="—"
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={v('claim_number')}
                          onChange={(ev) => patchEdit(c.id, 'claim_number', ev.target.value)}
                          placeholder="—"
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <select
                          value={v('lob')}
                          onChange={(ev) => patchEdit(c.id, 'lob', ev.target.value)}
                          style={inputStyle}
                        >
                          <option value="">—</option>
                          {LOB_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="date"
                          value={v('date_loss') ? String(v('date_loss')).slice(0, 10) : ''}
                          onChange={(ev) => patchEdit(c.id, 'date_loss', ev.target.value || null)}
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={v('loss_location')}
                          onChange={(ev) => patchEdit(c.id, 'loss_location', ev.target.value)}
                          placeholder="—"
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <MissingFieldChips fields={c.missing_fields || []} />
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <button
                            onClick={() => saveRow(c)}
                            disabled={!dirty || isSaving}
                            style={{ ...btnStyle('secondary', !dirty || isSaving), whiteSpace: 'nowrap' }}
                          >
                            {isSaving ? 'Saving…' : 'Save inline'}
                          </button>
                          <Link
                            href={`/claims/${encodeURIComponent(resolveLob(c.lob))}?editId=${encodeURIComponent(c.id)}&from=intimation`}
                            style={{
                              ...btnStyle('primary', false),
                              textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap',
                            }}
                          >
                            Register →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// LOB options shown in the inline dropdown. Mirrors the canonical
// LOB names used elsewhere in the portal (must match the keys the
// claims page knows how to render in the Edit Claim form).
const LOB_OPTIONS = [
  'Motor', 'Marine Cargo', 'Fire', 'Engineering',
  'Business Interruption', 'Liability', 'Miscellaneous',
];

const inputStyle = {
  width: '100%', padding: '5px 7px', fontSize: 12,
  border: '1px solid #e2e8f0', borderRadius: 4,
  background: '#fff', boxSizing: 'border-box',
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
