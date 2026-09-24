/**
 * forge-5rr (projects-45): `/flows/[id]/run/[runId]` — the pending scan's
 * note was "no FetchErrorState/PageLoadError visible near the read in a
 * quick scan — unverified." On inspection this page (and its client,
 * `lib/flow-run-detail-client.ts`) already closed the crosscut-08 defect
 * class — the SAME D9/forge-irn three-state resolver
 * `app/agents/[id]/run/[runId]/page.tsx` uses: `fetchFlowRunDetail`'s
 * transport-throw path resolves `{kind:'unresolved'}` via the sentinel-0
 * convention (never `'not-found'`), and `resolveRunPageState` additionally
 * downgrades a FOUND run to `'unresolved'` when the flows-list read failed
 * (never fabricates "unregistered" off a failed read). All of that is
 * already exhaustively pinned at the pure-logic level in
 * `tests/regression/flow-run-detail-client.test.ts` (its own "KILL 1a/1b/2a/
 * 2b/3" tests + the thrown-fetch test using `fetchFlowRunDetail`'s
 * injectable `fetchImpl` param — no mocked global `fetch` needed).
 *
 * What was NOT yet pinned, and what the scan's "unverified" note was really
 * asking: that the PAGE ITSELF wires `resolution.kind` to the render
 * correctly — `'unresolved'` never falls through to the shared `NotFound`,
 * and carries its own Retry (the page doesn't use `FetchErrorState`/
 * `PageLoadError` — a bespoke inline body — which is exactly why the scan's
 * grep-shaped "unverified" note fired; the CONTRACT is honoured, just not
 * via the shared component name a grep would catch). This file closes that.
 *
 * Source-text pins (same convention as the sibling `agent-run-page-fail-
 * closed-wiring.test.ts`): a `use client` page with an effect-driven fetch,
 * invisible to `renderToStaticMarkup`.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (): string => readFileSync(resolve(__dirname, '..', '..', 'app', 'flows', '[id]', 'run', '[runId]', 'page.tsx'), 'utf8');

test('the "unresolved" branch is checked BEFORE the not-found branch, and renders its own retryable body — never the shared NotFound', () => {
  const src = read();
  const unresolvedIdx = src.indexOf("resolution?.kind === 'unresolved'");
  const notFoundIdx = src.indexOf("resolution?.kind === 'not-found'");
  expect(unresolvedIdx).toBeGreaterThan(-1);
  expect(notFoundIdx).toBeGreaterThan(-1);
  expect(unresolvedIdx).toBeLessThan(notFoundIdx);
  // Between the two checks, the unresolved branch must return its OWN body,
  // not fall through — this file's own `data-run-resolution="unresolved"`
  // marks that body, distinct from NotFound and from the found timeline.
  const between = src.slice(unresolvedIdx, notFoundIdx);
  expect(between).toContain('data-run-resolution="unresolved"');
  expect(between).not.toContain('<NotFound');
});

test('the "unresolved" body carries a working Retry that re-invokes the SAME load — never a dead-end or a bare page reload', () => {
  const src = read();
  const unresolvedIdx = src.indexOf("resolution?.kind === 'unresolved'");
  const body = src.slice(unresolvedIdx, unresolvedIdx + 900);
  expect(body).toMatch(/data-action="retry-run-load"/);
  expect(body).toMatch(/onClick=\{\(\) => void load\(\{ cancelled: false \}\)\}/);
});

test('the not-found render is reachable ONLY off resolution.kind === "not-found" — the ONLY <NotFound> render site in the file', () => {
  const src = read();
  const notFoundSites = (src.match(/<NotFound/g) ?? []).length;
  expect(notFoundSites).toBe(1);
  expect(src).toMatch(/if \(resolution\?\.kind === 'not-found'\) \{\s*return \(\s*<NotFound/);
});
