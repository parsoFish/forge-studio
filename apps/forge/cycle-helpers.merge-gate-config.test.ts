/**
 * Tests for the merge-boundary gate's project-config failure path (M0-A task 2).
 *
 * One file, two tests:
 *   1. cycle-helpers.ts: `runMergeBoundaryGate` must return a RED `config`
 *      result on an unreadable `project.json`, never `{ ok: true }`.
 *   2. flow-runner.ts: `execDemo` must park the initiative needs-operator on
 *      a `config` red — never compile a gate-fix work item (a dev agent
 *      cannot fix the operator's project config), never open a PR.
 *
 * Test 2's harness (makeInput/makeLogger/makeCallTracker/makeMockDeps, the
 * real `forge-develop.yaml` load via `flowPathForId`/`loadFlowDefinition`,
 * and the tmp-worktree+manifest fixture) copies the STYLE of
 * `orchestrator/flow-runner.test.ts`'s "R4-10-F2: a RED merge-boundary
 * full-suite gate" test (the local/ci sibling of this scenario) — not its
 * assertions, which belong to a different `failedGate` value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMergeBoundaryGate } from '@forge/flows/cycle-helpers.ts';
import { flowPathForId } from '@forge/flows/flow-runner.ts';
import { runFlowT, type TestDeps, type FlowRunnerDeps } from './test-fixtures/flow-runner-port.ts';
import { loadFlowDefinition } from '@forge/flows/studio/flow-registry.ts';
import { readWorkItemsFromDir } from '@forge/flows/work-item.ts';
import type { CycleInput } from '@forge/flows/cycle-context.ts';
import type { EventLogger } from '@forge/kernel';

// ---------------------------------------------------------------------------
// Test 1 — verbatim from the lane plan (docs: `_1.0/plans/M0-A.md`, Task 2,
// Step 1).
// ---------------------------------------------------------------------------

/**
 * Kills: the `catch → return { ok: true }` at cycle-helpers.ts:570-585, which
 * turns "I could not read the project config" into "the full suite passed" and
 * lets a PR open on a branch that was never gated. The comment claims "the
 * branch's own CI still backstops the merge" — gitpulse has no CI mirror
 * (`forge preflight gitpulse` → C1b WARN, no testProcess.ci), so nothing does.
 */
const FLAT_KEY_CONFIG = JSON.stringify({ quality_gate_cmd: ['npm', 'test'], acceptance_gate: 'acceptance' }, null, 2);

function seedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'merge-gate-config-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), FLAT_KEY_CONFIG);
  return dir;
}

test('a flat-key project.json makes the merge gate RED with failedGate "config" — never ok:true', () => {
  const repo = seedProject();
  const emitted: any[] = [];
  const logger: any = { cycleId: 'c', emit(p: any) { emitted.push(p); return { ...p, event_id: 'e1' }; } };
  const result = runMergeBoundaryGate(
    { initiativeId: 'INIT-x', projectRepoPath: repo, worktreePath: repo, dryRun: false } as any,
    logger,
  );
  assert.equal(result.ok, false, 'a config the gate cannot read must never report a green gate');
  assert.equal((result as any).failedGate, 'config');
  assert.match((result as any).reason, /testProcess/, 'the reason must name what the operator has to fix');
  const ev = emitted.find((e) => e.event_type === 'error');
  assert.ok(ev, 'the config failure is an error event, not a `log` skip notice');
  assert.ok(!emitted.some((e) => e.message === 'cycle.merge-gate-skipped'), 'the log-and-skip path is retired');
});

// ---------------------------------------------------------------------------
// M0-A fix round 1 (T3 brief) — the contract test 1 above does NOT pin:
// `{ ok: true }` is reachable only when a gate actually ran and passed.
// Test 1 kills a project.json that THROWS on load. `loadProjectConfig` does
// NOT throw when the file is absent, unreadable, or symlink-rejected — it
// returns `null` (see project-config.ts's own doc comment: "the only
// non-throwing outcome on parse failure is 'file does not exist'"). With
// `cfg === null`, `localCmd` and `ciGate` in `runMergeBoundaryGate` both
// resolve to `null`, neither gate block runs, and the function falls through
// to `return { ok: true }` with ZERO events emitted — reproduced verbatim
// against the real function on a temp dir with no `.forge/project.json`
// (`RESULT: {"ok":true}`, `EVENTS: 0 []`). A third trigger reaches the same
// fallthrough even when `loadProjectConfig` returns a config cleanly: a
// declared-but-empty `testProcess.local.cmd` passes `validateProjectConfig`
// (an empty array is not `undefined`/`null`, so the loader's own
// `if (!localCmd) throw` never fires — `![]` is `false` in JS), then
// `runMergeBoundaryGate`'s `cfg.quality_gate_cmd.length > 0` check drives
// `localCmd` to `null` all the same. Case 3 is the positive control: a valid
// config whose local gate genuinely runs and passes must still return
// `{ ok: true }`, so an implementation that special-cases `cfg === null` (or
// returns config-red unconditionally) cannot pass all three at once.
// ---------------------------------------------------------------------------

/** Case 1 fixture: an empty project root — no `.forge/` directory at all. */
function seedAbsentProject(): string {
  return mkdtempSync(join(tmpdir(), 'merge-gate-config-absent-'));
}

test('Case 1 — no .forge/project.json at all makes the merge gate RED with failedGate "config" — never ok:true, never zero events', () => {
  const repo = seedAbsentProject();
  const emitted: any[] = [];
  const logger: any = { cycleId: 'c', emit(p: any) { emitted.push(p); return { ...p, event_id: 'e1' }; } };
  const result = runMergeBoundaryGate(
    { initiativeId: 'INIT-x', projectRepoPath: repo, worktreePath: repo, dryRun: false } as any,
    logger,
  );
  assert.equal(result.ok, false, 'an absent project config must never report a green gate — nothing ran');
  assert.equal((result as any).failedGate, 'config');
  assert.match(
    (result as any).reason,
    /not found|absent|missing|could not be read|does not exist/i,
    'the reason must say the config could not be read — distinct from "declares no gate" (case 2)',
  );
  assert.notEqual(emitted.length, 0, 'the silent-green zero-events shape is exactly what this case kills');
  const ev = emitted.find((e) => e.event_type === 'error');
  assert.ok(ev, 'an absent config is an error event, not silence');
});

/**
 * Case 2 fixture: valid JSON, loads WITHOUT throwing (`testProcess.local.cmd`
 * is a present-but-empty array — `optionalArgv` accepts it and
 * `parseTestProcess`'s `if (!localCmd) throw` does not fire on `[]`), yet
 * declares no actual local gate command to run.
 */
const EMPTY_LOCAL_CMD_CONFIG = JSON.stringify({ testProcess: { local: { cmd: [] } } }, null, 2);

function seedEmptyLocalCmdProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'merge-gate-config-empty-cmd-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), EMPTY_LOCAL_CMD_CONFIG);
  return dir;
}

test('Case 2 — a project.json that loads cleanly but declares no local gate command makes the merge gate RED with failedGate "config" — never ok:true', () => {
  const repo = seedEmptyLocalCmdProject();
  const emitted: any[] = [];
  const logger: any = { cycleId: 'c', emit(p: any) { emitted.push(p); return { ...p, event_id: 'e1' }; } };
  const result = runMergeBoundaryGate(
    { initiativeId: 'INIT-x', projectRepoPath: repo, worktreePath: repo, dryRun: false } as any,
    logger,
  );
  assert.equal(result.ok, false, 'a config declaring no local gate command must never report a green gate — nothing ran');
  assert.equal((result as any).failedGate, 'config');
  assert.match(
    (result as any).reason,
    /no local gate|local\.cmd|testProcess\.local\.cmd|empty/i,
    'the reason must say the config declares no gate — distinct from "could not be read" (case 1)',
  );
  assert.notEqual(emitted.length, 0, 'the silent-green zero-events shape is exactly what this case kills');
  const ev = emitted.find((e) => e.event_type === 'error');
  assert.ok(ev, 'a config with no declared gate is an error event, not silence');
});

/**
 * Case 3 fixture: a valid config whose local gate is a trivially-true
 * command, so `runLocalSuiteGate` actually executes and passes — no project
 * suite is invoked.
 */
const TRIVIAL_TRUE_CONFIG = JSON.stringify({ testProcess: { local: { cmd: ['true'] } } }, null, 2);

function seedTrivialGreenProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'merge-gate-config-green-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), TRIVIAL_TRUE_CONFIG);
  return dir;
}

test('Case 3 (positive control) — a green local gate that actually ran still returns ok:true, and the run is visible in the event log', () => {
  const repo = seedTrivialGreenProject();
  const emitted: any[] = [];
  const logger: any = { cycleId: 'c', emit(p: any) { emitted.push(p); return { ...p, event_id: 'e1' }; } };
  const result = runMergeBoundaryGate(
    { initiativeId: 'INIT-x', projectRepoPath: repo, worktreePath: repo, dryRun: false } as any,
    logger,
  );
  assert.equal(result.ok, true, 'a config whose declared local gate genuinely passes must report green');
  // Without this control, an implementation that returns config-red
  // unconditionally (over-correcting cases 1/2) would also pass them —
  // proving `ok: true` stays reachable requires proving a gate actually ran.
  const gateEvent = emitted.find(
    (e) => e.message === 'cycle.merge-gate' && e.metadata?.gate === 'local',
  );
  assert.ok(gateEvent, 'the local gate must actually have run (and been logged) for ok:true to be earned');
  assert.equal(gateEvent.metadata.ok, true, 'the logged local-gate run must itself be green');
});

// ---------------------------------------------------------------------------
// Test 2 — flow-runner harness. Helpers below mirror flow-runner.test.ts's
// makeInput/makeLogger/makeCallTracker/makeMockDeps (style only).
// ---------------------------------------------------------------------------

/** Minimal CycleInput for the runner (no real paths needed unless overridden). */
function makeInput(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    initiativeId: 'test-initiative',
    manifestPath: '/tmp/test/manifest.md',
    projectRepoPath: '/tmp/test/project',
    worktreePath: '/tmp/test/worktree',
    dryRun: true,
    ...overrides,
  };
}

/** Minimal no-op EventLogger spy that records emitted events. */
function makeLogger(): EventLogger & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    logFilePath: '/tmp/test/events.jsonl',
    cycleId: 'test-cycle-id',
    emit(event: unknown) {
      events.push(event);
      return { ...(event as Record<string, unknown>), event_id: `evt-${events.length}` } as ReturnType<EventLogger['emit']>;
    },
  };
}

/** Call order tracker — push name on each spy call. */
function makeCallTracker() {
  const calls: string[] = [];
  return { calls };
}

/** Complete FlowRunnerDeps set where every fn is a call-tracking spy. */
function makeMockDeps(tracker: { calls: string[] }): TestDeps {
  return {
    runProjectManager: async (_input, _logger) => {
      tracker.calls.push('runProjectManager');
    },
    runDeveloperLoop: async (_input, _logger) => {
      tracker.calls.push('runDeveloperLoop');
    },
    runDemoAgent: async (_input, _logger) => {
      tracker.calls.push('runDemoAgent');
      return { status: 'complete', demoJsonPath: 'demo/test-initiative/demo.json' };
    },
    runAdversarialReview: async (_input, _logger) => {
      tracker.calls.push('runAdversarialReview');
      return { status: 'complete', findingsPath: '_logs/test-cycle-id/artifacts/review-findings.json', counts: { total: 0 } };
    },
    computeDeliveryStats: (_input, _logger) => {
      tracker.calls.push('computeDeliveryStats');
      return { commitsAhead: 1, filesChanged: 1, insertions: 10 };
    },
    runMergeBoundaryGate: (_input, _logger) => {
      tracker.calls.push('runMergeBoundaryGate');
      return { ok: true };
    },
    openPrInline: async (_input, _logger) => {
      tracker.calls.push('openPrInline');
      return 'pr-open';
    },
    runClosure: async (_input, _logger, _reviewerOutcome) => {
      tracker.calls.push('runClosure');
      return { outcome: 'merged', merged: true };
    },
    runReflector: async (_input, _logger) => {
      tracker.calls.push('runReflector');
      return { reflection_status: 'complete', lint_status: 'ok' };
    },
    promoteMergedToDone: (_input, _logger) => {
      tracker.calls.push('promoteMergedToDone');
    },
    commitDevLoopBoundary: (_wt, _logger, _id) => { /* no-op */ },
    enforceDevLoopCloseInvariant: (_wt, _logger, _id) => { /* no-op */ },
    assertNonEmptyDelivery: (_outcome, _id, _wt, _logger) => { /* no-op */ },
    enforceFinalCiGate: (_input, _logger) => { /* no-op */ },
    rebaseForResume: (_input, _logger) => { tracker.calls.push('rebaseForResume'); },
    enqueueFlowRun: (_flowId, _opts) => { /* no-op */ },
  };
}

test('a config-red gate parks needs-operator and compiles NO gate-fix work item', async () => {
  /**
   * Kills: execDemo treating a `config` red exactly like a `local`/`ci` red —
   * compiling a gate-fix WORK ITEM the develop agent can never actually turn
   * green (the operator's own `.forge/project.json` is not part of the
   * initiative's diff), and leaving no marker a human can find, instead of
   * parking the initiative needs-operator. Drives the REAL `forge-develop`
   * flow (dev → demo → adversarial-review → verdict) with
   * `deps.runMergeBoundaryGate` stubbed to the config-red shape — exactly as
   * flow-runner.test.ts's "R4-10-F2: a RED merge-boundary full-suite gate"
   * test drives the local/ci sibling scenario.
   */
  const flow = loadFlowDefinition(flowPathForId('forge-develop'));

  const root = mkdtempSync(join(tmpdir(), 'flow-mergegate-config-'));
  const wt = join(root, 'wt');
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  const manifestPath = join(root, 'manifest.md');
  writeFileSync(
    manifestPath,
    [
      '---',
      'initiative_id: INIT-2026-08-28-mergegate-config',
      'project: demo',
      `project_repo_path: ${wt}`,
      "created_at: '2026-08-28T00:00:00.000Z'",
      'iteration_budget: 2',
      'cost_budget_usd: 1',
      'class: code',
      'phase: in-flight',
      'origin: architect',
      `worktree_path: ${wt}`,
      '---',
      '# INIT-2026-08-28-mergegate-config',
      '',
    ].join('\n'),
  );

  // The wave-8 gitpulse blocker's real loader text (verified against
  // project-config.ts's validateProjectConfig) — the reason a config-red
  // gate must surface to the operator.
  const reason =
    'project-config: the flat gate keys moved to the typed testProcess object (R1-03) — migrate: ' +
    'quality_gate_cmd → testProcess.local.cmd; acceptance_gate → testProcess.acceptance ' +
    '({match, required, requiresEnv}). The .forge/quality_gate_cmd sidecar still single-sources ' +
    'testProcess.local.cmd when the JSON omits it.';

  try {
    // Loaded at call time, not at file scope: these two symbols don't exist
    // yet (they land with the Task 2 implementation, in fix-work-items.ts
    // beside REVIEW_CAP_EXHAUSTED_FILENAME). A file-level static import of a
    // not-yet-existing named export breaks ESM linking for the WHOLE file
    // before any test body runs, which would make test 1 red on an
    // unresolved import instead of on its own `result.ok` assertion — a red
    // that proves nothing about the defect it claims to kill (immutable-gates).
    // A dynamic import scoped to this test keeps that failure local to test 2.
    const { hasMergeGateConfigErrorMarker, mergeGateConfigErrorPath } = await import('@forge/flows/fix-work-items.ts');

    const tracker = makeCallTracker();
    const deps = makeMockDeps(tracker);
    deps.runMergeBoundaryGate = (_input, _logger) => {
      tracker.calls.push('runMergeBoundaryGate');
      return { ok: false, failedGate: 'config', reason } as unknown as ReturnType<FlowRunnerDeps['runMergeBoundaryGate']>;
    };
    const input = makeInput({
      initiativeId: 'INIT-2026-08-28-mergegate-config',
      worktreePath: wt,
      projectRepoPath: wt,
      manifestPath,
      dryRun: false,
    });
    const logger = makeLogger();

    await runFlowT({ flow, input, logger, deps });

    // 1. Parked needs-operator: the marker exists and carries the reason.
    assert.ok(
      hasMergeGateConfigErrorMarker(wt),
      'a config-red gate must leave the MERGE-GATE-CONFIG-ERROR.md park marker',
    );
    const markerText = readFileSync(mergeGateConfigErrorPath(wt), 'utf8');
    assert.match(markerText, /testProcess/, 'the marker must name what the operator has to fix');

    // 2. No gate-fix work item compiled: a dev agent cannot fix the
    //    operator's project config, so enqueueGateFixWorkItems must not run
    //    and `.forge/work-items/` must gain nothing.
    const items = readWorkItemsFromDir(join(wt, '.forge', 'work-items')).items;
    assert.equal(items.length, 0, '.forge/work-items/ must gain nothing on a config-red gate');
    assert.ok(
      !items.some((w) => w.origin === 'gate-fix'),
      'no gate-fix work item may be compiled from a project-config error',
    );

    // 3. An error event carries merge-gate.config-error.
    const configErrorEvent = (logger.events as Array<Record<string, unknown>>).find(
      (e) => e.event_type === 'error' && e.message === 'merge-gate.config-error',
    );
    assert.ok(configErrorEvent, 'expected an error event named merge-gate.config-error');

    // 4. No PR opens: the walk terminates inside the demo band before the
    //    real demo pipeline, adversarial review, or the verdict's openPr
    //    ever run.
    assert.ok(!tracker.calls.includes('runDemoAgent'), 'the demo pipeline must not run on a config-red gate');
    assert.ok(!tracker.calls.includes('runAdversarialReview'), 'adversarial review must not run on a config-red gate');
    assert.ok(!tracker.calls.includes('openPrInline'), 'NO PR opens on a config-red gate (the preserved invariant)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
