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
 * RUN: cd forge-ui && npx vitest run tests/regression/detail-pages-fail-closed-wiring.test.ts
 */
import { test, expect, describe } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

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

const APP_ROOT = resolve(__dirname, '..', '..', 'app');

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
    'tests/regression/knowledge-page-fail-closed-wiring.test.ts — a bespoke (FetchErrorState + ' +
    'kbDetailError/retryKbDetail) shape pinned there; same contract, different names.',
  // W8-B5 (community-30) made this a candidate: it began rendering NotFound
  // for an `?edit=<id>` that does not exist (it used to render the whole edit
  // form under a red banner). Categorised deliberately, with BOTH halves
  // stated so this row cannot read as a clean bill of health:
  //   COVERED — the defect class this file exists for. The not-found claim is
  //   gated on `registryEditLoadOutcome` (lib/community-form.ts): ONLY a real
  //   HTTP 404 renders NotFound; a transport failure carries no status at all
  //   and renders the existing [data-component="fetch-error"] banner instead,
  //   so a down bridge can never fabricate an absence claim. Pinned by name in
  //   tests/regression/community-surface-wiring.test.ts ("NotFound is gated on the
  //   not-found OUTCOME…", "the transport-failure banner SURVIVES",
  //   "fetchRegistryItem carries the HTTP status through") and enumerated over
  //   every status shape in tests/regression/community-form.test.ts.
  //   forge-4sj CLOSED the second half: the page now uses the shared
  //   PageLoadError kit (Retry + bridge-recovery resubscribe) for a non-404
  //   edit-load failure, exactly like its `[kind]/[id]` sibling below —
  //   pinned by the "forge-4sj: …" tests in community-surface-wiring.test.ts.
  'app/community/new/page.tsx':
    'tests/regression/community-surface-wiring.test.ts + tests/regression/community-form.test.ts — the 404-vs-' +
    'transport-failure split AND the PageLoadError/useBridgeRecoveryWhenFailed retry wiring are both ' +
    'pinned there, adapted for this page\'s non-throwing read shape (fetchRegistryItem never throws).',
  // forge-5rr (projects-45): the pending scan flagged this as the strongest
  // GENUINE gap of the eight — a closer look found the not-found branch
  // ALREADY correctly gated on a real bridge-answered 404 (never a transport
  // failure), but the failure branch had no Retry and no bridge-recovery
  // resubscribe (a dead-end banner, crosscut-22). Fixed to use the shared
  // PageLoadError + useBridgeRecoveryWhenFailed kit — EXEMPT here rather than
  // COMPLIANT only because `fetchCommunityItemDetail` is a status-shaped
  // `{ok,status?,error?}` read that never throws, so `expectFailClosedPrimitives`'s
  // `catch (err)` regex cannot match it textually; the same contract is
  // pinned, adapted for that shape, in the tests below.
  'app/community/[kind]/[id]/page.tsx':
    'tests/regression/community-surface-wiring.test.ts — the not-404-vs-transport ' +
    'split AND the PageLoadError/useBridgeRecoveryWhenFailed retry wiring are both ' +
    'pinned there, adapted for this page\'s non-throwing read shape.',
  // forge-5rr (projects-45): the pending scan's OTHER strongest candidate.
  // The page's own NotFound (`viewState.status === 'no-session'`) was
  // ALREADY correctly gated — it is driven entirely by `fetchSessionShell`/
  // `deriveSessionShellViewState`, pinned at the pure-logic level
  // (tests/contract/session-shell-view.test.ts AT-63/AT-65) to be reachable
  // ONLY off a genuine `errorKind === 'not-found'`, never a transport
  // failure. The REAL defect was one level down: the per-kind SUMMARY
  // read's four `.catch(() => {})` sites silently discarded a fail-closed
  // (bridgeReadOrThrow) failure — for architect/project-brain (no generic-
  // panel fallback) that blanked the whole left column while the page still
  // reported "ready". Fixed to capture it into `summaryError` and render a
  // retryable FetchErrorState instead. EXEMPT here rather than COMPLIANT
  // because the page renders via `StudioArchitectShell` + an inline
  // `FetchErrorState`, never the standalone `PageLoadError` component, so
  // `expectFailClosedPrimitives`'s regexes cannot match it textually.
  // DISCLOSED, not fixed: `fetchStagedThemes`'s own `.catch(() => {})` has
  // the same shape but self-heals within one ~3s poll and is materially
  // less severe (see the wiring test's own header for the full reasoning).
  'app/sessions/[kind]/[sessionId]/page.tsx':
    'tests/regression/session-shell-summary-fail-closed-wiring.test.ts — the summary-' +
    'read swallow fix is pinned there; the not-found-vs-transport-failure split is ' +
    'pinned at the pure-logic level in tests/contract/session-shell-view.test.ts.',
  // forge-5rr (projects-45): the pending scan's three "unverified" siblings
  // (connections/hooks/skills). On inspection all three already had the
  // crosscut-08 defect class closed: a status-shaped, never-throwing read
  // (same shape as `/community/[kind]/[id]`'s) with `not-found` reachable
  // ONLY off a real HTTP 404, and a Retry ALREADY wired to the inline
  // FetchErrorState. The one gap, uniform across all three: no bridge-
  // recovery resubscribe (crosscut-22) — fixed identically on each.
  'app/connections/[id]/page.tsx':
    'tests/regression/library-detail-fail-closed-wiring.test.ts — the 404-only-not-found ' +
    'guard, the pre-existing Retry, and the new bridge-recovery resubscribe are all ' +
    'pinned there for this page\'s non-throwing read shape.',
  'app/hooks/[id]/page.tsx':
    'tests/regression/library-detail-fail-closed-wiring.test.ts — same contract as ' +
    '/connections/[id], pinned for this page\'s non-throwing read shape.',
  'app/skills/[id]/page.tsx':
    'tests/regression/library-detail-fail-closed-wiring.test.ts — same contract as ' +
    '/connections/[id], pinned for this page\'s non-throwing read shape.',
  // forge-5rr (projects-45): ALREADY fully closed under an earlier bead
  // (forge-irn, W7-B5 — see both files' own headers) before this scan even
  // ran. `fetchRunDetail` catches a transport throw into
  // `resolution:'unresolved'` (no status, never the authoritative
  // "not found"); a non-404 non-2xx status maps the same way (pinned at the
  // pure-logic level, tests/unit/run-view-client.test.ts); the page's
  // NotFound render is gated on `resolution === 'not-found'` alone; Retry is
  // already wired; the live poll keeps watching an "unresolved" transient
  // failure rather than giving up on the first blip. No production change
  // this pass — verified with a mutation check, not assumed.
  'app/agents/[id]/run/[runId]/page.tsx':
    'tests/regression/agent-run-page-fail-closed-wiring.test.ts — the not-found-vs-' +
    'unresolved split, the Retry wiring and the poll\'s transient-failure tolerance ' +
    'are all pinned there; the underlying status-mapping is pinned at the pure-logic ' +
    'level in tests/unit/run-view-client.test.ts.',
  // forge-5rr (projects-45): the D9/forge-irn SIBLING of the row above —
  // ALREADY fully closed before this scan ran. `fetchFlowRunDetail`'s
  // transport-throw path resolves 'unresolved' via the sentinel-0
  // convention (never 'not-found'); `resolveRunPageState` additionally
  // downgrades a FOUND run to 'unresolved' when the flows-list read failed.
  // All of that was already exhaustively pinned at the pure-logic level
  // (tests/regression/flow-run-detail-client.test.ts's own "KILL 1a/1b/2a/
  // 2b/3" tests). What was missing was the PAGE-level wiring pin — the scan's
  // "unverified" note fired because the page uses a bespoke inline retry
  // body, not the shared FetchErrorState/PageLoadError a grep would catch,
  // but the CONTRACT (never NotFound off a transport failure, checked
  // BEFORE not-found, with a working Retry) was already honoured. No
  // production change — verified with a mutation check.
  'app/flows/[id]/run/[runId]/page.tsx':
    'tests/regression/flow-run-page-fail-closed-wiring.test.ts — the unresolved-before-' +
    'not-found ordering, the bespoke Retry, and the single NotFound render site are ' +
    'all pinned there; the underlying status-mapping is pinned at the pure-logic level ' +
    'in tests/regression/flow-run-detail-client.test.ts.',
  // forge-5rr (projects-45): the scan's own note already verified this at
  // source ("a real, distinguishable failure state, not a swallow") and
  // left it PENDING only because no test pinned that banner to a thrown
  // read yet. `kickoffSpecFor(kind)` — a pure, static registry lookup with
  // NO bridge read in its path — decides the NotFound branch BEFORE the
  // mount-load effect can even fire, so the not-found claim here is
  // STRUCTURALLY incapable of the crosscut-08 shape; a real mount-load
  // failure (for a REGISTERED kind) surfaces via the existing
  // `data-kickoff-error` banner with the thrown message. No production
  // change — both proven by mounting the real page, with a mutation check.
  'app/sessions/[kind]/new/page.tsx':
    'tests/regression/session-kickoff-fail-closed-wiring.test.ts — both the zero-' +
    'network-calls not-found claim and the real mount-load failure banner are ' +
    'proven by mounting the real page.',
  // forge-5rr (projects-45): the not-found claim was ALREADY correctly
  // gated on a real bridge-answered 404 (`fetchTemplate`'s status-shaped,
  // never-throwing read — same shape as `/community/[kind]/[id]`'s) — but,
  // unlike its /connections|/hooks|/skills/[id] siblings, the error state
  // had NO Retry at all (a static banner) and no bridge-recovery
  // resubscribe. Fixed to use the shared PageLoadError +
  // useBridgeRecoveryWhenFailed kit — EXEMPT here rather than COMPLIANT for
  // the same non-throwing-read reason as its community sibling.
  'app/templates/[id]/page.tsx':
    'tests/regression/template-detail-fail-closed-wiring.test.ts — the 404-only-not-' +
    'found guard, the PageLoadError render and the bridge-recovery resubscribe are ' +
    'all pinned there for this page\'s non-throwing read shape.',
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
// forge-5rr (projects-45): CLOSED — every candidate the W8-A2/WI-5 scan
// derived is now COMPLIANT or EXEMPT. Kept as an explicit empty map (not
// deleted) so the completeness test below still enforces the invariant: any
// NEW page the derivation finds must be consciously categorized here before
// it can pass.
const PENDING_PAGES: Record<string, string> = {};

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
    expect(() => readFileSync(resolve(__dirname, '..', '..', testFile), 'utf8'), `${page}: ${testFile} must exist`).not.toThrow();
  }
});
