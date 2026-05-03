'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const AUTOSAVE_DEBOUNCE_MS = 1500;

const ADMISSIBILITY_OPTIONS = [
  { value: '', label: '— Pick admissibility —' },
  { value: 'admissible', label: 'Admissible (prima facie covered)' },
  { value: 'admissible_with_conditions', label: 'Admissible with conditions' },
  { value: 'needs_investigation', label: 'Needs investigation' },
  { value: 'likely_non_admissible', label: 'Likely non-admissible' },
  { value: 'non_admissible', label: 'Non-admissible' },
];

const PRIORITY_BG = {
  high: { bg: '#fee2e2', color: '#b91c1c' },
  medium: { bg: '#fef3c7', color: '#b45309' },
  low: { bg: '#e0f2fe', color: '#0c4a6e' },
};

export default function IlaDraftingPage({ params }) {
  const router = useRouter();
  const { user } = useAuth();
  const claimId = params.claimId;

  const [claim, setClaim] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState(null);
  const [submittedTo, setSubmittedTo] = useState('');
  const [breachReason, setBreachReason] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [tat, setTat] = useState(null);
  const lastSavedRef = useRef(null);
  const saveTimerRef = useRef(null);

  useEffect(() => { loadAll(); }, [claimId]);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Live TAT countdown — refreshes every 30 s.
  useEffect(() => {
    if (!claim?.ila_due_at) return;
    const tick = () => setTat(computeTat(claim.ila_due_at));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [claim?.ila_due_at]);

  async function loadAll() {
    try {
      setLoading(true);
      const [claimRes, draftsRes] = await Promise.all([
        fetch(`/api/claims/${claimId}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/claims/${claimId}/ila-drafts`).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      setClaim(claimRes);

      // Pick the latest non-superseded draft, or create one if none exists.
      let active = (draftsRes || []).find(d => d.status === 'draft' || d.status === 'under_review');
      if (!active && (draftsRes || []).length === 0) {
        const res = await fetch(`/api/claims/${claimId}/ila-drafts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ created_by: user?.email || null, drafted_by: 'human' }),
        });
        if (res.ok) active = await res.json();
      } else if (!active) {
        active = (draftsRes || [])[0]; // fall back to most recent (likely approved)
      }
      setDraft(active || null);
      lastSavedRef.current = active || null;

      // Default the signer to the lead surveyor on this claim.
      if (claimRes?.assigned_surveyor) setSignerEmail(claimRes.assigned_surveyor);

      // Default email-to-insurer to the dealing officer if known.
      if (claimRes?.dealing_officer_email) setSubmittedTo(claimRes.dealing_officer_email);
    } catch (e) {
      showAlert('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 6000);
  }

  const queueSave = useCallback((next) => {
    clearTimeout(saveTimerRef.current);
    setSaveStatus('pending');
    saveTimerRef.current = setTimeout(() => doSave(next), AUTOSAVE_DEBOUNCE_MS);
  }, []);

  async function doSave(snapshot) {
    if (!snapshot?.id) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/ila-drafts/${snapshot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preliminary_view: snapshot.preliminary_view,
          admissibility_opinion: snapshot.admissibility_opinion,
          admissibility_reasoning: snapshot.admissibility_reasoning,
          preliminary_estimate: snapshot.preliminary_estimate,
          estimate_basis: snapshot.estimate_basis,
          documents_required: snapshot.documents_required,
          next_steps: snapshot.next_steps,
          expected_fsr_date: snapshot.expected_fsr_date,
          observations: snapshot.observations,
          updated_by: user?.email || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      lastSavedRef.current = snapshot;
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  function setField(key, value) {
    setDraft(prev => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      queueSave(next);
      return next;
    });
  }

  function updateChecklistItem(idx, patch) {
    setDraft(prev => {
      if (!prev) return prev;
      const items = [...(prev.documents_required || [])];
      items[idx] = { ...items[idx], ...patch };
      const next = { ...prev, documents_required: items };
      queueSave(next);
      return next;
    });
  }

  function addChecklistItem() {
    setDraft(prev => {
      if (!prev) return prev;
      const items = [...(prev.documents_required || [])];
      items.push({ type: '', reason: '', priority: 'medium', status: 'pending' });
      const next = { ...prev, documents_required: items };
      queueSave(next);
      return next;
    });
  }

  function removeChecklistItem(idx) {
    setDraft(prev => {
      if (!prev) return prev;
      const items = [...(prev.documents_required || [])];
      items.splice(idx, 1);
      const next = { ...prev, documents_required: items };
      queueSave(next);
      return next;
    });
  }

  async function submit() {
    if (!draft || submitting) return;
    if (!signerEmail) {
      showAlert('Pick a signer (lead surveyor email)', 'error');
      return;
    }
    if (tat?.severity === 'breach' && !breachReason.trim()) {
      showAlert('TAT is breached — please enter a breach reason before submitting', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/ila-drafts/${draft.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_email: signerEmail,
          submitted_to_email: submittedTo || null,
          tat_breach_reason: breachReason || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Submit failed: ${JSON.stringify(data)}`);
      }
      showAlert(`ILA submitted (TAT ${data.tat?.compliant ? 'compliant' : 'breached'}, PDF ${data.pdf?.storage_path ? 'rendered' : 'pending'})`, 'success');
      setTimeout(() => router.push(`/claim-detail/${claimId}`), 1200);
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="main-content"><div className="loading">Loading ILA editor…</div></div>
      </PageLayout>
    );
  }

  if (!draft) {
    return (
      <PageLayout>
        <div className="main-content">
          <h2>ILA</h2>
          <p style={{ color: '#94a3b8' }}>No draft available for this claim.</p>
        </div>
      </PageLayout>
    );
  }

  const submittable = draft.status !== 'approved' && draft.status !== 'superseded';

  return (
    <PageLayout>
      <div className="main-content" style={{ maxWidth: 1200, margin: '0 auto' }}>
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>ILA · {claim?.ref_number || `Claim #${claimId}`}</h2>
            <p style={{ color: '#475569', fontSize: 13, margin: '4px 0 0' }}>
              v{draft.version} · {draft.status} · {claim?.insured_name || ''} · {claim?.lob || ''}
            </p>
          </div>
          {tat && <TatBadge tat={tat} />}
          <SaveBadge status={saveStatus} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16, marginTop: 16, alignItems: 'start' }}>
          <div style={paneStyle}>
            <Section title="1. Preliminary view of the loss" required>
              <textarea
                rows={4}
                value={draft.preliminary_view || ''}
                onChange={e => setField('preliminary_view', e.target.value)}
                style={inputStyle}
                placeholder="Cause of loss appears to be... insured states..."
              />
            </Section>

            <Section title="2. Admissibility" required>
              <select
                value={draft.admissibility_opinion || ''}
                onChange={e => setField('admissibility_opinion', e.target.value || null)}
                style={inputStyle}
              >
                {ADMISSIBILITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <textarea
                rows={3}
                value={draft.admissibility_reasoning || ''}
                onChange={e => setField('admissibility_reasoning', e.target.value)}
                style={{ ...inputStyle, marginTop: 8 }}
                placeholder="Reasoning…"
              />
            </Section>

            <Section title="3. Preliminary estimate">
              <input
                type="number"
                min="0"
                value={draft.preliminary_estimate ?? ''}
                onChange={e => setField('preliminary_estimate', e.target.value === '' ? null : Number(e.target.value))}
                style={inputStyle}
                placeholder="₹ amount"
              />
              <textarea
                rows={2}
                value={draft.estimate_basis || ''}
                onChange={e => setField('estimate_basis', e.target.value)}
                style={{ ...inputStyle, marginTop: 8 }}
                placeholder="Basis: e.g. insured's statement and visible damage"
              />
            </Section>

            <Section title="4. Documents required" required>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(draft.documents_required || []).map((item, idx) => (
                  <ChecklistRow
                    key={idx}
                    item={item}
                    onChange={(patch) => updateChecklistItem(idx, patch)}
                    onRemove={() => removeChecklistItem(idx)}
                  />
                ))}
              </div>
              <button className="secondary" onClick={addChecklistItem} style={{ marginTop: 8 }}>+ Add document</button>
            </Section>

            <Section title="5. Next steps" required>
              <textarea
                rows={3}
                value={draft.next_steps || ''}
                onChange={e => setField('next_steps', e.target.value)}
                style={inputStyle}
                placeholder="Schedule site inspection, request documents..."
              />
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 12, color: '#475569' }}>Expected FSR submission date *</label>
                <input
                  type="date"
                  value={draft.expected_fsr_date || ''}
                  onChange={e => setField('expected_fsr_date', e.target.value || null)}
                  style={inputStyle}
                />
              </div>
            </Section>

            <Section title="6. Other observations">
              <textarea
                rows={3}
                value={draft.observations || ''}
                onChange={e => setField('observations', e.target.value)}
                style={inputStyle}
                placeholder="Any other observations to flag at intimation stage…"
              />
            </Section>
          </div>

          <div style={paneStyle}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1e40af' }}>Submission</h4>

            <Field label="Signer (lead surveyor email) *">
              <input
                type="email"
                value={signerEmail}
                onChange={e => setSignerEmail(e.target.value)}
                placeholder="surveyor@nisla.in"
                style={inputStyle}
              />
              <p style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                Must match a row in <strong>surveyors</strong> with a valid IRDAI license.
              </p>
            </Field>

            <Field label="Submit to (insurer email)">
              <input
                type="email"
                value={submittedTo}
                onChange={e => setSubmittedTo(e.target.value)}
                placeholder="dealing-officer@insurer.com"
                style={inputStyle}
              />
              <p style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                Optional. If set, an email is queued via <code>notification_queue</code>.
              </p>
            </Field>

            {tat?.severity === 'breach' && (
              <Field label="TAT breach reason *">
                <textarea
                  rows={2}
                  value={breachReason}
                  onChange={e => setBreachReason(e.target.value)}
                  placeholder="e.g. insurer delayed sharing intimation till day 4"
                  style={inputStyle}
                />
              </Field>
            )}

            <button
              className="success"
              style={{ width: '100%', marginTop: 12 }}
              onClick={submit}
              disabled={submitting || !submittable || !signerEmail || (tat?.severity === 'breach' && !breachReason.trim())}
            >
              {submitting ? 'Submitting…' : (submittable ? 'Submit ILA' : `Already ${draft.status}`)}
            </button>
            <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
              Submission renders the ILA to PDF, files it under the claim folder, marks the draft approved (immutable), and queues the email to the insurer.
            </p>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

function Section({ title, required, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#1e40af', borderBottom: '1px solid #e2e8f0', paddingBottom: 3 }}>
        {title} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </h4>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function ChecklistRow({ item, onChange, onRemove }) {
  const cfg = PRIORITY_BG[item.priority] || PRIORITY_BG.medium;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 0.7fr auto', gap: 6, alignItems: 'center' }}>
      <input
        value={item.type || ''}
        onChange={e => onChange({ type: e.target.value })}
        placeholder="Document type"
        style={{ ...inputStyle, fontSize: 12 }}
      />
      <input
        value={item.reason || ''}
        onChange={e => onChange({ reason: e.target.value })}
        placeholder="Reason / what it proves"
        style={{ ...inputStyle, fontSize: 12 }}
      />
      <select
        value={item.priority || 'medium'}
        onChange={e => onChange({ priority: e.target.value })}
        style={{ ...inputStyle, fontSize: 12, background: cfg.bg, color: cfg.color }}
      >
        <option value="high">high</option>
        <option value="medium">medium</option>
        <option value="low">low</option>
      </select>
      <select
        value={item.status || 'pending'}
        onChange={e => onChange({ status: e.target.value })}
        style={{ ...inputStyle, fontSize: 12 }}
      >
        <option value="pending">pending</option>
        <option value="received">received</option>
        <option value="waived">waived</option>
      </select>
      <button className="danger" onClick={onRemove} style={{ fontSize: 11, padding: '4px 8px' }}>✕</button>
    </div>
  );
}

function TatBadge({ tat }) {
  const cfg = {
    green: { bg: '#dcfce7', color: '#15803d' },
    amber: { bg: '#fef3c7', color: '#b45309' },
    red: { bg: '#fee2e2', color: '#b91c1c' },
    breach: { bg: '#fee2e2', color: '#7f1d1d' },
  }[tat.severity] || { bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{
      padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      ILA TAT: {tat.label}
    </span>
  );
}

function SaveBadge({ status }) {
  const cfg = {
    idle: { label: 'No changes', color: '#94a3b8' },
    pending: { label: 'Saving soon…', color: '#3b82f6' },
    saving: { label: 'Saving…', color: '#3b82f6' },
    saved: { label: '✓ Saved', color: '#15803d' },
    error: { label: '⚠ Save failed', color: '#dc2626' },
  }[status] || { label: status, color: '#475569' };
  return <span style={{ fontSize: 12, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>;
}

const paneStyle = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, fontSize: 13 };
const inputStyle = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', marginTop: 2,
};

// Inline duplicate of lib/ila/index.js tatCountdown — keeps the page client-only
// without pulling in extra modules. The countdown logic is simple enough.
function computeTat(ilaDueAt) {
  if (!ilaDueAt) return null;
  const due = new Date(ilaDueAt);
  if (Number.isNaN(due.getTime())) return null;
  const ms = due.getTime() - Date.now();
  const hours = ms / 3_600_000;
  const fmt = (m) => {
    const abs = Math.abs(m);
    const h = Math.floor(abs / 3_600_000);
    const min = Math.floor((abs % 3_600_000) / 60_000);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      return `${d}d ${h % 24}h`;
    }
    return `${h}h ${min}m`;
  };
  if (ms < 0) return { severity: 'breach', label: `OVERDUE by ${fmt(ms)}` };
  if (hours <= 6) return { severity: 'red', label: `${fmt(ms)} left (URGENT)` };
  if (hours <= 24) return { severity: 'amber', label: `${fmt(ms)} left` };
  return { severity: 'green', label: `${fmt(ms)} left` };
}
