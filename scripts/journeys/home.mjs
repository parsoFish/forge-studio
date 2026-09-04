/**
 * home — R6-07 (wave-5, journey-sync T3): the Home dashboard at `/`.
 *
 * "What needs me at a glance" — the operator's landing surface. Entry-point
 * rule: the clip STARTS at `/` (Home is where the operator lands, not a
 * mid-flow screen). Reads the shipped `apps/studio/app/page.tsx` — Home is a
 * PURE composition of six existing surfaces (fetchStudioAgents/Flows/
 * Projects/Kbs + fetchRuns + fetchProjectAttention) through the pure
 * `lib/home-view.ts` derivation (buildConstellation/buildHomeAttention) —
 * no new endpoint, no bespoke poll loop. This journey proves the composition
 * renders real, non-fabricated state:
 *   - the hex constellation ([data-hex-kind][data-hex-id][data-hex-status])
 *     derives its status from the SAME run-model / attention aggregate every
 *     other journey already proves independently (never a `.status` field
 *     the wire types don't carry — home-view.ts's own declared-data-fails-
 *     open discipline);
 *   - the attention strip fires only on a REAL gated condition and links
 *     through to the owning project;
 *   - every hex/attention-row navigates to its real owning surface.
 *
 * FIXTURE (self-contained, disjoint from every other journey's ids — never
 * J4_PROJECT, never SHOWCASE_*, never CONN_SCRATCH_SLUG, etc., never mdtoc's
 * own canonical queue): two throwaway projects with real `_queue/` manifests, mirroring the
 * shapes flows-onboard.mjs's FOB_* fixture and journey-fixtures.mjs's
 * writePlan/showcaseManifest already use elsewhere in this harness —
 *   - HOME_GATED_PROJECT carries a REAL `_queue/ready-for-review/<id>.md`
 *     manifest (mirrors a real send-back-pending PR awaiting an operator
 *     verdict, the same `ready-for-review` shape flows-run.mjs's own INIT
 *     reaches) so `fetchProjectAttention()` derives `gated>0` for it — a REAL
 *     aggregate read, not a hand-poked count.
 *   - HOME_ACTIVE_PROJECT carries a REAL `_queue/in-flight/<id>.md` manifest
 *     naming the real, always-shipped `forge-develop` flow
 *     (studio/flows/forge-develop/flow.yaml) plus a hand-seeded
 *     `_logs/<cycleId>/events.jsonl` with one open `developer-loop` phase
 *     event (started, never ended — mirrors a real in-flight dev-loop pass,
 *     the same active shape flows-run.mjs's own CYCLE_ID reaches mid-run) —
 *     `orchestrator/run-model.ts`'s FALLBACK_PHASE_TO_NODE maps
 *     `developer-loop` -> the `dev` node, so this ONE seeded run drives
 *     THREE independently-derived 'active' hexes: the `forge-develop` FLOW
 *     hex (deriveFlowStatus), the `developer-ralph` AGENT hex
 *     (deriveAgentStatus — owns the `dev` node), and the
 *     HOME_ACTIVE_PROJECT PROJECT hex (deriveProjectStatus, via
 *     `row.inFlight>0`).
 *   - HOME_LINT_KB (forge-2am) carries a REAL project-brain dir
 *     (`brain/projects/home-fixture-lint-kb/kb.yaml` + `themes/*.md`) that
 *     genuinely trips `packages/knowledge/brain-lint.ts`'s `checkProjectBrainIndexes` — a
 *     project brain with themes but no category index files
 *     (patterns.md/antipatterns.md/decisions.md/reference.md) is unindexed.
 *     Verified directly against the real lint tool before writing this
 *     fixture (`node --experimental-strip-types` against a scratch copy of
 *     `runBrainLint`, not guessed): exactly ONE `flag` finding, zero
 *     `error` findings — `{category:'flag', check:'checkProjectBrainIndexes',
 *     message:'project brain "home-fixture-lint-kb" has 1 theme(s) but no
 *     category index files ...; themes are unindexed'}`. flags>0/errors=0
 *     maps to the honest attention-strip status "warn" (home-view.ts's
 *     buildKbAttention). This is a REAL brain-lint finding driving the KB
 *     attention row — never a hand-poked count.
 *
 *   - HOME_SESSION_SID (W6-B11) is a REAL instructions session, seeded via
 *     the harness's EXISTING `writeInstrStatus`/`cleanInstructionsSession`
 *     helpers (`scripts/lib/journey-fixtures.mjs` — the same ones knowledge/
 *     agents journeys already use), anchored under mdtoc (never a scratch
 *     project of its own) at phase `awaiting-verdict` — a REAL
 *     `deriveSessionAffordances` verdict affordance, so the Home
 *     active-sessions strip's needs-you dot is honestly derived. Disjoint
 *     from sessions-index.mjs's own SESSIONS_INDEX_SID fixture.
 *
 * Both project directories are brand-new, disposable scratch dirs under
 * `projects/` (never mdtoc's) — `discoverProjects()` (orchestrator/studio/
 * registry.ts) only needs the directory to exist to surface a project row;
 * a minimal `.forge/project.json` is added purely so the constellation label
 * reads like a real project, not a bare slug (the "half-onboarded project
 * still surfaces" contract orchestrator/studio/registry.ts documents).
 *
 * Seed/cleanup discipline (mirrors demo-showcase's own cross-beat shape,
 * scripts/journeys/index.mjs's own header comment): `home-landing` seeds
 * the fixture (behind its own crash-safe leading sweep, mirroring hooks-
 * security/connections-readiness-block/flows-onboard-gate's precedent) and
 * home-attention only READS it; `home-clickthrough` — the LAST beat that
 * needs it — sweeps it in its own try/finally. A stray leftover from an
 * interrupted run is swept by the SAME `cleanHomeFixture()` the next
 * `home-landing` run calls first, so no top-level e2e-journey.mjs wiring is
 * needed (unlike the multi-beat arcs that mutate a REAL shipped file and so
 * need a process-level backstop — this fixture only ever touches its own
 * disposable scratch paths).
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { FORGE_ROOT, caption, ACT, READ, writeInstrStatus, cleanInstructionsSession } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// ── HOME fixture identity — local to this journey, disjoint from every other
// journey's seeded ids (J4/J5/SK_*/HK_*/SHOWCASE_*/CONN_SCRATCH_SLUG/etc.) ──
const HOME_DATE = new Date().toISOString().slice(0, 10);

export const HOME_GATED_PROJECT = 'home-fixture-gated-project';
const HOME_GATED_PROJECT_DIR = join(FORGE_ROOT, 'projects', HOME_GATED_PROJECT);
const HOME_GATED_INIT = `INIT-${HOME_DATE}-home-fixture-gated`;
const HOME_GATED_MANIFEST_PATH = join(FORGE_ROOT, '_queue', 'ready-for-review', `${HOME_GATED_INIT}.md`);

export const HOME_ACTIVE_PROJECT = 'home-fixture-active-project';
const HOME_ACTIVE_PROJECT_DIR = join(FORGE_ROOT, 'projects', HOME_ACTIVE_PROJECT);
const HOME_ACTIVE_INIT = `INIT-${HOME_DATE}-home-fixture-active`;
const HOME_ACTIVE_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const HOME_ACTIVE_CYCLE_ID = `${HOME_ACTIVE_STAMP}_${HOME_ACTIVE_INIT}`;
const HOME_ACTIVE_MANIFEST_PATH = join(FORGE_ROOT, '_queue', 'in-flight', `${HOME_ACTIVE_INIT}.md`);
const HOME_ACTIVE_LOG_DIR = join(FORGE_ROOT, '_logs', HOME_ACTIVE_CYCLE_ID);

// forge-2am — a REAL scratch project-brain KB whose lint genuinely flags
// (see this file's header comment for the exact, directly-verified finding).
// `brain/projects/<id>/` (never `_queue`/`_logs`/`projects`) so it is
// discovered the SAME way the real gitpulse/mdtoc/etc. project brains are
// (packages/knowledge/bridge-studio-kbs.ts's loadKbDescriptors walks brain/projects/*/kb.yaml)
// — .gitignore carries its own dedicated entry (never committed).
// W8-B2 (ON-4) — a REAL parked kb-cleanup draft: the on-disk shape
// `mintKbCleanupDraftSession` (packages/knowledge/bridge-studio-kb-drain.ts) writes when the
// drain gates an edit, under the SAME `.kb-<id>` dot-anchor project a
// unique-binding KB's drafts land in. `awaiting-approval` is non-terminal and
// awaits a verdict (studio/session-kinds.yaml), so the bridge derives
// needsYou:true for it — which is the ONLY condition buildKbDraftAttention
// reads. Nothing here pokes an attention count.
const HOME_DRAFT_KB = 'home-fixture-draft-kb';
const HOME_DRAFT_ANCHOR = `.kb-${HOME_DRAFT_KB}`;
const HOME_DRAFT_SID = `${HOME_DATE}T09-00-00-home8b2`;
const HOME_DRAFT_ANCHOR_DIR = join(FORGE_ROOT, 'projects', HOME_DRAFT_ANCHOR);
const HOME_DRAFT_SESSION_DIR = join(HOME_DRAFT_ANCHOR_DIR, '_kb-cleanup', HOME_DRAFT_SID);

export const HOME_LINT_KB = 'home-fixture-lint-kb';
const HOME_LINT_KB_DIR = join(FORGE_ROOT, 'brain', 'projects', HOME_LINT_KB);

// W6-B11 — a REAL, disjoint instructions session (mdtoc-anchored, the same
// project every instructions-touching journey already seeds into — never
// HOME_ACTIVE_PROJECT/HOME_GATED_PROJECT, and never sessions-index.mjs's own
// SESSIONS_INDEX_SID) proving the Home active-sessions strip renders a real
// in-flight session. Seeded at `awaiting-verdict` — a REAL
// deriveSessionAffordances verdict affordance, so the strip's needs-you dot
// is honestly derived, not a hand-poked flag.
export const HOME_SESSION_SID = 'home-fixture-active-session';

/** Crash-safe sweep of ALL of this journey's own fixtures — never a tracked
 *  path (`projects/`, `_queue/`, `_logs/`, `brain/projects/home-fixture-lint-kb/`
 *  entries created here are all gitignored scratch), called both as a
 *  leading stale-state guard (home-landing) and in home-clickthrough's own
 *  finally (the last beat that needs the fixture), mirroring
 *  flows-onboard-gate's own cleanOnboardGateRun() precedent. */
function cleanHomeFixture() {
  try { rmSync(HOME_GATED_PROJECT_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(HOME_GATED_MANIFEST_PATH, { force: true }); } catch { /* best-effort */ }
  try { rmSync(HOME_ACTIVE_PROJECT_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(HOME_ACTIVE_MANIFEST_PATH, { force: true }); } catch { /* best-effort */ }
  try { rmSync(HOME_ACTIVE_LOG_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(HOME_LINT_KB_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(HOME_DRAFT_ANCHOR_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  cleanInstructionsSession(HOME_SESSION_SID); // W6-B11 — the strip's own session fixture
}

/** Minimal `.forge/project.json` — just enough for the constellation label
 *  to read like a real project (name/northStar); no testProcess/quality-gate
 *  declared since this fixture is never dispatched or preflighted. */
function writeHomeProjectConfig(dir, name, northStar) {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({
    $comment: 'journey-seeded scratch project (scripts/journeys/home.mjs) — never dispatched, swept every run.',
    name, northStar,
  }, null, 2));
}

/** The gated project's manifest — a real `ready-for-review` placement so
 *  `fetchProjectAttention()` (apps/forge/bridge-studio.ts's buildProjectAttention)
 *  derives `gated>0` for it from an ACTUAL queue scan, not a poked count.
 *  Carries its own `cycle_id` (no log dir needed — `orchestrator/run-
 *  model.ts`'s `aggregateRunWithMapping` only needs a truthy `manifest.
 *  cycle_id` to skip the `makePlannedRun` no-log fallback; an absent log dir
 *  just yields zero phase events, which is fine — nothing here asserts on
 *  this run's phase map). */
function writeHomeGatedManifest() {
  mkdirSync(join(FORGE_ROOT, '_queue', 'ready-for-review'), { recursive: true });
  writeHomeProjectConfig(HOME_GATED_PROJECT_DIR, 'Fixture: Needs Review',
    'A journey-seeded scratch project proving the Home attention strip fires on a real gated condition.');
  writeFileSync(HOME_GATED_MANIFEST_PATH, [
    '---',
    `initiative_id: ${HOME_GATED_INIT}`,
    `project: ${HOME_GATED_PROJECT}`,
    `project_repo_path: ${HOME_GATED_PROJECT_DIR}`,
    `created_at: '${new Date().toISOString()}'`,
    'iteration_budget: 6',
    'cost_budget_usd: 8',
    'phase: ready-for-review',
    'origin: architect',
    `cycle_id: ${HOME_DATE}T00-00-00-000_${HOME_GATED_INIT}`,
    '---',
    '',
    '# Home fixture — gated review (journey-seeded)',
    '',
    'Mirrors a real send-back-pending PR awaiting an operator verdict — the same ' +
      '`ready-for-review` shape flows-run.mjs\'s own INIT reaches once its dev-loop ' +
      'closes. Never mdtoc\'s own real queue; a throwaway scratch project this ' +
      'journey creates and destroys itself.',
    '',
  ].join('\n'));
}

/** The active project's manifest + a real, hand-seeded event log — an
 *  `in-flight` placement naming the real, always-shipped `forge-develop`
 *  flow with ONE open `developer-loop` phase event (started, never ended).
 *  `orchestrator/run-model.ts`'s FALLBACK_PHASE_TO_NODE maps `developer-loop`
 *  -> the `dev` node (agent `developer-ralph`), so this one seeded run
 *  independently derives 'active' on the forge-develop FLOW hex, the
 *  developer-ralph AGENT hex, and this project's own PROJECT hex. */
function writeHomeActiveManifest() {
  mkdirSync(join(FORGE_ROOT, '_queue', 'in-flight'), { recursive: true });
  writeHomeProjectConfig(HOME_ACTIVE_PROJECT_DIR, 'Fixture: Active Build',
    'A journey-seeded scratch project proving the Home constellation renders a real active flow/agent hex.');
  writeFileSync(HOME_ACTIVE_MANIFEST_PATH, [
    '---',
    `initiative_id: ${HOME_ACTIVE_INIT}`,
    `project: ${HOME_ACTIVE_PROJECT}`,
    `project_repo_path: ${HOME_ACTIVE_PROJECT_DIR}`,
    `created_at: '${new Date().toISOString()}'`,
    'iteration_budget: 10',
    'cost_budget_usd: 6',
    'phase: in-flight',
    'origin: architect',
    `cycle_id: ${HOME_ACTIVE_CYCLE_ID}`,
    'flow_id: forge-develop',
    '---',
    '',
    '# Home fixture — active build (journey-seeded)',
    '',
    'Mirrors a real in-flight developer-loop pass — the same active shape ' +
      'flows-run.mjs\'s own CYCLE_ID reaches mid-run, against the real, always-' +
      'shipped forge-develop flow. Never mdtoc\'s own real queue; a throwaway ' +
      'scratch project this journey creates and destroys itself.',
    '',
  ].join('\n'));
  mkdirSync(HOME_ACTIVE_LOG_DIR, { recursive: true });
  writeFileSync(join(HOME_ACTIVE_LOG_DIR, 'events.jsonl'), JSON.stringify({
    event_id: 'EV_home_1', cycle_id: HOME_ACTIVE_CYCLE_ID, initiative_id: HOME_ACTIVE_INIT,
    started_at: new Date().toISOString(), phase: 'developer-loop', skill: 'developer-ralph',
    event_type: 'start', input_refs: [], output_refs: [],
    message: 'developer-loop.start', metadata: {},
  }) + '\n');
}

/**
 * The lint-flagged KB fixture (forge-2am) — a real `brain/projects/<id>/`
 * dir with a valid-frontmatter theme but NO category index files beside it.
 * Content mirrors exactly what was run through the real `runBrainLint`
 * (packages/knowledge/brain-lint.ts) before this journey was written — see this file's
 * header comment for the observed finding.
 */
function writeHomeLintKbFixture() {
  mkdirSync(join(HOME_LINT_KB_DIR, 'themes'), { recursive: true });
  writeFileSync(join(HOME_LINT_KB_DIR, 'kb.yaml'), [
    `id: ${HOME_LINT_KB}`,
    'name: Home fixture — lint-flagged KB',
    'binding:',
    '  kind: unique',
    'desc: Journey-seeded scratch KB proving the Home attention strip surfaces a real per-KB lint flag.',
    'backend: filesystem',
    '',
  ].join('\n'));
  writeFileSync(join(HOME_LINT_KB_DIR, 'themes', 'sample-theme.md'), [
    '---',
    'title: Sample theme',
    'description: A journey-seeded theme with valid frontmatter but no category index files.',
    'category: pattern',
    'keywords:',
    '  - home-fixture',
    'created_at: 2026-08-14',
    'updated_at: 2026-08-14',
    '---',
    '',
    '# Sample theme',
    '',
    'Journey-seeded scratch content — proves checkProjectBrainIndexes flags an ' +
      'unindexed project brain (no patterns.md/antipatterns.md/decisions.md/ ' +
      'reference.md beside it). Never a real theme; swept every run.',
    '',
  ].join('\n'));
}

/** The parked drain draft (W8-B2/ON-4). Mirrors the real writer's fields —
 *  phase, kb_id, draft_apply, origin — so the sessions index reads a genuine
 *  kb-cleanup row, not a shape invented for this test. */
function writeHomeDraftSession() {
  mkdirSync(join(HOME_DRAFT_SESSION_DIR, 'drafts'), { recursive: true });
  mkdirSync(join(HOME_DRAFT_SESSION_DIR, 'plan'), { recursive: true });
  writeFileSync(join(HOME_DRAFT_SESSION_DIR, 'status.json'), JSON.stringify({
    session_id: HOME_DRAFT_SID,
    project: HOME_DRAFT_ANCHOR,
    phase: 'awaiting-approval',
    kb_id: HOME_DRAFT_KB,
    kb_binding: { kind: 'unique' },
    findings: [{ kind: 'length.soft-cap', check: 'checkLengthSoftCap', file: 'brain/projects/home-fixture-draft-kb/themes/sample-theme.md', message: 'theme over soft cap' }],
    draft_apply: [{ file: 'brain/projects/home-fixture-draft-kb/themes/sample-theme.md', draft: 'drafts/0.md' }],
    origin: 'kb-drain',
    updated_at: new Date().toISOString(),
  }, null, 2));
  writeFileSync(join(HOME_DRAFT_SESSION_DIR, 'drafts', '0.md'), '# Sample theme\n\nJourney-seeded proposed rewrite; never applied, swept every run.\n');
  writeFileSync(join(HOME_DRAFT_SESSION_DIR, 'plan', 'cleanup-plan.md'), [
    '# Drain-gated prose edit (journey-seeded)',
    '',
    '```diff',
    '--- a/brain/projects/home-fixture-draft-kb/themes/sample-theme.md',
    '+++ b/brain/projects/home-fixture-draft-kb/themes/sample-theme.md',
    '-Journey-seeded scratch content.',
    '+Journey-seeded scratch content, condensed.',
    '```',
    '',
  ].join('\n'));
}

function writeHomeFixture() {
  writeHomeGatedManifest();
  writeHomeDraftSession();
  writeHomeActiveManifest();
  writeHomeLintKbFixture();
  // W6-B11 — the active-sessions strip's own fixture (see HOME_SESSION_SID's
  // header comment above).
  writeInstrStatus(HOME_SESSION_SID, { phase: 'awaiting-verdict', round: 2 });
}

/** goto `/` and wait for the real readiness signal — never a fixed sleep. */
async function gotoHomeReady(page, watch) {
  await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('[data-page="home"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
}

export const journey = defineJourney({
  id: 'home',
  title: 'Home — everything running, at a glance',
  story: 'As the operator, I land on Home and see, in one glance, what needs me right now (a real gated review), the live status of every flow/agent/project/KB derived from the real run-model, and the recent-activity ledger behind it — every row a real link to its owning surface.',
  beats: [
    {
      id: 'home-landing',
      title: 'Landing on Home — the live constellation',
      narration: 'The operator\'s FIRST stop, not a mid-flow screen: `/` now serves the Home dashboard directly (R6-07 retired the interim redirect to /library). The hex constellation renders one hex per flow/agent/project/KB, its status DERIVED from the same run-model and attention aggregate every other Studio surface reads — never a fabricated `.status` field. Wave 7 (A1) adds the honesty layer under it: the app shell carries the shared bridge-status banner (`[data-bridge-status]`, hidden while the bridge is up) and Home reports `data-fetch-status="ok"` — a bridge outage now renders an explicit failure state with Retry, never the first-run "Nothing registered yet" screen.',
      drive: async (ctx) => {
        const { page, watch, check, countAtLeast, frame } = ctx;
        console.log('\n[HOME.1] Home dashboard — landing');
        cleanHomeFixture(); // crash-safe leading sweep — a prior interrupted run's leftovers
        writeHomeFixture();

        // Review fix (LOW): everything below writes/reads a REAL session
        // under mdtoc's own `_instructions/` dir (HOME_SESSION_SID) — the
        // SAME shared reference project other journeys (instructions.mjs,
        // knowledge.mjs, etc.) also enumerate sessions under. Unlike this
        // journey's three OTHER fixtures (HOME_GATED_PROJECT/
        // HOME_ACTIVE_PROJECT/HOME_LINT_KB — self-contained scratch dirs
        // this journey alone ever touches, so a leftover from an
        // interrupted run is harmless until the next `home-landing`
        // sweep, per this file's own header), a thrown exception ANYWHERE
        // in this beat (a failed `check`, a `page` timeout, …) would leave
        // HOME_SESSION_SID sitting in the SHARED mdtoc tree until whenever
        // this journey next runs — polluting a project other journeys
        // depend on staying exactly as THEY left it. Wrapping the whole
        // beat body closes that window: on any throw, the shared-mdtoc
        // fixture is swept before the error propagates; the three
        // self-contained scratch fixtures are deliberately left for the
        // existing leading-sweep design (widening their cleanup here too
        // is out of scope for this fix — see the class note above).
        try {
          await gotoHomeReady(page, watch);
          const ready = await page.evaluate(() =>
            document.querySelector('[data-page="home"]')?.getAttribute('data-page-ready') ?? '(absent)');
          check(ready === 'true', `HOME.1: [data-page="home"][data-page-ready="true"] (got "${ready}")`);

          // W7-A1 (home-sessions-13 / crosscut-01): the app-shell bridge
          // banner (components/BridgeStatus.tsx, mounted once in
          // app/layout.tsx) reports the LIVE bridge as up — the same
          // `[data-bridge-status]` every route carries — and Home's own read
          // settled OK (`data-fetch-status="ok"`), i.e. the roster below is a
          // real read, not the "Nothing registered yet" render an outage
          // used to produce. The WS may open a beat after page-ready, so
          // wait for the real transition, never a fixed sleep.
          await page.waitForFunction(
            () => document.querySelector('[data-component="bridge-status"]')?.getAttribute('data-bridge-status') === 'up',
            null, { timeout: 10000 },
          ).catch(() => {});
          const bridge = await page.evaluate(() => {
            const el = document.querySelector('[data-component="bridge-status"]');
            return el
              ? { status: el.getAttribute('data-bridge-status'), everUp: el.getAttribute('data-bridge-ever-up'), hidden: el.hasAttribute('hidden') }
              : null;
          });
          check(bridge !== null, 'HOME.1: [data-component="bridge-status"] is mounted in the app shell (every route carries it)');
          check(bridge?.status === 'up', `HOME.1: [data-bridge-status="up"] — the live bridge is reported up (got "${bridge?.status}")`);
          check(bridge?.everUp === 'true', `HOME.1: data-bridge-ever-up="true" once the bridge has been seen up (got "${bridge?.everUp}")`);
          check(bridge?.hidden === true, 'HOME.1: the bridge banner is HIDDEN while up (no banner text on a healthy bridge)');
          const fetchStatus = await page.evaluate(() =>
            document.querySelector('[data-page="home"]')?.getAttribute('data-fetch-status') ?? '(absent)');
          check(fetchStatus === 'ok', `HOME.1: [data-page="home"][data-fetch-status="ok"] — Home's read settled without a bridge failure (got "${fetchStatus}")`);
          const fetchErrorCount = await page.evaluate(() => document.querySelectorAll('[data-component="fetch-error"]').length);
          check(fetchErrorCount === 0, `HOME.1: no [data-component="fetch-error"] on a healthy bridge (got ${fetchErrorCount})`);

          // W7-A3 (flows-01/23, projects-16 — ADR-031 wave-7 amendment): the
          // scheduler daemon is a Studio object again. The journey harness runs
          // with the daemon STOPPED (its daemon guard refuses a live one), so
          // the card must say so honestly and offer exactly one control: Start.
          try {
            await page.waitForFunction(
              () => document.querySelector('[data-component="scheduler-card"]')?.getAttribute('data-scheduler-ready') === 'true',
              null, { timeout: 10000 },
            );
          } catch { /* asserted below */ }
          const sched = await page.evaluate(() => {
            const el = document.querySelector('[data-component="scheduler-card"]');
            return el ? {
              status: el.getAttribute('data-scheduler-status'),
              ready: el.getAttribute('data-scheduler-ready'),
              actions: [...el.querySelectorAll('[data-action^="scheduler-"]')].map((b) => b.getAttribute('data-action')),
            } : null;
          });
          check(sched !== null, 'HOME.1 (W7-A3): [data-component="scheduler-card"] is mounted on Home');
          check(sched?.ready === 'true', `HOME.1 (W7-A3): the scheduler card read the bridge (data-scheduler-ready, got "${sched?.ready}")`);
          check(sched?.status === 'stopped', `HOME.1 (W7-A3): the daemon is honestly reported stopped under the journey harness (got "${sched?.status}")`);
          check(JSON.stringify(sched?.actions) === JSON.stringify(['scheduler-start']), `HOME.1 (W7-A3): a stopped scheduler offers exactly [Start] (got ${JSON.stringify(sched?.actions)})`);

          // W6-IA-1: the header "Onboard a project" CTA is the operator's ONE
          // onboarding entry point from Home — it must land on the real
          // onboarding form (/projects/new), never the bare /projects index
          // (the retired shim used to redirect there to an arbitrary
          // already-onboarded project). `data-action="onboard-project-cta"`
          // (not "onboard-project") — that id is reserved for
          // ProjectOnboardForm's own submit button on /projects/new, so a
          // page-scoped selector can never match both at once.
          const onboardCta = await page.evaluate(() => {
            const el = document.querySelector('[data-action="onboard-project-cta"]');
            return el ? { href: el.getAttribute('href') } : null;
          });
          check(onboardCta?.href === '/projects/new',
            `HOME.1: the "Onboard a project" CTA targets the real onboarding form, /projects/new (got "${onboardCta?.href}")`);

          await caption(page, 'Home — everything running, at a glance: live flows/agents, the portfolio, and what needs the operator now.');
          await sleep(READ);

          const hexCount = await page.evaluate(() =>
            parseInt(document.querySelector('[data-page="home"]')?.getAttribute('data-hex-count') ?? '0', 10));
          check(hexCount >= 2, `HOME.1: constellation data-hex-count reflects the seeded live objects (got ${hexCount})`);
          await countAtLeast(page, 'section[data-section="constellation"] a.home-hex', 1, 'HOME.1: the constellation renders ≥1 clickable hex');

          // Ruling-49: hex status == the REAL run-model status just seeded — never
          // a fabricated color. Two independently-derived hexes off the ONE
          // active-build run, plus the gated project hex off the attention aggregate.
          const flowHexStatus = await page.evaluate(() =>
            document.querySelector('a.home-hex[data-hex-kind="flow"][data-hex-id="forge-develop"]')?.getAttribute('data-hex-status') ?? null);
          check(flowHexStatus === 'active',
            `HOME.1: the forge-develop flow hex reads the REAL seeded run-model status (data-hex-status="active", got "${flowHexStatus}")`);

          const agentHexStatus = await page.evaluate(() =>
            document.querySelector('a.home-hex[data-hex-kind="agent"][data-hex-id="developer-ralph"]')?.getAttribute('data-hex-status') ?? null);
          check(agentHexStatus === 'active',
            `HOME.1: the developer-ralph agent hex ALSO reads active — same seeded run, independently derived (data-hex-status="active", got "${agentHexStatus}")`);

          const gatedProjectHexStatus = await page.evaluate((pid) =>
            document.querySelector(`a.home-hex[data-hex-kind="project"][data-hex-id="${pid}"]`)?.getAttribute('data-hex-status') ?? null,
          HOME_GATED_PROJECT);
          check(gatedProjectHexStatus === 'gated',
            `HOME.1: the seeded gated project's own hex reads "gated" too, off the same attention aggregate (got "${gatedProjectHexStatus}")`);

          // The activity section (HistoryLedger) — structural presence only; the
          // ledger's own DOM contract is pinned elsewhere (flows-run.mjs).
          await countAtLeast(page, 'section[data-section="activity"] section[data-section="history-ledger"]', 1,
            'HOME.1: the activity section wraps a real HistoryLedger');
          const ledgerCount = await page.evaluate(() =>
            parseInt(document.querySelector('[data-section="history-ledger"]')?.getAttribute('data-ledger-count') ?? '0', 10));
          check(ledgerCount >= 2, `HOME.1: the ledger carries ≥2 rows — both seeded runs (got ${ledgerCount})`);

          // W6-B11 → W7-B1 — the sessions strip is now the NAMED
          // `sessions-needing-you` section (goal-pack contract; visible h2,
          // never unmounted at zero): a real in-flight session
          // (HOME_SESSION_SID, seeded above at `awaiting-verdict`) renders
          // its own card, needs-you flagged via a REAL
          // deriveSessionAffordances verdict affordance — never a
          // fabricated dot.
          const stripCount = await page.locator('section[data-section="sessions-needing-you"]').count();
          check(stripCount === 1, `HOME.1: section[data-section="sessions-needing-you"] renders (got ${stripCount})`);
          const stripAttrs = await page.evaluate(() => {
            const el = document.querySelector('[data-section="sessions-needing-you"]');
            return el ? {
              count: el.getAttribute('data-active-session-count'),
              needsYou: el.getAttribute('data-needs-you-count'),
              shown: el.getAttribute('data-session-cards-shown'),
              heading: el.querySelector('h2')?.textContent ?? '',
            } : null;
          });
          check(parseInt(stripAttrs?.count ?? '0', 10) >= 1, `HOME.1: data-active-session-count >= 1 (got "${stripAttrs?.count}")`);
          check(parseInt(stripAttrs?.needsYou ?? '0', 10) >= 1, `HOME.1: data-needs-you-count >= 1 — the seeded awaiting-verdict session (got "${stripAttrs?.needsYou}")`);
          // W7-B1 (home-sessions-01/32): the strip is NAMED on screen and its
          // card count is an attribute, so header-vs-cards arithmetic is
          // machine-checkable.
          // W8-F4: the heading is "Active sessions", not "Sessions needing
          // you" — the strip lists EVERY live session (needs-you first) and
          // carries the needs-you subset as a separate chip, so the old name
          // claimed a filter the derivation does not apply.
          check((stripAttrs?.heading ?? '').includes('Active sessions'), `HOME.1 (W7-B1/W8-F4): the strip carries its visible h2 name, and it names what it lists (got "${stripAttrs?.heading}")`);
          check(parseInt(stripAttrs?.shown ?? '-1', 10) >= 1, `HOME.1 (W7-B1): data-session-cards-shown reflects the rendered slice (got "${stripAttrs?.shown}")`);
          // W7-A2 made the card a DIV (`[data-session-card][data-session-id]`)
          // wrapping the open link + the cancel control (a button inside an
          // <a> is nested-interactive) — select by the session id attribute,
          // then assert the INNER link's href and that the cancel control
          // renders (W7-FIX-A2 journey-sync).
          const seededCard = await page.evaluate((sid) => {
            const el = document.querySelector(`[data-session-card][data-session-id="${sid}"]`);
            if (!el) return null;
            const link = el.querySelector('a[data-action="open-session"]');
            const cancel = el.querySelector('button[data-action="cancel-session"]');
            return {
              kind: el.getAttribute('data-session-kind'),
              needsYou: el.getAttribute('data-needs-you'),
              href: link ? link.getAttribute('href') : null,
              hasCancel: cancel !== null,
            };
          }, HOME_SESSION_SID);
          check(seededCard?.kind === 'instructions', `HOME.1: the seeded session's own card renders with the real kind (got "${seededCard?.kind}")`);
          check(seededCard?.needsYou === 'true', `HOME.1: the seeded card is flagged needs-you (got "${seededCard?.needsYou}")`);
          check(typeof seededCard?.href === 'string' && seededCard.href.includes(HOME_SESSION_SID), `HOME.1: the card's inner open-session link targets the seeded session (got "${seededCard?.href}")`);
          check(seededCard?.hasCancel === true, `HOME.1 (W7-A2): the card renders the cancel control (button[data-action="cancel-session"], outside the link) for an in-flight session (got ${seededCard?.hasCancel})`);
          const overflowHref = await page.evaluate(() => document.querySelector('[data-action="view-all-sessions"]')?.getAttribute('href') ?? null);
          check(overflowHref === '/sessions', `HOME.1: the strip's overflow link targets the real /sessions index (got "${overflowHref}")`);

          // W7-B1 (home-sessions-25): the ledger cap is PAGING now — the
          // activity section carries shown/total and they reconcile.
          const activityAttrs = await page.evaluate(() => {
            const el = document.querySelector('[data-section="activity"]');
            return el ? { shown: el.getAttribute('data-ledger-shown'), total: el.getAttribute('data-ledger-total') } : null;
          });
          check(activityAttrs !== null && activityAttrs.shown !== null && activityAttrs.total !== null,
            `HOME.1 (W7-B1): the activity section carries data-ledger-shown/-total (got ${JSON.stringify(activityAttrs)})`);
          check(parseInt(activityAttrs?.shown ?? '-1', 10) <= parseInt(activityAttrs?.total ?? '-1', 10),
            `HOME.1 (W7-B1): shown <= total — the paging arithmetic reconciles (${activityAttrs?.shown} of ${activityAttrs?.total})`);

          // W7-B1 (home-sessions-15): exactly ONE live-run CTA renders, and
          // its identity matches its data-live claim — "Watch live run" only
          // when something is genuinely live/gated, "Browse flows" otherwise.
          const liveCta = await page.evaluate(() => {
            const live = document.querySelector('[data-action="watch-live-run"]');
            const browse = document.querySelector('[data-action="browse-flows"]');
            return {
              count: (live ? 1 : 0) + (browse ? 1 : 0),
              liveAttr: live?.getAttribute('data-live') ?? null,
              browseAttr: browse?.getAttribute('data-live') ?? null,
            };
          });
          check(liveCta.count === 1, `HOME.1 (W7-B1): exactly one live-run CTA renders (got ${liveCta.count})`);
          check(liveCta.liveAttr === 'true' || liveCta.browseAttr === 'false',
            `HOME.1 (W7-B1): the CTA's data-live matches its identity (watch-live-run→"true" / browse-flows→"false"; got ${JSON.stringify(liveCta)})`);

          await frame(page, 'home-0-landing', 'Home — the constellation: live flow + agent + project hexes, all derived from the real run-model', { key: true });
        } catch (err) {
          cleanInstructionsSession(HOME_SESSION_SID); // shared-mdtoc fixture — never leak it on a throw
          throw err;
        }
      },
    },
    {
      id: 'home-projects-index',
      title: 'The real projects index — every project, one honest CTA',
      narration: 'Home\'s "Onboard a project" CTA (asserted above) only proves the POINTER — it must also land somewhere real. `/projects` used to be a 23-line shim that redirected to the first registered project and dead-ended into "No projects registered." when empty; it is now a real index. Both of this journey\'s own seeded scratch projects render their own card (never just the first, the retired shim\'s bug), the grid count is verified against the REAL server-side roster (a direct `GET /api/studio/projects`, never a re-derived client guess), and the persistent onboard CTA survives onto the index itself.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[HOME.1b] The real /projects index (W6-IA-1)');

        // Ground truth: the REAL server-side roster, read independently of
        // the page under test — never re-derived from the same DOM the
        // assertions below check against (this journey's own two scratch
        // projects, seeded by home-landing and still live, are included in
        // it by construction — discoverProjects() walks projects/ live).
        const projectsRes = await fetch(`${watch.bridgeUrl}/api/studio/projects`);
        const projectsPayload = await projectsRes.json().catch(() => ({ projects: [] }));
        const realCount = Array.isArray(projectsPayload.projects) ? projectsPayload.projects.length : -1;
        check(realCount >= 2, `HOME.1b: sanity — the real roster includes at least this journey's own 2 seeded projects (got ${realCount})`);

        await page.goto(watch.uiUrl + '/projects', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="projects-index"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 15000 },
        ).catch(() => {});
        await caption(page, 'The real /projects index — every registered project, not just the first one a stale redirect used to pick.');
        await sleep(ACT);

        const pageAttrs = await page.evaluate(() => {
          const m = document.querySelector('[data-page="projects-index"]');
          return m ? { ready: m.getAttribute('data-page-ready'), count: m.getAttribute('data-project-count') } : null;
        });
        check(pageAttrs !== null, 'HOME.1b: [data-page="projects-index"] renders at /projects — the retired shim no longer redirects away from it');
        check(pageAttrs?.ready === 'true', `HOME.1b: [data-page-ready="true"] once the fetch settles (got "${pageAttrs?.ready}")`);
        check(parseInt(pageAttrs?.count ?? '-1', 10) === realCount,
          `HOME.1b: data-project-count matches the REAL server-side roster, not a re-derived client guess (dom=${pageAttrs?.count}, real=${realCount})`);

        const gridCount = await page.evaluate(() =>
          parseInt(document.querySelector('[data-section="projects-grid"]')?.getAttribute('data-count') ?? '-1', 10));
        check(gridCount === realCount,
          `HOME.1b: the grid section's own data-count matches the same real roster (got ${gridCount}, want ${realCount})`);

        // Both of THIS journey's seeded scratch projects render their own
        // card — never just the first one on the roster (the retired shim's
        // redirect bug this index replaces).
        const gatedCardPresent = await page.evaluate((id) =>
          document.querySelector(`[data-section="projects-grid"] [data-card-type="project"][data-card-id="${id}"]`) !== null,
        HOME_GATED_PROJECT);
        const activeCardPresent = await page.evaluate((id) =>
          document.querySelector(`[data-section="projects-grid"] [data-card-type="project"][data-card-id="${id}"]`) !== null,
        HOME_ACTIVE_PROJECT);
        check(gatedCardPresent && activeCardPresent,
          `HOME.1b: BOTH seeded projects render their own card on the index (gated=${gatedCardPresent}, active=${activeCardPresent})`);

        // The persistent header CTA survives onto the index page itself —
        // present regardless of roster size, always the real onboarding form.
        const cta = await page.evaluate(() => {
          const el = document.querySelector('[data-action="onboard-project-cta"]');
          return el ? { href: el.getAttribute('href') } : null;
        });
        check(cta?.href === '/projects/new',
          `HOME.1b: the persistent "Onboard a project" CTA is present on the index and targets /projects/new (got "${cta?.href}")`);

        await frame(page, 'home-0b-projects-index', 'Home — the real /projects index: every registered project its own card, never just the first', { key: true });
      },
    },
    {
      id: 'home-attention',
      title: 'The attention strip — what needs the operator right now',
      narration: 'The attention strip fires ONLY on a real condition — never on mere existence (home-view.ts\'s buildHomeAttention/buildKbAttention/buildKbDraftAttention). THREE independent sources feed it here: the seeded gated project (a real ready-for-review PR), a REAL per-KB lint flag from a genuinely unindexed project brain, and — new in wave 8 (B2, operator note ON-4) — a brain edit the drain has already made and parked for approval. That last one used to appear in no Home row at all: a KB holding an unreviewed, unapplied rewrite of a real theme looked exactly like one that had never been drained, and the only way to find it was an 11px text link buried in a finding row on that KB\'s Health tab. It fires off the bridge\'s own needs-you verdict for the kb-cleanup session and links where the operator can actually decide. Every row is tagged data-attention-kind so gate, KB-lint and parked-draft rows are told apart, and every row links straight through to its own owning surface.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[HOME.2] Home — attention strip');
        await gotoHomeReady(page, watch);
        await caption(page, 'What needs the operator right now — gated reviews AND a real KB lint flag, never a fabricated row.');
        await sleep(ACT);

        const stripCount = await page.locator('section[data-section="attention-strip"]').count();
        check(stripCount === 1, `HOME.2: [data-section="attention-strip"] renders — the seeded gated project fired it (got ${stripCount})`);
        // W7-B1 (home-sessions-01/02): both attention strips are NAMED on
        // screen now, and the KB rows live in their OWN visually distinct
        // section (`kbs-needing-attention`) instead of blending into the
        // project-gate list.
        const gateHeading = await page.evaluate(() =>
          document.querySelector('[data-section="attention-strip"] h2')?.textContent ?? '');
        check(gateHeading.includes('Projects needing attention'), `HOME.2 (W7-B1): the gate strip carries its visible h2 (got "${gateHeading}")`);
        const kbStripCount = await page.locator('section[data-section="kbs-needing-attention"]').count();
        check(kbStripCount === 1, `HOME.2 (W7-B1): [data-section="kbs-needing-attention"] renders — the seeded KB lint flag fired it (got ${kbStripCount})`);
        const kbStrip = await page.evaluate(() => {
          const el = document.querySelector('[data-section="kbs-needing-attention"]');
          return el ? {
            heading: el.querySelector('h2')?.textContent ?? '',
            hasDrainLink: el.querySelector('a[data-action="kb-drain-link"]') !== null,
            drainText: el.querySelector('a[data-action="kb-drain-link"]')?.textContent ?? '',
          } : null;
        });
        check((kbStrip?.heading ?? '').includes('Knowledge bases needing attention'), `HOME.2 (W7-B1): the KB strip carries its visible h2 (got "${kbStrip?.heading}")`);
        check(kbStrip?.hasDrainLink === true, 'HOME.2 (W7-B1): each KB row is an explicit drain link (a[data-action="kb-drain-link"])');
        check((kbStrip?.drainText ?? '').includes('Drain to green'), `HOME.2 (W7-B1): the row SAYS where the click goes (got "${(kbStrip?.drainText ?? '').slice(0, 60)}")`);

        const attentionCountAttr = await page.evaluate(() =>
          document.querySelector('[data-page="home"]')?.getAttribute('data-attention-count') ?? '0');
        // Both the gate row (seeded project) and the KB row (seeded lint
        // flag) must be counted — this rose from >=1 to >=2 once the KB row
        // was added to this beat.
        check(parseInt(attentionCountAttr, 10) >= 3, `HOME.2: data-attention-count ≥3 (gate row + KB row + the W8-B2 parked-draft row; got "${attentionCountAttr}")`);

        // ── W8-B2 (ON-4) — a brain edit parked for review is LOUD on Home.
        // Before this it appeared in no Home row at all, so a KB holding an
        // unreviewed, unapplied rewrite of a real theme looked identical to one
        // that had never been drained. The row fires off the bridge's own
        // needs-you verdict for the seeded kb-cleanup session, and links to the
        // session — the only place the operator can actually approve or reject.
        const draftStrip = await page.evaluate(() => {
          const el = document.querySelector('section[data-section="brain-edits-awaiting-review"]');
          if (!el) return null;
          const row = el.querySelector('a[data-attention-item][data-attention-kind="kb-draft"]');
          return {
            heading: el.querySelector('h2')?.textContent ?? '',
            status: row?.getAttribute('data-attention-status') ?? '',
            session: row?.getAttribute('data-attention-session') ?? '',
            href: row?.getAttribute('href') ?? '',
            // A named hook, not `span:last-child`: querySelector is pre-order,
            // so that selector matched the NESTED `sub` span inside the middle
            // flex span, never the trailing CTA (adversarial round 1). The
            // sibling KB-lint check reads `a[data-action=...]` for the same
            // reason.
            cta: row?.querySelector('[data-component="brain-draft-cta"]')?.textContent ?? '',
            action: row?.getAttribute('data-action') ?? '',
          };
        });
        check(draftStrip !== null, 'HOME.2 (W8-B2/ON-4): [data-section="brain-edits-awaiting-review"] renders — the seeded parked kb-cleanup draft fired it');
        check((draftStrip?.heading ?? '').includes('Brain edits awaiting your review'),
          `HOME.2 (ON-4): the strip carries its visible h2 (got "${draftStrip?.heading}")`);
        check(draftStrip?.status === 'gated', `HOME.2 (ON-4): the row's status is the derived "gated" (got "${draftStrip?.status}")`);
        check(draftStrip?.session === HOME_DRAFT_SID,
          `HOME.2 (ON-4): the row names the REAL seeded session id, not a placeholder (got "${draftStrip?.session}")`);
        check((draftStrip?.href ?? '').startsWith('/sessions/kb-cleanup/'),
          `HOME.2 (ON-4): the row links to the SESSION — the only place the edit can be approved or rejected (got "${draftStrip?.href}")`);
        check((draftStrip?.cta ?? '').includes('Review the diff'),
          `HOME.2 (ON-4): the row SAYS where the click goes (got "${(draftStrip?.cta ?? '').slice(0, 40)}")`);
        check(draftStrip?.action === 'review-brain-draft',
          `HOME.2 (ON-4): the row carries its own data-action, distinct from the lint strip's kb-drain-link (got "${draftStrip?.action}")`);
        await frame(page, 'home-2b-brain-edits-awaiting-review', 'Home — a brain edit parked for review is now its own attention row (ON-4)', { key: true });

        const item = await page.evaluate((projectId) => {
          const el = document.querySelector(`a[data-attention-item][data-attention-project="${projectId}"]`);
          return el ? {
            status: el.getAttribute('data-attention-status'),
            href: el.getAttribute('href'),
            gated: el.getAttribute('data-attention-gated'),
            kind: el.getAttribute('data-attention-kind'),
          } : null;
        }, HOME_GATED_PROJECT);
        check(item !== null, `HOME.2: a[data-attention-item][data-attention-project="${HOME_GATED_PROJECT}"] is present`);
        check(item?.status === 'gated', `HOME.2: the seeded project's attention status is the REAL derived "gated" (got "${item?.status}")`);
        check(item?.href === `/projects/${HOME_GATED_PROJECT}`,
          `HOME.2: the attention item links to its owning project's own surface (got "${item?.href}")`);
        check(item?.kind === 'gate', `HOME.2: the gate row now also carries data-attention-kind="gate" (got "${item?.kind}")`);
        // Home mirrors R4-11-F4's full count vocabulary — the raw gated count
        // is on the row too (the seeded manifest put exactly one in ready-for-review).
        check(parseInt(item?.gated ?? '0', 10) >= 1,
          `HOME.2: the row carries the REAL data-attention-gated count from the same fetchProjectAttention() read (got "${item?.gated}")`);

        // The KB-skew row (forge-2am) — driven by the REAL lint finding this
        // file's header comment names verbatim: exactly one `flag`, zero
        // `error`, from checkProjectBrainIndexes on the seeded, genuinely
        // unindexed brain/projects/home-fixture-lint-kb/ dir.
        const kbItem = await page.evaluate((kbId) => {
          const el = document.querySelector(`a[data-attention-item][data-attention-kind="kb"][data-attention-kb="${kbId}"]`);
          return el ? {
            status: el.getAttribute('data-attention-status'),
            errors: el.getAttribute('data-attention-lint-errors'),
            flags: el.getAttribute('data-attention-lint-flags'),
            checksRun: el.getAttribute('data-attention-checks-run'),
            checksTotal: el.getAttribute('data-attention-checks-total'),
          } : null;
        }, HOME_LINT_KB);
        check(kbItem !== null,
          `HOME.2: a[data-attention-item][data-attention-kind="kb"][data-attention-kb="${HOME_LINT_KB}"] is present — the real lint flag surfaced`);
        check(kbItem?.status === 'warn' || kbItem?.status === 'fail',
          `HOME.2: the KB row's status is the REAL derived warn/fail (got "${kbItem?.status}")`);
        const lintSum = parseInt(kbItem?.errors ?? '0', 10) + parseInt(kbItem?.flags ?? '0', 10);
        check(lintSum >= 1,
          `HOME.2: the KB row's own lint-errors + lint-flags sum to >=1 — a REAL finding, not a fabricated row (errors="${kbItem?.errors}" flags="${kbItem?.flags}")`);

        await frame(page, 'home-1-attention', 'Home — the attention strip: a real gated review AND a real per-KB lint flag, both surfacing without the operator hunting for them', { key: true });
      },
    },
    {
      id: 'home-clickthrough',
      title: 'Every row links to its owning surface',
      narration: 'The payoff: clicking the attention row lands on the gated project\'s own page; clicking the active flow hex lands on its real monitor, the seeded run visible there too. Nothing on Home is a dead end.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[HOME.3] Home — clickthrough to the owning surface');
        try {
          await gotoHomeReady(page, watch);
          await caption(page, 'Every hex and every attention row links straight through to its owning surface.');
          await sleep(ACT);

          // Click the seeded gated attention item — lands on the owning project page.
          await page.locator(`a[data-attention-item][data-attention-project="${HOME_GATED_PROJECT}"]`).click();
          await page.waitForFunction(
            () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).catch(() => {});
          const projectPage = await page.evaluate(() => {
            const m = document.querySelector('[data-page="projects"]');
            return m ? { id: m.getAttribute('data-project-id') } : null;
          });
          check(projectPage?.id === HOME_GATED_PROJECT,
            `HOME.3: the attention row navigated to the owning project page (data-project-id="${projectPage?.id}")`);
          await frame(page, 'home-2-attention-clickthrough', 'Home — clicking the attention row lands on the owning project, gated condition intact', { key: true });

          // Back to Home, click the active flow hex — lands on its real monitor.
          await gotoHomeReady(page, watch);
          await page.locator('a.home-hex[data-hex-kind="flow"][data-hex-id="forge-develop"]').click();
          await page.waitForFunction(
            () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 20000 },
          ).catch(() => {});
          const monitor = await page.evaluate(() => {
            const m = document.querySelector('[data-page="flow-monitor"]');
            return m ? { flowId: m.getAttribute('data-flow-id') } : null;
          });
          check(monitor?.flowId === 'forge-develop',
            `HOME.3: the active flow hex navigated to its own real monitor (data-flow-id="${monitor?.flowId}")`);
          await frame(page, 'home-3-hex-clickthrough', 'Home — clicking the active flow hex lands on its real monitor, the seeded run visible there too', { key: true });
        } finally {
          cleanHomeFixture(); // the last beat that needs the fixture
        }
      },
    },
    {
      id: 'home-crosscut-chrome',
      title: 'The chrome every route shares — titles, landmarks, breadcrumbs, skip link',
      narration:
        'The parts of Studio no single page owns. Before W7-C3 every route in the '
        + 'product rendered the identical browser tab "forge" — twelve pinned tabs were '
        + 'twelve identical labels — no route had a skip link, so a keyboard user walked '
        + 'the brand link plus every nav pillar before reaching content on every page, and '
        + 'detail pages gave no trail back to the index they came from. This beat walks a '
        + 'cross-section of routes and reads the shared chrome off each one: a distinct '
        + 'document title, exactly one h1 inside a real main landmark, a skip link whose '
        + 'fragment resolves to that landmark, a semantic breadcrumb trail on the detail '
        + 'pages, and no horizontal scroll at a 740px viewport.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[HOME.4] Cross-cutting page chrome');

        // A cross-section, not a full crawl (e2e-deadpaths crawls every route):
        // both shared shells plus a detail page of each kind that owns a trail.
        // W7-C3 review (A-H5): these are the values the routes REALLY render
        // — `/flows` is `flows-index` and `/agents` is `agents-index`, not the
        // pillar names. Cross-checked against the app sources by
        // scripts/crosscut-chrome-beat.test.ts, because a wrong value here
        // only ever showed up as a 20s dead wait plus a check failure.
        const ROUTES = [
          { path: '/', page: 'home', crumbs: false },
          { path: '/flows', page: 'flows-index', crumbs: false },
          { path: '/flows/forge-develop', page: 'flow-monitor', crumbs: true },
          { path: '/knowledge', page: 'knowledge', crumbs: true },
          { path: '/agents', page: 'agents-index', crumbs: false },
        ];

        // The readiness wait's outcome is a CHECK, never swallowed: a route
        // that never renders its [data-page] must fail loudly and by name,
        // not silently hand every assertion below a blank page.
        const waitForPage = async (route) => {
          const ready = await page.waitForFunction(
            (p) => document.querySelector(`[data-page="${p}"]`) !== null,
            route.page, { timeout: 20000 },
          ).then(() => true, () => false);
          check(ready, `HOME.4: ${route.path} rendered [data-page="${route.page}"] within 20s`);
          return ready;
        };

        const titles = [];
        for (const route of ROUTES) {
          await page.goto(watch.uiUrl + route.path, { waitUntil: 'domcontentloaded' });
          if (!await waitForPage(route)) continue;

          const chrome = await page.evaluate(() => {
            const main = document.querySelector('main');
            const skip = document.querySelector('[data-component="skip-link"]');
            const frag = (skip?.getAttribute('href') ?? '').replace(/^#/, '');
            const crumbNav = document.querySelector('[data-component="breadcrumbs"]');
            return {
              title: document.title,
              hasMain: !!main,
              mainDataPage: main?.getAttribute('data-page') ?? null,
              h1Count: document.querySelectorAll('h1').length,
              // crosscut-18: the skip link must resolve to the landmark it
              // claims to skip to — an href naming a fragment that is not in
              // the document reads as provided and skips nowhere.
              skipTargetIsMain: !!frag && document.getElementById(frag) === main,
              crumbLabel: crumbNav?.getAttribute('aria-label') ?? null,
              crumbItems: crumbNav ? crumbNav.querySelectorAll('ol > li').length : 0,
              crumbCurrent: crumbNav ? crumbNav.querySelectorAll('[aria-current="page"]').length : 0,
            };
          });

          titles.push({ path: route.path, title: chrome.title });
          check(chrome.hasMain && chrome.mainDataPage === route.page,
            `HOME.4: ${route.path} roots in a <main> landmark carrying its own data-page (got "${chrome.mainDataPage}")`);
          check(chrome.h1Count === 1,
            `HOME.4: ${route.path} renders EXACTLY ONE <h1> (found ${chrome.h1Count})`);
          check(chrome.skipTargetIsMain,
            `HOME.4: ${route.path} skip link's fragment resolves to that same <main> (crosscut-18)`);
          check(/ · forge$/.test(chrome.title) && chrome.title !== 'forge',
            `HOME.4: ${route.path} sets a per-route document title, not the bare product name (got "${chrome.title}")`);
          if (route.crumbs) {
            check(chrome.crumbLabel === 'Breadcrumb' && chrome.crumbItems >= 2,
              `HOME.4: ${route.path} renders the shared semantic breadcrumb trail (aria-label="${chrome.crumbLabel}", ${chrome.crumbItems} items)`);
            check(chrome.crumbCurrent === 1,
              `HOME.4: ${route.path} marks exactly one crumb aria-current="page" — the current page is never a link (found ${chrome.crumbCurrent})`);
          }
        }

        // Distinct, not merely non-empty: the defect was every route sharing
        // ONE title, which a per-route format check alone would not catch.
        const distinct = new Set(titles.map((t) => t.title)).size;
        check(distinct === titles.length,
          `HOME.4: all ${titles.length} routes have DISTINCT tab titles (${distinct} distinct: ${titles.map((t) => t.title).join(' | ')})`);

        // crosscut-25: no horizontal scroll at the narrowest supported width.
        const prevViewport = page.viewportSize();
        await page.setViewportSize({ width: 740, height: 900 });
        for (const route of ROUTES) {
          await page.goto(watch.uiUrl + route.path, { waitUntil: 'domcontentloaded' });
          if (!await waitForPage(route)) continue;
          const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
          check(overflow <= 0,
            `HOME.4: ${route.path} has no horizontal scroll at 740px (overflow ${overflow}px)`);
        }
        if (prevViewport) await page.setViewportSize(prevViewport);

        await page.goto(watch.uiUrl + '/flows/forge-develop', { waitUntil: 'domcontentloaded' });
        await waitForPage({ path: '/flows/forge-develop', page: 'flow-monitor' });
        // Focus the skip link so the frame captures it visible — it is
        // deliberately off-screen until focused.
        await page.keyboard.press('Tab');
        await frame(page, 'home-4-crosscut-chrome',
          'Cross-cutting chrome — a per-route tab title, a breadcrumb trail back to the index, and the skip link revealed on its first tab stop',
          { key: true });
      },
    },
  ],
});
