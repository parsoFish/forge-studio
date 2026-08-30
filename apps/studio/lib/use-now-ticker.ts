'use client';

import { useEffect, useState } from 'react';

/**
 * Ticks `Date.now()` every `intervalMs` — drives the hex burst fade-out on the
 * focused screens. Extracted so the architect / review / reflect pages don't
 * each re-declare the same 250ms interval effect.
 */
export function useNowTicker(intervalMs = 250): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}
