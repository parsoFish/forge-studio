/**
 * W7-FIX-A1 (A1-01 / A1-02 + the demo-showcase gate regression) — WIRING
 * pins for the four detail routes whose reads went fail-closed in W7-A1
 * (`studioRead*` THROW `BridgeReadError`) while their `load()` kept the
 * pre-conversion `try { … } finally { setReady(true) }` shape — no `catch`.
 * On any bridge failure the throw escaped as an unhandled rejection, the
 * `finally` still flipped `ready`, and each page SETTLED INTO A CONFIDENT
 * WRONG ANSWER:
 *   - /agents/<id>        → a blank builder for a real agent (A1-01);
 *   - /projects/<id>      → NotFound "No project <id>" (A1-02);
 *   - /flows/<id>         → NotFound "No flow <id>" (A1-02);
 *   - /projects/<id>/showcase → the honest EMPTY state for a bridge failure
 *     (and, since W7-A4, NotFound for a not-yet-listed project — the beat's
 *     zero-cycle fixture project was never registered, so it never settled).
 *
 * These four pages are `use client` pages with effect-driven fetches — they
 * cannot be render-tested via `renderToStaticMarkup` (the fetch effect never
 * runs under SSR-style rendering; see `flows-index-render.test.ts`'s header
 * for the standing reason). So, like `knowledge-page-empty-state-wiring.
 * test.ts`, this file pins the WIRING in the source text; the rendered
 * error state itself is pinned with a REAL render test at
 * `page-load-error-render.test.ts`, and the showcase's empty/error split is
 * pinned in `showcase-load.test.ts`/`project-showcase.test.ts`.
 *
 * Kills: a `load()` with no `catch`; a `catch` that maps a failure to
 * `{kind:'empty'}`/`null`; a page that renders NotFound while `loadError` is
 * set; a detail page that never subscribes to bridge recovery (stuck until
 * F5 — crosscut-22); the dead `'empty-roster'` branch that a fail-closed
 * roster read can never reach.
 *
 * RUN: cd forge-ui && npx vitest run lib/detail-pages-fail-closed-wiring.test.ts
 */
import { test, expect, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8');

const AGENT = read('app/agents/[id]/page.tsx');
const PROJECT = read('app/projects/[id]/page.tsx');
const FLOW = read('app/flows/[id]/page.tsx');
const SHOWCASE = read('app/projects/[id]/showcase/page.tsx');

/** The three primitives every fail-closed detail page must wire. */
function expectFailClosedPrimitives(src: string, page: string): void {
  // 1. imports the shared page-level error state + the recovery hook
  expect(src).toMatch(/import \{ PageLoadError \} from '@\/components\/PageLoadError'/);
  // 2. subscribes to bridge recovery with its own reload (never a page poll)
  //    — the DETAIL-page rule (review): refill ONLY while failed, so a socket
  //    blip never re-loads over the operator's unsaved edits / open drawer.
  expect(src).toMatch(/import \{ useBridgeRecoveryWhenFailed \} from '@\/lib\/use-bridge-status'/);
  expect(src).toMatch(/useBridgeRecoveryWhenFailed\([^)]*!== null[^)]*, reload\)/);
  expect(src).not.toMatch(/useBridgeRecovery\(reload\)/);
  // 3. the load has a real catch that captures the failure via the shared classifier
  expect(src).toMatch(/catch \(err\) \{[\s\S]{0,400}setLoadError\(fetchErrorPropsFrom\(err\)\)/);
  // 4. renders the shared error state under the route's OWN data-page
  expect(src).toMatch(new RegExp(`<PageLoadError[\\s\\S]{0,200}page="${page}"`));
  // 5. a manual Retry re-runs the load (the shared component wires onRetry)
  expect(src).toMatch(/<PageLoadError[\s\S]{0,600}onRetry=\{reload\}/);
  // 6. the captured failure reaches the error state under the SAME field
  //    name `fetchErrorPropsFrom` returns (`{error, status}`) — a
  //    `{message}`-shaped state fed by `{error}` renders an empty error text
  //    (successor-resume finding: caught by tsc, pinned here so a vitest-only
  //    run also fails)
  expect(src).toMatch(/useState<\{ error: string; status\?: number \} \| null>\(null\)/);
  expect(src).toMatch(/<PageLoadError[\s\S]{0,600}error=\{(page)?[lL]oadError\.error\}/);
  expect(src).not.toMatch(/loadError\.message/);
}

describe('/agents/[id] (A1-01)', () => {
  test('wires the fail-closed primitives under data-page="agents"', () => {
    expectFailClosedPrimitives(AGENT, 'agents');
  });
  test('the dead "empty-roster" branch is gone — a fail-closed roster read either resolves the slug or throws; an honestly empty roster is a real not-found', () => {
    expect(AGENT).not.toContain("'empty-roster'");
    expect(AGENT).not.toContain('fails open to []');
  });
  test('the load-error guard precedes the builder root and the not-found guard cannot fire off a failed read', () => {
    const errIdx = AGENT.indexOf('<PageLoadError');
    const rootIdx = AGENT.indexOf('data-page="agents"\n');
    expect(errIdx).toBeGreaterThan(0);
    expect(rootIdx).toBeGreaterThan(errIdx);
    // slugResolution is assigned ONLY inside the try body (never in a catch)
    expect(AGENT).not.toMatch(/catch[\s\S]{0,300}setSlugResolution\('not-found'\)/);
  });
});

describe('/projects/[id] (A1-02)', () => {
  test('wires the fail-closed primitives under data-page="projects"', () => {
    expectFailClosedPrimitives(PROJECT, 'projects');
  });
  test('the NotFound branch is gated on a SUCCESSFUL roster read — never rendered while loadError is set', () => {
    expect(PROJECT).toMatch(/if \(ready && !loadError && !project\)[\s\S]{0,80}<NotFound kind="project"/);
  });
  test('loadPreflight / loadRoadmap / loadCycleGroups no longer escape as unhandled rejections or fail open — each has a catch that surfaces its OWN panel-scoped error slot (two failing panels both stay visible), and its success clears only its own slot', () => {
    expect(PROJECT).toMatch(/const loadPreflight = useCallback\(async[\s\S]{0,400}catch \(err\)[\s\S]{0,300}setPanelError\('preflight', \{ what: [^}]*fetchErrorPropsFrom\(err\)/);
    expect(PROJECT).toMatch(/const loadRoadmap = useCallback\(async[\s\S]{0,400}catch \(err\)[\s\S]{0,300}setPanelError\('roadmap', \{ what: [^}]*fetchErrorPropsFrom\(err\)/);
    expect(PROJECT).toMatch(/const loadCycleGroups = useCallback\(async[\s\S]{0,900}catch \(err\)[\s\S]{0,300}setPanelError\('cycles', \{ what: [^}]*fetchErrorPropsFrom\(err\)/);
    // the pre-fix fail-open (`catch { setCycleGroups([]); setProjectCycles([]) }`) is gone
    expect(PROJECT).not.toMatch(/catch \{[\s\S]{0,120}setCycleGroups\(\[\]\)/);
    for (const key of ['preflight', 'roadmap', 'cycles']) expect(PROJECT).toContain(`setPanelError('${key}', null)`);
    expect(PROJECT).toMatch(/panelErrorList\.map\(\(pe\) => \([\s\S]{0,200}<FetchErrorState/);
    // …and that panel error is RENDERED (the shared inline failure state), not just stored
    expect(PROJECT).toMatch(/panelErrorList\.length > 0 \? \([\s\S]{0,300}<FetchErrorState/);
  });
});

describe('/flows/[id] (A1-02)', () => {
  test('wires the fail-closed primitives under data-page="flow-monitor"', () => {
    expectFailClosedPrimitives(FLOW, 'flow-monitor');
  });
  test('the NotFound branch is gated on a SUCCESSFUL flows read — never rendered while a load error is set', () => {
    expect(FLOW).toMatch(/if \(flowNotFound && !isNew && !pageLoadError\)/);
  });
  test('the BUILD tab read has its OWN error slot — the monitor read\'s success cannot clear a builder failure it did not supersede (A1-03 class), and the builder\'s success clears only its own', () => {
    expect(FLOW).toMatch(/const \[buildLoadError, setBuildLoadError\]/);
    expect(FLOW).toMatch(/const pageLoadError = loadError \?\? buildLoadError;/);
    expect(FLOW).toMatch(/const loadBuildData = useCallback\(async[\s\S]{0,1200}setBuildLoadError\(null\);[\s\S]{0,1200}catch \(err\)[\s\S]{0,400}setBuildLoadError\(fetchErrorPropsFrom\(err\)\)/);
    expect(FLOW).toMatch(/if \(view\.ready && pageLoadError\)/);
  });
});

describe('/projects/[id]/showcase (demo-showcase gate regression)', () => {
  test('wires the fail-closed primitives under data-page="project-showcase"', () => {
    expectFailClosedPrimitives(SHOWCASE, 'project-showcase');
  });
  test('a bridge failure is an ERROR state — the catch never fabricates the honest EMPTY state', () => {
    expect(SHOWCASE).not.toMatch(/catch[\s\S]{0,200}setResult\(\{ kind: 'empty' \}\)/);
    expect(SHOWCASE).not.toContain('degrade to the honest empty state');
  });
  test('project-known is derived from the (fail-closed) roster exactly — no "empty roster = bridge unreachable" fail-open', () => {
    expect(SHOWCASE).not.toMatch(/roster\.length === 0 \? null/);
    expect(SHOWCASE).toMatch(/setProjectKnown\(roster\.some\(\(p\) => p\.id === id\)\)/);
  });
  test('the NotFound branch is gated on a SUCCESSFUL roster read', () => {
    expect(SHOWCASE).toMatch(/if \(ready && !loadError && projectKnown === false\)/);
  });
});
