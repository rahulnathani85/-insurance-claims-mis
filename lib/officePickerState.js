// =============================================================================
// lib/officePickerState.js
// =============================================================================
// Pure state-machine + debounce primitives for components/OfficeSearchPicker.
// Extracted into a JSX-free file so vitest (which uses Vite's default JS
// transform — no JSX loader for .js files) can import it directly.
//
// State shape:
//   query           string     — current text in the input
//   results         Office[]   — last set of search results
//   loading         boolean    — fetch in flight
//   open            boolean    — dropdown visible
//   highlighted     number     — index into results for keyboard nav (-1 if none)
//   selectedOffice  Office|null — full row backing the chip
//   pendingFetchId  number     — token used to ignore stale responses
// =============================================================================

export const initialState = {
  query: '',
  results: [],
  loading: false,
  open: false,
  highlighted: -1,
  selectedOffice: null,
  pendingFetchId: 0,
};

export function pickerReducer(state, action) {
  switch (action.type) {
    case 'TYPE': {
      return {
        ...state,
        query: action.query,
        open: true,
        highlighted: -1,
        loading: action.query.trim().length > 0,
      };
    }
    case 'FETCH_START': {
      return {
        ...state,
        loading: true,
        pendingFetchId: state.pendingFetchId + 1,
      };
    }
    case 'FETCH_RESULTS': {
      if (action.fetchId !== state.pendingFetchId) return state;
      return {
        ...state,
        results: action.results,
        loading: false,
        open: true,
        highlighted: action.results.length > 0 ? 0 : -1,
      };
    }
    case 'FETCH_ERROR': {
      if (action.fetchId !== state.pendingFetchId) return state;
      return { ...state, loading: false, results: [], highlighted: -1 };
    }
    case 'OPEN': {
      return { ...state, open: true };
    }
    case 'CLOSE': {
      return { ...state, open: false, highlighted: -1 };
    }
    case 'HIGHLIGHT_NEXT': {
      if (state.results.length === 0) return state;
      const next = (state.highlighted + 1) % state.results.length;
      return { ...state, highlighted: next };
    }
    case 'HIGHLIGHT_PREV': {
      if (state.results.length === 0) return state;
      const prev =
        state.highlighted <= 0 ? state.results.length - 1 : state.highlighted - 1;
      return { ...state, highlighted: prev };
    }
    case 'SET_HIGHLIGHT': {
      return { ...state, highlighted: action.index };
    }
    case 'SELECT': {
      return {
        ...state,
        selectedOffice: action.office,
        query: '',
        results: [],
        open: false,
        highlighted: -1,
        loading: false,
      };
    }
    case 'CLEAR': {
      return {
        ...state,
        selectedOffice: null,
        query: '',
        results: [],
        open: false,
        highlighted: -1,
        loading: false,
      };
    }
    case 'HYDRATE_SELECTED': {
      return { ...state, selectedOffice: action.office, loading: false };
    }
    default:
      return state;
  }
}

// makeDebouncer — returns { schedule(fn), cancel(), isPending() } where
// schedule resets a pending timer if called again before fire.
export function makeDebouncer(delayMs) {
  let handle = null;
  return {
    schedule(fn) {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => {
        handle = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (handle) {
        clearTimeout(handle);
        handle = null;
      }
    },
    isPending() {
      return handle !== null;
    },
  };
}
