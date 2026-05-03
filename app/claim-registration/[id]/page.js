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
import { IRDAI_LOBS, subcategoriesFor, suggestSubcategory } from '@/lib/lobSubcategories';
import { isPlaceholderRef } from '@/lib/refNumber';

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
      { key: 'lob', label: 'LOB', type: 'select', mandatory: true, options: ['', ...IRDAI_LOBS] },
      { key: 'lob_subcategory', label: 'Sub-category', type: 'lob_subcategory' },
      { key: 'peril_type', label: 'Peril', type: 'text' },
      { key: 'cause_of_loss', label: 'Cause of loss', type: 'text', hint: 'e.g. short circuit, machinery breakdown, road accident' },
      { key: 'date_loss', label: 'Date of loss', type: 'date', mandatory: true },
      { key: 'date_of_intimation', label: 'Date of intimation', type: 'date', mandatory: true },
      { key: 'loss_location', label: 'Loss location', type: 'textarea', mandatory: true },
      { key: 'loss_location_pin', label: 'PIN', type: 'text', mandatory: true },
      { key: 'loss_location_state', label: 'State', type: 'text' },
      { key: 'loss_location_district', label: 'District', type: 'text' },
      { key: 'estimated_loss_amount', label: 'Estimated loss (₹)', type: 'number', hint: 'Same as the claim amount intimated by the insurer' },
      { key: 'gross_loss', label: 'Gross loss (₹)', type: 'number' },
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
  // Registration Agent (rich on-demand extraction)
  const [regExtract, setRegExtract] = useState(null);
  const [regExtractLoading, setRegExtractLoading] = useState(false);
  const [regExtractError, setRegExtractError] = useState(null);
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
      // Auto-suggest sub-category from extraction when not already set.
      // The clerk can still override via the dropdown.
      if (!initial.lob_subcategory && initial.lob) {
        const suggested = suggestSubcategory(initial.lob, extracted);
        if (suggested) initial.lob_subcategory = suggested;
      }
      setFormState(initial);
      lastSavedRef.current = initial;

      // Kick off the Registration Agent (rich extraction) in the background
      // — don't block the form render. The 5-min idempotency on the server
      // means this is free on rapid reloads.
      fetchRegistrationExtract({ force: false });
    } catch (e) {
      showAlert('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Calls POST /api/claims/<id>/registration-extract. On success:
  //   - replaces extractedData with the rich {<field>: {value, confidence}}
  //     shape so ConfidenceBadge + Path 2 overlay get full info
  //   - pre-fills form fields that are still empty AND have confidence >= 0.5
  //   - stores conflicts + missing_critical for the Conflicts UI
  async function fetchRegistrationExtract({ force = false } = {}) {
    setRegExtractLoading(true);
    setRegExtractError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/registration-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setRegExtract(data);

      // Promote extractedData to the rich shape — fieldFromExtraction's Shape 1
      // ({ field: { value, confidence } }) just works.
      const richShape = {};
      for (const [k, entry] of Object.entries(data.fields || {})) {
        if (!entry || typeof entry !== 'object') continue;
        richShape[k] = { value: entry.value, confidence: entry.confidence };
      }
      setExtractedData(richShape);

      // Pre-fill empty form fields where confidence >= 0.5. Lower-confidence
      // values still show via ConfidenceBadge (red band) but don't auto-populate
      // — avoids polluting the form with bad LLM guesses.
      setFormState((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [key, entry] of Object.entries(data.fields || {})) {
          if (!entry || typeof entry !== 'object') continue;
          const val = entry.value;
          const conf = entry.confidence;
          if (val === null || val === undefined || val === '') continue;
          if (conf !== null && conf !== undefined && conf < 0.5) continue;
          if (next[key] !== undefined && next[key] !== null && next[key] !== '') continue;
          next[key] = val;
          changed = true;
        }
        if (changed) lastSavedRef.current = next;
        return next;
      });
    } catch (err) {
      setRegExtractError(err.message);
    } finally {
      setRegExtractLoading(false);
    }
  }

  // Manual trigger: bypasses the 5-min server-side cache.
  async function runReExtract() {
    await fetchRegistrationExtract({ force: true });
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

  // Hits /api/tentative-ref/<lob>?client_category= — read-only preview of the
  // next available ref number for the current LOB. The counter only ticks
  // when the form is submitted (the PUT route promotes the placeholder).
  async function autoGenerateRef() {
    const lob = (formState.lob || claim?.lob || '').trim();
    if (!lob) {
      showAlert('Set LOB before auto-generating Ref #.', 'error');
      return;
    }
    try {
      const qs = claim?.client_category
        ? `?client_category=${encodeURIComponent(claim.client_category)}`
        : '';
      const res = await fetch(`/api/tentative-ref/${encodeURIComponent(lob)}${qs}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.tentative_ref) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setField('ref_number', json.tentative_ref);
    } catch (err) {
      showAlert(`Auto-generate failed: ${err.message}`, 'error');
    }
  }

  async function submit() {
    if (submitting) return;
    if (!teamPicks.lead_surveyor) {
      showAlert('Pick a lead surveyor before submitting', 'error');
      return;
    }
    const ref = (formState.ref_number || '').trim();
    if (!ref || isPlaceholderRef(ref)) {
      showAlert('Assign a real surveyor reference number before submitting (use Auto-generate or type one).', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // Persist current draft as the source-of-truth claim row, then call register.
      // Important: send phase='intimation' explicitly so the PUT route doesn't
      // auto-flip phase (its sugar for inline edits). The dedicated POST
      // /register call below handles the phase transition AND computes
      // complexity tier + ILA/FSR TATs, which the auto-flip skips.
      const claimUpdates = mergeDraftWithClaim({}, formState);
      claimUpdates.phase = 'intimation';
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

        <ConflictsBanner conflicts={regExtract?.conflicts} />

        <RefNumberEditor
          formState={formState}
          claim={claim}
          setField={setField}
          autoGenerateRef={autoGenerateRef}
        />

        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(420px, 2fr) minmax(280px, 1fr)',
          gap: 16, marginTop: 16, alignItems: 'start',
        }}>
          <SourcePane intimation={intimation} claim={claim} />

          <FormPane
            sections={SECTIONS}
            formState={formState}
            setField={setField}
            conflictsByField={buildConflictsByField(regExtract?.conflicts)}
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
            regExtract={regExtract}
            regExtractLoading={regExtractLoading}
            regExtractError={regExtractError}
            onReExtract={runReExtract}
          />
        </div>
      </div>
    </PageLayout>
  );
}

// ----------------------------------------------------------------------------
// SURVEYOR REFERENCE EDITOR — sits above the 3-column grid because ref_number
// is the canonical claim identifier. Empty until the clerk types or clicks
// Auto-generate. INTAKE/<co>/<msgid> placeholders never appear in the input.
// ----------------------------------------------------------------------------

function RefNumberEditor({ formState, claim, setField, autoGenerateRef }) {
  const raw = formState?.ref_number || '';
  // Hide INTAKE/ placeholders from the input — the clerk should always
  // explicitly assign a real ref before this form will submit.
  const displayValue = isPlaceholderRef(raw) ? '' : raw;
  const lobReady = !!(formState?.lob || claim?.lob);
  const placeholderRef = isPlaceholderRef(claim?.ref_number) ? claim.ref_number : null;

  return (
    <div style={{
      marginTop: 16, padding: 14, background: '#fffbeb',
      border: '1px solid #fde68a', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Surveyor reference #
          </div>
          <div style={{ fontSize: 11, color: '#78350f', marginTop: 2 }}>
            Required before registering · canonical claim identifier
          </div>
        </div>
        <input
          value={displayValue}
          onChange={(e) => setField('ref_number', e.target.value)}
          placeholder="e.g. 4053/26-27/Marine Cargo"
          style={{
            flex: 1, minWidth: 240, padding: '8px 10px', fontSize: 14,
            fontFamily: 'monospace', border: '1px solid #cbd5e1',
            borderRadius: 6, background: '#fff',
          }}
        />
        <button
          type="button"
          onClick={autoGenerateRef}
          disabled={!lobReady}
          title={lobReady ? 'Generate next available ref for this LOB' : 'Pick LOB first'}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600,
            border: 'none', borderRadius: 6,
            cursor: lobReady ? 'pointer' : 'not-allowed',
            opacity: lobReady ? 1 : 0.5,
            background: '#1e3a5f', color: '#fff',
          }}
        >
          Auto-generate
        </button>
      </div>
      {placeholderRef && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#78350f' }}>
          Currently a stop-gap intake ref: <code style={{ fontFamily: 'monospace' }}>{placeholderRef}</code> — assign a real surveyor reference above to replace it on save.
        </div>
      )}
    </div>
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

function FormPane({ sections, formState, setField, fieldConfidences, conflictsByField = {} }) {
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
              conflict={conflictsByField[f.key] || null}
              formState={formState}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function FormField({ field, value, onChange, confidence, conflict, formState }) {
  const id = `f_${field.key}`;
  // Sub-category options depend on the currently-selected LOB.
  const subcatOptions = field.type === 'lob_subcategory'
    ? subcategoriesFor(formState?.lob)
    : null;
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: '#374151' }}>
        {field.label}
        {field.mandatory && <span style={{ color: '#dc2626' }}>*</span>}
        <ConfidenceBadge confidence={confidence} />
        <FieldConflictIcon conflict={conflict} fieldLabel={field.label} />
      </label>
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          rows={field.key === 'remark' ? 3 : 2}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={inputStyle}
        />
      ) : field.type === 'lob_subcategory' ? (
        subcatOptions && subcatOptions.length > 0 ? (
          <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value || null)} style={inputStyle}>
            <option value="">— Select sub-category —</option>
            {subcatOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <div style={{ ...inputStyle, color: '#94a3b8', background: '#f8fafc' }}>
            Pick an LOB first
          </div>
        )
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

function SuggestionsPane({
  extracted, summary, onSubmit, submitting, saveStatus,
  suggestions, suggestLoading, teamPicks, setTeamPicks, teamMode, setTeamMode,
  regExtract, regExtractLoading, regExtractError, onReExtract,
}) {
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
            : (regExtractLoading
                ? 'Running Registration Agent on email + attachments…'
                : 'No AI extraction available — fill in manually from the source pane.')}
        </p>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onReExtract}
            disabled={regExtractLoading}
            title="Run the Claim Registration Agent again from the source email and attachments"
            style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 600,
              border: '1px solid #cbd5e1', borderRadius: 4,
              background: regExtractLoading ? '#f1f5f9' : '#fff',
              color: '#0f172a',
              cursor: regExtractLoading ? 'wait' : 'pointer',
              opacity: regExtractLoading ? 0.7 : 1,
            }}
          >
            {regExtractLoading ? 'Re-extracting…' : 'Re-extract'}
          </button>
          {regExtract?.created_at && (
            <span style={{ fontSize: 10, color: '#94a3b8' }}>
              Last: {formatDateTime(regExtract.created_at)}
              {regExtract.llm_provider ? ` · ${regExtract.llm_provider}` : ''}
              {regExtract.cached ? ' · cached' : ''}
            </span>
          )}
        </div>
        {regExtractError && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c' }}>
            Re-extract failed: {regExtractError}
          </div>
        )}
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

// ----------------------------------------------------------------------------
// CONFLICTS UI
// ----------------------------------------------------------------------------
//
// The Registration Agent returns a `conflicts` array when the same field has
// different values across sources (e.g. policy_pdf says 5000000 but email
// says 4500000 for sum_insured). We surface these in two ways:
//   - A yellow banner at the top of the page summarising the count + list
//   - A small ⚠ icon next to each conflicted field's label
//
// Shape of each conflict entry (from the LLM):
//   { field: "sum_insured", values: [{source: "policy_pdf", value: 5000000}, ...] }
// ----------------------------------------------------------------------------

function ConflictsBanner({ conflicts }) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  const [open, setOpen] = useState(false);
  if (list.length === 0) return null;

  return (
    <div style={{
      marginTop: 12, padding: '10px 14px',
      background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8,
      fontSize: 13, color: '#78350f',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
           onClick={() => setOpen((v) => !v)}>
        <span style={{ fontSize: 16 }}>⚠</span>
        <strong>{list.length} conflict{list.length === 1 ? '' : 's'} found across sources</strong>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#92400e' }}>{open ? '▲ Hide' : '▼ Review'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10, paddingLeft: 24 }}>
          {list.map((c, i) => (
            <div key={i} style={{ marginBottom: 6, fontSize: 12 }}>
              <code style={{ fontFamily: 'monospace', color: '#0f172a', background: '#fff', padding: '1px 4px', borderRadius: 3 }}>
                {c?.field || '(unknown field)'}
              </code>
              {' — '}
              {(c?.values || []).map((v, j) => (
                <span key={j} style={{ marginRight: 8 }}>
                  <em style={{ color: '#92400e' }}>{v?.source || 'source?'}:</em>{' '}
                  <span style={{ color: '#0f172a' }}>{stringifyConflictValue(v?.value)}</span>
                  {j < (c.values?.length ?? 0) - 1 ? ' vs' : ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldConflictIcon({ conflict, fieldLabel }) {
  if (!conflict || !Array.isArray(conflict.values) || conflict.values.length < 2) return null;
  const tooltip = `Conflict on ${fieldLabel}:\n` +
    conflict.values.map((v) => `  ${v?.source || 'source?'}: ${stringifyConflictValue(v?.value)}`).join('\n');
  return (
    <span
      title={tooltip}
      style={{
        marginLeft: 4, fontSize: 12, color: '#b45309',
        cursor: 'help', userSelect: 'none',
      }}
    >
      ⚠
    </span>
  );
}

function buildConflictsByField(conflicts) {
  const out = {};
  if (!Array.isArray(conflicts)) return out;
  for (const c of conflicts) {
    if (c?.field && Array.isArray(c.values) && c.values.length >= 2) {
      out[c.field] = c;
    }
  }
  return out;
}

function stringifyConflictValue(v) {
  if (v === null || v === undefined) return '(empty)';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
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
