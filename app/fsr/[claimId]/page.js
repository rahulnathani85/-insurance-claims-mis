'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const AUTOSAVE_DEBOUNCE_MS = 2000;

export default function FsrDraftingPage({ params }) {
  const router = useRouter();
  const { user } = useAuth();
  const claimId = params.claimId;

  const [claim, setClaim] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [activeDraft, setActiveDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState(null);
  const [signerEmail, setSignerEmail] = useState('');
  const [submittedTo, setSubmittedTo] = useState('');
  const [previewMode, setPreviewMode] = useState('preview'); // 'preview' | 'edit'
  const lastSavedRef = useRef(null);
  const saveTimerRef = useRef(null);

  useEffect(() => { loadAll(); }, [claimId]);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  async function loadAll() {
    try {
      setLoading(true);
      const [claimRes, draftsRes] = await Promise.all([
        fetch(`/api/claims/${claimId}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/claims/${claimId}/fsr-drafts`).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      setClaim(claimRes);
      setDrafts(Array.isArray(draftsRes) ? draftsRes : []);
      const active = (draftsRes || []).find(d => d.status === 'draft' || d.status === 'under_review')
        || (draftsRes || [])[0]
        || null;
      setActiveDraft(active);
      lastSavedRef.current = active?.draft_content || null;

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

  async function generateDraft() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/claims/${claimId}/fsr-drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generate failed');
      showAlert(
        `Draft v${data.draft.version_number} generated · loss sheet: ${data.has_loss_sheet ? 'used' : 'missing'} · ILA: ${data.has_ila ? 'used' : 'missing'}`,
        'success'
      );
      await loadAll();
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  const queueSave = useCallback((html) => {
    clearTimeout(saveTimerRef.current);
    setSaveStatus('pending');
    saveTimerRef.current = setTimeout(async () => {
      if (!activeDraft?.id) return;
      setSaveStatus('saving');
      try {
        const res = await fetch(`/api/fsr-drafts/${activeDraft.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_content: html }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Save failed');
        }
        lastSavedRef.current = html;
        setSaveStatus('saved');
      } catch (e) {
        setSaveStatus('error');
        showAlert(e.message, 'error');
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [activeDraft?.id]);

  function setHtml(html) {
    setActiveDraft((prev) => ({ ...prev, draft_content: html }));
    queueSave(html);
  }

  async function submit() {
    if (!activeDraft || submitting) return;
    if (!signerEmail) {
      showAlert('Pick a signer (lead surveyor email)', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/fsr-drafts/${activeDraft.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_email: signerEmail,
          submitted_to_email: submittedTo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submit failed');
      showAlert(
        `FSR submitted · PDF ${data.pdf?.storage_path ? 'rendered' : 'pending'} · notification ${data.notification_id ? 'queued' : 'skipped'}`,
        'success'
      );
      setTimeout(() => router.push(`/claim-detail/${claimId}`), 1500);
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="main-content"><div className="loading">Loading FSR editor…</div></div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content" style={{ maxWidth: 1500, margin: '0 auto' }}>
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>FSR · {claim?.ref_number || `Claim #${claimId}`}</h2>
            <p style={{ color: '#475569', fontSize: 13, margin: '4px 0 0' }}>
              {claim?.insured_name || ''} · {claim?.lob || ''}
              {activeDraft && <> · v{activeDraft.version_number} · status <strong>{activeDraft.status}</strong></>}
            </p>
          </div>
          {activeDraft && <SaveBadge status={saveStatus} />}
        </div>

        {!activeDraft ? (
          <div style={{ ...paneStyle, textAlign: 'center', padding: 40 }}>
            <p style={{ color: '#475569', fontSize: 14, marginBottom: 16 }}>
              No FSR draft exists yet. Generate one from the LOB template, claim record, latest ILA, and loss sheet.
            </p>
            <button className="success" onClick={generateDraft} disabled={generating} style={{ padding: '10px 20px' }}>
              {generating ? 'Generating…' : 'Generate FSR draft from claim + ILA + loss sheet'}
            </button>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>
              Pulls fsr_lob_templates row for ({claim?.company || 'NISLA'} / {claim?.lob || 'Fire'}), substitutes claim + loss-sheet + ILA placeholders, and saves a new draft.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 1fr)', gap: 16, marginTop: 16, alignItems: 'start' }}>
            {/* Editor / preview */}
            <div style={paneStyle}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button
                  className={previewMode === 'preview' ? 'primary' : 'secondary'}
                  onClick={() => setPreviewMode('preview')}
                  style={{ fontSize: 12 }}
                >
                  Preview
                </button>
                <button
                  className={previewMode === 'edit' ? 'primary' : 'secondary'}
                  onClick={() => setPreviewMode('edit')}
                  style={{ fontSize: 12 }}
                  disabled={activeDraft.status === 'approved' || activeDraft.status === 'superseded'}
                >
                  Edit HTML
                </button>
                <button
                  className="secondary"
                  onClick={generateDraft}
                  disabled={generating}
                  style={{ fontSize: 12, marginLeft: 'auto' }}
                  title="Create a new version that re-renders from current data, preserving the existing draft"
                >
                  {generating ? '…' : 'Regenerate v' + ((drafts[0]?.version_number || 0) + 1)}
                </button>
              </div>

              {previewMode === 'preview' ? (
                <div
                  style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: 8, maxHeight: '70vh', overflow: 'auto' }}
                >
                  <iframe
                    srcDoc={activeDraft.draft_content || ''}
                    style={{ width: '100%', height: '70vh', border: 'none' }}
                    title="FSR preview"
                  />
                </div>
              ) : (
                <textarea
                  value={activeDraft.draft_content || ''}
                  onChange={(e) => setHtml(e.target.value)}
                  style={{
                    width: '100%', height: '70vh', fontSize: 12, fontFamily: 'monospace',
                    border: '1px solid #cbd5e1', borderRadius: 4, padding: 8,
                  }}
                  disabled={activeDraft.status === 'approved' || activeDraft.status === 'superseded'}
                  spellCheck={false}
                />
              )}
            </div>

            {/* Submission panel */}
            <aside style={paneStyle}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1e40af' }}>Submission</h4>

              <Field label="Signer (lead surveyor email) *">
                <input
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  placeholder="surveyor@nisla.in"
                  style={inputStyle}
                />
                <p style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  Must be a row in <strong>surveyors</strong> with an unexpired IRDAI license.
                </p>
              </Field>

              <Field label="Submit to (insurer email)">
                <input
                  type="email"
                  value={submittedTo}
                  onChange={(e) => setSubmittedTo(e.target.value)}
                  placeholder="dealing-officer@insurer.com"
                  style={inputStyle}
                />
                <p style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  Optional. If set, an email is queued via <code>notification_queue</code>.
                </p>
              </Field>

              <button
                className="success"
                style={{ width: '100%', marginTop: 12 }}
                onClick={submit}
                disabled={submitting
                  || !signerEmail
                  || activeDraft.status === 'approved'
                  || activeDraft.status === 'superseded'
                  || saveStatus === 'saving'}
              >
                {submitting
                  ? 'Submitting…'
                  : (activeDraft.status === 'approved' ? 'Already approved' : 'Submit FSR')}
              </button>
              <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                Renders the draft to PDF, files it under <code>D:\\2026-27\\&lt;company&gt;\\&lt;ref&gt;\\FSR\\</code>, marks the draft approved (immutable), and queues an email to the insurer.
              </p>

              {drafts.length > 1 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                    Versions
                  </div>
                  {drafts.map((d) => (
                    <div
                      key={d.id}
                      onClick={() => setActiveDraft(d)}
                      style={{
                        padding: 6, marginBottom: 4, borderRadius: 4,
                        cursor: 'pointer', fontSize: 11,
                        background: activeDraft?.id === d.id ? '#dbeafe' : 'transparent',
                        color: '#1e40af',
                      }}
                    >
                      v{d.version_number} · {d.status}{d.approved_by ? ` · by ${d.approved_by}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </PageLayout>
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

const paneStyle = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 };
const inputStyle = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' };
