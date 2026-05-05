'use client';
// =============================================================================
// components/fsr/FsrRenderPanel.jsx
// =============================================================================
// Top-level UI for the template-based FSR drafting flow (Slice 4 + 5).
//
// Responsibilities:
//   1. Discover the latest non-approved draft for the claim, or render a
//      fresh one against the active fsr_lob_templates row.
//   2. Surface a template_name dropdown so surveyors can switch between
//      Production / ILA / future per-insurer variants.
//   3. Render the in-place narrative editor (`<NarrativeEditor>`) — every
//      keystroke debounces a save to claim_fsr_drafts.narrative_jsonb and
//      a re-render against the template, so the preview stays live.
//   4. Display the rendered HTML in a preview pane plus the
//      missing_placeholders list as a click-through checklist.
//   5. Provide one-click PDF / Word download of the current draft_content
//      via the existing puppeteer-server proxy.
//
// Used by `app/claim-detail/[id]/page.js` for non-EW LOBs (Marine Cargo,
// Fire — and anything else after Slice 11/12). The EW flow keeps using
// /api/ew-fsr-generate which has its own template-rendering pipeline.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import NarrativeEditor from './NarrativeEditor';
import { labelForPlaceholder } from '@/lib/fsr/narrativeFields';

const SAVE_DEBOUNCE_MS = 800;

export default function FsrRenderPanel({ claim, userEmail }) {
  const claimId = claim?.id;
  const lob = claim?.lob;

  // -- core state ---------------------------------------------------------
  const [latestDraft, setLatestDraft] = useState(null);
  const [templateName, setTemplateName] = useState('Production');
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [narrative, setNarrative] = useState({});
  const [renderedHtml, setRenderedHtml] = useState('');
  const [missingPlaceholders, setMissingPlaceholders] = useState([]);
  const [renderTemplateMeta, setRenderTemplateMeta] = useState(null);

  // -- ux flags -----------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingWord, setDownloadingWord] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [aiDraftingKey, setAiDraftingKey] = useState(null);  // section key being drafted, or null
  // 'Prepare with AI' (auto-prepare) — manual button. Reads everything tagged
  // to the claim (claim_documents OCR + intimation body + claim row + loss
  // sheet + lifecycle template) and asks the LLM to populate the narrative
  // form's fields. Backed by /api/fsr-drafts/auto-prepare.
  const [autoPreparing, setAutoPreparing] = useState(false);
  const [autoPrepareResult, setAutoPrepareResult] = useState(null); // last run's stats

  // Keep a ref so the debounce closure always sees the latest narrative
  const narrativeRef = useRef(narrative);
  narrativeRef.current = narrative;
  const debounceRef = useRef(null);

  // -- initial load -------------------------------------------------------
  useEffect(() => {
    if (!claimId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Load templates available for this (company, lob) so the dropdown
        // can show real options instead of guessing.
        const tplRes = await fetch(
          `/api/fsr-lob-templates?lob=${encodeURIComponent(lob || '')}&company=${encodeURIComponent(claim.company || 'NISLA')}`
        );
        const tplData = await tplRes.json().catch(() => []);
        if (alive) {
          const list = Array.isArray(tplData) ? tplData : [];
          setAvailableTemplates(list);
        }

        // Load the latest draft
        const draftsRes = await fetch(`/api/ai/fsr-drafts?claim_id=${claimId}`);
        const drafts = await draftsRes.json().catch(() => []);
        if (!alive) return;
        const list = Array.isArray(drafts) ? drafts : [];
        const latest = list[0] || null;
        setLatestDraft(latest);
        if (latest?.narrative_jsonb) setNarrative(latest.narrative_jsonb);
        if (latest?.template_name)   setTemplateName(latest.template_name);
        if (latest?.draft_content)   setRenderedHtml(latest.draft_content);
        // If there's no draft yet, kick off an initial render so the
        // surveyor sees something. save:true creates v1.
        if (!latest) await renderNow({ initial: true });
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load draft');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId, lob]);

  // -- debounced auto-render on narrative edits ---------------------------
  function scheduleRender() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      renderNow({ silent: true });
    }, SAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // -- render call --------------------------------------------------------
  async function renderNow({ initial = false, silent = false } = {}) {
    if (!claimId) return;
    if (!silent) setRendering(true);
    setError(null);
    try {
      const res = await fetch('/api/fsr-drafts/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_id: claimId,
          template_name: templateName,
          company: claim.company,
          lob,
          narrative_jsonb: narrativeRef.current,
          user_email: userEmail,
          save: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Render failed');
      setLatestDraft(data.draft);
      setRenderedHtml(data.html);
      setMissingPlaceholders(data.missing_placeholders || []);
      setRenderTemplateMeta(data.template);
      setSavedAt(new Date());
      // When the lifecycle resolver chose a template that differs from what
      // we sent (the common case for new Ultratech / Tata Motors / etc.
      // claims whose first render comes in with default 'Production'), align
      // the editor's templateName state so the right narrative field set
      // shows. Don't overwrite when the user explicitly switched templates
      // (source='override') — their pick is the source of truth.
      if (
        data.template?.source === 'lifecycle' &&
        data.template?.name &&
        data.template.name !== templateName
      ) {
        setTemplateName(data.template.name);
      }
    } catch (e) {
      setError(e.message || 'Render failed');
    } finally {
      if (!silent) setRendering(false);
    }
  }

  // -- when the surveyor changes templateName, re-render immediately ------
  function onTemplateNameChange(next) {
    setTemplateName(next);
    setTimeout(() => renderNow({ silent: false }), 0);
  }

  // -- narrative-editor callbacks -----------------------------------------
  function onNarrativeChange(next) {
    setNarrative(next);
    scheduleRender();
  }

  // Slice 6: ✨ AI button per textarea. Fetches a single-section draft from
  // /api/ai/fsr-narrative and patches it into the local narrative state.
  // The next render will pick up the new value via the auto-render debounce.
  async function onAiDraft(sectionKey) {
    if (!sectionKey || !claimId || aiDraftingKey) return;
    setAiDraftingKey(sectionKey);
    setError(null);
    try {
      const res = await fetch('/api/ai/fsr-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, section: sectionKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'AI draft failed');
      // Confirm with the surveyor before overwriting if there's existing text.
      const existing = (narrativeRef.current?.[sectionKey] || '').trim();
      if (existing && !window.confirm(
        `Replace your existing "${data.field_label || sectionKey}" with the AI draft?\n\n` +
        `Your current text:\n${truncate(existing, 200)}\n\n` +
        `AI draft:\n${truncate(data.draft, 200)}`
      )) {
        return;  // surveyor cancelled
      }
      const next = { ...narrativeRef.current, [sectionKey]: data.draft };
      setNarrative(next);
      scheduleRender();
    } catch (e) {
      setError(`AI draft failed: ${e.message}`);
    } finally {
      setAiDraftingKey(null);
    }
  }

  // -- 'Prepare with AI' — manual button that asks the LLM to compile
  // every input the portal has against this claim into the narrative form.
  // See /api/fsr-drafts/auto-prepare and lib/fsr/narrativeAutoPreparePrompt.
  async function autoPrepareWithAi() {
    if (!claimId || autoPreparing) return;
    setAutoPreparing(true);
    setError(null);
    setAutoPrepareResult(null);
    try {
      const res = await fetch('/api/fsr-drafts/auto-prepare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userEmail ? { 'x-app-user-email': userEmail } : {}),
        },
        body: JSON.stringify({ claim_id: claimId, user_email: userEmail }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        // Surface the resolver's machine-readable codes (LIFECYCLE_NOT_INITIALIZED,
        // FSR_TEMPLATE_NOT_CONFIGURED, NARRATIVE_SCHEMA_NOT_CONFIGURED) so the
        // surveyor sees actionable copy, not a raw HTTP error.
        if (data?.code === 'LIFECYCLE_NOT_INITIALIZED') {
          throw new Error('Initialize the lifecycle workflow before AI auto-prepare. Open the claim, attach a lifecycle template, then try again.');
        }
        if (data?.code === 'FSR_TEMPLATE_NOT_CONFIGURED' || data?.code === 'NARRATIVE_SCHEMA_NOT_CONFIGURED') {
          throw new Error("This claim's lifecycle template isn't wired to a known FSR template — AI auto-prepare can't run. Type fields manually.");
        }
        throw new Error(data?.error || `Auto-prepare failed (HTTP ${res.status})`);
      }
      // Update local state so the form + preview refresh immediately.
      setNarrative(data.narrative);
      narrativeRef.current = data.narrative;
      setRenderedHtml(data.html);
      setLatestDraft(data.draft);
      setRenderTemplateMeta(data.template);
      setMissingPlaceholders([]); // server returns a fresh draft; let next renderNow refresh missing list
      setAutoPrepareResult(data.stats || null);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || 'Auto-prepare failed');
    } finally {
      setAutoPreparing(false);
    }
  }

  // -- PDF / Word download via puppeteer-server proxy ---------------------
  async function downloadPdf() {
    if (!renderedHtml) return;
    setDownloadingPdf(true);
    try {
      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: renderedHtml, filename: `FSR-${claim.ref_number || 'report'}.pdf` }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `PDF generation failed (${res.status})`);
      }
      const data = await res.json().catch(() => null);
      if (data?.path) {
        // Saved to D:\2026-27\... — open via the file proxy
        window.open(`/api/file-proxy?path=${encodeURIComponent(data.path)}`, '_blank');
      } else {
        // Fallback: open the rendered HTML in a print-ready window
        const w = window.open();
        w.document.write(renderedHtml);
        w.document.close();
        w.print();
      }
    } catch (e) {
      alert('PDF error: ' + e.message);
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function downloadWord() {
    if (!renderedHtml) return;
    setDownloadingWord(true);
    try {
      const { downloadAsWord } = await import('@/lib/documentExport');
      downloadAsWord(renderedHtml, `FSR-${claim.ref_number || 'report'}.doc`);
    } catch (e) {
      alert('Word export error: ' + e.message);
    } finally {
      setDownloadingWord(false);
    }
  }

  // -- derive: only narrative.* placeholders for the checklist ----------
  const narrativeMissing = useMemo(
    () => missingPlaceholders.filter((p) => p.startsWith('narrative.')),
    [missingPlaceholders]
  );
  const otherMissing = useMemo(
    () => missingPlaceholders.filter((p) => !p.startsWith('narrative.')),
    [missingPlaceholders]
  );

  // -- render -------------------------------------------------------------

  if (!claim) return null;

  if (loading) {
    return <div style={{ padding: 30, color: '#64748b' }}>Loading FSR draft…</div>;
  }

  const draftIsFinal = latestDraft?.status === 'approved' || latestDraft?.status === 'superseded';

  return (
    <div>
      {/* Header bar */}
      <div style={headerBarStyle}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
            {claim.lob || 'Claim'} FSR — Template-based
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {latestDraft
              ? <>Draft v{latestDraft.version_number} · status: <strong>{latestDraft.status}</strong>{savedAt && <> · saved {savedAt.toLocaleTimeString('en-IN')}</>}</>
              : <>No draft yet — fill the narrative below and a draft will be created automatically.</>
            }
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Template dropdown */}
          <label style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
            Template:
            <select
              value={templateName}
              onChange={(e) => onTemplateNameChange(e.target.value)}
              disabled={draftIsFinal}
              style={selectStyle(draftIsFinal)}
            >
              {/* Always offer the standards even if not yet seeded for this lob */}
              {dedupe(['Production', 'Default', 'ILA', ...availableTemplates.map((t) => t.template_name)]).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          {/* Re-render */}
          <button
            type="button"
            onClick={() => renderNow()}
            disabled={rendering || draftIsFinal}
            style={primaryBtn(rendering || draftIsFinal)}
          >
            {rendering ? 'Rendering…' : '🔄 Re-render'}
          </button>

          {/* Downloads */}
          <button type="button" onClick={downloadPdf} disabled={!renderedHtml || downloadingPdf} style={pdfBtn(!renderedHtml || downloadingPdf)}>
            {downloadingPdf ? '...' : '📄 PDF'}
          </button>
          <button type="button" onClick={downloadWord} disabled={!renderedHtml || downloadingWord} style={wordBtn(!renderedHtml || downloadingWord)}>
            {downloadingWord ? '...' : '📝 Word'}
          </button>
        </div>
      </div>

      {/* Status badges + error */}
      {draftIsFinal && (
        <div style={lockedBannerStyle}>
          🔒 This draft is <strong>{latestDraft.status}</strong>. Edits are blocked. To iterate further, create a new version
          (we&rsquo;ll add an explicit &ldquo;new version&rdquo; button in the next slice).
        </div>
      )}
      {error && (
        <div style={errorBannerStyle}>
          ⚠ {error}
        </div>
      )}

      {/* Two-column layout: narrative editor on the left, preview on the right */}
      <div style={twoColStyle}>
        {/* Left: narrative editor + missing-placeholders summary */}
        <div style={leftColStyle}>
          <h4 style={sectionTitleStyle}>Narrative</h4>
          <p style={sectionSubtitleStyle}>
            Edit any section below. The preview re-renders automatically a second after you stop typing.
            Empty fields render as <code style={inlineCodeStyle}>(blank)</code> in the FSR.
          </p>

          {/* AI auto-prepare — manual button. Reads everything already tagged
              to this claim (documents, intimation email, claim row, loss
              sheet) and asks the LLM to compile the narrative form. */}
          <div style={autoPrepareBannerStyle(autoPreparing, draftIsFinal)}>
            <button
              type="button"
              onClick={autoPrepareWithAi}
              disabled={autoPreparing || draftIsFinal}
              style={autoPrepareButtonStyle(autoPreparing || draftIsFinal)}
              title={
                draftIsFinal
                  ? 'Draft is locked. Create a new version before re-running AI auto-prepare.'
                  : 'Reads documents + intimation + claim row and pre-fills this form'
              }
            >
              {autoPreparing ? '⏳ Reading documents and drafting…' : '🪄 Prepare with AI'}
            </button>
            <div style={{ flex: 1, fontSize: 11, color: '#475569', lineHeight: 1.4 }}>
              Reads every document tagged to this claim (RR, JIRs, invoices, policy copy, intimation email)
              along with the manual fields you&rsquo;ve entered, and pre-fills the narrative below.
              Your already-typed values are preserved.
            </div>
            {autoPrepareResult && (
              <div style={autoPrepareResultStyle}>
                <strong>{autoPrepareResult.filled}</strong>/{autoPrepareResult.total_fields} filled
                {autoPrepareResult.skipped > 0 && <> · {autoPrepareResult.skipped} skipped (already filled)</>}
                {autoPrepareResult.dropped > 0 && <> · {autoPrepareResult.dropped} unknown keys dropped</>}
                {' '}· {autoPrepareResult.ocr_docs_used} doc{autoPrepareResult.ocr_docs_used === 1 ? '' : 's'} read
              </div>
            )}
          </div>

          {narrativeMissing.length > 0 && (
            <div style={missingChipBarStyle}>
              <strong style={{ fontSize: 11, color: '#991b1b' }}>
                {narrativeMissing.length} narrative section{narrativeMissing.length === 1 ? '' : 's'} still empty:
              </strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {narrativeMissing.map((p) => (
                  <span key={p} style={chipStyle}>
                    {labelForPlaceholder(p, lob)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {otherMissing.length > 0 && (
            <div style={otherMissingChipBarStyle}>
              <strong style={{ fontSize: 11, color: '#92400e' }}>
                Non-narrative gaps ({otherMissing.length}):
              </strong>
              <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                {otherMissing.join(', ')}
              </div>
              <div style={{ fontSize: 11, color: '#92400e', marginTop: 4, fontStyle: 'italic' }}>
                These come from the loss sheet, ILA submission, or claim columns. Fill them via their respective screens.
              </div>
            </div>
          )}

          <NarrativeEditor
            lob={lob}
            templateName={templateName}
            value={narrative}
            onChange={onNarrativeChange}
            missingKeys={narrativeMissing.map((p) => p.replace(/^narrative\./, ''))}
            disabled={draftIsFinal}
            onAiDraft={onAiDraft}
            aiDraftingKey={aiDraftingKey}
          />
        </div>

        {/* Right: rendered HTML preview */}
        <div style={rightColStyle}>
          <h4 style={sectionTitleStyle}>
            Preview
            {renderTemplateMeta && (
              <span style={{ fontWeight: 400, fontSize: 11, color: '#64748b', marginLeft: 8 }}>
                · {renderTemplateMeta.name} v{renderTemplateMeta.version}
              </span>
            )}
          </h4>
          {renderedHtml ? (
            <div style={previewWrapStyle}>
              <iframe
                title="FSR preview"
                srcDoc={renderedHtml}
                style={previewIframeStyle}
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div style={emptyPreviewStyle}>
              <div style={{ fontSize: 36 }}>📑</div>
              <p>The preview appears here after the first render.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// truncate — for the AI-overwrite confirm dialog
// -----------------------------------------------------------------------------
function truncate(s, n) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// -----------------------------------------------------------------------------
// dedupe — preserve first occurrence
// -----------------------------------------------------------------------------
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (v == null || v === '') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// -----------------------------------------------------------------------------
// inline styles
// -----------------------------------------------------------------------------

const headerBarStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 12, flexWrap: 'wrap',
  padding: '12px 14px', background: '#f8fafc',
  border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 14,
};

function selectStyle(disabled) {
  return {
    padding: '5px 8px', fontSize: 12, color: '#0f172a',
    border: '1px solid #cbd5e1', borderRadius: 6,
    background: disabled ? '#f1f5f9' : '#fff',
    cursor: disabled ? 'default' : 'pointer',
  };
}

function primaryBtn(disabled) {
  return {
    padding: '6px 14px', fontSize: 12, fontWeight: 600,
    background: disabled ? '#94a3b8' : '#059669',
    color: '#fff', border: 'none', borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
  };
}

function pdfBtn(disabled) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    background: disabled ? '#fca5a5' : '#dc2626',
    color: '#fff', border: 'none', borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
  };
}

function wordBtn(disabled) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    background: disabled ? '#93c5fd' : '#2563eb',
    color: '#fff', border: 'none', borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
  };
}

const lockedBannerStyle = {
  padding: '10px 14px', background: '#fef3c7', color: '#92400e',
  border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, marginBottom: 12,
};

const errorBannerStyle = {
  padding: '10px 14px', background: '#fee2e2', color: '#991b1b',
  border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, marginBottom: 12,
};

const twoColStyle = {
  display: 'grid', gridTemplateColumns: 'minmax(420px, 1fr) minmax(420px, 1fr)',
  gap: 14, alignItems: 'start',
};

const leftColStyle = { minWidth: 0 };
const rightColStyle = { minWidth: 0, position: 'sticky', top: 12 };

const sectionTitleStyle = {
  margin: '0 0 6px 0', fontSize: 14, fontWeight: 700, color: '#0f172a',
};
const sectionSubtitleStyle = {
  margin: '0 0 10px 0', fontSize: 12, color: '#64748b',
};
const inlineCodeStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  background: '#f1f5f9', padding: '0 4px', borderRadius: 3,
};

// 'Prepare with AI' banner — sits above the missing-chips bar so it's the
// first thing surveyors see in the narrative column. Calm purple/indigo so
// it doesn't compete with the red missing-fields chip bar.
function autoPrepareBannerStyle(busy, locked) {
  return {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    padding: '10px 14px',
    background: locked ? '#f1f5f9' : (busy ? '#eef2ff' : '#f5f3ff'),
    border: '1px solid ' + (locked ? '#cbd5e1' : (busy ? '#a5b4fc' : '#c4b5fd')),
    borderRadius: 8, marginBottom: 12,
  };
}
function autoPrepareButtonStyle(disabled) {
  return {
    padding: '8px 14px', fontSize: 13, fontWeight: 700,
    background: disabled ? '#e2e8f0' : 'linear-gradient(180deg, #8b5cf6, #6d28d9)',
    color: disabled ? '#94a3b8' : '#fff',
    border: 'none', borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: disabled ? 'none' : '0 1px 0 rgba(0,0,0,0.05), 0 0 0 1px rgba(124,58,237,0.2)',
  };
}
const autoPrepareResultStyle = {
  fontSize: 11, padding: '4px 10px',
  background: '#fff', border: '1px solid #c4b5fd', borderRadius: 999,
  color: '#5b21b6',
};

const missingChipBarStyle = {
  padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 8, marginBottom: 12,
};
const otherMissingChipBarStyle = {
  padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d',
  borderRadius: 8, marginBottom: 12,
};

const chipStyle = {
  fontSize: 11, padding: '2px 8px', background: '#fff',
  border: '1px solid #fecaca', borderRadius: 9999, color: '#991b1b',
};

const previewWrapStyle = {
  border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
  background: '#fff', height: 720,
};
const previewIframeStyle = {
  width: '100%', height: '100%', border: 'none',
};

const emptyPreviewStyle = {
  textAlign: 'center', padding: 60, color: '#94a3b8',
  background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10,
};
