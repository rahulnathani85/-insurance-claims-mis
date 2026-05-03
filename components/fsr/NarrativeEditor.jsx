'use client';
// =============================================================================
// components/fsr/NarrativeEditor.jsx
// =============================================================================
// Per-section editor for the {{narrative.*}} placeholders that the FSR
// templates expect surveyors to fill in. Hands a flat object up to the
// parent via onChange — the parent decides when/how to persist (typically
// debounced via PUT /api/fsr-drafts/[id]).
//
// LOB-aware: pulls the field list from `lib/fsr/narrativeFields.js`.
// Sections are collapsible; the first stays open by default.
//
// Props:
//   lob              string                'Marine Cargo' | 'Extended Warranty' | 'Fire' | ...
//   templateName     string                'Production' | 'ILA' | ...
//                                          (controls whether to show ILA-only sections)
//   value            object                current narrative_jsonb
//   onChange(next)   fn                    called with the updated object on every keystroke
//   missingKeys      string[]              keys (e.g. 'situation_of_loss') that are still empty;
//                                          rendered as a red dot next to the field label
//   disabled         bool                  true → all inputs read-only (e.g. when draft is approved)
//   onAiDraft(key)   fn                    optional. When provided, a "✨ AI" button
//                                          appears next to each textarea. Slice 6 wires this up.
//   aiDraftingKey    string | null         which key is currently mid-draft (one at a time);
//                                          shows a spinner on that field's AI button and disables
//                                          the others while the call is in flight.
// =============================================================================

import { useState, useMemo } from 'react';
import { fieldsForLob } from '@/lib/fsr/narrativeFields';

export default function NarrativeEditor({
  lob,
  templateName = 'Production',
  value = {},
  onChange,
  missingKeys = [],
  disabled = false,
  onAiDraft,
  aiDraftingKey = null,
}) {
  const sections = useMemo(() => fieldsForLob(lob, templateName), [lob, templateName]);
  const missingSet = useMemo(() => new Set(missingKeys), [missingKeys]);

  // Track which sections are open. First section is open by default; the rest closed.
  const [openSections, setOpenSections] = useState(
    () => Object.fromEntries(sections.map((s, i) => [s.title, i === 0]))
  );

  if (!sections.length) {
    return (
      <div style={emptyStateStyle}>
        Narrative editor not yet configured for LOB &ldquo;{lob || '(unknown)'}&rdquo;.
      </div>
    );
  }

  function handleField(key, next) {
    if (disabled || !onChange) return;
    onChange({ ...value, [key]: next });
  }

  function toggleSection(title) {
    setOpenSections((s) => ({ ...s, [title]: !s[title] }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sections.map((section) => {
        const isOpen = !!openSections[section.title];
        const sectionMissing = section.fields.filter((f) => missingSet.has(f.key)).length;
        const sectionFilled = section.fields.filter((f) => !!value[f.key]).length;

        return (
          <div key={section.title} style={sectionWrapStyle}>
            {/* Section header */}
            <button
              type="button"
              onClick={() => toggleSection(section.title)}
              style={sectionHeaderStyle(isOpen)}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>
                  {section.title}
                </span>
                <span style={sectionCountStyle}>
                  {sectionFilled}/{section.fields.length}
                  {sectionMissing > 0 && (
                    <span style={{ marginLeft: 6, color: '#dc2626' }}>
                      · {sectionMissing} missing
                    </span>
                  )}
                </span>
              </span>
              <span style={{ fontSize: 14, color: '#64748b' }}>{isOpen ? '▾' : '▸'}</span>
            </button>

            {/* Section fields */}
            {isOpen && (
              <div style={sectionBodyStyle}>
                {section.fields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={value[f.key] ?? ''}
                    onChange={(next) => handleField(f.key, next)}
                    missing={missingSet.has(f.key)}
                    disabled={disabled}
                    onAiDraft={onAiDraft ? () => onAiDraft(f.key) : null}
                    aiDrafting={aiDraftingKey === f.key}
                    aiBlocked={!!aiDraftingKey && aiDraftingKey !== f.key}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// FieldInput — single labelled input. Picks textarea / text based on type.
// -----------------------------------------------------------------------------
function FieldInput({ field, value, onChange, missing, disabled, onAiDraft, aiDrafting, aiBlocked }) {
  const isTextarea = field.type === 'textarea';
  const aiDisabled = disabled || aiDrafting || aiBlocked;

  return (
    <label style={fieldWrapStyle(field.wide || isTextarea)}>
      <div style={labelRowStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#475569' }}>
          {field.label}
          {missing && <span style={missingDotStyle} title="Empty — will render as (blank)">●</span>}
        </span>
        {onAiDraft && isTextarea && (
          <button
            type="button"
            onClick={onAiDraft}
            disabled={aiDisabled}
            style={aiButtonStyle(aiDisabled)}
            title={
              aiDrafting ? 'Drafting…'
              : aiBlocked ? 'Another section is being drafted'
              : 'Have the AI draft this section based on the claim data'
            }
          >
            {aiDrafting ? '⏳ Drafting…' : '✨ AI Draft'}
          </button>
        )}
      </div>

      {isTextarea ? (
        <textarea
          rows={Math.max(3, Math.min(8, Math.ceil((value || '').length / 80) + 2))}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          disabled={disabled}
          style={textareaStyle(disabled)}
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          disabled={disabled}
          style={inputStyle(disabled)}
        />
      )}

      {field.help && (
        <span style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
          {field.help}
        </span>
      )}
    </label>
  );
}

// -----------------------------------------------------------------------------
// Inline styles — match the rest of claim-detail's surveyor look
// -----------------------------------------------------------------------------

const emptyStateStyle = {
  padding: 30, textAlign: 'center', color: '#94a3b8',
  background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1',
};

const sectionWrapStyle = {
  border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'hidden',
};

function sectionHeaderStyle(isOpen) {
  return {
    width: '100%', padding: '10px 14px',
    display: 'flex', alignItems: 'center', gap: 8,
    background: isOpen ? '#f1f5f9' : '#fafafa',
    border: 'none', borderBottom: isOpen ? '1px solid #e2e8f0' : 'none',
    cursor: 'pointer',
  };
}

const sectionCountStyle = {
  marginLeft: 10, fontSize: 11, color: '#64748b', fontWeight: 500,
};

const sectionBodyStyle = {
  padding: 14,
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
};

function fieldWrapStyle(wide) {
  return {
    display: 'flex', flexDirection: 'column', gap: 4,
    gridColumn: wide ? '1 / -1' : 'auto',
  };
}

const labelRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
};

const missingDotStyle = {
  color: '#dc2626', fontSize: 9, lineHeight: 1,
};

function inputStyle(disabled) {
  return {
    padding: '6px 10px', fontSize: 13, color: '#0f172a',
    border: '1px solid #cbd5e1', borderRadius: 6,
    background: disabled ? '#f1f5f9' : '#fff',
    fontFamily: 'inherit',
  };
}

function textareaStyle(disabled) {
  return {
    ...inputStyle(disabled),
    resize: 'vertical', lineHeight: 1.5,
    fontFamily: 'inherit',
  };
}

function aiButtonStyle(disabled) {
  return {
    padding: '2px 8px', fontSize: 11, fontWeight: 600,
    background: disabled ? '#e2e8f0' : 'linear-gradient(180deg, #6366f1, #4f46e5)',
    color: disabled ? '#94a3b8' : '#fff',
    border: 'none', borderRadius: 6,
    cursor: disabled ? 'default' : 'pointer',
  };
}
