// =============================================================================
// tests/officeSearchPicker.test.js
// =============================================================================
// Pure-logic tests for the picker's reducer + debouncer. The repo doesn't
// ship @testing-library/react or jsdom (see package.json devDependencies),
// so the component itself isn't rendered — instead, the reducer and
// makeDebouncer are exported from components/OfficeSearchPicker.js and
// exercised directly here.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pickerReducer,
  initialState,
  makeDebouncer,
} from '../lib/officePickerState.js';

const sampleOffice = (id, code = 'BO', name = `Office ${id}`) => ({
  id,
  insurer_id: 1,
  office_code: code,
  name,
  hierarchy_path: `HO / ${name}`,
  city: 'Mumbai',
  state: 'MH',
  is_active: true,
});

describe('pickerReducer', () => {
  describe('TYPE', () => {
    it('opens the dropdown and sets loading when query is non-empty', () => {
      const next = pickerReducer(initialState, { type: 'TYPE', query: 'mum' });
      expect(next.query).toBe('mum');
      expect(next.open).toBe(true);
      expect(next.loading).toBe(true);
      expect(next.highlighted).toBe(-1);
    });
    it('opens the dropdown but leaves loading false when query is empty', () => {
      const s1 = pickerReducer(initialState, { type: 'TYPE', query: 'mum' });
      const s2 = pickerReducer(s1, { type: 'TYPE', query: '' });
      expect(s2.loading).toBe(false);
      expect(s2.query).toBe('');
    });
    it('whitespace-only query does not trigger loading', () => {
      const next = pickerReducer(initialState, { type: 'TYPE', query: '   ' });
      expect(next.loading).toBe(false);
    });
  });

  describe('FETCH_START / FETCH_RESULTS', () => {
    it('bumps pendingFetchId on FETCH_START', () => {
      const start = pickerReducer(initialState, { type: 'FETCH_START' });
      expect(start.pendingFetchId).toBe(initialState.pendingFetchId + 1);
      expect(start.loading).toBe(true);
    });

    it('applies fresh results matching the current fetchId', () => {
      let s = pickerReducer(initialState, { type: 'FETCH_START' });
      const offices = [sampleOffice(1), sampleOffice(2)];
      s = pickerReducer(s, {
        type: 'FETCH_RESULTS',
        fetchId: s.pendingFetchId,
        results: offices,
      });
      expect(s.results).toEqual(offices);
      expect(s.loading).toBe(false);
      expect(s.open).toBe(true);
      expect(s.highlighted).toBe(0); // first result auto-highlighted
    });

    it('drops stale results whose fetchId does not match', () => {
      // Two consecutive starts — second supersedes first.
      let s = pickerReducer(initialState, { type: 'FETCH_START' });
      const staleId = s.pendingFetchId;
      s = pickerReducer(s, { type: 'FETCH_START' }); // fresh start
      const freshId = s.pendingFetchId;
      expect(staleId).not.toBe(freshId);
      // Stale response arrives.
      const stale = pickerReducer(s, {
        type: 'FETCH_RESULTS',
        fetchId: staleId,
        results: [sampleOffice(99)],
      });
      // results must NOT be touched.
      expect(stale.results).toEqual([]);
      expect(stale.loading).toBe(true);
      // Fresh response arrives.
      const fresh = pickerReducer(stale, {
        type: 'FETCH_RESULTS',
        fetchId: freshId,
        results: [sampleOffice(1)],
      });
      expect(fresh.results).toHaveLength(1);
      expect(fresh.results[0].id).toBe(1);
    });

    it('empty results highlight is -1', () => {
      let s = pickerReducer(initialState, { type: 'FETCH_START' });
      s = pickerReducer(s, {
        type: 'FETCH_RESULTS',
        fetchId: s.pendingFetchId,
        results: [],
      });
      expect(s.highlighted).toBe(-1);
    });

    it('FETCH_ERROR with stale id is a no-op', () => {
      let s = pickerReducer(initialState, { type: 'FETCH_START' });
      const stale = pickerReducer(s, {
        type: 'FETCH_ERROR',
        fetchId: s.pendingFetchId - 1,
      });
      expect(stale).toBe(s);
    });
  });

  describe('keyboard navigation', () => {
    function withResults(n) {
      let s = pickerReducer(initialState, { type: 'FETCH_START' });
      s = pickerReducer(s, {
        type: 'FETCH_RESULTS',
        fetchId: s.pendingFetchId,
        results: Array.from({ length: n }, (_, i) => sampleOffice(i + 1)),
      });
      return s;
    }

    it('HIGHLIGHT_NEXT wraps from last to first', () => {
      let s = withResults(3);
      // initially highlighted = 0
      s = pickerReducer(s, { type: 'HIGHLIGHT_NEXT' });
      s = pickerReducer(s, { type: 'HIGHLIGHT_NEXT' });
      expect(s.highlighted).toBe(2);
      s = pickerReducer(s, { type: 'HIGHLIGHT_NEXT' });
      expect(s.highlighted).toBe(0);
    });

    it('HIGHLIGHT_PREV wraps from first to last', () => {
      let s = withResults(3);
      s = pickerReducer(s, { type: 'HIGHLIGHT_PREV' });
      expect(s.highlighted).toBe(2);
      s = pickerReducer(s, { type: 'HIGHLIGHT_PREV' });
      expect(s.highlighted).toBe(1);
    });

    it('HIGHLIGHT_NEXT/PREV is no-op with empty results', () => {
      const s1 = pickerReducer(initialState, { type: 'HIGHLIGHT_NEXT' });
      expect(s1).toBe(initialState);
      const s2 = pickerReducer(initialState, { type: 'HIGHLIGHT_PREV' });
      expect(s2).toBe(initialState);
    });

    it('SET_HIGHLIGHT moves to a specific index', () => {
      const s = withResults(5);
      const next = pickerReducer(s, { type: 'SET_HIGHLIGHT', index: 3 });
      expect(next.highlighted).toBe(3);
    });
  });

  describe('SELECT / CLEAR / HYDRATE_SELECTED', () => {
    it('SELECT stores the chip and clears the dropdown', () => {
      const office = sampleOffice(7);
      let s = pickerReducer(initialState, { type: 'TYPE', query: 'foo' });
      s = pickerReducer(s, { type: 'SELECT', office });
      expect(s.selectedOffice).toEqual(office);
      expect(s.query).toBe('');
      expect(s.results).toEqual([]);
      expect(s.open).toBe(false);
    });

    it('CLEAR drops the chip and the input', () => {
      let s = pickerReducer(initialState, {
        type: 'SELECT',
        office: sampleOffice(7),
      });
      s = pickerReducer(s, { type: 'CLEAR' });
      expect(s.selectedOffice).toBeNull();
      expect(s.query).toBe('');
      expect(s.open).toBe(false);
    });

    it('HYDRATE_SELECTED fills the chip without disturbing query', () => {
      const office = sampleOffice(11);
      let s = pickerReducer(initialState, { type: 'TYPE', query: 'partial' });
      s = pickerReducer(s, { type: 'HYDRATE_SELECTED', office });
      expect(s.selectedOffice).toEqual(office);
      expect(s.query).toBe('partial');
      expect(s.loading).toBe(false);
    });

    it('HYDRATE_SELECTED with null clears the chip', () => {
      let s = pickerReducer(initialState, {
        type: 'SELECT',
        office: sampleOffice(11),
      });
      s = pickerReducer(s, { type: 'HYDRATE_SELECTED', office: null });
      expect(s.selectedOffice).toBeNull();
    });
  });

  describe('OPEN / CLOSE', () => {
    it('CLOSE clears highlight too', () => {
      let s = pickerReducer(initialState, { type: 'FETCH_START' });
      s = pickerReducer(s, {
        type: 'FETCH_RESULTS',
        fetchId: s.pendingFetchId,
        results: [sampleOffice(1)],
      });
      s = pickerReducer(s, { type: 'CLOSE' });
      expect(s.open).toBe(false);
      expect(s.highlighted).toBe(-1);
    });
  });

  it('returns the same state for unknown actions', () => {
    const s = pickerReducer(initialState, { type: 'UNKNOWN' });
    expect(s).toBe(initialState);
  });
});

describe('makeDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback once after the delay', () => {
    const fn = vi.fn();
    const d = makeDebouncer(300);
    d.schedule(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(d.isPending()).toBe(true);
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.isPending()).toBe(false);
  });

  it('rescheduling resets the timer (only last fn fires)', () => {
    const a = vi.fn();
    const b = vi.fn();
    const d = makeDebouncer(300);
    d.schedule(a);
    vi.advanceTimersByTime(150);
    d.schedule(b);
    vi.advanceTimersByTime(299);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents the pending fire', () => {
    const fn = vi.fn();
    const d = makeDebouncer(300);
    d.schedule(fn);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(d.isPending()).toBe(false);
  });
});
