/**
 * W7-A3 (artifact-plan-03/05/09/21/27) — pinned contract for
 * `artifact-mode.ts`: `?mode=gate` is a REQUEST, not a fact. The gate renders
 * only when the run/session is actually awaiting that gate.
 *
 * Kills:
 *  - a completed run rendering a live "THIS RUN IS BLOCKED ON YOU" bar because
 *    the URL said mode=gate (artifact-plan-05);
 *  - an architect plan gate armed by the URL while the session is committed /
 *    rejected / drafting / missing (artifact-plan-03/21/27).
 */
import { test, expect } from 'vitest';

import { inferArtifactMode, resolveArtifactMode } from './artifact-mode.ts';
import type { Run } from './studio-client.ts';

function run(over: Partial<Run>): Run {
  return {
    id: 'c', flowId: 'forge-develop', initiativeId: 'INIT-2026-01-01-x', initiative: 'x', status: 'active', origin: 'architect',
    costUsd: 0, phases: {}, phaseMeta: {}, artifactsReady: {}, flowLineage: [], ...over,
  };
}

test('inferArtifactMode: artifactsReady gate/view drives plan/demo/pr; verdict gate = the queue state alone (gated)', () => {
  expect(inferArtifactMode('plan', run({ status: 'gated', artifactsReady: { plan: 'gate' } }))).toBe('gate');
  expect(inferArtifactMode('plan', run({ status: 'complete', artifactsReady: { plan: 'view' } }))).toBe('view');
  expect(inferArtifactMode('workitems', run({ artifactsReady: { 'work-items': 'gate' } }))).toBe('gate');
  expect(inferArtifactMode('verdict', run({ status: 'gated' }))).toBe('gate');
  expect(inferArtifactMode('verdict', run({ status: 'complete', artifactsReady: { verdict: 'view' } }))).toBe('view');
  expect(inferArtifactMode('verdict', run({ status: 'complete' }))).toBe('view');
  expect(inferArtifactMode('plan', null)).toBe('view');
});

// W7-B7 (artifact-plan-11/-14): verdict-gate arming, both directions.
test('verdict gate: ROUND 2 stays armed — a gated run with a prior send-back verdict.json still awaits the operator', () => {
  expect(inferArtifactMode('verdict', run({ status: 'gated', artifactsReady: { verdict: 'view' } }))).toBe('gate');
});

test('verdict gate: an ACTIVE run does not arm it (agents still working — nothing awaits the operator), and failed/planned never do', () => {
  expect(inferArtifactMode('verdict', run({ status: 'active' }))).toBe('view');
  expect(inferArtifactMode('verdict', run({ status: 'failed' }))).toBe('view');
  expect(inferArtifactMode('verdict', run({ status: 'planned' }))).toBe('view');
});

test('?mode=gate on a run that is NOT gated for that artifact → view (artifact-plan-05)', () => {
  const done = run({ status: 'complete', artifactsReady: { plan: 'view', demo: 'view', verdict: 'view' } });
  const opts = { architect: false, architectArmed: false };
  expect(resolveArtifactMode('gate', 'plan', done, opts)).toBe('view');
  expect(resolveArtifactMode('gate', 'demo', done, opts)).toBe('view');
  expect(resolveArtifactMode('gate', 'verdict', done, opts)).toBe('view');
  expect(resolveArtifactMode('gate', 'plan', null, opts)).toBe('view');
});

test('?mode=gate on a run that IS gated for that artifact → gate; ?mode=view always wins; absent → inferred', () => {
  const gated = run({ status: 'gated', artifactsReady: { demo: 'gate', pr: 'gate' } });
  const opts = { architect: false, architectArmed: false };
  expect(resolveArtifactMode('gate', 'demo', gated, opts)).toBe('gate');
  expect(resolveArtifactMode('gate', 'verdict', gated, opts)).toBe('gate');
  expect(resolveArtifactMode('view', 'demo', gated, opts)).toBe('view');
  expect(resolveArtifactMode(null, 'demo', gated, opts)).toBe('gate');
  expect(resolveArtifactMode('bogus', 'demo', gated, opts)).toBe('gate');
});

// artifact-plan-43 (W8-A2): `?mode=gate` is STILL never HONOURED for an
// unarmed session (the gate is armed by the session phase alone, never
// forced open by the URL) — but an explicit `?mode=view` NOW WINS even for
// an ARMED session, so a read-only visit is never silently promoted to the
// full Approve/Send-back/Reject gate (e.g. the live session poll arming
// mid-visit while a `mode=view` tab sits open — the old order checked
// `architectArmed` BEFORE the `mode=view` short-circuit, so the URL was
// ignored in both directions).
test('architect plan: mode=gate is still ignored on an unarmed session; mode=view now wins even when armed', () => {
  expect(resolveArtifactMode('gate', 'plan', null, { architect: true, architectArmed: false })).toBe('view');
  // The fix under test: mode=view on an ARMED session is now honoured (kills
  // a fix that only reorders the check without actually branching on it).
  expect(resolveArtifactMode('view', 'plan', null, { architect: true, architectArmed: true })).toBe('view');
  // Negative control — this is what stops the fix from disarming the gate
  // ENTIRELY: absent mode on an armed session must STILL arm it.
  expect(resolveArtifactMode(null, 'plan', null, { architect: true, architectArmed: true })).toBe('gate');
  // ...and an EXPLICIT mode=gate on an armed session still arms it too.
  expect(resolveArtifactMode('gate', 'plan', null, { architect: true, architectArmed: true })).toBe('gate');
  expect(resolveArtifactMode(null, 'plan', null, { architect: true, architectArmed: false })).toBe('view');
  // mode=view on an unarmed session was already 'view' — stays 'view'.
  expect(resolveArtifactMode('view', 'plan', null, { architect: true, architectArmed: false })).toBe('view');
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 — the artifact page's not-found rule. W7-A4 (crosscut-08 /
// artifact-plan-08) made an unknown run render the shared NotFound instead
// of a fabricated "not yet produced" story. That rule fired for a run whose
// queue manifest is gone but whose `_logs/<id>/` artifacts still exist (the
// journey's automated-reflection fixture; 8 real 2026-05-30/31 betterado
// cycles in the live root) — the flows-run-reflect-automated beat regressed
// to NotFound. Not-found is asserted ONLY when the run is unknown AND nothing
// exists on disk for the id; `?run=nope` (no run, no artifact) stays NotFound.
// ---------------------------------------------------------------------------
import { isRunNotFound } from './artifact-mode.ts';

test('isRunNotFound: unknown run + nothing on disk → not found (crosscut-08 keeps its NotFound)', () => {
  expect(isRunNotFound({ runFound: false, runOnDisk: false })).toBe(true);
});

test('isRunNotFound: unknown run but SOMETHING exists on disk for the id → NOT not-found (orphan log dir renders its artifact)', () => {
  expect(isRunNotFound({ runFound: false, runOnDisk: true })).toBe(false);
});

test('isRunNotFound: a known run is never not-found, whatever is on disk', () => {
  expect(isRunNotFound({ runFound: true, runOnDisk: false })).toBe(false);
});

// W7-FIX-A3 (round-2 finding 2): the decision is a PER-RUN existence fact
// (`GET /api/runs/<id>`'s 404 `onDisk` — the guarded existence of
// `_logs/<id>`), never "did THIS artifact type resolve". The old inputs made
// the answer type-dependent: `fetchArtifactDoc('workitems', …)` returns
// `{type:'empty'}` without touching disk whenever `run` is null (it reads
// `run.workItems`), so the SAME orphan log dir rendered its plan and 404'd its
// work-items tab — two contradictory pages for one id, both linked from the
// same ArtifactTrail.
test('the orphan log dir renders EVERY type the same: workitems (always doc-empty for a null run) is not NotFound while plan renders', () => {
  const orphan = { runFound: false, runOnDisk: true };
  // plan resolved a doc, workitems could not — the verdict is identical.
  expect(isRunNotFound(orphan)).toBe(false);
  const decisions = (['plan', 'workitems', 'pr', 'demo', 'verdict', 'reflection'] as const).map(() => isRunNotFound(orphan));
  expect(new Set(decisions).size).toBe(1);
  expect(decisions.every((d) => d === false)).toBe(true);
});

test('?run=nope stays NotFound for every type (an unknown id with nothing on disk is a real negative)', () => {
  expect(isRunNotFound({ runFound: false, runOnDisk: false })).toBe(true);
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 1) — the GATE is keyed on the INITIATIVE id.
// `POST /api/runs/<id>/gates/<gateId>` (both `plan` and `verdict`) validates
// its id against INIT_ID_RE (packages/flows/bridge-studio-runs.ts:162 / :788), so a gate
// posted with a CYCLE id 400s. A3-03 re-keyed the run page's "artifacts →"
// link onto the run's own id (the cycle id once claimed), which put a cycle id
// in `?run=` — and GateBar was still passing that raw URL handle straight to
// `postGate`, so the demo gate's Approve/Send-back reached from that link
// could not be submitted at all. ReviewVerdictForm (the verdict gate's own
// form, same page) already resolves `run?.initiativeId ?? runId`; the gate bar
// must use the SAME handle. Source pin: there is no jsdom/@testing-library in
// this repo and `app/artifact/page.tsx` is a `useSearchParams` client page
// that `renderToStaticMarkup` cannot mount (the documented gap in
// ./flow-run-detail-render.test.ts), so the prop wiring is pinned on the
// page source — the same precedent as ./knowledge-page-tabs.test.ts.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTIFACT_PAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'artifact', 'page.tsx');

/** The `<GateBar …/>` JSX element as written in the page source. */
function gateBarElement(): string {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  const start = src.indexOf('<GateBar');
  expect(start, '<GateBar> must be rendered by the artifact page').toBeGreaterThan(-1);
  const end = src.indexOf('/>', start);
  expect(end, '<GateBar> must be a self-closing element').toBeGreaterThan(start);
  return src.slice(start, end);
}

test('GateBar is keyed on the run\'s initiative id (never the raw ?run= handle, which is a cycle id since A3-03)', () => {
  const el = gateBarElement();
  expect(el).toMatch(/runId=\{gateInitiativeId\}/);
  expect(el, 'the raw URL handle must not reach postGate — it 400s at INIT_ID_RE').not.toMatch(/runId=\{runId\}/);
});

test('ONE id-resolution rule: gateInitiativeId rides lib/initiative-id.ts and every verdict surface receives it', () => {
  // W7-B7 (artifact-plan-18/25) strengthened the A3 invariant this pin used
  // to encode (`run?.initiativeId ?? runId`): the raw fallback still 400s for
  // an orphan cycle-id handle, so the page now resolves through the SHARED
  // `effectiveInitiativeId` — and BOTH verdict surfaces (DemoReviewSurface +
  // ReviewVerdictForm) receive that same resolved handle.
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  expect(src).toMatch(/const gateInitiativeId = effectiveInitiativeId\(run\?\.initiativeId \?\? runId, artifactRunId\);/);
  expect(src, 'no verdict surface may re-derive its own id rule').not.toMatch(/initiativeId=\{run\?\.initiativeId \?\? runId\}/);
  const surfaces = src.match(/initiativeId=\{gateInitiativeId\}/g) ?? [];
  expect(surfaces.length, 'DemoReviewSurface + ReviewVerdictForm both take the one resolved id').toBeGreaterThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// artifact-plan-38 / artifact-plan-35 (W8-A2): `deriveArtifactEmptyReason` —
// the EmptyState copy must never promise a future phase for a run that
// cannot reach one. Kills a fix that keeps the single "will emit it when
// this run reaches that stage" sentence for every status.
// ---------------------------------------------------------------------------
import { deriveArtifactEmptyReason } from './artifact-mode.ts';

test('deriveArtifactEmptyReason: a still-progressing run (planned/active/gated) is "pending" — the future-phase promise is still true', () => {
  expect(deriveArtifactEmptyReason('planned', false)).toBe('pending');
  expect(deriveArtifactEmptyReason('active', false)).toBe('pending');
  expect(deriveArtifactEmptyReason('gated', false)).toBe('pending');
});

test('deriveArtifactEmptyReason: a FAILED run is "terminal-failed" — it will not retry, so the promise is false', () => {
  expect(deriveArtifactEmptyReason('failed', false)).toBe('terminal-failed');
});

test('deriveArtifactEmptyReason: a COMPLETE run that never produced this artifact is "terminal-status" — also never a future promise', () => {
  expect(deriveArtifactEmptyReason('complete', false)).toBe('terminal-status');
});

test('deriveArtifactEmptyReason: isOrphan takes priority over status — an orphan run has no Run object, so status is always null for it', () => {
  expect(deriveArtifactEmptyReason(null, true)).toBe('orphan');
  // Even if a caller somehow passed a status alongside isOrphan, orphan wins
  // (this can't happen in practice — an orphan `run` is null — but the
  // priority is the contract, not an accident of argument shape).
  expect(deriveArtifactEmptyReason('failed', true)).toBe('orphan');
});

test('the page WIRES deriveArtifactEmptyReason into EmptyState — the render call site passes status + isOrphan, not just type', () => {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  expect(src).toMatch(/import \{ resolveArtifactMode, isRunNotFound, deriveArtifactEmptyReason, type ArtifactEmptyReason \} from '@\/lib\/artifact-mode'/);
  expect(src).toMatch(/const reason = deriveArtifactEmptyReason\(status, isOrphan\);/);
  expect(src).toMatch(/<EmptyState type=\{type\} backHref=\{monitorHref\} status=\{run\?\.status \?\? null\} isOrphan=\{runRecordAbsent\} \/>/);
  // Every reason must actually change the copy — a fix that derives `reason`
  // but never branches on it (always the same sentence) would still pass the
  // wiring checks above; this greps the four distinct copy branches exist.
  expect(src).toMatch(/if \(reason === 'orphan'\)/);
  expect(src).toMatch(/if \(reason === 'terminal-failed'\)/);
  expect(src).toMatch(/if \(reason === 'terminal-status'\)/);
  // The 'pending' branch is the old unconditional sentence — still present,
  // but now reached only for 'pending' (the trailing default, no `if`).
  expect(src).toMatch(/the\{' '\}\s*\n\s*<strong>\{phase\}<\/strong> phase will emit it when this run reaches that stage/);
});

// ---------------------------------------------------------------------------
// crosscut-08 (W8-A2) — page-source pins for the fail-closed wiring that
// cannot be render-tested (see the file-header precedent above). Each test
// names the wrong implementation it kills.
// ---------------------------------------------------------------------------

test('fetchArtifactDoc has NO catch-all any more — a transport failure must propagate, never settle into {type:"empty"}', () => {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  const start = src.indexOf('async function fetchArtifactDoc(');
  expect(start, 'fetchArtifactDoc must exist').toBeGreaterThan(-1);
  const end = src.indexOf('\nasync function fetchArtifactFileChecked', start);
  expect(end, 'fetchArtifactFileChecked must follow fetchArtifactDoc').toBeGreaterThan(start);
  const body = src.slice(start, end);
  // Kills: re-wrapping the function body in `try { … } catch { return {
  // type: 'empty' }; }` (the exact shape of the original bug).
  expect(body, 'no swallow-to-empty catch inside fetchArtifactDoc').not.toMatch(/catch\s*\{\s*(\/\/[^\n]*\n\s*)?return \{ ?type: ?'empty' ?\}/);
  expect(body, 'no bare catch at all inside fetchArtifactDoc').not.toMatch(/\}\s*catch\s*\{/);
  // Negative control: a CONFIRMED 404 (`text === null` / `doc === null &&
  // !failed`) must STILL resolve the honest empty state — this proves the
  // fix didn't just delete the empty path along with the swallowing catch.
  expect(body, 'PLAN.html confirmed-404 still resolves empty').toMatch(/if \(text === null\) return \{ type: 'empty' \}; \/\/ confirmed 404/);
  expect(body, 'reflection.json confirmed-404 still resolves empty').toMatch(/return doc \? \{ type: 'reflection', doc \} : \{ type: 'empty' \};/);
  expect(body, 'verdict.json confirmed-404 still resolves empty').toMatch(/return verdictJson \? \{ type: 'verdict', doc: verdictJson \} : \{ type: 'empty' \};/);
});

test('the page renders the shared PageLoadError on a settled load error, checked BEFORE the runNotFound NotFound branch', () => {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  expect(src).toMatch(/import \{ PageLoadError \} from '@\/components\/PageLoadError'/);
  expect(src).toMatch(/import \{ fetchErrorPropsFrom \} from '@\/components\/FetchErrorState'/);
  expect(src).toMatch(/import \{ useBridgeRecoveryWhenFailed \} from '@\/lib\/use-bridge-status'/);
  expect(src).toMatch(/useBridgeRecoveryWhenFailed\(loadError !== null, reload\)/);
  const loadErrorIdx = src.indexOf('if (ready && loadError) {');
  const runNotFoundIdx = src.indexOf('if (ready && runNotFound) {');
  expect(loadErrorIdx, 'the loadError branch must exist').toBeGreaterThan(-1);
  expect(runNotFoundIdx, 'the runNotFound branch must exist').toBeGreaterThan(-1);
  expect(loadErrorIdx, 'loadError is checked before runNotFound').toBeLessThan(runNotFoundIdx);
  expect(src).toMatch(/<PageLoadError[\s\S]{0,80}page="artifact"/);
});

test('every probe fetchArtifactDoc calls throws-on-failure or is a checked helper — no raw fire-and-forget bridgeFetch with a swallowing local catch left for PLAN.html / pr-description.md', () => {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  expect(src).toMatch(/async function fetchArtifactFileChecked\(/);
  // The old inline try/catch around the raw PLAN.html bridgeFetch is gone.
  expect(src).not.toMatch(/const htmlRes = await bridgeFetch\(htmlPath\);/);
  expect(src).toMatch(/fetchArtifactFileChecked\(runId, 'PLAN\.html'\)/);
  expect(src).toMatch(/fetchArtifactFileChecked\(runId, 'pr-description\.md'\)/);
});

test('the reflection Stage-2 data fetch is NOT .catch(() => null) any more — that fabricated "No reflection questions filed" off a transport failure', () => {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  expect(src).not.toMatch(/fetchReflection\(artifactId\)\.catch\(\(\) => null\)/);
  expect(src).toMatch(/refl = await fetchReflection\(artifactId\);/);
});

// artifact-plan-42 (W8-A2): an architect id's `?type=` accepts only `plan`
// (or absent, which defaults to 'plan' upstream) — anything else is the
// shared NotFound, never a silent coercion to the plan.
test('typeInvalid: an architect id treats any type OTHER than "plan" as invalid; a cycle id keeps the ARTIFACT_TYPES check', () => {
  const src = readFileSync(ARTIFACT_PAGE_PATH, 'utf8');
  expect(src).toMatch(/const typeInvalid = isArchitectRunId\(runId\)\s*\n?\s*\?\s*typeRaw !== 'plan'/);
  expect(src, 'the old blanket suppression for architect ids is gone').not.toMatch(/const typeInvalid = !isArchitectRunId\(runId\) && !isValidType\(typeRaw\)/);
});

test('an armed architect plan forced into mode=view renders a "decide on this plan" affordance, never a silent read-only-forever', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'studio', 'artifact', 'ArchitectPlanGate.tsx'),
    'utf8',
  );
  expect(src).toMatch(/mode: 'gate' \| 'view';/);
  expect(src).toMatch(/const showGate = armed && mode !== 'view';/);
  expect(src).toMatch(/data-action="decide-on-plan"/);
  expect(src).toMatch(/architectPlanArtifactHref\(session\.sessionId, 'gate'\)/);
});
