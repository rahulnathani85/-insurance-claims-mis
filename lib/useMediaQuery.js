// ============================================================
// lib/useMediaQuery.js
// ------------------------------------------------------------
// Tiny React hook to react to viewport breakpoints. Used to
// switch the inline-styled grid layouts to a single-column stack
// on mobile.
//
// Common usage:
//   const isMobile = useMediaQuery('(max-width: 768px)');
//   <div style={{ gridTemplateColumns: isMobile ? '1fr' : '1fr 360px' }} />
// ============================================================

import { useState, useEffect } from 'react';

export function useMediaQuery(query) {
  // Default to false on server / first paint to keep markup deterministic.
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    // Modern browsers
    mql.addEventListener?.('change', update);
    // Safari < 14 fallback
    mql.addListener?.(update);
    return () => {
      mql.removeEventListener?.('change', update);
      mql.removeListener?.(update);
    };
  }, [query]);

  return matches;
}

export const MOBILE_BREAKPOINT = '(max-width: 768px)';
