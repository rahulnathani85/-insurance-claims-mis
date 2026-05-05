'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import ThreeOfficePicker from '@/components/ThreeOfficePicker';
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
import { SECTIONS } from '@/lib/claimRegistrationSections';

const AUTOSAVE_DEBOUNCE_MS = 1500;

// SECTIONS now lives in lib/claimRegistrationSections.js so the editable
// mirror on /claim-detail/[id] (Registration tab) can render the same form
// without duplicating the schema.

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
  // Master list of insurers — drives the InsurerBlock dropdown and lets us
  // resolve insurer_name <-> insurer_id without adding a column on claims.
  const [insurers, setInsurers] = useState([]);
  const [teamPicks, setTeamPicks] = useState({}); // { lead_surveyor: surveyor_id, co_surveyor: id, ... }
  const [teamMode, setTeamMode] = useState(false);
  // Registration Agent (rich on-demand extraction)
  const [regExtract, setRegExtract] = useState(null);
  const [regExtractLoading, setRegExtractLoading] = useState(false);
  const [regExtractError, setRegExtractError] = useState(null);
  const lastSavedRef = useRef(null);
  const saveTimerRef = useRef(null);
  // Tracks whether the page loaded an existing claim_drafts row. When true,
  // we suppress the auto-trigger of the Registration Agent so reopening a
  // saved draft doesn't burn LLM tokens — the clerk can still click
  // Re-extract to fetch a fresh run when they actually want one.
  const draftExistedOnLoadRef = useRef(false);

  useEffect(() => { loadAll(); }, [claimId]);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Load the insurers master once. Used by InsurerBlock to render the
  // dropdown and to resolve insurer_name -> insurer_id when an existing
  // claim is opened.
  useEffect(() => {
    fetch('/api/insurers')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setInsurers(Array.isArray(data) ? data : []))
      .catch(() => setInsurers([]));
  }, []);

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

      // Stash whether a non-empty draft existed at load time. Read by the
      // auto-extract useEffect below so we don't kick off the LLM when the
      // clerk is just reopening a saved draft.
      draftExistedOnLoadRef.current =
        !!draftRes?.draft_data &&
        typeof draftRes.draft_data === 'object' &&
        Object.keys(draftRes.draft_data).length > 0;

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
      // Note: the Registration Agent fires from a separate useEffect below
      // because it requires the auth header (x-app-user-email) and the
      // useAuth() hook may not have populated `user` by the time loadAll
      // runs on first mount.
    } catch (e) {
      showAlert('Failed to load: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Auto-fire the Registration Agent once both the form has loaded AND the
  // user is signed in. The server-side 5-min idempotency window already
  // returns the cached extraction without an LLM call, so re-opens stay
  // free even when a draft exists; only after 5 min does a fresh run fire,
  // which is the desired behaviour.
  useEffect(() => {
    if (loading) return;
    if (!user?.email) return;
    if (regExtract || regExtractLoading) return;
    fetchRegistrationExtract({ force: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.email, claimId]);

  // Calls POST /api/claims/<id>/registration-extract. On success:
  //   - replaces extractedData with the rich {<field>: {value, confidence}}
  //     shape so ConfidenceBadge + Path 2 overlay get full info
  //   - pre-fills form fields that are still empty AND have confidence >= 0.5
  //   - stores conflicts + missing_critical for the Conflicts UI
  async function fetchRegistrationExtract({ force = false } = {}) {
    if (!user?.email) {
      // Auth header is mandatory upstream (requireUser in the API route).
      // Surfacing a clear UI message rather than letting the 401 confuse
      // the clerk into thinking the LLM failed.
      setRegExtractError('Sign-in not yet loaded — try again in a moment.');
      return;
    }
    setRegExtractLoading(true);
    setRegExtractError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/registration-extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-user-email': user.email,
        },
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

      // Pre-fill empty form fields with whatever the agent extracted. The
      // ConfidenceBadge (high/medium/low chip rendered next to the label by
      // FormField) communicates trust to the clerk — the value still goes
      // into the input either way, so a low-confidence extraction is visible
      // and reviewable instead of silently dropped.
      setFormState((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [key, entry] of Object.entries(data.fields || {})) {
          if (!entry || typeof entry !== 'object') continue;
          const val = entry.value;
          if (val === null || val === undefined || val === '') continue;
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
    if (!user?.email) {
      showAlert('Sign-in not yet loaded — try again in a moment.', 'error');
      return;
    }
    // Routes /api/claims/<id>/register and /team-assign use requireUser
    // (lib/comms/session.js) which 401s without this header. The legacy PUT
    // route doesn't strictly require it (uses requireSurveyorRequest, which
    // is null-tolerant), but sending it keeps the auth context consistent.
    const authHeaders = {
      'Content-Type': 'application/json',
      'x-app-user-email': user.email,
    };
    setSubmitting(true);
    try {
      // Persist current draft as the source-of-truth claim row, then call register.
      // Important: send phase='intimation' explicitly so the PUT route doesn't
      // auto-flip phase (its sugar for inline edits). The dedicated POST
      // /register call below handles the phase transition AND computes
      // complexity tier + ILA/FSR TATs, which the auto-flip skips.
      const claimUpdates = mergeDraftWithClaim({}, formState);
      claimUpdates.phase = 'intimation';
      // _insurer_id is a transient form field used to scope the office
      // picker — claims has no insurer_id column, so strip before PUT.
      delete claimUpdates._insurer_id;
      const updateRes = await fetch(`/api/claims/${claimId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(claimUpdates),
      });
      if (!updateRes.ok) {
        const err = await updateRes.json();
        throw new Error(err.error || 'Failed to save claim fields');
      }

      const regRes = await fetch(`/api/claims/${claimId}/register`, {
        method: 'POST',
        headers: authHeaders,
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
          headers: authHeaders,
          body: JSON.stringify({ assignments, assigned_by: user.email }),
        });
        if (!assignRes.ok) {
          const err = await assignRes.json();
          showAlert(`Registered, but team-assign failed: ${err.error || 'unknown'}`, 'error');
          // Don't throw — claim is registered; assignment can be re-tried.
        }
      }

      // Drop the draft now that the claim is registered.
      await fetch(`/api/claims/${claimId}/draft`, {
        method: 'DELETE',
        headers: { 'x-app-user-email': user.email },
      }).catch(() => {});

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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => doSave(formState)}
              disabled={saveStatus === 'saving' || saveStatus === 'pending'}
              title="Save the current form state as a draft now (bypasses the autosave debounce)"
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                border: '1px solid #cbd5e1', borderRadius: 6,
                background: (saveStatus === 'saving' || saveStatus === 'pending') ? '#f1f5f9' : '#fff',
                color: '#0f172a',
                cursor: (saveStatus === 'saving' || saveStatus === 'pending') ? 'wait' : 'pointer',
              }}
            >
              Save draft
            </button>
            <SaveBadge status={saveStatus} />
          </div>
        </div>

        <ConflictsBanner conflicts={regExtract?.conflicts} />

        <RefNumberEditor
          formState={formState}
          claim={claim}
          setField={setField}
          autoGenerateRef={autoGenerateRef}
        />

        <InsurerBlock
          insurers={insurers}
          formState={formState}
          setField={setField}
        />

        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(420px, 2fr) minmax(280px, 1fr)',
          gap: 16, marginTop: 16, alignItems: 'start',
        }}>
          <SourcePane intimation={intimation} claim={claim} user={user} />

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
            autoExtractSuppressed={false}
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
// INSURER BLOCK — sits below RefNumberEditor and above the 3-column grid.
// Owns the insurer dropdown (replaces the legacy insurer_name text input)
// and the 3-office picker. Picker is disabled until an insurer is chosen.
// ----------------------------------------------------------------------------

function InsurerBlock({ insurers, formState, setField }) {
  // Resolve the form's _insurer_id from the chosen insurer_name. We don't
  // persist _insurer_id (claims has no such column) — it's a transient
  // scope hint for the picker. If the form already carries it (e.g. a
  // saved draft), trust it; otherwise derive from insurer_name.
  let resolvedInsurerId = formState?._insurer_id || null;
  if (!resolvedInsurerId && formState?.insurer_name && insurers.length > 0) {
    const target = formState.insurer_name.trim().toLowerCase();
    const match = insurers.find(
      (i) => (i.company_name || '').trim().toLowerCase() === target
    );
    if (match) resolvedInsurerId = match.id;
  }

  function onInsurerChange(e) {
    const id = e.target.value ? Number(e.target.value) : null;
    if (id == null) {
      setField('insurer_name', '');
      setField('_insurer_id', null);
      // Clear any stale office FKs since they'd belong to a different insurer.
      ['appointing', 'policy', 'fsr'].forEach((role) => {
        setField(`${role}_office_id`, null);
        setField(`${role}_office_name`, '');
        setField(`${role}_office_address`, '');
      });
      return;
    }
    const ins = insurers.find((i) => i.id === id);
    if (!ins) return;
    setField('insurer_name', ins.company_name || '');
    setField('_insurer_id', id);
    // If switching insurers, drop existing office picks — they belong to
    // the previous insurer and the server-side validator would reject them.
    if (formState?._insurer_id && formState._insurer_id !== id) {
      ['appointing', 'policy', 'fsr'].forEach((role) => {
        setField(`${role}_office_id`, null);
        setField(`${role}_office_name`, '');
        setField(`${role}_office_address`, '');
      });
    }
  }

  function onOfficeChange(role, office) {
    setField(`${role}_office_id`, office?.id ?? null);
    setField(`${role}_office_name`, office?.name || '');
    if (office) {
      const parts = [office.address, office.city, office.state, office.pin].filter(Boolean);
      setField(`${role}_office_address`, parts.join(', '));
    } else {
      setField(`${role}_office_address`, '');
    }
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 320px) 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 700,
              color: '#1e40af',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            Insurer <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <select
            value={resolvedInsurerId || ''}
            onChange={onInsurerChange}
            style={{
              width: '100%',
              padding: '7px 10px',
              fontSize: 13,
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              background: '#fff',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          >
            <option value="">— Select insurer —</option>
            {insurers.map((ins) => (
              <option key={ins.id} value={ins.id}>
                {ins.company_name}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
            Picks scope the 3 office searches. Add a new insurer in /insurer-master before registering.
          </p>
        </div>

        <ThreeOfficePicker
          insurerId={resolvedInsurerId}
          values={{
            appointing: formState?.appointing_office_id || null,
            policy: formState?.policy_office_id || null,
            fsr: formState?.fsr_office_id || null,
          }}
          onChange={onOfficeChange}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// LEFT PANE — source email + attachments + OCR
// ----------------------------------------------------------------------------

function SourcePane({ intimation, claim, user }) {
  const source = intimation?.source;
  const isManual = !source;  // no intimation email = manual claim or non-email source

  // Fetch claim_documents for this claim. For email claims we already have
  // attachments via intimation-context; for manual claims this is the only
  // place documents come from. Always fetching keeps the upload UX consistent.
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const refreshDocs = useCallback(async () => {
    if (!claim?.id) return;
    setDocsLoading(true);
    try {
      const res = await fetch(
        `/api/claim-documents?claim_id=${encodeURIComponent(claim.id)}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const arr = await res.json();
        setDocs(Array.isArray(arr) ? arr : []);
      }
    } catch { /* non-fatal */ }
    finally {
      setDocsLoading(false);
    }
  }, [claim?.id]);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);

  async function uploadOne(file) {
    if (!file || !claim?.id) return;
    setUploading(true);
    setUploadError(null);
    try {
      // 1. Presign
      const presignRes = await fetch('/api/claim-documents/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: claim.id,
          ref_number: claim.ref_number || '',
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
          company: claim.company || 'NISLA',
        }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok || !presign?.signedUrl) {
        throw new Error(presign?.error || 'presign failed');
      }

      // 2. Direct PUT to Supabase
      const putRes = await fetch(presign.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Storage upload failed (${putRes.status})`);
      }

      // 3. Confirm
      const confirmRes = await fetch('/api/claim-documents/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: presign.path,
          claim_id: claim.id,
          ref_number: claim.ref_number || '',
          file_name: file.name,
          file_type: 'other',
          mime_type: file.type || null,
          file_size: file.size,
          uploaded_by: user?.email || '',
          company: claim.company || 'NISLA',
        }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok) {
        throw new Error(confirmJson?.error || 'confirm failed');
      }

      await refreshDocs();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';  // allow re-selecting the same file
    (async () => {
      for (const f of files) {
        // Sequential to keep UX deterministic and avoid concurrent presign races.
        // eslint-disable-next-line no-await-in-loop
        await uploadOne(f);
      }
    })();
  }

  return (
    <aside style={paneStyle}>
      <PaneHeader icon={isManual ? '📁' : '📧'} label="Source" />
      {!source ? (
        <p style={{ color: '#94a3b8', fontSize: 12 }}>
          {claim && isPlaceholderRef(claim?.ref_number) && claim.ref_number?.startsWith('MANUAL/')
            ? 'Manual claim — upload the policy / intimation / supporting documents below, then click Re-extract on the right rail to fill the form from them.'
            : 'No intimation email linked to this claim. Claim was created manually or from a non-email source.'}
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

      {/* Upload widget — always available so manual claims can add files
          and email claims can attach extras (FIRs, photos, supplementary
          policy docs) that didn't come in via the original email. */}
      <div style={{ marginTop: 14, padding: 10, background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          Upload documents
        </div>
        <input
          type="file"
          multiple
          onChange={onPickFiles}
          disabled={uploading}
          style={{ fontSize: 12 }}
        />
        {uploading && (
          <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 4 }}>Uploading…</div>
        )}
        {uploadError && (
          <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>
            Upload failed: {uploadError}
          </div>
        )}
      </div>

      {/* Documents list (claim_documents). Includes email attachments
          materialised at intimation time + uploads + generated artifacts. */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          Documents ({docs.length}){docsLoading ? ' · loading…' : ''}
        </div>
        {docs.length === 0 && !docsLoading && (
          <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>
            No documents yet. Upload above to attach files.
          </p>
        )}
        {docs.map((d) => (
          <div key={d.id} style={{ padding: 8, borderRadius: 4, background: '#fff', border: '1px solid #e2e8f0', marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#0f172a', wordBreak: 'break-all' }}>{d.file_name}</div>
            <div style={{ fontSize: 10, color: '#64748b' }}>
              {d.source === 'gmail' ? 'Email' : d.source === 'generated' ? 'Generated' : 'Upload'}
              {d.mime_type ? ` · ${d.mime_type}` : ''}
              {d.file_size ? ` · ${(d.file_size / 1024).toFixed(1)} KB` : ''}
              {d.ocr_text ? ` · ${d.ocr_text.length} chars OCR'd` : ' · no OCR'}
            </div>
          </div>
        ))}
      </div>
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
  autoExtractSuppressed = false,
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
        {autoExtractSuppressed && (
          <div style={{ marginTop: 6, fontSize: 10, color: '#94a3b8' }}>
            Auto-extract suppressed (saved draft loaded). Click Re-extract to refresh.
          </div>
        )}
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

      <PolicyDecisionPanel decision={regExtract?.policy_decision} />

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

// =============================================================================
// PolicyDecisionPanel — renders the Policy Registration Agent's decision
// (lib/comms/prompts/policyRegistrationAgentPrompt.js). Reads the
// `policy_decision_json` row stored on claim_registration_extractions and
// returned as `regExtract.policy_decision` from /api/claims/[id]/registration-extract.
//
// States:
//   match_existing         — green: matched master row + optional conflicts list
//   create_new             — blue:  preview of new_policy_payload that will be inserted on submit
//   ambiguous_needs_review — amber: review_reasons + candidates summary (clerk resolves manually)
//   null/no decision       — grey:  "Policy decision pending"
// =============================================================================
function PolicyDecisionPanel({ decision }) {
  const wrap = {
    marginBottom: 14,
    padding: 10,
    borderRadius: 6,
    border: '1px solid',
    fontSize: 12,
  };
  const head = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  };

  if (!decision || typeof decision !== 'object' || !decision.decision) {
    return (
      <div style={{ ...wrap, background: '#f8fafc', borderColor: '#e2e8f0' }}>
        <div style={{ ...head, color: '#475569' }}>Policy decision</div>
        <div style={{ color: '#94a3b8' }}>Pending — agent has not run or returned no decision.</div>
      </div>
    );
  }

  if (decision.decision === 'match_existing') {
    const mid = decision.matched_policy_id;
    const merged = decision.merged_policy_fields || {};
    const masterPolicy = merged?.policy_number?.value || '(no policy_number)';
    const conflicts = Array.isArray(decision.conflicts) ? decision.conflicts : [];
    return (
      <div style={{ ...wrap, background: '#f0fdf4', borderColor: '#86efac' }}>
        <div style={{ ...head, color: '#15803d' }}>✓ Matched existing policy</div>
        <div style={{ color: '#166534' }}>
          Policy <strong>{masterPolicy}</strong>
          {' '}
          {mid != null && (
            <a
              href={`/policy-master/${mid}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#15803d', textDecoration: 'underline' }}
            >
              (view master #{mid})
            </a>
          )}
        </div>
        {conflicts.length > 0 && (
          <div style={{ marginTop: 8, padding: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#b45309', marginBottom: 4 }}>
              ⚠ Master differs on {conflicts.length} field{conflicts.length > 1 ? 's' : ''}
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, color: '#92400e' }}>
              {conflicts.map((c, i) => (
                <li key={i} style={{ marginBottom: 2 }}>
                  <strong>{c.field}</strong>: master = {stringifyConflictValue(c.master_value)} · extracted = {stringifyConflictValue(c.extracted_value)}
                  {c.reason && <span style={{ color: '#b45309' }}> — {c.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (decision.decision === 'create_new') {
    const payload = decision.new_policy_payload || {};
    return (
      <div style={{ ...wrap, background: '#eff6ff', borderColor: '#93c5fd' }}>
        <div style={{ ...head, color: '#1d4ed8' }}>＋ Will create new policy on submit</div>
        <div style={{ color: '#1e40af' }}>
          Policy <strong>{payload.policy_number || '(no policy_number)'}</strong>
          {payload.insurer && <span> · {payload.insurer}</span>}
        </div>
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 11, color: '#1d4ed8', cursor: 'pointer' }}>Show full payload</summary>
          <pre style={{
            margin: '6px 0 0',
            padding: 8,
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: 4,
            fontSize: 11,
            color: '#334155',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  if (decision.decision === 'ambiguous_needs_review') {
    const reasons = Array.isArray(decision.review_reasons) ? decision.review_reasons : [];
    const candidates = Array.isArray(decision.candidate_matches_seen) ? decision.candidate_matches_seen : [];
    return (
      <div style={{ ...wrap, background: '#fffbeb', borderColor: '#fde68a' }}>
        <div style={{ ...head, color: '#b45309' }}>⚠ Needs manual review</div>
        {reasons.length > 0 && (
          <ul style={{ margin: '0 0 6px', paddingLeft: 16, color: '#92400e' }}>
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        {candidates.length > 0 && (
          <details>
            <summary style={{ fontSize: 11, color: '#b45309', cursor: 'pointer' }}>
              {candidates.length} candidate{candidates.length > 1 ? 's' : ''} considered
            </summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: '#78350f', fontSize: 11 }}>
              {candidates.map((c, i) => (
                <li key={i}>
                  #{c.id} · {c.policy_number || '(no policy_number)'} · {c.insurer || '?'} · {c.insured_name || '?'}
                  {c.id != null && (
                    <>
                      {' · '}
                      <a href={`/policy-master/${c.id}`} target="_blank" rel="noreferrer" style={{ color: '#b45309' }}>
                        view
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: '#92400e' }}>
          Resolve via <a href="/policy-master" target="_blank" rel="noreferrer" style={{ color: '#b45309', textDecoration: 'underline' }}>Policy Master</a> before submitting.
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...wrap, background: '#f8fafc', borderColor: '#e2e8f0' }}>
      <div style={{ ...head, color: '#475569' }}>Policy decision</div>
      <div style={{ color: '#94a3b8' }}>Unknown decision: {String(decision.decision)}</div>
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
