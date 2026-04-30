'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import {
  CONFIDENCE_BANDS,
  confidenceBand,
  fieldFromExtraction,
  mergeDraftWithClaim,
  summariseDraft,
  hasMeaningfulDiff,
  FORM_FIELDS,
} from '@/lib/registrationDraft';

const AUTOSAVE_DEBOUNCE_MS = 1500;

// Sections drive the centre column. Each entry: { title, fields: [{ key, label, type, hint? }] }
const SECTIONS = [
  {
    key: 'insurer',
    title: 'Insurer',
    fields: [
      { key: 'insurer_name', label: 'Insurer', type: 'text' },
      { key: 'insurer_branch', label: 'Branch', type: 'text' },
      { key: 'dealing_officer_name', label: 'Dealing officer', type: 'text' },
      { key: 'dealing_officer_email', label: 'Officer email', type: 'email' },
      { key: 'dealing_officer_phone', label: 'Officer phone', type: 'tel' },
    ],
  },
  {
    key: 'policy',
    title: 'Policy',
    fields: [
      { key: 'policy_number', label: 'Policy #', type: 'text', mandatory: true },
      { key: 'policy_period_from', label: 'Period from', type: 'date', mandatory: true },
      { key: 'policy_period_to', label: 'Period to', type: 'date', mandatory: true },
      { key: 'sum_insured', label: 'Sum insured (₹)', type: 'number', mandatory: true },
      { key: 'policy_type', label: 'Policy type', type: 'text' },
    ],
  },
  {
    key: 'insured',
    title: 'Insured',
    fields: [
      { key: 'insured_name', label: 'Insured name', type: 'text', mandatory: true },
      { key: 'insured_address', label: 'Address', type: 'textarea' },
      { key: 'insured_contact_phone', label: 'Phone', type: 'tel' },
      { key: 'insured_contact_email', label: 'Email', type: 'email' },
      { key: 'insured_gstin', label: 'GSTIN', type: 'text' },
    ],
  },
  {
    key: 'loss',
    title: 'Loss',
    fields: [
      { key: 'lob', label: 'LOB', type: 'text', mandatory: true },
      { key: 'peril_type', label: 'Peril', type: 'text' },
      { key: 'date_loss', label: 'Date of loss', type: 'date', mandatory: true },
      { key: 'date_of_intimation', label: 'Date of intimation', type: 'date', mandatory: true },
      { key: 'loss_location', label: 'Loss location', type: 'textarea', mandatory: true },
      { key: 'loss_location_pin', label: 'PIN', type: 'text', mandatory: true },
      { key: 'loss_location_state', label: 'State', type: 'text' },
      { key: 'loss_location_district', label: 'District', type: 'text' },
      { key: 'estimated_loss_amount', label: 'Estimated loss (₹)', type: 'number' },
      { key: 'gross_loss', label: 'Gross loss (₹)', type: 'number' },
      { key: 'claim_amount_intimated', label: 'Claim amount intimated (₹)', type: 'number' },
    ],
  },
  {
    key: 'classification',
    title: 'Classification',
    fields: [
      { key: 'complexity_tier', label: 'Complexity tier', type: 'select', options: ['', 'small', 'standard', 'large', 'cat'] },
      { key: 'is_catastrophe', label: 'Linked to a catastrophe event?', type: 'boolean' },
    ],
  },
  {
    key: 'fee',
    title: 'Fee',
    fields: [
      { key: 'fee_basis', label: 'Fee basis', type: 'select', options: ['', 'irdai_scale', 'special_agreement'] },
      { key: 'fee_amount', label: 'Fee amount (₹)', type: 'number' },
      { key: 'fee_notes', label: 'Fee notes', type: 'textarea' },
    ],
  },
  {
    key: 'remark',
    title: 'Notes',
    fields: [
      { key: 'remark', label: 'Internal remark', type: 'textarea' },
    ],
  },
];

export default function ClaimRegistrationPage({ params }) {
  const router = useRouter();
  const { user } = useAuth();
  const claimId = params.id;

  const [claim, setClaim] = useState(null);
  const [intimation, setIntimation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formState, setFormState] = useState({});
  const [extractedData, setExtractedData] = useState({});
  const [saveStatus, setSaveStatus] = useState('idle');
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState(null);
  const [suggestions, setSuggestions] = useState({ eligible: [], blocked: [] });
  const [suggestLoading, setSuggestLoading] = useState(true);
  const [teamPicks, setTeamPicks] = useState({}); // { lead_surveyor: surveyor_id, co_surveyor: id, ... }
  const [teamMode, setTeamMode] = useState(false);
  const lastSavedRef = useRef(null);
  const saveTimerRef = useRef(null);

  useEffect(() => { loadAll(); }, [claimId]);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  async function loadAll() {
    try {
      setLoading(true);
      const [claimRes, draftRes, contextRes, suggRes] = await Promise.all([
        fetch(`/api/claims/${claimId}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/claims/${claimId}/draft`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/claims/${claimId}/intimation-context`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/claims/${claimId}/suggested-surveyors`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      setClaim(claimRes);
      setIntimation(contextRes);
      setSuggestions(suggRes || { eligible: [], blocked: [] });
      setSuggestLoading(false);
      const extracted = contextRes?.extraction?.extracted_data || {};
      setExtractedData(extracted);

      const initial = mergeDraftWithClaim(claimRes || {}, draftRes?.draft_data || {});
      // Pre-fill empty form fields from LLM extraction
      for (const f of FORM_FIELDS) {
        if (initial[f] === undefined || initial[f] === null || initial[f] === '') {
          const { value } = fieldFromExtraction(extracted, f);
          if (value !== null && value !== undefined && value !== '') {
            initial[f] = value;
          }
        }
      }
      setFormState(initial);
      lastSavedRef.current = initial;
    } catch (e) {
      showAlert('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  // Debounced autosave
  const queueSave = useCallback((next) => {
    if (!hasMeaningfulDiff(lastSavedRef.current, next)) return;
    clearTimeout(saveTimerRef.current);
    setSaveStatus('pending');
    saveTimerRef.current = setTimeout(() => doSave(next), AUTOSAVE_DEBOUNCE_MS);
  }, []);

  async function doSave(snapshot) {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/claims/${claimId}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_data: snapshot, updated_by: user?.email || null }),
      });
      if (!res.ok) throw new Error('Save failed');
      lastSavedRef.current = snapshot;
      setSaveStatus('saved');
    } catch (e) {
      setSaveStatus('error');
    }
  }

  function setField(key, value) {
    setFormState(prev => {
      const next = { ...prev, [key]: value };
      queueSave(next);
      return next;
    });
  }

  async function submit() {
    if (submitting) return;
    if (!teamPicks.lead_surveyor) {
      showAlert('Pick a lead surveyor before submitting', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // Persist current draft as the source-of-truth claim row, then call register.
      const claimUpdates = mergeDraftWithClaim({}, formState);
      const updateRes = await fetch(`/api/claims/${claimId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claimUpdates),
      });
      if (!updateRes.ok) {
        const err = await updateRes.json();
        throw new Error(err.error || 'Failed to save claim fields');
      }

      const regRes = await fetch(`/api/claims/${claimId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override_warnings: true, note: formState.remark || null }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) {
        throw new Error(regData.error || `Register failed: ${JSON.stringify(regData)}`);
      }

      // Team assignment (Slice F).
      const assignments = Object.entries(teamPicks)
        .filter(([, surveyor_id]) => !!surveyor_id)
        .map(([role, surveyor_id]) => ({ role, surveyor_id }));
      if (assignments.length > 0) {
        const assignRes = await fetch(`/api/claims/${claimId}/team-assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignments, assigned_by: user?.email || null }),
        });
        if (!assignRes.ok) {
          const err = await assignRes.json();
          showAlert(`Registered, but team-assign failed: ${err.error || 'unknown'}`, 'error');
          // Don't throw — claim is registered; assignment can be re-tried.
        }
      }

      // Drop the draft now that the claim is registered.
      await fetch(`/api/claims/${claimId}/draft`, { method: 'DELETE' }).catch(() => {});

      showAlert(`Registered ${regData.ref_number} (tier: ${regData.complexity_tier || 'n/a'})`, 'success');
      setTimeout(() => router.push(`/claim-detail/${claimId}`), 800);
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const summary = summariseDraft(formState);
  const fieldConfidences = computeConfidences(extractedData, FORM_FIELDS);

  if (loading) {
    return (
      <PageLayout>
        <div className="main-content"><div className="loading">Loading registration form...</div></div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content" style={{ maxWidth: 1600, margin: '0 auto' }}>
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Register claim {claim?.ref_number || `#${claimId}`}</h2>
            <p style={{ color: '#475569', fontSize: 13, margin: '4px 0 0' }}>
              Pre-filled from intimation email + AI extraction. Confidence cues per field. Auto-saves every {Math.round(AUTOSAVE_DEBOUNCE_MS / 1000)}s.
            </p>
          </div>
          <SaveBadge status={saveStatus} />
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(420px, 2fr) minmax(280px, 1fr)',
          gap: 16, marginTop: 16, alignItems: 'start',
        }}>
          <SourcePane intimation={intimation} claim={claim} />

          <FormPane
            sections={SECTIONS}
            formState={formState}
            setField={setField}
            fieldConfidences={fieldConfidences}
          />

          <SuggestionsPane
            extracted={extractedData}
            summary={summary}
            onSubmit={submit}
            submitting={submitting}
            saveStatus={saveStatus}
            suggestions={suggestions}
            suggestLoading={suggestLoading}
            teamPicks={teamPicks}
            setTeamPicks={setTeamPicks}
            teamMode={teamMode}
            setTeamMode={setTeamMode}
          />
        </div>
      </div>
    </PageLayout>
  );
}

// ----------------------------------------------------------------------------
// LEFT PANE — source email + attachments + OCR
// ----------------------------------------------------------------------------

function SourcePane({ intimation, claim }) {
  const source = intimation?.source;
  const attachments = intimation?.attachments || [];
  return (
    <aside style={paneStyle}>
      <PaneHeader icon="📧" label="Source" />
      {!source ? (
        <p style={{ color: '#94a3b8', fontSize: 12 }}>
          No intimation email linked to this claim.
          {claim && <> Claim was created manually or from a non-email source.</>}
        </p>
      ) : (
        <>
          <Field label="Subject" value={source.subject} />
          <Field label="From" value={`${source.sender_name || ''} <${source.sender}>`.trim()} />
          <Field label="Received" value={formatDateTime(source.received_at)} />
          <Field label="Mailbox" value={source.mailbox_email} />
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#475569' }}>Body ({source.body_plain?.length || 0} chars)</summary>
            <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, borderRadius: 4, maxHeight: 300, overflow: 'auto', marginTop: 6 }}>
              {(source.body_plain || source.snippet || '(empty)').slice(0, 4000)}
            </pre>
          </details>
        </>
      )}

      {attachments.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
            Attachments ({attachments.length})
          </div>
          {attachments.map(a => (
            <div key={a.id} style={{ padding: 8, borderRadius: 4, background: '#f8fafc', marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{a.file_name}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>
                {a.mime_type} · {(a.size_bytes / 1024).toFixed(1)} KB
                {a.ocr_text ? ` · ${a.ocr_text.length} chars OCR'd` : ' · no OCR'}
              </div>
              {a.ocr_text && (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: '#475569', marginTop: 4 }}>OCR text</summary>
                  <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', marginTop: 4 }}>
                    {a.ocr_text.slice(0, 2000)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

// ----------------------------------------------------------------------------
// CENTER PANE — registration form
// ----------------------------------------------------------------------------

function FormPane({ sections, formState, setField, fieldConfidences }) {
  return (
    <div style={paneStyle}>
      {sections.map(section => (
        <div key={section.key} style={{ marginBottom: 18 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1e40af', borderBottom: '1px solid #e2e8f0', paddingBottom: 4 }}>
            {section.title}
          </h4>
          {section.fields.map(f => (
            <FormField
              key={f.key}
              field={f}
              value={formState[f.key]}
              onChange={(v) => setField(f.key, v)}
              confidence={fieldConfidences[f.key]}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function FormField({ field, value, onChange, confidence }) {
  const id = `f_${field.key}`;
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: '#374151' }}>
        {field.label}
        {field.mandatory && <span style={{ color: '#dc2626' }}>*</span>}
        <ConfidenceBadge confidence={confidence} />
      </label>
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          rows={field.key === 'remark' ? 3 : 2}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={inputStyle}
        />
      ) : field.type === 'select' ? (
        <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value || null)} style={inputStyle}>
          {field.options.map(opt => (
            <option key={opt} value={opt}>{opt || '—'}</option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
          <input
            id={id}
            type="checkbox"
            checked={value === true || value === 'true'}
            onChange={e => onChange(e.target.checked)}
          />
          <span>{field.hint || 'Yes'}</span>
        </label>
      ) : (
        <input
          id={id}
          type={field.type}
          value={value ?? ''}
          onChange={e => onChange(field.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
          style={inputStyle}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// RIGHT PANE — AI summary + submit gate
// ----------------------------------------------------------------------------

function SuggestionsPane({ extracted, summary, onSubmit, submitting, saveStatus, suggestions, suggestLoading, teamPicks, setTeamPicks, teamMode, setTeamMode }) {
  const fieldsExtracted = Object.keys(extracted || {}).filter(k => !k.startsWith('_')).length;
  return (
    <aside style={paneStyle}>
      <PaneHeader icon="🤖" label="AI Suggestions" />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
          Extraction summary
        </div>
        <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>
          {fieldsExtracted > 0
            ? `${fieldsExtracted} field${fieldsExtracted === 1 ? '' : 's'} pre-filled from the intimation email.`
            : 'No AI extraction available — fill in manually from the source pane.'}
        </p>
      </div>

      <SurveyorSuggestionsBlock
        loading={suggestLoading}
        suggestions={suggestions}
        teamPicks={teamPicks}
        setTeamPicks={setTeamPicks}
        teamMode={teamMode}
        setTeamMode={setTeamMode}
      />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
          Mandatory fields
        </div>
        <div style={{ fontSize: 12, color: '#475569' }}>
          {summary.filled} of {summary.total} filled
        </div>
        <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
          <div style={{
            width: `${(summary.filled / summary.total) * 100}%`,
            height: '100%',
            background: summary.ready ? '#15803d' : '#3b82f6',
            transition: 'width 200ms',
          }} />
        </div>
        {summary.missing.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 11, color: '#b45309', cursor: 'pointer' }}>
              {summary.missing.length} missing
            </summary>
            <ul style={{ fontSize: 11, color: '#b45309', margin: '6px 0 0', paddingLeft: 16 }}>
              {summary.missing.map(f => <li key={f}>{f}</li>)}
            </ul>
          </details>
        )}
      </div>

      <button
        className="success"
        style={{ width: '100%' }}
        disabled={!summary.ready || submitting || saveStatus === 'saving'}
        onClick={onSubmit}
      >
        {submitting ? 'Registering…' : 'Submit registration'}
      </button>
      <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
        Submitting calls /api/claims/{`<id>`}/register. Computes complexity tier + ILA / FSR TAT per spec §6.
      </p>
    </aside>
  );
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

const paneStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 16,
  fontSize: 13,
};

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#fff',
  marginTop: 2,
};

function PaneHeader({ icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: '#1e40af', fontSize: 13, marginBottom: 12 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>{label}
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 12, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function ConfidenceBadge({ confidence }) {
  if (confidence === null || confidence === undefined) return null;
  const band = confidenceBand(confidence);
  if (band === 'unknown') return null;
  const cfg = CONFIDENCE_BANDS[band];
  if (!cfg) return null;
  return (
    <span style={{
      padding: '0 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
      background: cfg.bg, color: cfg.color, marginLeft: 4,
    }} title={`AI confidence: ${(confidence * 100).toFixed(0)}%`}>
      {cfg.label}
    </span>
  );
}

function SurveyorSuggestionsBlock({ loading, suggestions, teamPicks, setTeamPicks, teamMode, setTeamMode }) {
  const eligible = suggestions?.eligible || [];
  const blocked = suggestions?.blocked || [];

  const lead = teamPicks.lead_surveyor || '';
  const pickedIds = new Set(Object.values(teamPicks).filter(Boolean));
  const pickIds = (role, surveyor_id) => setTeamPicks(p => ({ ...p, [role]: surveyor_id || null }));

  return (
    <div style={{ marginBottom: 14, padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Surveyor suggestions
        </div>
        <label style={{ fontSize: 11, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={teamMode} onChange={e => setTeamMode(e.target.checked)} />
          Team
        </label>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Loading…</p>
      ) : eligible.length === 0 ? (
        <>
          <p style={{ fontSize: 12, color: '#b45309', margin: '4px 0' }}>
            No eligible surveyors. {blocked.length > 0 && `${blocked.length} blocked — see surveyor master.`}
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, color: '#475569', margin: '4px 0' }}>
            Lead surveyor *
          </div>
          <select
            value={lead}
            onChange={e => pickIds('lead_surveyor', e.target.value)}
            style={{ ...inputStyle, fontSize: 12 }}
          >
            <option value="">— Pick lead —</option>
            {eligible.map(({ surveyor, score, reasons }) => (
              <option key={surveyor.id} value={surveyor.id}>
                {surveyor.name} · score {Math.round(score)} · {reasons[0] || 'eligible'}
              </option>
            ))}
          </select>

          {teamMode && (
            <>
              <TeamRolePicker
                role="co_surveyor"
                label="Co-surveyor"
                eligible={eligible}
                pickedIds={pickedIds}
                value={teamPicks.co_surveyor}
                onChange={(v) => pickIds('co_surveyor', v)}
              />
              <TeamRolePicker
                role="engineer"
                label="Engineer"
                eligible={eligible}
                pickedIds={pickedIds}
                value={teamPicks.engineer}
                onChange={(v) => pickIds('engineer', v)}
              />
              <TeamRolePicker
                role="ca"
                label="CA"
                eligible={eligible}
                pickedIds={pickedIds}
                value={teamPicks.ca}
                onChange={(v) => pickIds('ca', v)}
              />
              <TeamRolePicker
                role="manager"
                label="Manager observer"
                eligible={eligible}
                pickedIds={pickedIds}
                value={teamPicks.manager}
                onChange={(v) => pickIds('manager', v)}
              />
            </>
          )}

          {lead && (() => {
            const sel = eligible.find(e => e.surveyor.id === lead);
            if (!sel) return null;
            return (
              <div style={{ marginTop: 6, fontSize: 10, color: '#475569' }}>
                <strong>{sel.surveyor.name}</strong>: {sel.reasons.join(' · ')}
              </div>
            );
          })()}
        </>
      )}

      {blocked.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 10, color: '#94a3b8', cursor: 'pointer' }}>
            {blocked.length} blocked
          </summary>
          <ul style={{ fontSize: 10, color: '#94a3b8', margin: '4px 0 0', paddingLeft: 16 }}>
            {blocked.map(b => (
              <li key={b.surveyor.id}>{b.surveyor.name}: {b.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TeamRolePicker({ role, label, eligible, pickedIds, value, onChange }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, color: '#475569' }}>{label}</div>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, fontSize: 12 }}
      >
        <option value="">— optional —</option>
        {eligible
          .filter(({ surveyor }) => surveyor.id === value || !pickedIds.has(surveyor.id))
          .map(({ surveyor, score }) => (
            <option key={surveyor.id} value={surveyor.id}>
              {surveyor.name} · score {Math.round(score)}
            </option>
          ))}
      </select>
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

function computeConfidences(extracted, fields) {
  const out = {};
  for (const f of fields) {
    out[f] = fieldFromExtraction(extracted, f).confidence;
  }
  return out;
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
