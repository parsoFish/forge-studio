/**
 * Acceptance tests for the onboard-preflight PLATFORM SEAM (R4-18): a
 * `gate: contract` flow node executes the REAL preflight (`runPreflight`
 * from `cli/preflight.ts`), orchestrator-side, via the `onboard-preflight`
 * band guard.
 *
 * W7-C1 (flows-20): the `onboard-project` OOTB flow wrapper was RETIRED —
 * onboarding's ONE operator surface is the onboarding SESSION
 * (`POST /api/studio/onboarding/start`, kicked off from
 * `/sessions/onboarding/new` and the project page). The seam these tests
 * pin stays fully shipped and authorable: skills/contract-check/SKILL.md,
 * the band registry rows, GATE_KIND['contract'], and execOnboardPreflight
 * are all live platform surface a Studio-authored flow can bind. The flow
 * under test is therefore an AUTHORED FIXTURE of the same two-node shape
 * (written to a temp dir and loaded through the real loadFlowDefinition),
 * not an on-disk seed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveNodeKind } from './flow-runner.ts';
import { runFlowT, type TestDeps } from './test-fixtures/flow-runner-port.ts';
import { loadFlowDefinition, loadAgentDefinition, listAgentDefinitions, loadCatalog } from './studio/registry.ts';
import { validateFlow, validateAgent } from './studio/validate.ts';
import { skillsDir } from '@forge/agents/skill-path.ts';
import { BAND_GUARD_IDS, BAND_CANONICAL_SLUG, PLATFORM_GUARD_IDS, resolveBandGuard } from '@forge/agents/agent-bands.ts';
import { runPreflight } from '@forge/projects/preflight.ts';
import type { CycleInput } from '@forge/flows/cycle-context.ts';
import type { EventLogger } from '@forge/kernel';
import type { FlowNode } from '@forge/contracts/studio/types.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = resolve(REPO_ROOT, 'studio', 'catalog.yaml');
const CONTRACT_CHECK_SKILL_PATH = join(skillsDir(REPO_ROOT), 'contract-check', 'SKILL.md');

// ---------------------------------------------------------------------------
// Test helpers (mirrors orchestrator/flow-runner.test.ts's house style)
// ---------------------------------------------------------------------------

function makeLogger(): EventLogger & { events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    logFilePath: '/tmp/test/onboard-flow-gate-events.jsonl',
    cycleId: 'test-onboard-cycle',
    emit(event: unknown) {
      events.push(event as Record<string, unknown>);
      // Echo the partial back with an event_id, exactly as the real
      // EventLogger does — wrapLoggerForCost reads cost_usd off the RETURN.
      return { ...(event as Record<string, unknown>), event_id: `evt-${events.length}` } as ReturnType<
        EventLogger['emit']
      >;
    },
  };
}

function makeInput(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    initiativeId: 'test-onboard-init',
    manifestPath: '/tmp/test/onboard-flow-gate/manifest.md',
    projectRepoPath: '/tmp/test/onboard-flow-gate/project',
    worktreePath: '/tmp/test/onboard-flow-gate/worktree',
    dryRun: true,
    ...overrides,
  };
}

/**
 * A FULL FlowRunnerDeps object, every function a tracked no-op. Neither node
 * in the onboard-shaped flow reaches any of these through its OWN executor:
 * `onboard` resolves through execAgent's DIRECT `runAgent` call (suppressed
 * via `withDryBridge`, not a FlowRunnerDeps seam) and `contract-check`
 * resolves through `execOnboardPreflight`'s DIRECT `runPreflight` call (no
 * injectable dep at all — the whole point of this initiative). The one
 * exception is `runClosure`, which `runFlow` ITSELF calls on the
 * `terminateEarly` branch (a RED contract-check) to route the manifest to
 * `ready-for-review` — populated here as a tracked no-op so a RED gate never
 * touches the real (git/gh-calling) closure implementation in this hermetic
 * test file.
 */
function makeInertDeps(tracker: { calls: string[] }): TestDeps {
  return {
    runProjectManager: async () => {
      tracker.calls.push('runProjectManager');
    },
    runDeveloperLoop: async () => {
      tracker.calls.push('runDeveloperLoop');
    },
    runDemoAgent: async () => {
      tracker.calls.push('runDemoAgent');
      return { status: 'complete', demoJsonPath: 'demo/test-onboard-init/demo.json' };
    },
    runAdversarialReview: async () => {
      tracker.calls.push('runAdversarialReview');
      return { status: 'complete', findingsPath: '_logs/test-onboard-cycle/artifacts/review-findings.json', counts: { total: 0 } };
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
    promoteMergedToDone: () => {
      tracker.calls.push('promoteMergedToDone');
    },
    commitDevLoopBoundary: () => {
      /* no-op */
    },
    enforceDevLoopCloseInvariant: () => {
      /* no-op */
    },
    assertNonEmptyDelivery: () => {
      /* no-op */
    },
    enforceFinalCiGate: () => {
      /* no-op */
    },
    rebaseForResume: () => {
      /* no-op */
    },
    enqueueFlowRun: () => {
      tracker.calls.push('enqueueFlowRun');
    },
  };
}

/**
 * Suppress the real SDK spawn for the `onboard` node's generic execAgent
 * dispatch — run-agent.ts's `FORGE_DRY_BRIDGE` seam, the SAME mechanism
 * flow-runner.test.ts's "generic agent flow" test uses (execAgent calls
 * `runAgent` directly; there is no FlowRunnerDeps injection point for a
 * generic agent spawn). Restores the prior env value in a finally so this
 * cannot leak state to other tests in the same process.
 */
async function withDryBridge<T>(fn: () => Promise<T>): Promise<T> {
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
 * Build a directory that PASSES the real preflight (all 3 unconditionally-hard
 * clauses green). Factored out (P2-2 review) so both AT-4 RED (as a decoy
 * `worktreePath` — P2-1, below) and AT-4 companion (as the actual GREEN
 * `projectRepoPath` fixture) share one fixture builder instead of duplicating
 * it.
 *
 * Basename MUST be "mdtoc" — this reuses the REAL, already-committed
 * brain/projects/mdtoc/profile.md for preflight's C4 brain-sub-wiki check,
 * instead of writing into the real repo's tracked brain/ tree (execOnboardPreflight
 * hardcodes forgeRoot to the real worktree root with no injection seam).
 *
 * P2-2: that coupling is unguarded in the source it currently reviews — a
 * future brain cleanup would silently break every caller of this helper with
 * an opaque red (a fixture that mysteriously stops passing preflight, far
 * from the file it depends on). Assert the dependency as an explicit
 * precondition here, before any caller can read a verdict off it.
 */
function makePassingPreflightFixture(): { fixtureDir: string; cleanup: () => void } {
  const mdtocProfilePath = join(REPO_ROOT, 'brain', 'projects', 'mdtoc', 'profile.md');
  assert.ok(
    existsSync(mdtocProfilePath),
    `fixture precondition: this preflight-PASSING fixture's basename is "mdtoc" specifically ` +
      `to reuse the REAL, already-committed ${mdtocProfilePath} for preflight's C4 ` +
      `brain-sub-wiki check. That file is gone, so every test using this fixture will now fail ` +
      `preflight for an unrelated reason (a missing brain profile, not the thing under test). ` +
      `Fix: restore brain/projects/mdtoc/profile.md, or repoint this helper's basename at a ` +
      `different still-committed brain/projects/<name>/profile.md.`,
  );

  const parent = mkdtempSync(join(tmpdir(), 'onboard-flow-gate-pass-'));
  const fixtureDir = join(parent, 'mdtoc');
  mkdirSync(join(fixtureDir, '.forge'), { recursive: true });
  writeFileSync(join(fixtureDir, 'roadmap.md'), '# Roadmap\n');
  writeFileSync(join(fixtureDir, '.forge', 'quality_gate_cmd'), 'true\n');
  writeFileSync(
    join(fixtureDir, '.gitignore'),
    ['.forge/work-items/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n') + '\n',
  );
  return { fixtureDir, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// The authored onboard-shaped flow fixture (W7-C1: the OOTB wrapper is
// retired; the seam stays authorable). Written to a temp dir and loaded
// through the REAL loadFlowDefinition so the parse path is identical to a
// Studio-authored flow.
// ---------------------------------------------------------------------------

const ONBOARD_FIXTURE_FLOW_YAML = [
  'id: onboard-authored',
  'name: Onboard (authored fixture)',
  'version: 1',
  'goal: Authored-flow fixture proving the onboard-preflight gate seam.',
  'project: null',
  'kb: cycles',
  'costCeilingUsd: 5',
  'origin: studio',
  'nodes:',
  '  - { id: onboard, agent: onboarding-agent }',
  '  - { id: contract-check, agent: contract-check, gate: contract }',
  'edges:',
  '  - { from: onboard, to: contract-check, artifact: contract }',
  'triggers: []',
  '',
].join('\n');

function makeOnboardFlowFixture(): { flow: ReturnType<typeof loadFlowDefinition>; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'onboard-flow-fixture-'));
  const flowPath = join(dir, 'flow.yaml');
  writeFileSync(flowPath, ONBOARD_FIXTURE_FLOW_YAML);
  return { flow: loadFlowDefinition(flowPath), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AT-1 — the authored flow shape validates cleanly against the real roster
// ---------------------------------------------------------------------------

// Kills: a contract-check node that carries `gate` but NOT `agent` (or vice
// versa) — the declared-dispatch shape the design requires; and — via the
// real validateFlow call — any flow shape `forge studio lint` would reject
// (e.g. a missing gate anywhere, which zero-gate would catch since this is
// the flow's only gate node). Proves the RETIREMENT left the seam usable: a
// Studio author can still bind onboarding-agent + the contract gate.
test('AT-1 authored onboard-shaped flow: loads through the real parse path, and zero validateFlow error findings against the real roster', () => {
  const { flow, cleanup } = makeOnboardFlowFixture();
  try {
  const agents = new Map(listAgentDefinitions(skillsDir(REPO_ROOT)).map((a) => [a.slug, a]));

  assert.equal(flow.id, 'onboard-authored');
  assert.equal(flow.nodes.length, 2, `expected exactly 2 nodes, got ${flow.nodes.length}: ${JSON.stringify(flow.nodes)}`);
  assert.deepEqual(
    flow.nodes.map((n) => n.id).sort(),
    ['contract-check', 'onboard'],
  );

  // P1-1: the `onboard` node's execution was entirely unpinned — AT-1 checked
  // node count/ids but never `onboard`'s own `agent:` field. Kills: `onboard`
  // carrying no agent field, a misspelled slug, or a slug that isn't a real
  // roster member. Any of those make resolveNodeKind (flow-runner.ts) fall
  // through to 'unknown' — execUnknown then emits an ERROR event and
  // silently no-ops (the walk still proceeds to contract-check), shipping a
  // flow whose onboarding step never actually runs, green.
  const onboardNode = flow.nodes.find((n) => n.id === 'onboard');
  assert.ok(onboardNode, 'expected an "onboard" node');
  assert.equal(
    onboardNode!.agent,
    'onboarding-agent',
    'the onboard node must declare agent:"onboarding-agent"',
  );
  assert.ok(
    agents.has('onboarding-agent'),
    `the onboard node's agent ref must resolve in the REAL roster (skills/onboarding-agent/SKILL.md) — ` +
      `a dangling ref makes resolveNodeKind fall through to 'unknown' — got roster slugs: ${JSON.stringify([...agents.keys()])}`,
  );

  const contractCheckNode = flow.nodes.find((n) => n.id === 'contract-check');
  assert.ok(contractCheckNode, 'expected a "contract-check" node');
  assert.equal(
    contractCheckNode!.agent,
    'contract-check',
    'the gate node must ALSO carry agent:"contract-check" — declared dispatch (ADR-039), no privileged executor enum',
  );
  assert.equal(contractCheckNode!.gate, 'contract');

  assert.equal(flow.edges.length, 1, `expected exactly 1 edge, got ${flow.edges.length}: ${JSON.stringify(flow.edges)}`);
  assert.deepEqual(flow.edges[0], { from: 'onboard', to: 'contract-check', artifact: 'contract' });

  // What `forge studio lint` gates on: zero error-level findings against the
  // real agent roster.
  const findings = validateFlow(flow, agents);
  const errors = findings.filter((f) => f.level === 'error');
  assert.deepEqual(
    errors,
    [],
    `expected zero validateFlow error findings for the authored onboard-shaped flow — got: ${JSON.stringify(errors)}`,
  );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AT-2 — band registry rows + totality
// ---------------------------------------------------------------------------

// Kills: BAND_GUARD_IDS never gaining 'onboard-preflight' (today's array has
// only the 4 legacy bands); BAND_CANONICAL_SLUG missing the new entry, or
// pointing it at the wrong slug; PLATFORM_GUARD_IDS staying at 9 (its
// TOGGLE_GUARD_IDS + BAND_GUARD_IDS union not picking up the new band);
// studio/catalog.yaml never gaining its guards: display row (the "declared
// data fails open" antipattern this codebase repeatedly ratchets against —
// see PLATFORM_GUARD_IDS/catalog.yaml parity tests in hook-library.test.ts).
test('AT-2 band registry rows + totality: onboard-preflight is a full 10th citizen (5 toggles + 5 bands)', () => {
  assert.ok(
    (BAND_GUARD_IDS as readonly string[]).includes('onboard-preflight'),
    `expected BAND_GUARD_IDS to include "onboard-preflight" — got: ${JSON.stringify(BAND_GUARD_IDS)}`,
  );
  assert.equal(
    (BAND_CANONICAL_SLUG as Record<string, string>)['onboard-preflight'],
    'contract-check',
    'BAND_CANONICAL_SLUG must route the onboard-preflight guard to the contract-check agent',
  );
  assert.equal(
    PLATFORM_GUARD_IDS.length,
    10,
    `PLATFORM_GUARD_IDS must be the 5 toggle ids + 5 band ids now — got ${PLATFORM_GUARD_IDS.length}: ${JSON.stringify(PLATFORM_GUARD_IDS)}`,
  );

  const catalog = loadCatalog(CATALOG_PATH);
  const row = catalog.guards.find((g) => g.id === 'onboard-preflight');
  assert.ok(
    row,
    `expected a studio/catalog.yaml guards: row with id "onboard-preflight" (read from the REAL file) — got ids: ${JSON.stringify(catalog.guards.map((g) => g.id))}`,
  );

  // Totality over flow-runner's band-executor table is proven BEHAVIOURALLY,
  // not by reaching into the module-private AGENT_BAND_EXECUTORS map — AT-4
  // below drives a real runFlow over this exact guard id through to a
  // terminal event, which is only possible if the executor table is total.
});

// ---------------------------------------------------------------------------
// AT-3 — node-kind dispatch (caller-count class)
// ---------------------------------------------------------------------------

// Kills, in order:
//  1. (primary assertion) the flow.yaml never landing, or the contract-check
//     node not resolving to NodeKind 'agent' at all.
//  2. (THE LOAD-BEARING PIN — the companion assertion) an implementation that
//     resolves 'agent' purely off `node.agent` existing in the roster, WITHOUT
//     ever adding the new GATE_KIND['contract'] row. Today (and under that
//     wrong implementation) `resolveNodeKind` falls through the `if
//     (node.gate && GATE_KIND[node.gate])` check (GATE_KIND has no 'contract'
//     row) to `if (!node.agent) return 'unknown'` — so stripping the agent
//     field flips the result to 'unknown' UNLESS the row is real. The primary
//     assertion alone cannot catch this wrong implementation (both a real
//     GATE_KIND row and a bare roster lookup produce the same 'agent' answer
//     when the agent field is present).
//  3. (negative control) a fix that turns GATE_KIND into a catch-all instead
//     of adding one precise row.
test("AT-3 node-kind dispatch: gate:'contract' resolves 'agent' via the GATE_KIND row, independent of node.agent", () => {
  const { flow, cleanup } = makeOnboardFlowFixture();
  cleanup(); // definition already parsed; the temp yaml is no longer needed
  const agents = new Map(listAgentDefinitions(skillsDir(REPO_ROOT)).map((a) => [a.slug, a]));
  const contractCheckNode = flow.nodes.find((n) => n.id === 'contract-check');
  assert.ok(contractCheckNode, 'expected the authored onboard-shaped flow to carry a "contract-check" node (see AT-1)');

  assert.equal(resolveNodeKind(contractCheckNode!, agents), 'agent');

  const gateOnlyNode: FlowNode = { ...contractCheckNode!, agent: undefined };
  assert.equal(
    resolveNodeKind(gateOnlyNode, agents),
    'agent',
    "gate:'contract' alone (no agent field) must resolve to 'agent' via GATE_KIND — proves the row is load-bearing, not decorative",
  );

  assert.equal(
    resolveNodeKind({ id: 'x', gate: 'not-a-real-gate-id-xyz' }, agents),
    'unknown',
    'an unrelated/unknown gate id with no agent field must stay unknown — GATE_KIND must not become a catch-all',
  );
});

// ---------------------------------------------------------------------------
// AT-4 — THE LOAD-BEARING PIN: real preflight, failing fixture, end-to-end
// through runFlow.
// ---------------------------------------------------------------------------

// Kills: any implementation where execOnboardPreflight is a stub that never
// calls the real runPreflight (a hand-rolled "always ok" or "always fail"
// gate); one that fails to set ctx.state.terminateEarly on a red report
// (the walk would then try to run past contract-check, or runClosure would
// never fire); one that emits status:'complete' regardless of report.ok;
// and — via assertion (b) — one that fabricates/echoes a fixed clause list
// instead of the REAL clauses runPreflight computed for THIS fixture.
// P1-1 (below): one that leaves `onboard`'s agent ref dangling, silently
// no-op'd by execUnknown. P2-1 (below): one that reads `input.worktreePath`
// instead of `input.projectRepoPath` — discriminated by pointing
// worktreePath at a DECOY fixture that would preflight-PASS.
test('AT-4 (RED) contract-check gate: a real preflight-FAILING fixture, driven end-to-end through runFlow, terminates the walk with a failed contract-check node', async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'onboard-flow-gate-red-'));
  // P2-1: makeInput's default worktreePath is a fixed, never-created path —
  // an empty fixtureDir and that nonexistent path produce the SAME hard-
  // clause signature (C1/C2/C4), so a wrong execOnboardPreflight that reads
  // `input.worktreePath` instead of `input.projectRepoPath` would pass this
  // RED test by coincidence. Point worktreePath at a fixture that WOULD
  // preflight-PASS instead, so reading the wrong field flips the verdict to
  // ok:true and trips this test's own assertions.
  const decoy = makePassingPreflightFixture();
  try {
    // Boilerplate rule 4: assert the fixture precondition BEFORE reading any
    // verdict. An entirely empty temp dir trips the 3 UNCONDITIONALLY hard
    // preflight clauses (C1 — no declared quality gate; C2 — not a git repo
    // and no .gitignore; C4 — no roadmap.md and no brain sub-wiki profile).
    const preflightCheck = runPreflight(fixtureDir, { forgeRoot: REPO_ROOT });
    assert.equal(preflightCheck.ok, false, 'fixture precondition: this project MUST fail preflight');
    const expectedFailingHardIds = preflightCheck.clauses.filter((c) => c.hard && !c.pass).map((c) => c.clause);
    assert.ok(
      expectedFailingHardIds.length > 0,
      `fixture precondition: at least one HARD clause must fail — got clauses: ${JSON.stringify(preflightCheck.clauses)}`,
    );

    const flowFixture = makeOnboardFlowFixture();
    const flow = flowFixture.flow;
    flowFixture.cleanup();
    const tracker = { calls: [] as string[] };
    const deps = makeInertDeps(tracker);
    const input = makeInput({ projectRepoPath: fixtureDir, worktreePath: decoy.fixtureDir });
    const logger = makeLogger();

    const result = await withDryBridge(() => runFlowT({ flow, input, logger, deps }));

    const events = logger.events;

    // P1-1: `onboard`'s agent ref must actually resolve and dispatch — not
    // fall through to the generic unknown-node path. Kills: a dangling/
    // misspelled/off-roster `onboard.agent` (resolveNodeKind → 'unknown' →
    // execUnknown emits this error event and silently no-ops, the walk still
    // reaching contract-check with every existing assertion below still
    // green).
    assert.ok(
      !events.some((e) => e.message === 'flow-runner.unknown-node-skipped'),
      `expected NO 'flow-runner.unknown-node-skipped' event — the onboard node's agent ref must resolve, not fall through to execUnknown — got events: ${JSON.stringify(events)}`,
    );
    // Measured (not assumed) shape of the onboard node's suppressed spawn:
    // under FORGE_DRY_BRIDGE, runAgent (run-agent.ts) emits a 'start' event
    // keyed by the def's own slug, then returns via the dry-bridge branch
    // BEFORE reaching its 'end'-event lines — so there is no 'end' event to
    // pair it with here (verified by running the flow and inspecting
    // logger.events directly). Mirrors flow-runner.test.ts:1266-1278's
    // "runFlow dispatches the node via execAgent" pattern.
    assert.ok(
      events.some((e) => e.event_type === 'start' && e.skill === 'onboarding-agent'),
      `expected a 'start' event for skill "onboarding-agent" — proves the onboard node actually dispatched through execAgent's real runAgent call, not a stub — got events: ${JSON.stringify(events)}`,
    );
    assert.ok(
      events.some(
        (e) =>
          e.message === 'run-agent.spawn-suppressed' &&
          (e.metadata as Record<string, unknown> | undefined)?.agent_slug === 'onboarding-agent',
      ),
      `expected a 'run-agent.spawn-suppressed' log event for agent_slug "onboarding-agent" — got events: ${JSON.stringify(events)}`,
    );

    // (a) contract-check's terminal end event is status:'failed'.
    const endEvents = events.filter(
      (e) => e.event_type === 'end' && (e.metadata as Record<string, unknown> | undefined)?.node_id === 'contract-check',
    );
    assert.equal(
      endEvents.length,
      1,
      `expected exactly one contract-check end event — got events: ${JSON.stringify(events)}`,
    );
    assert.equal((endEvents[0]!.metadata as Record<string, unknown>).status, 'failed');

    // (b) the report event carries the REAL failing hard clause ids — a stub
    // executor that never called runPreflight for real cannot reproduce
    // these, and one that fabricates a fixed list cannot match THIS
    // fixture's independently-computed ids.
    const reportEvent = events.find((e) => {
      const md = e.metadata as Record<string, unknown> | undefined;
      return Array.isArray(md?.failing_clause_ids);
    });
    assert.ok(
      reportEvent,
      `expected an emitted event carrying metadata.failing_clause_ids — got events: ${JSON.stringify(events)}`,
    );
    assert.deepEqual(
      (reportEvent!.metadata as Record<string, unknown>).failing_clause_ids,
      expectedFailingHardIds,
      'the emitted failing_clause_ids must deep-equal the REAL hard-failing clause ids independently computed from runPreflight on this exact fixture',
    );

    // (c) the walk terminated early. There is no node after contract-check in
    // this 2-node flow (so "nothing ran after it" is trivially true either
    // way) — the real behavioural signal is runFlow's OWN terminateEarly
    // branch firing: it unconditionally routes the manifest via runClosure,
    // which is otherwise unreachable for this flow shape.
    assert.ok(
      tracker.calls.includes('runClosure'),
      `expected the terminateEarly branch to route the manifest via runClosure — got calls: ${JSON.stringify(tracker.calls)}`,
    );
    assert.equal(result.cycleOutcome, 'ready-for-review');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
    decoy.cleanup();
  }
});

// Companion GREEN case. A true contract-GREEN fixture through the REAL
// runFlow path IS achievable cheaply — see the file-level report for why
// (reuses the already-committed brain/projects/mdtoc/profile.md instead of
// writing into the real repo's tracked brain/ tree, since execOnboardPreflight
// hardcodes forgeRoot to the real worktree root with no injection seam).
//
// Kills: an implementation that emits status:'failed' (or terminates early)
// regardless of report.ok; one that never emits status:'complete' on green;
// one whose report event's failing_clause_ids is non-empty on a real pass.
test("AT-4 companion (GREEN) contract-check gate: a real preflight-PASSING fixture reaches 'complete', not 'failed', and the walk does not terminate early", async () => {
  // Fixture precondition (P2-2, including the "basename MUST be mdtoc"
  // dependency on the real committed brain/projects/mdtoc/profile.md) is
  // asserted INSIDE makePassingPreflightFixture, before any verdict is read.
  const { fixtureDir, cleanup } = makePassingPreflightFixture();
  try {
    // Boilerplate rule 4: assert the fixture precondition BEFORE the verdict.
    const preflightCheck = runPreflight(fixtureDir, { forgeRoot: REPO_ROOT });
    assert.equal(
      preflightCheck.ok,
      true,
      `fixture precondition: this project MUST pass preflight — got clauses: ${JSON.stringify(preflightCheck.clauses)}`,
    );

    const flowFixture = makeOnboardFlowFixture();
    const flow = flowFixture.flow;
    flowFixture.cleanup();
    const tracker = { calls: [] as string[] };
    const deps = makeInertDeps(tracker);
    const input = makeInput({ projectRepoPath: fixtureDir });
    const logger = makeLogger();

    await withDryBridge(() => runFlowT({ flow, input, logger, deps }));

    const events = logger.events;

    // P1-1: same dangling-ref kill as AT-4 RED (see its comments for the
    // full rationale) — checked here too since this is the OTHER real
    // runFlow path through the onboard node.
    assert.ok(
      !events.some((e) => e.message === 'flow-runner.unknown-node-skipped'),
      `expected NO 'flow-runner.unknown-node-skipped' event — got events: ${JSON.stringify(events)}`,
    );
    assert.ok(
      events.some((e) => e.event_type === 'start' && e.skill === 'onboarding-agent'),
      `expected a 'start' event for skill "onboarding-agent" — got events: ${JSON.stringify(events)}`,
    );
    assert.ok(
      events.some(
        (e) =>
          e.message === 'run-agent.spawn-suppressed' &&
          (e.metadata as Record<string, unknown> | undefined)?.agent_slug === 'onboarding-agent',
      ),
      `expected a 'run-agent.spawn-suppressed' log event for agent_slug "onboarding-agent" — got events: ${JSON.stringify(events)}`,
    );

    const endEvents = events.filter(
      (e) => e.event_type === 'end' && (e.metadata as Record<string, unknown> | undefined)?.node_id === 'contract-check',
    );
    assert.equal(
      endEvents.length,
      1,
      `expected exactly one contract-check end event — got events: ${JSON.stringify(events)}`,
    );
    assert.equal((endEvents[0]!.metadata as Record<string, unknown>).status, 'complete');

    const reportEvent = events.find((e) => {
      const md = e.metadata as Record<string, unknown> | undefined;
      return Array.isArray(md?.failing_clause_ids);
    });
    if (reportEvent) {
      assert.deepEqual(
        (reportEvent.metadata as Record<string, unknown>).failing_clause_ids,
        [],
        'a green preflight report must carry an EMPTY failing_clause_ids',
      );
    }

    assert.ok(
      !tracker.calls.includes('runClosure'),
      'a green gate must NOT terminate the walk early — runClosure is only reachable via the terminateEarly branch in this 2-node flow',
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AT-5 — agent-def lint conformance
// ---------------------------------------------------------------------------

// Kills: skills/contract-check/SKILL.md never being authored (loadAgentDefinition
// throws ENOENT — today's RED); an authored def that fails validateAgent (e.g.
// missing budgets.maxTurns/maxBudgetUsd, or a loopStrategy other than one-shot
// — the composition/band-guard lint in validate.ts); one that forgets to
// declare the onboard-preflight guard at all (resolveBandGuard would return
// undefined); one that declares loopStrategy:'ralph' or omits 'one-shot'.
test('AT-5 contract-check agent-def lint conformance: zero validateAgent errors, correct band-guard resolution + loop strategy', () => {
  const def = loadAgentDefinition(CONTRACT_CHECK_SKILL_PATH);
  const findings = validateAgent(def);
  const errors = findings.filter((f) => f.level === 'error');
  assert.deepEqual(
    errors,
    [],
    `expected zero validateAgent error findings for contract-check — got: ${JSON.stringify(errors)}`,
  );

  assert.equal(resolveBandGuard(def), 'onboard-preflight');
  assert.equal(def.runtime.loopStrategy, 'one-shot');
});

// Kills: BAND_CANONICAL_SLUG['onboard-preflight'] pointing at a slug other
// than 'contract-check' (the composition/band-guard "restricted to its
// canonical slug" error would fire on WHICHEVER def actually declares the
// guard); contract-check declaring the guard but omitting budgets.maxTurns /
// a budget cap; and — the INVERSE half — contract-check landing WITHOUT
// declaring its own owed 'onboard-preflight' guard (the
// "canonical-agent-must-carry-its-band-guard" rule), which would silently
// degrade the gate node to the bare generic spawn with lint green. RED today
// because "contract-check" is not yet a member of the real on-disk roster at
// all — listAgentDefinitions(skillsDir(REPO_ROOT)) cannot find it.
test('AT-5 companion — inverse lint over the REAL on-disk agent roster, contract-check included: zero composition/band-guard findings anywhere', () => {
  const agents = listAgentDefinitions(skillsDir(REPO_ROOT));
  assert.ok(
    agents.some((a) => a.slug === 'contract-check'),
    'expected "contract-check" to be a REAL, loadable roster agent (skills/contract-check/SKILL.md must exist, be library:true, and carry a runtime block)',
  );

  const allBandGuardFindings = agents.flatMap((def) => validateAgent(def).filter((f) => f.check === 'composition/band-guard'));
  assert.deepEqual(
    allBandGuardFindings,
    [],
    `expected zero composition/band-guard findings across the real roster (including contract-check) — got: ${JSON.stringify(allBandGuardFindings)}`,
  );
});
