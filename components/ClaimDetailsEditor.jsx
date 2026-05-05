'use client';
// =============================================================================
// components/ClaimDetailsEditor.jsx
// =============================================================================
// Editable mirror of the claim-registration form, rendered inside the
// Registration tab of /claim-detail/[id]. Lets surveyors fix any field that
// was left unfilled (or wrong) at registration time without leaving the
// claim-detail page they're already on for FSR work.
//
// Schema source: lib/claimRegistrationSections.js (SECTIONS). Identical to
// what /claim-registration/[id] renders — they share the constant.
//
// Save flow:
//   - Local state mirrors the claim row.
//   - Edits are autosaved 1.5s after the surveyor stops typing
//     (matches the registration page's debounce).
//   - PUT /api/claims/[id] handles persistence + dual-write to provenance
//     + EW sync. We don't bypass any of that.
//   - Save status shown via a small badge in the header.
//
// Locked fields (`LOCKED_REGISTRATION_FIELDS`):
//   id, ref_number, created_at, registered_at, registered_by — shown in a
//   read-only summary block at the top, never editable here.
//
// Insurer + 3 office roles:
//   InsurerBlock = insurer dropdown + ThreeOfficePicker. Same UX as the
//   registration page. Insurer change clears the 3 office fields (since
//   they belong to a specific insurer).
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import ThreeOfficePicker from './ThreeOfficePicker';
import {
  SECTIONS,
  LOCKED_REGISTRATION_FIELDS,
} from '@/lib/claimRegistrationSections';
import {
  initFormState,
  buildPutBody,
} from '@/lib/claimDetailsEditorState';
import { subcategoriesFor } from '@/lib/lobSubcategories';

// initFormState/buildPutBody live in lib/claimDetailsEditorState.js (no JSX)
// so vitest can import them directly without pulling React. Re-export so
// callers wanting component-local imports still work.
export { initFormState, buildPutBody };

const AUTOSAVE_DEBOUNCE_MS = 1500;

export default function ClaimDetailsEditor({ claim, onSaved, userEmail }) {
  // -- core state ---------------------------------------------------------
  const [formState, setFormState] = useState(() => initFormState(claim));
  const [insurers, setInsurers] = useState([]);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | pending | saving | saved | error
  const [errorMsg, setErrorMsg] = useState(null);

  const lastSavedRef = useRef(formState);
  const saveTimerRef = useRef(null);

  // -- when the parent reloads the claim, re-seed our state ---------------
  // Treat the parent as the source of truth on load. Only re-seed if the
  // claim id changed OR our local state hasn't been touched (saveStatus
  // === 'idle'). Avoids stomping on in-flight surveyor edits.
  useEffect(() => {
    if (!claim) return;
    if (saveStatus === 'pending' || saveStatus === 'saving') return;
    setFormState(initFormState(claim));
    lastSavedRef.current = initFormState(claim);
    setSaveStatus('idle');
    setErrorMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim?.id]);

  // -- load insurers master list once ------------------------------------
  useEffect(() => {
    fetch('/api/insurers')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setInsurers(Array.isArray(data) ? data : []))
      .catch(() => setInsurers([]));
  }, []);

  // -- field setter that schedules autosave ------------------------------
  function setField(key, value) {
    if (LOCKED_REGISTRATION_FIELDS.includes(key)) return; // defence in depth
    setFormState((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  }

  function scheduleSave(snapshot) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('pending');
    setErrorMsg(null);
    saveTimerRef.current = setTimeout(() => doSave(snapshot), AUTOSAVE_DEBOUNCE_MS);
  }

  // Cleanup on unmount.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // -- save -----------------------------------------------------------------
  async function doSave(snapshot) {
    if (!claim?.id) return;
    setSaveStatus('saving');
    try {
      const body = buildPutBody(snapshot, lastSavedRef.current);
      if (Object.keys(body).length === 0) {
        // Nothing changed — short-circuit.
        setSaveStatus('saved');
        return;
      }
      const res = await fetch(`/api/claims/${claim.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(userEmail ? { 'x-app-user-email': userEmail } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (HTTP ${res.status})`);
      }
      lastSavedRef.current = snapshot;
      setSaveStatus('saved');
      // Tell the parent so the Overview tab and any other readers refetch.
      if (typeof onSaved === 'function') onSaved();
    } catch (e) {
      setSaveStatus('error');
      setErrorMsg(e.message || 'Save failed');
    }
  }

  // -- save now (manual button) ------------------------------------------
  function saveNow() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    doSave(formState);
  }

  // -- insurer + offices --------------------------------------------------
  // resolvedInsurerId is derived from the form's insurer_name when the
  // master list is loaded. Stored only locally (the claims table has no
  // insurer_id column today).
  const resolvedInsurerId = useMemo(() => {
    if (formState._insurer_id) return formState._insurer_id;
    if (!formState.insurer_name || insurers.length === 0) return null;
    const target = formState.insurer_name.trim().toLowerCase();
    const match = insurers.find((i) => (i.company_name || '').trim().toLowerCase() === target);
    return match ? match.id : null;
  }, [formState._insurer_id, formState.insurer_name, insurers]);

  function onInsurerSelect(e) {
    const id = e.target.value ? Number(e.target.value) : null;
    if (id == null) {
      // Clear insurer + offices.
      setFormState((prev) => {
        const next = { ...prev,
          insurer_name: '', _insurer_id: null,
          appointing_office_id: null, appointing_office_name: '', appointing_office_address: '',
          policy_office_id:     null, policy_office_name:     '', policy_office_address:     '',
          fsr_office_id:        null, fsr_office_name:        '', fsr_office_address:        '',
        };
        scheduleSave(next);
        return next;
      });
      return;
    }
    const ins = insurers.find((i) => i.id === id);
    if (!ins) return;
    setFormState((prev) => {
      const insurerChanged = prev._insurer_id && prev._insurer_id !== id;
      const next = { ...prev, insurer_name: ins.company_name || '', _insurer_id: id };
      if (insurerChanged) {
        // Drop the existing 3-office picks — they belong to the previous
        // insurer and the server-side validator will reject them.
        for (const role of ['appointing', 'policy', 'fsr']) {
          next[`${role}_office_id`] = null;
          next[`${role}_office_name`] = '';
          next[`${role}_office_address`] = '';
        }
      }
      scheduleSave(next);
      return next;
    });
  }

  function onOfficeChange(role, office) {
    setFormState((prev) => {
      const next = { ...prev,
        [`${role}_office_id`]: office?.id ?? null,
        [`${role}_office_name`]: office?.name || '',
      };
      if (office) {
        const parts = [office.address, office.city, office.state, office.pin].filter(Boolean);
        next[`${role}_office_address`] = parts.join(', ');
      } else {
        next[`${role}_office_address`] = '';
      }
      scheduleSave(next);
      return next;
    });
  }

  // -- render -------------------------------------------------------------
  if (!claim) return null;

  return (
    <div style={wrapStyle}>
      <LockedSummary claim={claim} />

      <div style={headerStyle}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>Registration details</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            Edits autosave {Math.round(AUTOSAVE_DEBOUNCE_MS / 1000)}s after you stop typing.
            Identity fields (Ref #, Claim ID, timestamps, registered-by) are locked above.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SaveBadge status={saveStatus} />
          <button
            type="button"
            onClick={saveNow}
            disabled={saveStatus === 'saving' || saveStatus === 'idle' || saveStatus === 'saved'}
            style={saveButtonStyle(saveStatus)}
            title="Force a save now (bypasses the autosave debounce)"
          >
            Save now
          </button>
        </div>
      </div>

      {errorMsg && <div style={errorStyle}>⚠ {errorMsg}</div>}

      <InsurerBlock
        insurers={insurers}
        resolvedInsurerId={resolvedInsurerId}
        onInsurerSelect={onInsurerSelect}
        formState={formState}
        onOfficeChange={onOfficeChange}
      />

      <FormPane sections={SECTIONS} formState={formState} setField={setField} />
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function LockedSummary({ claim }) {
  return (
    <div style={lockedSummaryStyle}>
      <strong style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Identity (locked)
      </strong>
      <div style={lockedGridStyle}>
        <LockedField label="Ref #"          value={claim.ref_number} mono />
        <LockedField label="Claim ID"       value={String(claim.id)} mono />
        <LockedField label="Registered at"  value={fmtTs(claim.registered_at)} />
        <LockedField label="Registered by"  value={claim.registered_by || '—'} />
        <LockedField label="Created at"     value={fmtTs(claim.created_at)} />
      </div>
    </div>
  );
}

function LockedField({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#0f172a', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>
        {value || '—'}
      </div>
    </div>
  );
}

function InsurerBlock({ insurers, resolvedInsurerId, onInsurerSelect, formState, onOfficeChange }) {
  return (
    <div style={insurerBlockStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <label style={labelStyle}>
            Insurer <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <select value={resolvedInsurerId || ''} onChange={onInsurerSelect} style={inputStyle}>
            <option value="">— Select insurer —</option>
            {insurers.map((ins) => (
              <option key={ins.id} value={ins.id}>{ins.company_name}</option>
            ))}
          </select>
          <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
            Picks scope the 3 office searches. Changing the insurer clears the office picks.
          </p>
        </div>
        <ThreeOfficePicker
          insurerId={resolvedInsurerId}
          values={{
            appointing: formState.appointing_office_id || null,
            policy: formState.policy_office_id || null,
            fsr: formState.fsr_office_id || null,
          }}
          onChange={onOfficeChange}
        />
      </div>
    </div>
  );
}

function FormPane({ sections, formState, setField }) {
  return (
    <div style={paneStyle}>
      {sections.map((section) => (
        <div key={section.key} style={{ marginBottom: 18 }}>
          <h4 style={sectionTitleStyle}>{section.title}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {section.fields.map((f) => (
              <FieldWrap key={f.key} wide={f.type === 'textarea' || f.type === 'lob_subcategory'}>
                <FormField field={f} value={formState[f.key]} onChange={(v) => setField(f.key, v)} formState={formState} />
              </FieldWrap>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldWrap({ children, wide }) {
  return <div style={{ gridColumn: wide ? '1 / -1' : 'auto' }}>{children}</div>;
}

function FormField({ field, value, onChange, formState }) {
  const subcatOptions = field.type === 'lob_subcategory' ? subcategoriesFor(formState?.lob) : null;

  return (
    <div>
      <label style={labelStyle}>
        {field.label}
        {field.mandatory && <span style={{ color: '#dc2626' }}> *</span>}
      </label>
      {field.type === 'textarea' ? (
        <textarea
          rows={field.key === 'remark' ? 3 : 2}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={textareaStyle}
        />
      ) : field.type === 'lob_subcategory' ? (
        subcatOptions && subcatOptions.length > 0 ? (
          <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} style={inputStyle}>
            <option value="">— Select sub-category —</option>
            {subcatOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <div style={{ ...inputStyle, color: '#94a3b8', background: '#f8fafc' }}>
            Pick an LOB first
          </div>
        )
      ) : field.type === 'select' ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} style={inputStyle}>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt || '—'}</option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={value === true || value === 'true'}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.hint || 'Yes'}</span>
        </label>
      ) : (
        <input
          type={field.type}
          value={value ?? ''}
          onChange={(e) =>
            onChange(field.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)
          }
          style={inputStyle}
        />
      )}
      {field.hint && field.type !== 'boolean' && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{field.hint}</div>
      )}
    </div>
  );
}

function SaveBadge({ status }) {
  const cfg = {
    idle:    { label: 'No changes', color: '#94a3b8' },
    pending: { label: 'Saving soon…', color: '#3b82f6' },
    saving:  { label: 'Saving…', color: '#3b82f6' },
    saved:   { label: '✓ Saved', color: '#15803d' },
    error:   { label: '⚠ Save failed', color: '#dc2626' },
  }[status] || { label: status, color: '#475569' };
  return <span style={{ fontSize: 12, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>;
}

// =============================================================================
// Local utility helpers (display only — pure state lives in
// lib/claimDetailsEditorState.js so tests can import without React)
// =============================================================================

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(ts);
  }
}

// =============================================================================
// Styles
// =============================================================================

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 14, padding: 16 };

const lockedSummaryStyle = {
  padding: 12,
  background: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
};
const lockedGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  marginTop: 8,
};

const headerStyle = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
};

function saveButtonStyle(status) {
  const disabled = status === 'saving' || status === 'idle' || status === 'saved';
  return {
    padding: '6px 14px', fontSize: 12, fontWeight: 600,
    border: '1px solid #cbd5e1', borderRadius: 6,
    background: disabled ? '#f1f5f9' : '#fff',
    color: '#0f172a',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

const errorStyle = {
  padding: '8px 12px',
  background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 6, color: '#991b1b', fontSize: 12,
};

const insurerBlockStyle = {
  padding: 14,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
};

const paneStyle = {
  padding: 16,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 13,
};

const sectionTitleStyle = {
  margin: '0 0 8px', fontSize: 14, color: '#1e40af',
  borderBottom: '1px solid #e2e8f0', paddingBottom: 4,
};

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#475569',
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
};

const inputStyle = {
  width: '100%', padding: '7px 10px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 6,
  background: '#fff', outline: 'none', boxSizing: 'border-box',
};

const textareaStyle = {
  ...inputStyle,
  minHeight: 60,
  resize: 'vertical',
  fontFamily: 'inherit',
};
