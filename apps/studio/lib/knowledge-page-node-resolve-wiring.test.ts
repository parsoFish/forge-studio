/**
 * knowledge-page-node-resolve-wiring.test.ts (W7-B2, knowledge-30's second
 * half) — the ?node=/?theme= → owning-KB resolution must be its OWN effect,
 * keyed on the URL params alone.
 *
 * W7-A4 fixed knowledge-30's visible half (an unowned node renders NotFound,
 * never a silent first-KB fallback) but left the resolve call inside the ONE
 * combined selection effect, whose dep array also carries `allKbs` +
 * `kbListReady`. The roster load then re-ran that effect mid-flight: cleanup
 * cancelled the FIRST resolve-node fetch and the re-run issued a SECOND one —
 * one deep link, two `GET /api/studio/kbs/resolve-node` calls, every time.
 *
 * `/knowledge` cannot be render-tested (`useSearchParams` + effect-gated
 * state — see `knowledge-page-empty-state-wiring.test.ts`'s header for the
 * proven reason), so this file pins the WIRING in the source text, the same
 * technique as `knowledge-page-fail-closed-wiring.test.ts`.
 *
 * Kills: a resolveKbNode call inside any effect whose deps include the
 * roster (`allKbs` / `kbListReady`); a roster-keyed effect that re-issues
 * node resolution.
 *
 * RUN: cd forge-ui && npx vitest run lib/knowledge-page-node-resolve-wiring.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../app/knowledge/page.tsx'), 'utf8');

/** Slice one useEffect body: from the given anchor inside it to its dep
 *  array (the first `}, [` after the anchor), returning both halves. */
function effectAround(anchor: string): { body: string; deps: string } {
  const at = source.indexOf(anchor);
  expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const start = source.lastIndexOf('useEffect(', at);
  expect(start, `no useEffect( before anchor: ${anchor}`).toBeGreaterThan(-1);
  const depsStart = source.indexOf('}, [', at);
  expect(depsStart, `no dep array after anchor: ${anchor}`).toBeGreaterThan(-1);
  const depsEnd = source.indexOf(']', depsStart);
  return {
    body: source.slice(start, depsStart),
    deps: source.slice(depsStart + 4, depsEnd),
  };
}

test('resolveKbNode lives in its OWN effect, keyed on the URL params alone — the roster (allKbs/kbListReady) never re-runs it (knowledge-30)', () => {
  const { deps } = effectAround('resolveKbNode(');
  expect(deps).not.toContain('allKbs');
  expect(deps).not.toContain('kbListReady');
  // it still re-keys on the params themselves (a NEW deep link resolves anew)
  expect(deps).toContain('nodeParam');
  expect(deps).toContain('themeParam');
  expect(deps).toContain('idParam');
});

test('the roster-keyed selection effect never calls resolveKbNode — the node-only path is owned by the resolve effect and early-returns here', () => {
  // the combined selection effect is the one whose deps DO include the roster
  const at = source.indexOf('resolveActiveKbId(idParam, allKbs, kbListReady)');
  expect(at).toBeGreaterThan(-1);
  const start = source.lastIndexOf('useEffect(', at);
  const depsStart = source.indexOf('}, [', at);
  const body = source.slice(start, depsStart);
  const deps = source.slice(depsStart + 4, source.indexOf(']', depsStart));
  expect(deps).toContain('allKbs');
  expect(body).not.toContain('resolveKbNode(');
});

// ---------------------------------------------------------------------------
// W8-B2 (forge-6gv.6.3) — a graph selection is WRITTEN BACK to ?node=.
//
// `?node=` has always been READABLE (the drain's per-finding "open in Explore"
// link depends on it), but clicking a node in the graph never reached the URL,
// so the address bar disagreed with the page and a share/reload/back landed
// somewhere else. Source-level, like every other assertion in this file: the
// page is a client component with hooks and no jsdom is installed.
// ---------------------------------------------------------------------------

test('handleSelectNode writes the selection back to ?node= via syncSelectionToUrl', () => {
  expect(source).toMatch(/const syncSelectionToUrl = useCallback\(/);
  const body = source.slice(source.indexOf('const handleSelectNode = useCallback('));
  expect(body.slice(0, 400)).toContain('syncSelectionToUrl(nodeId)');
});

test('the selection sync uses router.replace, never push — exploring a graph must not bury the Back button', () => {
  const fn = source.slice(source.indexOf('const syncSelectionToUrl = useCallback('));
  const bodyOnly = fn.slice(0, fn.indexOf('const handleSelectNode'));
  expect(bodyOnly).toContain('router.replace(');
  expect(bodyOnly).not.toContain('router.push(');
});

test('the sync short-circuits when ?node= already names this node — no redundant history writes', () => {
  const fn = source.slice(source.indexOf('const syncSelectionToUrl = useCallback('));
  expect(fn.slice(0, fn.indexOf('const handleSelectNode'))).toMatch(/params\.get\('node'\) === nodeId\) return;/);
});

test('the sync clears ?theme=, so its alias can never disagree with the ?node= just written', () => {
  const fn = source.slice(source.indexOf('const syncSelectionToUrl = useCallback('));
  expect(fn.slice(0, fn.indexOf('const handleSelectNode'))).toContain("params.delete('theme')");
});
