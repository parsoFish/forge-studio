/**
 * W7-FIX-A1 (A1-01 / A1-02 + the demo-showcase gate regression) — WIRING
 * pins for the detail routes whose reads went fail-closed in W7-A1
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
 *   - /artifact (W8-A2, crosscut-08) → "Artifact not yet produced" for a
 *     PLAN.html that was sitting on disk the whole time — a down bridge
 *     fabricated an ABSENCE claim, not just a not-found.
 *
 * These pages are `use client` pages with effect-driven fetches — they
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
 * ---------------------------------------------------------------------------
 * W8-A2 (WI-5, crosscut-08 review) — DERIVED page inventory, not hardcoded.
 * ---------------------------------------------------------------------------
 * The four pages above used to be the file's entire universe, hand-picked.
 * That is exactly why `/artifact` was missed for a whole wave: nothing ever
 * asked "which OTHER pages have the same shape". Below, every
 * every nested `page.tsx` under `app/` is enumerated and scored against a predicate for "is
 * this a candidate for the shared fail-closed contract at all" — every
 * candidate must then land in exactly ONE of three buckets:
 *
 *   - `COMPLIANT_PAGES` — asserted in full via `expectFailClosedPrimitives`
 *     (one describe block per page, below).
 *   - `EXEMPT_PAGES` — legitimately fine via a DIFFERENT, equally-strict
 *     wiring test (named per entry) that this file does not duplicate.
 *   - `PENDING_PAGES` — flagged by the derivation, NOT fixed by this pass.
 *     W8-A2/WI-5's brief is explicit: "report them, do not silently expand
 *     scope to fix them all." Each entry carries a one-line note of what was
 *     actually observed (several already have SOME inline `FetchErrorState`
 *     handling — just not the shared `PageLoadError` shape — so "pending" is
 *     not a claim that they are broken, only that this file does not verify
 *     them yet).
 *
 * The completeness test below asserts the derived candidate list is EXACTLY
 * the union of the three buckets — a NEW page that starts rendering
 * `NotFound` off its own bridge read will show up as an extra candidate in
 * NONE of the three buckets, failing that test until someone consciously
 * places it in one.
 *
 * PREDICATE (documented so it stays honest as pages change): a `page.tsx` is
 * a candidate when it (a) imports at least one `fetch*`-named symbol from
 * `@/lib/*` (excluding `fetchErrorPropsFrom`, the error-SHAPING helper, not
 * a read) — it performs its OWN bridge read — AND (b) renders the shared
 * `<NotFound>` component — it can answer "this object does not exist". That
 * conjunction is exactly crosscut-08's defect class: a transport failure has
 * nowhere else to go but a false "does not exist" claim UNLESS the page
 * threads it through the shared kit (or an exempted equivalent). A page that
 * fetches but never renders NotFound (an index/listing page — an empty list
 * is a real, unambiguous answer, never confusable with "list does not
 * exist") is correctly never a candidate; neither is a page that renders
 * NotFound off a purely static check (no fetch at all).
 *
 * RUN: cd forge-ui && npx vitest run lib/detail-pages-fail-closed-wiring.test.ts
 */
import { test, expect, describe } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8');

const AGENT = read('app/agents/[id]/page.tsx');
const PROJECT = read('app/projects/[id]/page.tsx');
const FLOW = read('app/flows/[id]/page.tsx');
const SHOWCASE = read('app/projects/[id]/showcase/page.tsx');
const ARTIFACT = read('app/artifact/page.tsx');

/** The three primitives every fail-closed detail page must wire. */
function expectFailClosedPrimitives(src: string, page: string): void {
  // 1. imports the shared page-level error state + the recovery hook
  expect(src).toMatch(/import \{ PageLoadError \} from '@\/components\/PageLoadError'/);
  // 2. subscribes to bridge recovery with its own reload (never a page poll)
  //    — the DETAIL-page rule (review): refill ONLY while failed, so a socket
  //    blip never re-loads over the operator's unsaved edits / open drawer.
  expect(src).toMatch(/import \{ useBridgeRecoveryWhenFailed \} from '@\/lib\/use-bridge-status'/);
  expect(src).toMatch(/useBridgeRecoveryWhenFailed\(\s*[^;]*!== null[^;]*,\s*(reload|loadError !== null \? reload : retryPanels),?\s*\)/);
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
    expect(PROJECT).toMatch(/panelErrorList\.map\(\(pe\) => \([\s\S]{0,200}<FetchErrorState[^>]{0,200}onRetry=\{retryPanels\}/);
    // panels re-run on their OWN key: a panel Retry / panels-only recovery never re-runs loadData (form clobber)
    expect(PROJECT).toMatch(/useBridgeRecoveryWhenFailed\(\s*loadError !== null \|\| panelErrorList\.length > 0,\s*loadError !== null \? reload : retryPanels,\s*\)/);
    expect(PROJECT).toMatch(/\}, \[isNew, loadData, loadKey\]\);/);
    // W7-D1: `projectKnown` JOINS this dependency list — a STRENGTHENING, not a
    // relaxation. The panel reads must not fire for an id the roster has not
    // confirmed (the same rule W7-A4 wrote for `new`, one case wider), and the
    // gate is a stable boolean rather than the `project` object so a save that
    // changes the object's identity does not re-run every panel read. Both the
    // guard and the dependency are pinned, so removing either fails here.
    expect(PROJECT).toMatch(/if \(isNew \|\| !projectKnown\) return;/);
    expect(PROJECT).toMatch(/const projectKnown = project !== null;/);
    expect(PROJECT).toMatch(/\}, \[isNew, projectKnown, loadPreflight, loadRoadmap, loadCycleGroups, loadKey, panelKey\]\);/);
    // a failed cycles read never keeps a PREVIOUS project's cycles under this project's error
    expect(PROJECT).toMatch(/catch \(err\) \{[\s\S]{0,300}setCycleGroups\(\[\]\);\s*setProjectCycles\(\[\]\);\s*setPanelError\('cycles'/);
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
  test('a FAILED live refresh (WS-triggered fetchRuns / fetchRun) is caught into a monitor-scoped refreshError with Retry — never an unhandled rejection, never unseating the loaded page', () => {
    expect(FLOW).toMatch(/const refreshActiveRun = useCallback\([\s\S]{0,600}catch \(err\) \{[\s\S]{0,120}setRefreshError\(fetchErrorPropsFrom\(err\)\)/);
    expect(FLOW).toMatch(/const refreshRuns = useCallback\([\s\S]{0,700}catch \(err\) \{[\s\S]{0,120}setRefreshError\(fetchErrorPropsFrom\(err\)\)/);
    expect(FLOW).toMatch(/data-section="monitor-refresh-error"[\s\S]{0,200}<FetchErrorState[^>]{0,200}onRetry=\{retryRefresh\}[^>]{0,40}compact/);
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
    expect(SHOWCASE).toMatch(/const known = roster\.some\(\(p\) => p\.id === id\);\s*setProjectKnown\(known\);/);
  });
  test('the NotFound branch is gated on a SUCCESSFUL roster read — and a definitive not-found short-circuits BEFORE the cycles/demo reads (a later read failure never turns a not-found into a retryable error)', () => {
    expect(SHOWCASE).toMatch(/if \(ready && !loadError && projectKnown === false\)/);
    expect(SHOWCASE).toMatch(/const known = roster\.some\(\(p\) => p\.id === id\);[\s\S]{0,500}if \(!known\) \{[\s\S]{0,120}return;\s*\}\s*const snapshot = await fetchCycles\(\);/);
  });
});

describe('/artifact (W8-A2, crosscut-08)', () => {
  test('wires the fail-closed primitives under data-page="artifact"', () => {
    expectFailClosedPrimitives(ARTIFACT, 'artifact');
  });
  test('fetchArtifactDoc has no catch-all — every probe resolves a settled outcome or throws (never coerces a transport failure to {type:"empty"})', () => {
    const start = ARTIFACT.indexOf('async function fetchArtifactDoc(');
    expect(start).toBeGreaterThan(-1);
    const end = ARTIFACT.indexOf('\nasync function fetchArtifactFileChecked', start);
    expect(end).toBeGreaterThan(start);
    const body = ARTIFACT.slice(start, end);
    expect(body).not.toMatch(/\}\s*catch\s*\{/);
  });
  test('the NotFound(run) branch is gated on ready — and the loadError branch is checked BEFORE it, so a transport failure never falls through to "no such run"', () => {
    const loadErrorIdx = ARTIFACT.indexOf('if (ready && loadError) {');
    const runNotFoundIdx = ARTIFACT.indexOf('if (ready && runNotFound) {');
    expect(loadErrorIdx).toBeGreaterThan(-1);
    expect(runNotFoundIdx).toBeGreaterThan(-1);
    expect(loadErrorIdx).toBeLessThan(runNotFoundIdx);
  });
  test('the architect-session branch is fail-closed too — a thrown fetchArchitectSessions sets loadError, not a silent indefinite spinner', () => {
    expect(ARTIFACT).toMatch(/sessions = await fetchArchitectSessions\(\);\s*\} catch \(err\) \{\s*if \(!signal\.cancelled\) setLoadError\(fetchErrorPropsFrom\(err\)\);/);
  });
  test('the reflection Stage-2 fetch no longer swallows a transport failure into "No reflection questions filed"', () => {
    expect(ARTIFACT).not.toMatch(/fetchReflection\(artifactId\)\.catch\(\(\) => null\)/);
  });
});

// ---------------------------------------------------------------------------
// W8-A2 (WI-5) — derived page inventory + completeness gate. See the file
// header for the full rationale and the predicate definition.
// ---------------------------------------------------------------------------

const APP_ROOT = resolve(__dirname, '..', 'app');

function findPageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findPageFiles(full));
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/** `fetch<Name>` imports found in the file's `import` statements, excluding
 *  `fetchErrorPropsFrom` (the error-SHAPING helper — not a bridge read). */
function importsFetchSymbol(src: string): boolean {
  const importBlock = (src.match(/^import [\s\S]*?;\s*$/gm) ?? []).join('\n');
  const names = importBlock.match(/\bfetch[A-Za-z0-9_]*\b/g) ?? [];
  return names.some((n) => n !== 'fetchErrorPropsFrom');
}

/** Renders the shared `<NotFound … />` component — see `components/NotFound.tsx`'s
 *  own docstring for the exact set of routes it documents as its callers. */
function rendersNotFound(src: string): boolean {
  return /<NotFound[\s/>]/.test(src);
}

function toAppRelative(absPath: string): string {
  return `app/${relative(APP_ROOT, absPath).replace(/\\/g, '/')}`;
}

const CANDIDATES = findPageFiles(APP_ROOT)
  .filter((p) => {
    const src = readFileSync(p, 'utf8');
    return importsFetchSymbol(src) && rendersNotFound(src);
  })
  .map(toAppRelative)
  .sort();

/** Asserted in full above via `expectFailClosedPrimitives`. */
const COMPLIANT_PAGES = [
  'app/agents/[id]/page.tsx',
  'app/artifact/page.tsx',
  'app/flows/[id]/page.tsx',
  'app/projects/[id]/page.tsx',
  'app/projects/[id]/showcase/page.tsx',
].sort();

/** Legitimately fail-closed via a DIFFERENT, equally-strict wiring test —
 *  not asserted again here so the two tests cannot drift out of sync and
 *  both silently pass on a shape neither actually checks. */
const EXEMPT_PAGES: Record<string, string> = {
  'app/knowledge/page.tsx':
    'lib/knowledge-page-fail-closed-wiring.test.ts — a bespoke (FetchErrorState + ' +
    'kbDetailError/retryKbDetail) shape pinned there; same contract, different names.',
};

/**
 * Flagged by the derivation, NOT fixed by W8-A2/WI-5 — reported, not
 * silently expanded into. Each note records what was actually observed
 * (2026-08-23), so "pending" here is a TODO, not an accusation: several
 * already render an inline `FetchErrorState` distinct from `NotFound` (just
 * not the shared `PageLoadError` shape this file asserts), which may turn
 * out to be an equally valid pattern on closer look — that look is exactly
 * what was NOT done here, per the brief's "report, don't fix" instruction.
 */
const PENDING_PAGES: Record<string, string> = {
  'app/agents/[id]/run/[runId]/page.tsx':
    'Renders NotFound for "no such run" AND an inline FetchErrorState for "unresolved" ' +
    '— NOT the shared PageLoadError kit. Unverified whether the FetchErrorState branch ' +
    'is reachable for a THROWN read or only a resolved-but-refused one.',
  'app/community/[kind]/[id]/page.tsx':
    'Renders NotFound for an unknown kind/id; no FetchErrorState/PageLoadError/catch ' +
    'visible near the read — the most likely GENUINE gap of the eight.',
  'app/connections/[id]/page.tsx':
    'Renders NotFound AND an inline FetchErrorState with its own error/errorStatus ' +
    'state — not the shared kit; unverified whether a transport failure reaches it.',
  'app/flows/[id]/run/[runId]/page.tsx':
    'Renders NotFound for an unknown run; no FetchErrorState/PageLoadError visible ' +
    'near the read in a quick scan — unverified.',
  'app/hooks/[id]/page.tsx':
    'Renders NotFound AND an inline FetchErrorState with its own error/errorStatus ' +
    'state — not the shared kit; unverified whether a transport failure reaches it.',
  'app/sessions/[kind]/[sessionId]/page.tsx':
    'Renders NotFound AND FetchErrorState; several `.catch(() => {})` sites nearby ' +
    'that look like the SAME swallow-to-nothing shape crosscut-08 is about — the ' +
    'strongest OTHER candidate for a real defect, unverified.',
  'app/sessions/[kind]/new/page.tsx':
    'NEW CANDIDATE as of W8-B3 (crosscut-R08): this page began rendering the shared ' +
    'NotFound for an unknown session KIND, which is a routing outcome rather than a ' +
    'read failure, so the derivation now picks it up. Verified at source, not scanned: ' +
    'its mount load is a single Promise.all with ONE top-level .catch that sets `error` ' +
    'and renders it at :512 as `data-kickoff-error` — a real, distinguishable failure ' +
    'state, not a swallow. It is PENDING rather than EXEMPT only because no test pins ' +
    'that banner to a thrown bridge read yet, and EXEMPT here requires naming a test ' +
    'file that actually covers the page.',
  'app/skills/[id]/page.tsx':
    'Renders NotFound AND an inline FetchErrorState with its own error/errorStatus ' +
    'state — not the shared kit; unverified whether a transport failure reaches it.',
  'app/templates/[id]/page.tsx':
    'Renders NotFound; no FetchErrorState/PageLoadError/catch visible near the read ' +
    'in a quick scan — unverified, possibly a genuine gap.',
};

test('the derived candidate list is EXACTLY the union of compliant + exempt + pending — a new page must be consciously categorized, never silently uncovered', () => {
  const accountedFor = [...COMPLIANT_PAGES, ...Object.keys(EXEMPT_PAGES), ...Object.keys(PENDING_PAGES)].sort();
  expect(CANDIDATES).toEqual(accountedFor);
});

test('every COMPLIANT page is a real file this suite actually reads (no stale entry passing by accident)', () => {
  const readPaths = new Set([
    'app/agents/[id]/page.tsx',
    'app/projects/[id]/page.tsx',
    'app/flows/[id]/page.tsx',
    'app/projects/[id]/showcase/page.tsx',
    'app/artifact/page.tsx',
  ]);
  for (const p of COMPLIANT_PAGES) expect(readPaths.has(p), p).toBe(true);
});

test('every EXEMPT page names a real, existing test file that covers it', () => {
  for (const [page, note] of Object.entries(EXEMPT_PAGES)) {
    const testFile = note.split(' — ')[0]?.split(' ')[0] ?? '';
    expect(testFile.endsWith('.test.ts'), `${page}: "${testFile}" doesn't look like a test file`).toBe(true);
    expect(() => readFileSync(resolve(__dirname, '..', testFile), 'utf8'), `${page}: ${testFile} must exist`).not.toThrow();
  }
});
