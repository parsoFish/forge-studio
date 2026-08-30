/**
 * fetch-error-scope — the ONE rule for a page-level fetch error that lives
 * across an initial full load AND narrower live refreshes (W7-FIX-A1, A1-03).
 *
 * `/flows` and Home both keep one `error` slot: the initial `loadAll` reads
 * everything (flows+runs+projects / seven reads); a WS `cycle-list-changed`
 * refresh re-reads a NARROW subset (runs / runs+sessions). Before this
 * module, ANY successful refresh did `setError(null)` — so a failed full load
 * (flows still `[]`) was "cleared" by a successful runs refresh and the page
 * fell straight through to the false zero-state ("No flows registered at
 * all" / "Nothing registered yet") W7-A1 had removed.
 *
 * Rule: an error remembers the SCOPE of the read set that failed. A
 * successful refresh clears ONLY an error of its own scope — it cannot vouch
 * for reads it did not perform. A failing refresh never replaces a wider
 * (full-load) error with its narrower one. Pure; both call sites use it
 * inside `setError((prev) => …)`.
 */
import { describeBridgeError } from './bridge-result';

/** The scope tag of the initial, everything-read load. */
export const FULL_LOAD_SCOPE = 'all';

export type ScopedFetchError = {
  message: string;
  status?: number;
  /** `FULL_LOAD_SCOPE` for the initial load; a narrow name (`'runs'`, `'runs+sessions'`) for a live refresh. */
  scope: string;
};

/** Classify a caught error (shared bridge-result vocabulary) and tag its scope. */
export function scopedFetchError(err: unknown, scope: string): ScopedFetchError {
  const d = describeBridgeError(err);
  return d.status !== undefined ? { message: d.message, status: d.status, scope } : { message: d.message, scope };
}

/** A refresh of `refreshedScope` succeeded: clear ONLY an error of that scope. */
export function afterRefreshSuccess(prev: ScopedFetchError | null, refreshedScope: string): ScopedFetchError | null {
  if (prev === null) return null;
  return prev.scope === refreshedScope ? null : prev;
}

/** A refresh failed: record it, unless a FULL-load error is still standing
 *  (a narrower error must not replace it — the next narrow success would
 *  clear it). A failing full load always wins. */
export function afterRefreshFailure(prev: ScopedFetchError | null, next: ScopedFetchError): ScopedFetchError {
  if (next.scope === FULL_LOAD_SCOPE) return next;
  if (prev !== null && prev.scope === FULL_LOAD_SCOPE) return prev;
  return next;
}
