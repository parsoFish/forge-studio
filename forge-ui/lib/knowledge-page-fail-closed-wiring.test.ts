/**
 * W7-FIX-A1 (A1-07) — `/knowledge`'s KB-DETAIL read (and the ingest-activity
 * feed) still failed OPEN after W7-A1: `fetchKb` (`studioReadOr404`) throws
 * on any non-404 failure, but the detail effect's `.catch` only flipped
 * `ready` — `kbDetail` stayed null, the graph area rendered the bare "No KB
 * data available." and the root advertised `data-fetch-status="ok"` (derived
 * from the ROSTER read alone). `IngestActivityPanel`'s catch likewise left
 * `events=[]` → "No ingest activity recorded yet." with
 * `data-ingest-event-count="0"` — indistinguishable from an empty feed.
 *
 * `/knowledge` cannot be render-tested (`useSearchParams` + effect-gated
 * `currentId` — see `knowledge-page-empty-state-wiring.test.ts`'s header for
 * the proven reason), so this file pins the WIRING in the source text; the
 * rendered failure state itself is pinned by `bridge-status-render.test.ts`.
 *
 * Kills: a detail catch that only sets `ready`; a root `data-fetch-status`
 * that ignores the detail read; an ingest catch that only clears `loading`;
 * a Retry that re-reads the CACHED (rejected) `fetchKb` promise.
 *
 * RUN: cd forge-ui && npx vitest run lib/knowledge-page-fail-closed-wiring.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../app/knowledge/page.tsx'), 'utf8');

test('the KB-detail effect\'s catch captures the failure (fetchErrorPropsFrom → kbDetailError) — not just setReady(true)', () => {
  const start = source.indexOf('getOrStartKbFetch(currentId).then((detail) =>');
  expect(start).toBeGreaterThan(0);
  const effect = source.slice(start, source.indexOf('return () => { signal.cancelled = true; };', start));
  expect(effect).toMatch(/\.catch\(\(err\) => \{[\s\S]{0,600}fetchErrorPropsFrom\(err\)[\s\S]{0,200}setKbDetailError\(/);
  expect(effect).toMatch(/setReady\(true\)/); // still settles — into an honest failure
  // a successful detail read clears any prior detail error
  expect(effect).toMatch(/setKbDetailError\(null\)/);
});

test('the root data-fetch-status folds the detail read in — "error" when EITHER the roster or the detail read failed', () => {
  expect(source).toMatch(/data-fetch-status=\{kbsError \|\| kbDetailError \? 'error' : kbListReady \? 'ok' : 'loading'\}/);
});

test('a failed detail read renders the shared FetchErrorState with a Retry in the graph area — never the bare "No KB data available."', () => {
  expect(source).toMatch(/kbDetailError \? \([\s\S]{0,300}<FetchErrorState[\s\S]{0,300}onRetry=\{retryKbDetail\}/);
});

test('Retry for the detail read DROPS the cached (rejected) fetchKb promise before re-running the effect — a retry that re-awaits the same rejected promise is a no-op', () => {
  expect(source).toMatch(/const retryKbDetail = useCallback\(\(\) => \{[\s\S]{0,200}kbFetchCacheRef\.current = null;[\s\S]{0,200}setDetailKey\(/);
  // the detail effect re-runs on detailKey
  expect(source).toMatch(/\}, \[currentId, idConfirmed, getOrStartKbFetch, detailKey\]\);/);
});

test('bridge recovery re-runs the roster AND a FAILED detail read (a pinned KB tab refills itself — crosscut-22; a healthy graph keeps its selection)', () => {
  expect(source).toMatch(/useBridgeRecovery\(reloadAll\)/);
  expect(source).toMatch(/const reloadAll = useCallback\(\(\) => \{[\s\S]{0,120}reloadKbs\(\);[\s\S]{0,300}if \(kbDetailError\) retryKbDetail\(\);/);
});

test('IngestActivityPanel: a failed ingest-activity read is an ERROR state (compact FetchErrorState + Retry, data-fetch-status="error"), distinguishable from an empty feed', () => {
  const start = source.indexOf('function IngestActivityPanel(');
  expect(start).toBeGreaterThan(0);
  const panel = source.slice(start);
  expect(panel).toMatch(/\.catch\(\(err\) => \{[\s\S]{0,300}fetchErrorPropsFrom\(err\)[\s\S]{0,200}setIngestError\(/);
  expect(panel).toMatch(/data-component="ingest-activity"[\s\S]{0,300}data-fetch-status=\{ingestError \? 'error' : loading \? 'loading' : 'ok'\}/);
  expect(panel).toMatch(/ingestError \? \([\s\S]{0,200}<FetchErrorState[\s\S]{0,300}compact/);
  // the empty copy is gated on NO error
  expect(panel).toMatch(/!loading && !ingestError && events\.length === 0/);
});
