'use client';
// =============================================================================
// /insurer-master/register
// =============================================================================
// AI-assisted Insurer Registration Agent. Three input modes feed into the
// same Review screen — once the agent extracts an insurer + offices payload
// from the user's chosen evidence (typed name, URL, or document), the user
// edits the result inline and saves to the master.
//
// Spec / contract:
//   - lib/insurerAgent/extractor.js owns the JSON shape the API returns.
//   - lib/insurerAgent/confidence.js promotes/demotes per-field ratings.
//   - lib/insurerAgent/autoLink.js owns hierarchy validation + parent
//     suggestions (used live so Save stays disabled until clean).
//
// All styling is plain CSS — uses classes from app/globals.css (button,
// .success, .secondary, .mis-table, .alert) + inline styles where the
// existing classes don't cover. No Tailwind, no shadcn.
// =============================================================================

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import {
  OFFICE_CODE_LIST,
  OFFICE_TYPE_LABELS,
  OFFICE_TYPE_SHORT_LABELS,
  OFFICE_TYPE_COLORS,
  ALLOWED_PARENT_TYPES,
  isValidParent,
} from '@/lib/insurerOfficeTypes';
import { ALLOWED_OWNERSHIP_TYPES } from '@/lib/insurerAgent/extractor';
import {
  suggestParents,
  validateOffices,
} from '@/lib/insurerAgent/autoLink';

const MODES = [
  { key: 'name', label: 'By name', hint: 'Type the insurer’s name and let the agent draft the master entry.' },
  { key: 'url',  label: 'By URL',  hint: 'Paste the insurer’s branch-locator page; the agent extracts what’s on it.' },
  { key: 'doc',  label: 'By document', hint: 'Upload a PDF, image, or XLSX. PDF/image OCR’s, XLSX rows are classified.' },
];

const INSURER_FIELD_LIST = [
  { key: 'company_name', label: 'Company name', required: true },
  { key: 'code', label: 'Code (acronym)', placeholder: 'e.g. ICICI, NIA, OIC' },
  { key: 'irdai_reg_no', label: 'IRDAI Registration #' },
  { key: 'gstin', label: 'GSTIN', monospace: true },
  { key: 'ownership_type', label: 'Ownership type', kind: 'select', options: ['', ...ALLOWED_OWNERSHIP_TYPES] },
  { key: 'registered_address', label: 'Registered address', kind: 'textarea' },
  { key: 'city', label: 'Head-office city' },
  { key: 'state', label: 'Head-office state' },
  { key: 'pin', label: 'PIN', monospace: true },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
];

export default function InsurerRegisterPage() {
  const router = useRouter();
  const { user } = useAuth();

  // Extraction phase state
  const [mode, setMode] = useState('name');
  const [nameInput, setNameInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [fileInput, setFileInput] = useState(null);
  const [extracting, setExtracting] = useState(false);

  // Review phase state — set once the agent returns
  const [insurer, setInsurer] = useState(null);            // { ...10 fields }
  const [offices, setOffices] = useState([]);              // [{office_code,name,city,state,address,parent_name,is_active}]
  const [confidences, setConfidences] = useState({});      // { 'insurer.<f>'|'offices[i].<f>': 'high'|'medium'|'low' }
  const [extractionNotes, setExtractionNotes] = useState(null);
  const [existingMatch, setExistingMatch] = useState(null);
  const [llmMeta, setLlmMeta] = useState(null);
  const [sourceMeta, setSourceMeta] = useState(null);

  // Bulk-edit on offices table
  const [selectedOfficeIdxs, setSelectedOfficeIdxs] = useState([]);

  // Save phase
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  function showAlert(msg, type = 'error') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  // ----- Extraction triggers -----------------------------------------------

  async function runByName() {
    const name = nameInput.trim();
    if (name.length < 2) return showAlert('Enter at least 2 characters');
    setExtracting(true);
    setAlert(null);
    try {
      const res = await fetch('/api/insurers/agent/lookup-by-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      applyExtraction(json);
    } catch (e) {
      showAlert(`Lookup failed: ${e.message}`);
    } finally {
      setExtracting(false);
    }
  }

  async function runByUrl() {
    const url = urlInput.trim();
    if (!/^https?:\/\//i.test(url)) return showAlert('Paste a full http(s) URL');
    setExtracting(true);
    setAlert(null);
    try {
      const res = await fetch('/api/insurers/agent/lookup-by-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      applyExtraction(json);
    } catch (e) {
      showAlert(`URL extraction failed: ${e.message}`);
    } finally {
      setExtracting(false);
    }
  }

  async function runByDocument() {
    if (!fileInput) return showAlert('Pick a file first');
    setExtracting(true);
    setAlert(null);
    try {
      const fd = new FormData();
      fd.append('file', fileInput);
      const res = await fetch('/api/insurers/agent/lookup-by-document', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      applyExtraction(json);
    } catch (e) {
      showAlert(`Document extraction failed: ${e.message}`);
    } finally {
      setExtracting(false);
    }
  }

  function applyExtraction(json) {
    setInsurer(json.insurer || {});
    setOffices(
      Array.isArray(json.offices)
        ? json.offices.map((o) => ({ ...o, is_active: true }))
        : []
    );
    setConfidences(json.field_confidences || {});
    setExtractionNotes(json.extraction_notes || null);
    setExistingMatch(json.existing_match || null);
    setLlmMeta(json.llm || null);
    setSourceMeta(json.source || (json.source_url ? { kind: 'url', url: json.source_url } : null));
    setSelectedOfficeIdxs([]);
  }

  function resetReview() {
    setInsurer(null);
    setOffices([]);
    setConfidences({});
    setExtractionNotes(null);
    setExistingMatch(null);
    setLlmMeta(null);
    setSourceMeta(null);
    setSelectedOfficeIdxs([]);
  }

  // ----- Live validation ---------------------------------------------------

  const validation = useMemo(() => {
    if (!insurer) return { errors: [] };
    const errs = [];
    if (!insurer.company_name || String(insurer.company_name).trim().length < 2) {
      errs.push('Company name is required.');
    }
    if (
      insurer.ownership_type &&
      !ALLOWED_OWNERSHIP_TYPES.includes(insurer.ownership_type)
    ) {
      errs.push(`Ownership type must be one of: ${ALLOWED_OWNERSHIP_TYPES.join(', ')}.`);
    }
    if (insurer.pin && !/^[1-9][0-9]{5}$/.test(String(insurer.pin).trim())) {
      errs.push('PIN must be 6 digits starting with 1–9.');
    }
    const officeRes = validateOffices(offices);
    errs.push(...officeRes.errors);
    return { errors: errs };
  }, [insurer, offices]);

  const canSave = !saving && validation.errors.length === 0;

  // ----- Office row mutations ---------------------------------------------

  function updateOffice(idx, patch) {
    setOffices((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function addOfficeRow() {
    setOffices((prev) => [
      ...prev,
      { office_code: 'BO', name: '', city: '', state: '', address: '', parent_name: '', is_active: true },
    ]);
  }
  function deleteOfficeRow(idx) {
    setOffices((prev) => prev.filter((_, i) => i !== idx));
    setSelectedOfficeIdxs((prev) => prev.filter((j) => j !== idx).map((j) => (j > idx ? j - 1 : j)));
  }
  function bulkSetCode(code) {
    setOffices((prev) =>
      prev.map((o, i) => (selectedOfficeIdxs.includes(i) ? { ...o, office_code: code } : o))
    );
  }
  function bulkSetActive(active) {
    setOffices((prev) =>
      prev.map((o, i) => (selectedOfficeIdxs.includes(i) ? { ...o, is_active: active } : o))
    );
  }
  function bulkDelete() {
    if (selectedOfficeIdxs.length === 0) return;
    if (!confirm(`Delete ${selectedOfficeIdxs.length} selected offices?`)) return;
    const drop = new Set(selectedOfficeIdxs);
    setOffices((prev) => prev.filter((_, i) => !drop.has(i)));
    setSelectedOfficeIdxs([]);
  }
  function autoLinkParents() {
    const suggestions = suggestParents(offices);
    let touched = 0;
    const next = offices.map((o, i) => {
      if (o.parent_name && String(o.parent_name).trim()) return o;
      const s = suggestions[i];
      if (!s || s.parentIndex == null) return o;
      const parent = offices[s.parentIndex];
      if (!parent?.name) return o;
      touched += 1;
      return { ...o, parent_name: parent.name };
    });
    setOffices(next);
    showAlert(`Auto-linked ${touched} office${touched === 1 ? '' : 's'}.`, 'success');
  }

  function toggleSelected(idx) {
    setSelectedOfficeIdxs((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  }
  function toggleSelectAll() {
    if (selectedOfficeIdxs.length === offices.length) setSelectedOfficeIdxs([]);
    else setSelectedOfficeIdxs(offices.map((_, i) => i));
  }

  // ----- Save --------------------------------------------------------------

  async function commit() {
    if (!canSave) return;
    setSaving(true);
    try {
      const cleaned = {
        insurer: { ...insurer },
        offices: offices.map((o) => ({
          office_code: o.office_code,
          name: String(o.name || '').trim(),
          city: nz(o.city),
          state: nz(o.state),
          address: nz(o.address),
          parent_name: nz(o.parent_name),
          is_active: o.is_active !== false,
        })),
      };
      const res = await fetch('/api/insurers/agent/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.email ? { 'x-app-user-email': user.email } : {}),
        },
        body: JSON.stringify(cleaned),
      });
      const json = await res.json();
      if (res.status === 409) {
        showAlert(
          `Insurer already exists${json?.existing_match?.company_name ? `: ${json.existing_match.company_name}` : ''}. Edit the existing entry from the master list.`
        );
        setExistingMatch(json?.existing_match || null);
        return;
      }
      if (!res.ok) {
        const msg = Array.isArray(json?.errors) ? json.errors.join('; ') : json?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const flash = encodeURIComponent(
        `Registered ${cleaned.insurer.company_name} (${json.offices_created} office${json.offices_created === 1 ? '' : 's'}).`
      );
      router.push(`/insurer-master?flash=${flash}`);
    } catch (e) {
      showAlert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ============================ render ====================================

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Register insurer (AI-assisted)</h2>
          <button className="secondary" onClick={() => router.push('/insurer-master')}>
            ← Back to master
          </button>
        </div>

        {!insurer ? (
          <ExtractionPanel
            mode={mode} setMode={setMode}
            nameInput={nameInput} setNameInput={setNameInput}
            urlInput={urlInput} setUrlInput={setUrlInput}
            fileInput={fileInput} setFileInput={setFileInput}
            extracting={extracting}
            runByName={runByName} runByUrl={runByUrl} runByDocument={runByDocument}
          />
        ) : (
          <>
            {existingMatch && <ExistingMatchBanner match={existingMatch} />}
            {extractionNotes && (
              <div style={notesStyle}>
                <strong>Agent notes:</strong> {extractionNotes}
              </div>
            )}
            <ReviewSummary llm={llmMeta} source={sourceMeta} onReset={resetReview} />

            <InsurerCard insurer={insurer} setInsurer={setInsurer} confidences={confidences} />

            <OfficesTable
              offices={offices}
              confidences={confidences}
              selectedIdxs={selectedOfficeIdxs}
              onToggle={toggleSelected}
              onToggleAll={toggleSelectAll}
              onUpdate={updateOffice}
              onDelete={deleteOfficeRow}
              onAdd={addOfficeRow}
              onAutoLink={autoLinkParents}
              onBulkSetCode={bulkSetCode}
              onBulkSetActive={bulkSetActive}
              onBulkDelete={bulkDelete}
            />

            <ValidationPanel errors={validation.errors} />

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={resetReview} disabled={saving}>
                Discard & start over
              </button>
              <button
                className="success"
                onClick={commit}
                disabled={!canSave}
                title={canSave ? 'Save to master' : 'Resolve the validation errors above'}
              >
                {saving ? 'Saving…' : `Save to master (${offices.length} office${offices.length === 1 ? '' : 's'})`}
              </button>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function ExtractionPanel({
  mode, setMode,
  nameInput, setNameInput,
  urlInput, setUrlInput,
  fileInput, setFileInput,
  extracting,
  runByName, runByUrl, runByDocument,
}) {
  const cur = MODES.find((m) => m.key === mode) || MODES[0];
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid #cbd5e1',
              borderBottom: mode === m.key ? '3px solid #1e40af' : '1px solid #cbd5e1',
              background: mode === m.key ? '#eff6ff' : '#f8fafc',
              color: mode === m.key ? '#1e40af' : '#475569',
              borderRadius: '6px 6px 0 0',
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>{cur.hint}</p>

      {mode === 'name' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Insurer name</label>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder='e.g. "ICICI Lombard" or "New India Assurance"'
              disabled={extracting}
              onKeyDown={(e) => { if (e.key === 'Enter') runByName(); }}
            />
          </div>
          <button className="success" onClick={runByName} disabled={extracting || !nameInput.trim()}>
            {extracting ? 'Looking up…' : 'Look up'}
          </button>
        </div>
      )}

      {mode === 'url' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>URL of branch / contact page</label>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder='https://www.example.com/contact-us'
              disabled={extracting}
              onKeyDown={(e) => { if (e.key === 'Enter') runByUrl(); }}
            />
          </div>
          <button className="success" onClick={runByUrl} disabled={extracting || !urlInput.trim()}>
            {extracting ? 'Fetching…' : 'Fetch & extract'}
          </button>
        </div>
      )}

      {mode === 'doc' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>PDF / image / XLSX</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff,.xlsx,.xls,.csv,application/pdf,image/*,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFileInput(e.target.files?.[0] || null)}
              disabled={extracting}
            />
            {fileInput && (
              <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
                {fileInput.name} · {(fileInput.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>
          <button className="success" onClick={runByDocument} disabled={extracting || !fileInput}>
            {extracting ? 'Processing…' : 'Extract'}
          </button>
        </div>
      )}

      {extracting && (
        <p style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
          The agent runs Gemini → Claude with a 30s budget per provider. Document mode adds an OCR pass.
        </p>
      )}
    </div>
  );
}

function ExistingMatchBanner({ match }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 8,
        fontSize: 13,
        color: '#78350f',
      }}
    >
      ⚠ <strong>Insurer may already exist.</strong>{' '}
      <a href={`/insurer-master?focus=${match.id}`} style={{ color: '#92400e', textDecoration: 'underline' }}>
        {match.company_name}
        {match.code ? ` (${match.code})` : ''}
      </a>{' '}
      is already in the master. Saving here will fail with a duplicate error — open the existing entry to add offices, or rename above to register a new insurer.
    </div>
  );
}

function ReviewSummary({ llm, source, onReset }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '8px 12px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
        fontSize: 11,
        color: '#475569',
      }}
    >
      <span>Review the agent output below — every field is editable.</span>
      {llm && (
        <span>
          <strong>{llm.provider}</strong>
          {llm.model ? ` · ${llm.model}` : ''}
          {llm.latencyMs ? ` · ${(llm.latencyMs / 1000).toFixed(1)}s` : ''}
          {llm.costInr ? ` · ₹${Number(llm.costInr).toFixed(3)}` : ''}
        </span>
      )}
      {source?.kind === 'ocr' && (
        <span>Source: OCR ({source.ocr_provider}) · {source.pages || 0} page{source.pages === 1 ? '' : 's'}</span>
      )}
      {source?.kind === 'xlsx' && <span>Source: XLSX ({source.filename})</span>}
      {source?.url && <span>Source: <code>{source.url}</code></span>}
      <span style={{ marginLeft: 'auto' }}>
        <button className="secondary" onClick={onReset} style={{ padding: '4px 10px', fontSize: 11 }}>
          Re-extract
        </button>
      </span>
    </div>
  );
}

function InsurerCard({ insurer, setInsurer, confidences }) {
  function set(k, v) {
    setInsurer((prev) => ({ ...prev, [k]: v }));
  }
  return (
    <div style={{ ...cardStyle, marginTop: 12 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#1e40af' }}>Insurer</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {INSURER_FIELD_LIST.map((f) => {
          const span = f.kind === 'textarea' ? 2 : 1;
          return (
            <div key={f.key} style={{ gridColumn: `span ${span}` }}>
              <label style={labelStyle}>
                {f.label}
                {f.required && <span style={{ color: '#dc2626' }}> *</span>}
                <ConfidenceChip level={confidences[`insurer.${f.key}`]} />
              </label>
              {f.kind === 'textarea' ? (
                <textarea
                  rows={2}
                  value={insurer[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  style={{ ...inputBase, minHeight: 60, resize: 'vertical' }}
                />
              ) : f.kind === 'select' ? (
                <select value={insurer[f.key] || ''} onChange={(e) => set(f.key, e.target.value || null)} style={inputBase}>
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>{opt || '—'}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={insurer[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder || ''}
                  style={{ ...inputBase, fontFamily: f.monospace ? 'monospace' : 'inherit' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OfficesTable({
  offices, confidences,
  selectedIdxs, onToggle, onToggleAll,
  onUpdate, onDelete, onAdd, onAutoLink,
  onBulkSetCode, onBulkSetActive, onBulkDelete,
}) {
  const officeNames = offices.map((o) => o.name).filter(Boolean);
  const allSelected = offices.length > 0 && selectedIdxs.length === offices.length;

  return (
    <div style={{ ...cardStyle, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, color: '#1e40af', flex: 1 }}>Offices ({offices.length})</h3>
        <button onClick={onAutoLink} className="secondary" style={{ fontSize: 12, padding: '6px 12px' }}>
          Auto-link parents
        </button>
        <button onClick={onAdd} className="success" style={{ fontSize: 12, padding: '6px 12px' }}>
          + Add row
        </button>
      </div>

      {selectedIdxs.length > 0 && (
        <div
          style={{
            padding: '8px 12px',
            background: '#eff6ff',
            border: '1px solid #93c5fd',
            borderRadius: 6,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          <strong>{selectedIdxs.length} selected</strong>
          <span style={{ color: '#475569' }}>· bulk:</span>
          <select
            onChange={(e) => { if (e.target.value) onBulkSetCode(e.target.value); e.target.value = ''; }}
            defaultValue=""
            style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
          >
            <option value="">Set type…</option>
            {OFFICE_CODE_LIST.map((c) => (
              <option key={c} value={c}>{c} — {OFFICE_TYPE_LABELS[c]}</option>
            ))}
          </select>
          <button onClick={() => onBulkSetActive(true)} style={pillBtn}>Set active</button>
          <button onClick={() => onBulkSetActive(false)} style={pillBtn}>Set inactive</button>
          <button onClick={onBulkDelete} style={{ ...pillBtn, borderColor: '#fca5a5', color: '#b91c1c' }}>
            Delete
          </button>
        </div>
      )}

      <div className="mis-table-container">
        <table className="mis-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
              </th>
              <th style={{ width: 110 }}>Type</th>
              <th>Name</th>
              <th>City</th>
              <th>State</th>
              <th>Parent</th>
              <th style={{ width: 70 }}>Active</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {offices.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>
                  No offices yet. Click <strong>+ Add row</strong> to start manually.
                </td>
              </tr>
            )}
            {offices.map((o, i) => (
              <OfficeRow
                key={i}
                index={i}
                office={o}
                officeNames={officeNames}
                offices={offices}
                selected={selectedIdxs.includes(i)}
                onToggle={() => onToggle(i)}
                onUpdate={(patch) => onUpdate(i, patch)}
                onDelete={() => onDelete(i)}
                confidences={confidences}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OfficeRow({ index, office, offices, selected, onToggle, onUpdate, onDelete, confidences }) {
  const code = String(office.office_code || '').toUpperCase();
  const allowedParentCodes = ALLOWED_PARENT_TYPES[code] || [];
  const parentOptions = code === 'HO'
    ? []
    : offices
        .map((o, j) => ({ idx: j, office: o }))
        .filter(({ idx, office: o }) =>
          idx !== index &&
          o.name &&
          allowedParentCodes.includes(String(o.office_code || '').toUpperCase())
        );
  const colorCfg = OFFICE_TYPE_COLORS[code] || { bg: '#e2e8f0', fg: '#334155' };

  return (
    <tr style={{ background: selected ? '#eff6ff' : 'transparent' }}>
      <td>
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </td>
      <td>
        <select
          value={code}
          onChange={(e) => onUpdate({ office_code: e.target.value })}
          style={{ ...inputBase, padding: '4px 6px', fontSize: 12, fontWeight: 700, color: colorCfg.fg, background: colorCfg.bg }}
        >
          {OFFICE_CODE_LIST.map((c) => (
            <option key={c} value={c}>{OFFICE_TYPE_SHORT_LABELS[c]} — {OFFICE_TYPE_LABELS[c]}</option>
          ))}
        </select>
      </td>
      <td>
        <input
          value={office.name || ''}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={{ ...inputBase, padding: '4px 6px', fontSize: 12 }}
          placeholder="Office name"
        />
        <ConfidenceChip level={confidences[`offices[${index}].name`]} small />
      </td>
      <td>
        <input
          value={office.city || ''}
          onChange={(e) => onUpdate({ city: e.target.value })}
          style={{ ...inputBase, padding: '4px 6px', fontSize: 12 }}
        />
        <ConfidenceChip level={confidences[`offices[${index}].city`]} small />
      </td>
      <td>
        <input
          value={office.state || ''}
          onChange={(e) => onUpdate({ state: e.target.value })}
          style={{ ...inputBase, padding: '4px 6px', fontSize: 12 }}
        />
      </td>
      <td>
        {code === 'HO' ? (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>— root —</span>
        ) : parentOptions.length === 0 ? (
          <span style={{ fontSize: 11, color: '#b45309' }}>
            no eligible parent ({allowedParentCodes.join('/')})
          </span>
        ) : (
          <select
            value={office.parent_name || ''}
            onChange={(e) => onUpdate({ parent_name: e.target.value || null })}
            style={{ ...inputBase, padding: '4px 6px', fontSize: 12 }}
          >
            <option value="">— pick parent —</option>
            {parentOptions.map(({ idx, office: p }) => (
              <option key={idx} value={p.name}>
                [{OFFICE_TYPE_SHORT_LABELS[String(p.office_code).toUpperCase()] || p.office_code}] {p.name}
              </option>
            ))}
          </select>
        )}
      </td>
      <td style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={office.is_active !== false}
          onChange={(e) => onUpdate({ is_active: e.target.checked })}
        />
      </td>
      <td>
        <button
          onClick={onDelete}
          title="Delete row"
          style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

function ValidationPanel({ errors }) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return (
      <div
        style={{
          marginTop: 12, padding: '8px 12px', background: '#f0fdf4',
          border: '1px solid #86efac', borderRadius: 6, fontSize: 12, color: '#166534',
        }}
      >
        ✓ Validation passes. Save is enabled.
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 12, padding: '10px 14px', background: '#fef2f2',
        border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, color: '#991b1b',
      }}
    >
      <strong>{errors.length} issue{errors.length === 1 ? '' : 's'} block Save:</strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {errors.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </div>
  );
}

function ConfidenceChip({ level, small }) {
  if (!level) return null;
  const cfg = {
    high:   { bg: '#dcfce7', color: '#15803d', label: 'high' },
    medium: { bg: '#fef3c7', color: '#b45309', label: 'med' },
    low:    { bg: '#fee2e2', color: '#b91c1c', label: 'low' },
  }[level];
  if (!cfg) return null;
  return (
    <span
      title={`AI confidence: ${level}`}
      style={{
        display: 'inline-block',
        marginLeft: 6,
        padding: small ? '0 4px' : '1px 6px',
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        background: cfg.bg,
        color: cfg.color,
        borderRadius: 3,
        verticalAlign: 'middle',
      }}
    >
      {cfg.label}
    </span>
  );
}

// ----- Local style atoms ----------------------------------------------------

const cardStyle = {
  marginTop: 16,
  padding: 16,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
};
const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 4,
};
const inputBase = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};
const pillBtn = {
  fontSize: 11,
  padding: '4px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 999,
  background: '#fff',
  cursor: 'pointer',
};
const notesStyle = {
  marginTop: 12,
  padding: '8px 12px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 12,
  color: '#475569',
};

function nz(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
