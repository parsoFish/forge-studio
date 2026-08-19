/**
 * W7-FIX-A1 (A1-03, HIGH) — a page-global `error` flag that ANY successful
 * partial refresh clears restores the exact false zero-state W7-A1 removed:
 * `/flows`'s initial `loadAll` (flows+runs+projects) fails → `error` set,
 * `flows` still `[]`; the WS-driven `refreshRuns` (runs ONLY) succeeds →
 * `setError(null)` → the guard falls through to `<FlowsIndexBody flows=[]>`
 * = "No flows registered at all" while the flows read is still broken.
 * Same shape on Home (`use-studio-home-data.ts`: seven reads in `loadAll`,
 * two in `refreshRunsAndSessions`) → "Nothing registered yet".
 *
 * `lib/fetch-error-scope.ts` is the ONE pure rule both call sites use:
 *   - an error carries the SCOPE of the read set that failed
 *     (`FULL_LOAD_SCOPE` for the initial load, a narrow name for a refresh);
 *   - a successful refresh clears ONLY an error of ITS OWN scope — it can
 *     never vouch for reads it did not perform;
 *   - a failing refresh never REPLACES a wider (full-load) error with its
 *     narrower one (that would let the next narrow success clear it).
 *
 * The pure rule is tested by execution below; the two call sites are pinned
 * by source text (the pages' fetch effects don't run under SSR-style
 * rendering — the standing render-test gap).
 *
 * RUN: cd forge-ui && npx vitest run lib/fetch-error-scope.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FULL_LOAD_SCOPE,
  afterRefreshFailure,
  afterRefreshSuccess,
  scopedFetchError,
  type ScopedFetchError,
} from './fetch-error-scope';
import { BridgeReadError } from './bridge-result';

const full: ScopedFetchError = { message: 'HTTP 500', status: 500, scope: FULL_LOAD_SCOPE };
const runsErr: ScopedFetchError = { message: 'bridge unreachable (Failed to fetch)', scope: 'runs' };

test('scopedFetchError: classifies via the shared bridge-result vocabulary and tags the scope', () => {
  expect(scopedFetchError(new BridgeReadError('/api/studio/flows', { ok: false, status: 502, error: 'upstream' }), FULL_LOAD_SCOPE))
    .toEqual({ message: 'upstream', status: 502, scope: FULL_LOAD_SCOPE });
  const transport = scopedFetchError(new TypeError('Failed to fetch'), 'runs');
  expect(transport).toEqual({ message: 'Failed to fetch', scope: 'runs' });
  expect('status' in transport).toBe(false);
});

test('afterRefreshSuccess: a successful NARROW refresh does NOT clear a FULL-load error (the reads it did not perform are still failed)', () => {
  expect(afterRefreshSuccess(full, 'runs')).toBe(full);
});

test('afterRefreshSuccess: a successful refresh clears an error of ITS OWN scope', () => {
  expect(afterRefreshSuccess(runsErr, 'runs')).toBeNull();
});

test('afterRefreshSuccess: no error stays no error', () => {
  expect(afterRefreshSuccess(null, 'runs')).toBeNull();
});

test('afterRefreshFailure: a failing narrow refresh never REPLACES a full-load error (else the next narrow success would clear it)', () => {
  expect(afterRefreshFailure(full, runsErr)).toBe(full);
});

test('afterRefreshFailure: a failing refresh over no error / over its own scope records the new failure', () => {
  expect(afterRefreshFailure(null, runsErr)).toBe(runsErr);
  const newer: ScopedFetchError = { message: 'HTTP 503', status: 503, scope: 'runs' };
  expect(afterRefreshFailure(runsErr, newer)).toBe(newer);
});

test('afterRefreshFailure: a failing FULL load always wins (it supersedes any narrower error)', () => {
  const fullAgain: ScopedFetchError = { message: 'HTTP 500', status: 500, scope: FULL_LOAD_SCOPE };
  expect(afterRefreshFailure(runsErr, fullAgain)).toBe(fullAgain);
});

// ---- the two call sites (source pins) ---------------------------------------

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8');

test('/flows (app/flows/page.tsx): loadAll tags FULL_LOAD_SCOPE; refreshRuns clears/records ONLY through the scoped rule — never an unconditional setError(null)', () => {
  const src = read('app/flows/page.tsx');
  expect(src).toMatch(/import \{[^}]*afterRefreshSuccess[^}]*\} from '@\/lib\/fetch-error-scope'/);
  expect(src).toMatch(/async function loadAll[\s\S]{0,700}scopedFetchError\(err, FULL_LOAD_SCOPE\)/);
  const refresh = src.slice(src.indexOf('async function refreshRuns'), src.indexOf('useEffect(', src.indexOf('async function refreshRuns')));
  expect(refresh).not.toContain('setError(null)');
  expect(refresh).toMatch(/setError\(\(prev\) => afterRefreshSuccess\(prev, /);
  expect(refresh).toMatch(/setError\(\(prev\) => afterRefreshFailure\(prev, scopedFetchError\(err, /);
});

test('Home (lib/use-studio-home-data.ts): loadAll tags FULL_LOAD_SCOPE; refreshRunsAndSessions clears/records ONLY through the scoped rule', () => {
  const src = read('lib/use-studio-home-data.ts');
  expect(src).toMatch(/import \{[^}]*afterRefreshSuccess[^}]*\} from '\.\/fetch-error-scope'/);
  expect(src).toMatch(/async function loadAll[\s\S]{0,900}scopedFetchError\(err, FULL_LOAD_SCOPE\)/);
  const refresh = src.slice(src.indexOf('async function refreshRunsAndSessions'), src.indexOf('const debouncedRefresh'));
  expect(refresh).not.toContain('setError(null)');
  expect(refresh).toMatch(/setError\(\(prev\) => afterRefreshSuccess\(prev, /);
  expect(refresh).toMatch(/setError\(\(prev\) => afterRefreshFailure\(prev, scopedFetchError\(err, /);
});
