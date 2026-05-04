'use client';
// =============================================================================
// components/OfficeSearchPicker.js
// =============================================================================
// Type-ahead picker for one insurer-office role. Calls /api/offices/search
// with a debounced query, scoped to a single insurer_id, hides inactive
// offices, and emits the full office row on selection so the caller can
// populate <role>_office_id, <role>_office_name, <role>_office_address.
//
// This component is the canonical input for the 3 office roles on every
// claim form (per CLAUDE.md §17). Don't fork this — extend it or wire it
// into a wrapper.
//
// Props:
//   insurerId       number | null   required to enable; null disables picker
//   value           number | null   currently-selected office id
//   role            'appointing' | 'policy' | 'fsr'  (drives placeholder text)
//   onChange        (office | null) => void   full row on select; null on clear
//   placeholder     string?
//   required        boolean?        red asterisk + native required validation
//   disabled        boolean?        force-disable beyond insurerId check
//
// Internal state machine is factored into a pure reducer (pickerReducer)
// exported for testing. UI is plain CSS — no Tailwind, no shadcn.
// =============================================================================

import { useEffect, useReducer, useRef } from 'react';
import { OFFICE_TYPE_COLORS, OFFICE_TYPE_SHORT_LABELS } from '@/lib/insurerOfficeTypes';
import { initialState, pickerReducer, makeDebouncer } from '@/lib/officePickerState';

const SEARCH_DEBOUNCE_MS = 300;

// pickerReducer/initialState/makeDebouncer live in lib/officePickerState.js
// so vitest can unit-test them without pulling JSX through its loader.
// Re-exported here for any caller that prefers component-local imports.
export { initialState, pickerReducer, makeDebouncer };

// ----- UI helpers -----

function CodeBadge({ code }) {
  const cfg = OFFICE_TYPE_COLORS[code] || { bg: '#e2e8f0', fg: '#334155' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        fontSize: 10,
        fontWeight: 700,
        background: cfg.bg,
        color: cfg.fg,
        borderRadius: 3,
        marginRight: 6,
        letterSpacing: 0.3,
      }}
    >
      {OFFICE_TYPE_SHORT_LABELS[code] || code}
    </span>
  );
}

function OfficeChip({ office, onClear, disabled }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        fontSize: 13,
        background: '#f1f5f9',
        border: '1px solid #cbd5e1',
        borderRadius: 6,
        minHeight: 32,
      }}
    >
      <CodeBadge code={office.office_code} />
      <span style={{ flex: 1, color: '#0f172a' }}>
        {office.hierarchy_path || office.name}
        {office.city ? <span style={{ color: '#64748b' }}> — {office.city}</span> : null}
      </span>
      {office.is_active === false && (
        <span
          title="This office is currently inactive"
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#b91c1c',
            background: '#fee2e2',
            padding: '0 6px',
            borderRadius: 3,
          }}
        >
          INACTIVE
        </span>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: '#64748b',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function ResultRow({ office, highlighted, onMouseEnter, onClick }) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => {
        // Use mousedown so we beat the input's blur (which would close the
        // dropdown via CLOSE before click fires).
        e.preventDefault();
        onClick();
      }}
      style={{
        padding: '6px 8px',
        cursor: 'pointer',
        background: highlighted ? '#eff6ff' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        fontSize: 13,
      }}
    >
      <CodeBadge code={office.office_code} />
      <span style={{ flex: 1, color: '#0f172a' }}>
        {office.hierarchy_path || office.name}
      </span>
      {office.city && (
        <span style={{ marginLeft: 8, color: '#64748b', fontSize: 12 }}>
          {office.city}
        </span>
      )}
    </div>
  );
}

// ----- Main component -----

export default function OfficeSearchPicker({
  insurerId,
  value,
  role,
  onChange,
  placeholder,
  required = false,
  disabled = false,
}) {
  const [state, dispatch] = useReducer(pickerReducer, initialState);
  const debouncerRef = useRef(null);
  const abortRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  if (!debouncerRef.current) {
    debouncerRef.current = makeDebouncer(SEARCH_DEBOUNCE_MS);
  }

  const isDisabled = disabled || insurerId == null;
  const effectivePlaceholder =
    placeholder ||
    (insurerId == null ? 'Select an insurer first' : 'Type to search offices…');

  // ----- Effect: hydrate chip when value is set externally and we don't
  // have the row yet. Single round-trip via /api/offices/search?id=N.
  useEffect(() => {
    let cancelled = false;
    if (value == null) {
      // External clear. If our chip's office id doesn't match, drop it.
      if (state.selectedOffice != null) {
        dispatch({ type: 'HYDRATE_SELECTED', office: null });
      }
      return undefined;
    }
    if (state.selectedOffice && Number(state.selectedOffice.id) === Number(value)) {
      return undefined;
    }
    (async () => {
      try {
        const res = await fetch(`/api/offices/search?id=${encodeURIComponent(value)}`);
        if (!res.ok) return;
        const json = await res.json();
        const office = (json.offices || [])[0] || null;
        if (!cancelled && office) {
          dispatch({ type: 'HYDRATE_SELECTED', office });
        }
      } catch {
        /* network error; chip stays unset, user can re-pick */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ----- Effect: close dropdown on outside mousedown.
  useEffect(() => {
    if (!state.open) return undefined;
    function onDocMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        dispatch({ type: 'CLOSE' });
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [state.open]);

  // ----- Effect: cleanup debouncer + in-flight fetch on unmount.
  useEffect(
    () => () => {
      debouncerRef.current?.cancel();
      abortRef.current?.abort();
    },
    []
  );

  // ----- Trigger a search whenever the query changes (after debounce).
  function runFetch(rawQuery) {
    if (insurerId == null) return;
    const q = rawQuery.trim();
    if (q.length === 0) {
      dispatch({ type: 'FETCH_RESULTS', fetchId: state.pendingFetchId, results: [] });
      return;
    }
    // Abort previous in-flight request.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: 'FETCH_START' });
    // Capture the post-increment fetchId. Reducer just bumped pendingFetchId,
    // but state hasn't re-rendered yet — read the value optimistically.
    const fetchId = state.pendingFetchId + 1;

    const params = new URLSearchParams({
      insurer_id: String(insurerId),
      q,
      active_only: '1',
      limit: '25',
    });
    fetch(`/api/offices/search?${params.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        dispatch({
          type: 'FETCH_RESULTS',
          fetchId,
          results: Array.isArray(json.offices) ? json.offices : [],
        });
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        dispatch({ type: 'FETCH_ERROR', fetchId });
      });
  }

  function onInputChange(e) {
    const next = e.target.value;
    dispatch({ type: 'TYPE', query: next });
    debouncerRef.current.schedule(() => runFetch(next));
  }

  function onInputFocus() {
    if (state.results.length > 0 || state.query.length > 0) {
      dispatch({ type: 'OPEN' });
    }
  }

  function onKeyDown(e) {
    if (isDisabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!state.open) dispatch({ type: 'OPEN' });
      dispatch({ type: 'HIGHLIGHT_NEXT' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!state.open) dispatch({ type: 'OPEN' });
      dispatch({ type: 'HIGHLIGHT_PREV' });
    } else if (e.key === 'Enter') {
      if (state.open && state.highlighted >= 0) {
        e.preventDefault();
        const office = state.results[state.highlighted];
        if (office) selectOffice(office);
      }
    } else if (e.key === 'Escape') {
      dispatch({ type: 'CLOSE' });
    }
  }

  function selectOffice(office) {
    dispatch({ type: 'SELECT', office });
    onChange?.(office);
  }

  function clearSelection() {
    dispatch({ type: 'CLEAR' });
    onChange?.(null);
  }

  // Native required validation: if required and no selection, force a
  // hidden <input required> so the form's submit() reports it.
  const showHiddenRequiredField = required && state.selectedOffice == null;

  // Compose the visible input. When a chip is showing we don't render the
  // text input; the chip + clear-button replace it.
  const showChip = state.selectedOffice != null;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {showChip ? (
        <OfficeChip
          office={state.selectedOffice}
          onClear={isDisabled ? undefined : clearSelection}
          disabled={isDisabled}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={state.query}
          onChange={onInputChange}
          onFocus={onInputFocus}
          onKeyDown={onKeyDown}
          placeholder={effectivePlaceholder}
          disabled={isDisabled}
          aria-label={role ? `Search ${role} office` : 'Search office'}
          style={{
            width: '100%',
            padding: '7px 10px',
            fontSize: 13,
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            background: isDisabled ? '#f1f5f9' : '#fff',
            color: isDisabled ? '#94a3b8' : '#0f172a',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}

      {showHiddenRequiredField && (
        <input
          tabIndex={-1}
          required
          value=""
          onChange={() => {}}
          aria-hidden="true"
          style={{
            position: 'absolute',
            opacity: 0,
            height: 0,
            width: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {state.open && !showChip && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 2,
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
            maxHeight: 280,
            overflowY: 'auto',
            zIndex: 30,
          }}
        >
          {state.loading && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: '#64748b' }}>
              Searching…
            </div>
          )}
          {!state.loading && state.results.length === 0 && state.query.trim() && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: '#94a3b8' }}>
              No offices match — try a different name or city.
            </div>
          )}
          {!state.loading &&
            state.results.map((office, idx) => (
              <ResultRow
                key={office.id}
                office={office}
                highlighted={idx === state.highlighted}
                onMouseEnter={() => dispatch({ type: 'SET_HIGHLIGHT', index: idx })}
                onClick={() => selectOffice(office)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
