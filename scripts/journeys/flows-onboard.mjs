/**
 * flows-onboard — R4-18 (wave-5 batch E, journey-sync T3): the onboard-project
 * OOTB flow's own monitor + kickoff surface + REAL contract-check gate.
 *
 * Ports the mockup's `run-flow-onboard` story
 * (mockups/studio-endstate-v2/journeys-data.jsx). Per-mockup-step grounding
 * lives in scripts/journeys/story-registry.mjs's own run-flow-onboard entry
 * (port.beats + its DECISION_R4_18_* constants) — this header only explains
 * what THIS journey demonstrates.
 *
 * Three beats:
 *   - flows-onboard-monitor  — the flow renders as a real card on the library
 *     shelf (peer of forge-develop) and its own monitor shows two real node
 *     hexes (onboard -> contract-check) before any run exists.
 *   - flows-onboard-kickoff  — onboard-project declares no `kickoff:` block,
 *     so it renders the platform's generic Start-Run fallback: a bare
 *     button, no project-target field (there is no 4th FLOW_KICKOFF_KINDS).
 *   - flows-onboard-gate     — THE LOAD-BEARING BEAT. Drives the REAL
 *     orchestrator/flow-runner.ts `runFlow()` over the REAL
 *     studio/flows/onboard-project/flow.yaml against a genuinely
 *     preflight-RED scratch fixture, exactly mirroring
 *     orchestrator/onboard-flow-gate.test.ts's own AT-4 harness: the
 *     `onboard` node's agent spawn is suppressed via the same
 *     FORGE_DRY_BRIDGE seam every other journey beat relies on, but the
 *     `contract-check` gate is NOT stubbed — it calls the real
 *     `runPreflight` and the monitor renders a genuine on-disk event log
 *     that beat produced, never a hand-authored one. Self-contained:
 *     creates and destroys its own scratch fixture + queue manifest +
 *     `_logs/<cycleId>` inside its own try/finally (plus a crash-safe
 *     leading sweep), no dependency on any other journey's seeded project.
 */
import { defineJourney } from '../lib/journey-runtime.mjs';
import { FORGE_ROOT, caption, openStudioMonitor } from '../lib/journey-fixtures.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Direct ESM imports of the real TS modules — Node's default type-stripping
// (no --experimental-strip-types flag needed; `--no-experimental-strip-types`
// is what would disable it) makes this work the same way
// orchestrator/onboard-flow-gate.test.ts's own `node --test` run does. This is
// what makes flows-onboard-gate's proof REAL rather than a hand-fabricated
// event log: the exact production code the live bridge also runs.
import { runFlow, flowPathForId } from '../../orchestrator/flow-runner.ts';
import { loadFlowDefinition } from '../../orchestrator/studio/registry.ts';
import { runPreflight } from '../../cli/preflight.ts';
import { createLogger } from '../../orchestrator/logging.ts';

// ── FOB (flows-onboard) fixture identity — local to this journey, disjoint
// from every other journey's seeded ids (J4/J5/SK_*/HK_*/etc.) ───────────────
const FOB_DATE = new Date().toISOString().slice(0, 10);
const FOB_INIT = `INIT-${FOB_DATE}-onboard-preflight-red`;
const FOB_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const FOB_CYCLE_ID = `${FOB_STAMP}_${FOB_INIT}`;
const FOB_MANIFEST_PATH = join(FORGE_ROOT, '_queue', 'ready-for-review', `${FOB_INIT}.md`);
const FOB_LOG_DIR = join(FORGE_ROOT, '_logs', FOB_CYCLE_ID);

/** Crash-safe sweep of this beat's OWN seeded manifest + event log (never a
 *  tracked path — both `_queue/` and `_logs/` are gitignored) — called both
 *  as a leading stale-state guard and in the beat's own finally, mirroring
 *  hooks-security/connections-readiness-block's create-and-destroy-its-own-
 *  fixture precedent (scripts/journeys/index.mjs's own header comment). */
function cleanOnboardGateRun() {
  try { rmSync(FOB_MANIFEST_PATH, { force: true }); } catch { /* best-effort */ }
  try { rmSync(FOB_LOG_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** Mirrors orchestrator/onboard-flow-gate.test.ts's own `withDryBridge` —
 *  suppresses the `onboard` node's real SDK spawn (execAgent's `runAgent`
 *  call, run-agent.ts's FORGE_DRY_BRIDGE seam) for the duration of `fn`,
 *  restoring the prior env value in a finally so no state leaks to any other
 *  beat/journey sharing this same process. */
async function withDryBridge(fn) {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
}

/**
 * A full FlowRunnerDeps object, every function a tracked no-op — mirrors
 * orchestrator/onboard-flow-gate.test.ts's own `makeInertDeps` byte-for-byte
 * (same rationale: neither node in onboard-project's flow reaches any of
 * these through its OWN executor; `onboard` resolves through execAgent's
 * direct `runAgent` call, suppressed by withDryBridge above, and
 * `contract-check` resolves through `execOnboardPreflight`'s direct
 * `runPreflight` call — no injectable dep at all, the whole point of this
 * initiative). `runClosure` is the one exception `runFlow` itself calls on
 * the RED gate's `terminateEarly` branch, tracked here so the beat can prove
 * the walk actually terminated early rather than falling through.
 */
function makeInertDeps(tracker) {
  return {
    runProjectManager: async () => { tracker.calls.push('runProjectManager'); },
    runDeveloperLoop: async () => { tracker.calls.push('runDeveloperLoop'); },
    runDemoAgent: async () => {
      tracker.calls.push('runDemoAgent');
      return { status: 'complete', demoJsonPath: '' };
    },
    runAdversarialReview: async () => {
      tracker.calls.push('runAdversarialReview');
      return { status: 'complete', findingsPath: '', counts: { total: 0 } };
    },
    computeDeliveryStats: () => {
      tracker.calls.push('computeDeliveryStats');
      return { commitsAhead: 0, filesChanged: 0, insertions: 0 };
    },
    runMergeBoundaryGate: () => {
      tracker.calls.push('runMergeBoundaryGate');
      return { ok: true };
    },
    openPrInline: async () => {
      tracker.calls.push('openPrInline');
      return 'pr-open';
    },
    runClosure: async () => {
      tracker.calls.push('runClosure');
      return { outcome: 'ready-for-review', merged: false };
    },
    runReflector: async () => {
      tracker.calls.push('runReflector');
      return { reflection_status: 'skipped', lint_status: 'skipped' };
    },
    promoteMergedToDone: () => { tracker.calls.push('promoteMergedToDone'); },
    commitDevLoopBoundary: () => { /* no-op */ },
    enforceDevLoopCloseInvariant: () => { /* no-op */ },
    assertNonEmptyDelivery: () => { /* no-op */ },
    enforceFinalCiGate: () => { /* no-op */ },
    rebaseForResume: () => { /* no-op */ },
    enqueueFlowRun: () => { tracker.calls.push('enqueueFlowRun'); },
  };
}

/** Queue-bookkeeping manifest for the seeded run — hand-authored, exactly
 *  like every other seeded run's manifest in this harness (e.g.
 *  flows-author.mjs's flows-author-seeded-run beat writes its own the same
 *  way). What is NOT hand-authored is the event log this manifest's
 *  `cycle_id` points at — that comes from the real `runFlow()` call below. */
function writeOnboardGateManifest(fixtureDir) {
  mkdirSync(join(FORGE_ROOT, '_queue', 'ready-for-review'), { recursive: true });
  writeFileSync(FOB_MANIFEST_PATH, [
    '---',
    `initiative_id: ${FOB_INIT}`,
    'project: journey-onboard-preflight-red',
    `project_repo_path: ${fixtureDir}`,
    `created_at: '${new Date().toISOString()}'`,
    'iteration_budget: 1',
    'cost_budget_usd: 5',
    'phase: ready-for-review',
    'origin: human-directed',
    `cycle_id: ${FOB_CYCLE_ID}`,
    'flow_id: onboard-project',
    '---',
    '',
    '# Onboard-project gate proof (journey-seeded)',
    '',
    'A real runFlow() pass over the real onboard-project flow.yaml against a ' +
      'genuinely preflight-RED scratch fixture — the contract-check gate\'s ' +
      'real `runPreflight` call terminates the walk early, exactly as it ' +
      'would for a freshly cloned repo that has not yet declared a quality ' +
      'gate.',
    '',
  ].join('\n'));
}

export const journey = defineJourney({
  id: 'flows-onboard',
  title: 'Run the onboard-project flow',
  story: 'As an operator, I open the onboard-project OOTB flow — a peer of forge-develop with its own monitor — and see a real run reach its contract-check gate, which runs the actual forge↔project preflight and reports honestly when a project is not yet contract-green.',
  beats: [
    {
      id: 'flows-onboard-monitor',
      title: 'The onboard-project flow: a peer of forge-develop, its own two-node topology',
      narration: 'onboard-project (R4-18) ships as an OOTB flow, not just a standalone agent: it lands on the library — now its own pillar at /library, since Home took the first nav slot (R6-03-F3; the Home dashboard itself lands in R6-07) — beside forge-develop. Every flow card now carries a live data-flow-status (derived through the SAME shared runsForFlow matcher Home and the flow monitor use — forge-n5r) and a data-provenance read straight off the server, never re-derived from flow.origin client-side (forge-3oq); the same server-sourced data-provenance now reaches non-flow cards too (KBs/agents/projects). It opens its own monitor: two real nodes, onboard → contract-check, visible before a single run exists.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[FOB.1] The onboard-project flow monitor renders');
        await page.goto(watch.uiUrl + '/library', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 15000 },
        ).catch(() => {});
        await caption(page, 'onboard-project — a real OOTB flow, a peer of forge-develop on the library shelf.');
        const onboardCard = page.locator('[data-card-type="flow"][data-card-id="onboard-project"]');
        await onboardCard.waitFor({ timeout: 8000 }).catch(() => {});
        check(await onboardCard.count() === 1,
          'FOB.1: onboard-project renders as a real flow card on the library shelf ([data-card-type="flow"][data-card-id="onboard-project"])');
        const develCount = await page.locator('[data-card-type="flow"][data-card-id="forge-develop"]').count();
        check(develCount === 1,
          'FOB.1: the OOTB forge-develop card is present in the SAME flows section — onboard-project is a peer, not a separate surface');

        // R6-03-F3: the six-pillar nav (Home added, Library moved off /) + OOTB provenance badges.
        const navCount = await page.locator('[data-component="studio-nav"] [data-nav]').count();
        check(navCount === 6, `FOB.nav: the six-pillar nav renders (Home/Flows/Agents/Projects/Library/Knowledge) — got ${navCount}`);
        check(await page.locator('[data-component="studio-nav"] [data-nav="home"][href="/"]').count() > 0, 'FOB.nav: Home pillar points at /');
        check(await page.locator('[data-component="studio-nav"] [data-nav="library"][href="/library"]').count() > 0, 'FOB.nav: Library pillar moved onto /library');
        // The OOTB seed flow forge-develop carries a real provenance badge derived from flow.origin.
        check(await page.locator('[data-card-type="flow"][data-card-id="forge-develop"][data-provenance="ootb"]').count() > 0, 'FOB.prov: the OOTB seed flow forge-develop card is marked data-provenance="ootb"');
        check(await page.locator('[data-card-type="flow"][data-card-id="forge-develop"] .badge-ootb').count() > 0, 'FOB.prov: forge-develop renders the visible ootb badge');

        // forge-n5r: FlowCard's status is now derived through the SAME
        // shared runsForFlow() matcher Home/the flow monitor use (never a
        // card-local re-filter that drops flowLineage) — every flow card on
        // the shelf carries a real data-flow-status, one of active/gated/idle.
        const flowStatuses = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-card-type="flow"][data-flow-status]'))
            .map((el) => ({ id: el.getAttribute('data-card-id'), status: el.getAttribute('data-flow-status') })));
        check(flowStatuses.length >= 2,
          `FOB.status: every flow card on the library shelf carries data-flow-status (got ${JSON.stringify(flowStatuses)})`);
        const VALID_FLOW_STATUS = new Set(['active', 'gated', 'idle']);
        check(flowStatuses.every((f) => VALID_FLOW_STATUS.has(f.status)),
          `FOB.status: every data-flow-status value is one of active/gated/idle (got ${JSON.stringify(flowStatuses)})`);

        // forge-3oq: data-provenance reaches every flow card (already pinned
        // above for forge-develop's specific "ootb" value) — this widens the
        // check to the WHOLE flow shelf, plus a NON-flow card (a top-level
        // OOTB KB, always present regardless of what's been onboarded in
        // this run), proving the server-sourced field reaches every card
        // type, not just Flow (which alone had a client-inferable signal
        // before this fix).
        const flowProvenanceCount = await page.locator('[data-card-type="flow"][data-provenance]').count();
        check(flowProvenanceCount === flowStatuses.length,
          `FOB.prov: every flow card carrying data-flow-status ALSO carries data-provenance (${flowProvenanceCount} of ${flowStatuses.length})`);

        const VALID_PROVENANCE = new Set(['ootb', 'operator', 'unknown']);
        const kbProvenance = await page.evaluate(() =>
          document.querySelector('[data-card-type="kb"][data-card-id="forge-dev"]')?.getAttribute('data-provenance') ?? null);
        check(kbProvenance !== null && VALID_PROVENANCE.has(kbProvenance),
          `FOB.prov: the forge-dev KB card (a non-flow card type) carries a real server-sourced data-provenance value (got "${kbProvenance}")`);

        await frame(page, 'fob-0-library-card', 'FOB — onboard-project on the library shelf, beside forge-develop, every card carrying a live status and a server-sourced provenance');

        await page.goto(watch.uiUrl + '/flows/onboard-project', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 },
        ).catch(() => {});
        const monitor = await page.evaluate(() => {
          const m = document.querySelector('[data-page="flow-monitor"]');
          return m ? {
            flowId: m.getAttribute('data-flow-id'),
            canStart: m.getAttribute('data-can-start'),
            runCount: m.getAttribute('data-run-count'),
          } : null;
        });
        check(monitor !== null && monitor.flowId === 'onboard-project',
          `FOB.1: /flows/onboard-project renders with data-flow-id="onboard-project" (got ${JSON.stringify(monitor)})`);
        check(monitor !== null && monitor.canStart === 'true',
          'FOB.1: data-can-start reflects a real, loadable flow');
        check(monitor !== null && monitor.runCount === '0',
          `FOB.1: no runs exist yet for onboard-project (data-run-count="0", got "${monitor?.runCount}")`);

        for (const nodeId of ['onboard', 'contract-check']) {
          await page.waitForSelector(`[data-mon-node][data-node-id="${nodeId}"]`, { timeout: 10000 }).catch(() => {});
          const present = await page.evaluate(
            (n) => document.querySelector(`[data-mon-node][data-node-id="${n}"]`) !== null, nodeId);
          check(present, `FOB.1: the monitor renders the "${nodeId}" node hex, before any run exists`);
        }
        await frame(page, 'fob-1-monitor-empty', 'FOB — onboard-project monitor: two real nodes (onboard → contract-check), no runs yet');
      },
    },
    {
      id: 'flows-onboard-kickoff',
      title: 'The generic Start-Run affordance — no project-target picker exists',
      narration: 'onboard-project declares no kickoff: block, so it renders the platform\'s generic Start-Run fallback — the same one every authored flow with no declared kickoff.kind gets. There is no project-target field: onboarding a real project still launches from the project page (R4-17), not from here.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[FOB.2] The generic Start-Run affordance');
        await page.goto(watch.uiUrl + '/flows/onboard-project', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 },
        ).catch(() => {});
        await page.waitForSelector('[data-section="flow-kickoff"]', { timeout: 10000 }).catch(() => {});
        await caption(page, 'No kickoff: block declared — the generic Start-Run fallback, and nothing else.');
        const kickoff = await page.evaluate(() => {
          const el = document.querySelector('[data-section="flow-kickoff"]');
          if (!el) return null;
          return {
            kind: el.getAttribute('data-kickoff-kind'),
            hasStart: el.querySelector('[data-action="start-run"]') !== null,
            hasProjectSelect: el.querySelector('select') !== null,
          };
        });
        check(kickoff !== null && kickoff.kind === 'generic',
          `FOB.2: onboard-project's kickoff bar is the generic fallback (data-kickoff-kind="generic", got ${JSON.stringify(kickoff)}) — FLOW_KICKOFF_KINDS declares only idea/initiative-select/trigger-only`);
        check(kickoff !== null && kickoff.hasStart,
          'FOB.2: the generic kickoff renders [data-action="start-run"]');
        check(kickoff !== null && !kickoff.hasProjectSelect,
          'FOB.2: no project-target <select> exists on the generic kickoff — onboarding a real project launches from the project page instead (R4-17)');
        await frame(page, 'fob-2-generic-kickoff', 'FOB — the generic Start-Run affordance: no project picker, no live dispatch driven here');
      },
    },
    {
      id: 'flows-onboard-gate',
      title: 'A real onboarding run reaches the gate — the REAL preflight runs, and fails honestly',
      narration: 'A genuine runFlow() pass over the real onboard-project flow.yaml, against a scratch fixture with no declared quality gate, no git remote/.gitignore and no roadmap/brain profile — the same 3-hard-clause RED shape orchestrator/onboard-flow-gate.test.ts\'s own AT-4 proves. The onboard node\'s agent spawn is suppressed (the same dry-bridge seam every other journey beat relies on); the contract-check gate is NOT stubbed — it calls the real runPreflight, and the monitor renders exactly what that call reported, off a real on-disk event log.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[FOB.3] A real onboarding run reaches the gate');
        cleanOnboardGateRun(); // crash-safe leading sweep of a prior interrupted run

        const fixtureDir = mkdtempSync(join(tmpdir(), 'journey-onboard-gate-red-'));
        const tracker = { calls: [] };
        try {
          // Boilerplate rule 4: assert the fixture precondition BEFORE reading
          // any verdict — an entirely empty temp dir trips the 3
          // unconditionally-hard preflight clauses (C1 no declared quality
          // gate; C2 not a git repo / no .gitignore; C4 no roadmap.md and no
          // brain sub-wiki profile), exactly as AT-4's own fixture does.
          const preflightCheck = runPreflight(fixtureDir, { forgeRoot: FORGE_ROOT });
          check(preflightCheck.ok === false,
            `FOB.3 (fixture precondition): the scratch fixture genuinely fails preflight (ok=${preflightCheck.ok})`);
          const failingHardIds = preflightCheck.clauses.filter((c) => c.hard && !c.pass).map((c) => c.clause);
          check(failingHardIds.length > 0,
            `FOB.3 (fixture precondition): at least one HARD clause fails (got ${JSON.stringify(preflightCheck.clauses)})`);

          if (preflightCheck.ok === false) {
            writeOnboardGateManifest(fixtureDir);

            const flow = loadFlowDefinition(flowPathForId('onboard-project'));
            const logger = createLogger(FOB_CYCLE_ID, join(FORGE_ROOT, '_logs'));
            const input = {
              initiativeId: FOB_INIT,
              manifestPath: FOB_MANIFEST_PATH,
              projectRepoPath: fixtureDir,
              worktreePath: fixtureDir,
              dryRun: true,
            };
            const deps = makeInertDeps(tracker);

            const result = await withDryBridge(() => runFlow({ flow, input, logger, deps }));

            // The real gate terminated the walk early and routed to
            // ready-for-review — the same real behaviour
            // skills/contract-check/SKILL.md documents for a red report.
            check(result?.cycleOutcome === 'ready-for-review',
              `FOB.3: the real runFlow() terminated early via the RED gate (cycleOutcome="${result?.cycleOutcome}")`);
            check(tracker.calls.includes('runClosure'),
              `FOB.3: the terminateEarly branch routed the manifest via runClosure (real flow-runner behaviour) — calls: ${JSON.stringify(tracker.calls)}`);
            const eventsPath = join(FOB_LOG_DIR, 'events.jsonl');
            check(existsSync(eventsPath),
              `FOB.3: a REAL event log landed on disk at _logs/${FOB_CYCLE_ID}/events.jsonl — never hand-authored`);

            await openStudioMonitor(page, watch, 'onboard-project', FOB_CYCLE_ID);
            await page.waitForFunction(
              () => parseInt(document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-run-count') ?? '0', 10) >= 1,
              null, { timeout: 15000 },
            ).catch(() => {});
            await caption(page, 'A real preflight-RED onboarding run — the contract-check gate genuinely fails.');

            const runCount = await page.evaluate(
              () => parseInt(document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-run-count') ?? '0', 10));
            check(runCount === 1,
              `FOB.3: the monitor discovers exactly the one real seeded run (data-run-count="${runCount}")`);
            const activeRun = await page.evaluate(
              () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-run') ?? '');
            check(activeRun === FOB_CYCLE_ID,
              `FOB.3: the seeded run is selected as active (data-active-run="${activeRun}")`);

            await page.waitForSelector('[data-mon-node][data-node-id="contract-check"]', { timeout: 10000 }).catch(() => {});
            const contractCheckStatus = await page.evaluate(
              () => document.querySelector('[data-mon-node][data-node-id="contract-check"]')?.getAttribute('data-status') ?? null);
            check(contractCheckStatus === 'failed',
              `FOB.3: the contract-check node hex reflects the REAL gate's failed status (data-status="${contractCheckStatus}")`);

            const onboardStatus = await page.evaluate(
              () => document.querySelector('[data-mon-node][data-node-id="onboard"]')?.getAttribute('data-status') ?? null);
            check(onboardStatus === 'active',
              `FOB.3: the onboard node hex renders too — its agent spawn is suppressed (never an 'end' event), so it honestly reads "active" rather than a fabricated "complete" (got "${onboardStatus}")`);

            await frame(page, 'fob-3-gate-failed', 'FOB — a real preflight-RED onboarding run: the contract-check gate genuinely fails, rendered on the monitor', { key: true });
          }
        } finally {
          cleanOnboardGateRun();
          try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      },
    },
  ],
});
