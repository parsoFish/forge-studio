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
  expect(src).toMatch(/import \{ useBridgeRecovery \} from '@\/lib\/use-bridge-status'/);
  // 2. subscribes to bridge recovery with its own reload (never a page poll)
  expect(src).toMatch(/useBridgeRecovery\(reload\)/);
  // 3. the load has a real catch that captures the failure via the shared classifier
  expect(src).toMatch(/catch \(err\) \{[\s\S]{0,400}fetchErrorPropsFrom\(err\)[\s\S]{0,200}setLoadError\(/);
  // 4. renders the shared error state under the route's OWN data-page
  expect(src).toMatch(new RegExp(`<PageLoadError[\\s\\S]{0,200}page="${page}"`));
  // 5. a manual Retry re-runs the load (the shared component wires onRetry)
  expect(src).toMatch(/<PageLoadError[\s\S]{0,600}onRetry=\{reload\}/);
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
  test('loadPreflight / loadRoadmap no longer escape as unhandled rejections — each has a catch that surfaces a panel-scoped error', () => {
    expect(PROJECT).toMatch(/const loadPreflight = useCallback\(async[\s\S]{0,400}catch \(err\)[\s\S]{0,300}setPanelError\(/);
    expect(PROJECT).toMatch(/const loadRoadmap = useCallback\(async[\s\S]{0,400}catch \(err\)[\s\S]{0,300}setPanelError\(/);
    // …and that panel error is RENDERED (the shared inline failure state), not just stored
    expect(PROJECT).toMatch(/panelError \? \([\s\S]{0,200}<FetchErrorState/);
  });
});

describe('/flows/[id] (A1-02)', () => {
  test('wires the fail-closed primitives under data-page="flow-monitor"', () => {
    expectFailClosedPrimitives(FLOW, 'flow-monitor');
  });
  test('the NotFound branch is gated on a SUCCESSFUL flows read — never rendered while loadError is set', () => {
    expect(FLOW).toMatch(/if \(flowNotFound && !isNew && !loadError\)/);
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
