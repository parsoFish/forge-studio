'use client';

/**
 * useSaveState — one save-feedback pattern for every Studio builder (X1).
 *
 * Wraps a save callback and exposes a small state machine the SaveStatus
 * component renders: saving → saved (auto-clears) | error | locked. Replaces the
 * three bespoke patterns (projects inline-error, flows toast+banner, agents toast).
 */

import { useCallback, useState } from 'react';

export type SaveResult = { ok: boolean; error?: string; locked?: boolean; version?: number };
export type SaveState = { saving: boolean; saved: boolean; error: string | null; locked: boolean };

const IDLE: SaveState = { saving: false, saved: false, error: null, locked: false };

/** A locked result means an in-flight run blocks the edit (flow edit-lock). */
function isLocked(r: SaveResult): boolean {
  if (r.locked) return true;
  const e = (r.error ?? '').toLowerCase();
  return e.includes('locked') || e.includes('423') || e.includes('in flight');
}

export function useSaveState(onSave: () => Promise<SaveResult>): SaveState & { save: () => Promise<SaveResult> } {
  const [state, setState] = useState<SaveState>(IDLE);

  const save = useCallback(async (): Promise<SaveResult> => {
    setState({ saving: true, saved: false, error: null, locked: false });
    let result: SaveResult;
    try {
      result = await onSave();
    } catch (err) {
      setState({ saving: false, saved: false, error: String(err), locked: false });
      return { ok: false, error: String(err) };
    }
    if (result.ok) {
      setState({ saving: false, saved: true, error: null, locked: false });
      // Auto-clear the "✓ Saved" affordance after a beat.
      setTimeout(() => setState((s) => (s.saved ? { ...s, saved: false } : s)), 2500);
    } else if (isLocked(result)) {
      setState({ saving: false, saved: false, error: null, locked: true });
    } else {
      setState({ saving: false, saved: false, error: result.error ?? 'Save failed', locked: false });
    }
    return result;
  }, [onSave]);

  return { ...state, save };
}
