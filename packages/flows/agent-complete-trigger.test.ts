/**
 * ACCEPTANCE TESTS (T3, R2-08-F2) — lighting up `on: agent-complete`.
 *
 * PINNED CONTRACT this file locks in (does not exist yet — landed BEFORE the
 * implementation, per the immutable-gates method):
 *
 *   `orchestrator/flow-trigger.ts` exports
 *
 *     export function fireAgentCompleteTriggers(
 *       flows: Array<Pick<FlowDefinition, 'id' | 'triggers'>>,
 *       completedAgentSlug: string,
 *       opts?: { queueRoot?: string },
 *     ): Promise<FlowTrigger[]>
 *
 *   Scans every given flow's `triggers` for `on: 'agent-complete'` rows
 *   targeting a flow WHOSE `agent:` field identity-matches `completedAgentSlug`,
 *   and for each match STAGES one claimable flow-run request via
 *   `stageFlowRunRequest` (origin: 'agent-complete', no `sourceInitiativeId` —
 *   a standalone agent run is not an initiative, so this is an
 *   EXTERNAL-ORIGINATION kind like cron/webhook: the drain mints a fresh
 *   initiative for the target flow's project, never chains; carries
 *   `sourceAgent: completedAgentSlug` so F4 can later derive `trigger.source`
 *   from the staged request rather than free text). Returns the triggers it
 *   fired, mirroring `fireFlowTriggers`'s own return contract. The "SAME
 *   claimable-queue + dry-bridge guard contract as every other kind" the WI
 *   requires is `stageFlowRunRequest` / `drainFlowRunRequests` themselves —
 *   this function's ONLY job is staging; dispatch still happens exclusively
 *   in the guarded daemon sweep.
 *
 *   `FlowTrigger` gains a REQUIRED per-kind config field for `on:
 *   'agent-complete'` rows: `agent: <slug>` — the source agent whose
 *   completion fires this row, matched by IDENTITY (never
 *   prefix/substring). This is ADR-041 §2's existing per-kind config-block
 *   pattern (cron rows carry `schedule`/`concurrency`, webhook rows carry
 *   `webhook: {…}`) being exercised, not a new design decision — see T1's
 *   ruling on the first cut of this file, which pinned a fail-open contract
 *   (ANY agent completing fired EVERY `on: agent-complete` row in the
 *   roster) and required this fix. `agent:` absent on an `on: agent-complete`
 *   row is a `forge studio lint` ERROR (see
 *   orchestrator/studio/validate.test.ts's `trigger-agent-complete` block) —
 *   it must never default to "fires for all".
 *
 * WHY the firing-site shape (fireAgentCompleteTriggers as a standalone
 * function rather than inline in dispatchAgentRun): `dispatchAgentRun`
 * (orchestrator/agent-dispatch.ts) is the ONE generic surface for "an
 * UNATTENDED runnable roster agent" completing standalone (its own module
 * doc) — the natural firing site for "a standalone agent run completes".
 * `fireFlowTriggers` itself already fires ANY event string generically (its
 * `event` param is unchecked at runtime), so the real gap isn't there — it's
 * that nothing scans the flow roster for `on: agent-complete` declarations
 * and stages a request when a standalone run finishes. This is a genuine
 * design decision the T3 test-writer made under latitude (the ratified
 * ADR-027 R2-08 amendment does not specify the call site or function shape)
 * — flagged in the accompanying report for T1 to confirm or correct.
 *
 * Test #12 (harness-mode effect-set guard) lives in
 * orchestrator/trigger-harness-guard.test.ts, extending its existing pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORGE_ROOT } from '@forge/kernel';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listFlowRunRequests } from './flow-run-requests.ts';
import { dispatchAgentRun } from '@forge/agents/agent-dispatch.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import type { FlowTrigger } from '@forge/contracts/studio/types.ts';

// Bead forge-8vfn.5.53: anchored on kernel's FORGE_ROOT, not the process cwd.
// This test dispatches a REAL agent run, and the agent roster is discovered
// from `<root>/skills`; with cwd = packages/flows the roster came back empty
// and the failure read as a product defect ("no runnable agent … (known: )").
const ROOT = FORGE_ROOT;

/** Mirrors `fakeQueryFn` in run-agent.test.ts — the canonical stub for the
 *  locked `RunContext.queryFn` shape: a fake SDK query() yielding one
 *  `result` message reporting the given cost, never touching the real SDK. */
function fakeQueryFn(costUsd: number): StreamQueryFn {
  return ((_params: { prompt: unknown; options?: unknown }) => {
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: costUsd, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'agent-complete-trigger-'));
}

/** Runtime-only accessor for the not-yet-typed `agent` field on a FlowTrigger. */
function agentTrigger(ref: string, sourceAgent: string): FlowTrigger {
  return {
    on: 'agent-complete',
    target: { kind: 'flow', ref },
    agent: sourceAgent,
  } as unknown as FlowTrigger;
}

type FireAgentCompleteTriggersFn = (
  flows: Array<{ id: string; triggers: FlowTrigger[] }>,
  completedAgentSlug: string,
  opts?: { queueRoot?: string },
) => Promise<FlowTrigger[]>;

/**
 * Dynamic import + a clear assertion failure (rather than a static-import
 * SyntaxError) if the export doesn't exist yet — keeps the failure message
 * informative and, more importantly, means a missing export fails ONE test
 * with a readable message instead of crashing this whole file's collection.
 */
async function loadFireAgentCompleteTriggers(): Promise<FireAgentCompleteTriggersFn> {
  const mod = (await import('./flow-trigger.ts')) as unknown as Record<string, unknown>;
  const fn = mod['fireAgentCompleteTriggers'];
  assert.equal(
    typeof fn,
    'function',
    'expected orchestrator/flow-trigger.ts to export fireAgentCompleteTriggers(flows, completedAgentSlug, opts) — R2-08-F2\'s pinned contract for firing on:agent-complete triggers when a standalone agent run completes (see this file\'s header comment for the full pinned signature)',
  );
  return fn as FireAgentCompleteTriggersFn;
}

test('(RED) [F2 #11] an on: agent-complete trigger targeting a flow stages exactly one claimable request when its named source agent completes, carrying the same fields every other kind carries plus the source agent slug', async () => {
  const fireAgentCompleteTriggers = await loadFireAgentCompleteTriggers();
  const root = setup();
  try {
    const flows = [
      { id: 'watcher-flow', triggers: [agentTrigger('demo-runner-flow', 'doc-updater')] },
      { id: 'unrelated-flow', triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' } } as FlowTrigger] },
    ];

    const fired = await fireAgentCompleteTriggers(flows, 'doc-updater', { queueRoot: root });

    assert.equal(fired.length, 1, `expected exactly one agent-complete trigger to fire (the unrelated flow-complete trigger must not) — got ${JSON.stringify(fired)}`);
    assert.equal(fired[0].target.ref, 'demo-runner-flow');

    const staged = listFlowRunRequests({ queueRoot: root });
    assert.equal(staged.length, 1, `expected exactly one claimable request staged in _queue/flow-runs/ — got ${staged.length}`);
    const req = staged[0].req as unknown as Record<string, unknown>;
    assert.deepEqual(req['target'], { kind: 'flow', ref: 'demo-runner-flow' });
    assert.equal(req['origin'], 'agent-complete', `expected origin "agent-complete" — got ${JSON.stringify(req['origin'])}`);
    assert.ok(
      typeof req['triggeredBy'] === 'string' && (req['triggeredBy'] as string).length > 0,
      'triggeredBy must be a non-empty string, same as every other kind',
    );
    assert.ok(
      typeof req['createdAt'] === 'string' && (req['createdAt'] as string).length > 0,
      'createdAt must be stamped, same as every other kind',
    );
    assert.equal(
      req['sourceAgent'],
      'doc-updater',
      `expected the completed agent's slug carried onto the staged request as sourceAgent (so F4 can derive trigger.source from it, never from prose) — got ${JSON.stringify(req['sourceAgent'])}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [F2 #11] a flow with no agent-complete trigger fires nothing — the common case, mirrors fireFlowTriggers\' own "empty triggers → []" contract', async () => {
  const fireAgentCompleteTriggers = await loadFireAgentCompleteTriggers();
  const root = setup();
  try {
    const flows = [
      { id: 'quiet-flow', triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' } } as FlowTrigger] },
    ];
    const fired = await fireAgentCompleteTriggers(flows, 'doc-updater', { queueRoot: root });
    assert.deepEqual(fired, []);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T1 ruling #1 — the fail-open fix. `agent:` scopes which completing agent
// fires a row; two watchers for two DIFFERENT source agents must not
// cross-fire. Both assertions in the SAME test — "B's watcher didn't fire"
// alone passes for the wrong reason if the whole function is a no-op.
// ---------------------------------------------------------------------------

test('(RED) [F2 #11, T1 ruling #1] agent A completing fires ONLY A\'s watcher, never B\'s — kills the fail-open contract where any agent completing fires every agent-complete row in the roster', async () => {
  const fireAgentCompleteTriggers = await loadFireAgentCompleteTriggers();
  const root = setup();
  try {
    const flows = [
      { id: 'watches-doc-updater', triggers: [agentTrigger('flow-for-a', 'doc-updater')] },
      { id: 'watches-project-scoped-review', triggers: [agentTrigger('flow-for-b', 'project-scoped-review')] },
    ];

    const fired = await fireAgentCompleteTriggers(flows, 'doc-updater', { queueRoot: root });

    const firedRefs = fired.map((t) => t.target.ref);
    assert.ok(
      firedRefs.includes('flow-for-a'),
      `expected doc-updater's watcher (flow-for-a) to fire — fired: ${JSON.stringify(firedRefs)}`,
    );
    assert.ok(
      !firedRefs.includes('flow-for-b'),
      `expected project-scoped-review's watcher (flow-for-b) NOT to fire when doc-updater completes — fired: ${JSON.stringify(firedRefs)}`,
    );

    const staged = listFlowRunRequests({ queueRoot: root });
    assert.equal(staged.length, 1, `expected exactly one staged request (A's, not B's) — got ${staged.length}: ${JSON.stringify(staged.map((s) => s.req))}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [F2 #11, T1 ruling #1] source-agent matching is strict IDENTITY, not prefix/substring — agent: "developer" must not match a completed slug "developer-ralph" or "x/developer"', async () => {
  const fireAgentCompleteTriggers = await loadFireAgentCompleteTriggers();
  const root = setup();
  try {
    const flows = [{ id: 'watches-developer', triggers: [agentTrigger('flow-for-developer', 'developer')] }];

    const firedForRalph = await fireAgentCompleteTriggers(flows, 'developer-ralph', { queueRoot: join(root, 'a') });
    assert.deepEqual(firedForRalph, [], `"developer-ralph" must not identity-match "developer" — fired: ${JSON.stringify(firedForRalph)}`);

    const firedForNamespaced = await fireAgentCompleteTriggers(flows, 'x/developer', { queueRoot: join(root, 'b') });
    assert.deepEqual(firedForNamespaced, [], `"x/developer" must not identity-match "developer" — fired: ${JSON.stringify(firedForNamespaced)}`);

    const firedForExact = await fireAgentCompleteTriggers(flows, 'developer', { queueRoot: join(root, 'c') });
    assert.equal(firedForExact.length, 1, 'sanity: the exact slug must still fire');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ACCEPTANCE TESTS (T3, R2-08-F2, round-3 real-path pin) — this site is
// broken in TWO distinct, separately-provable ways. Escalated to T1 (not
// guessed): the second (structural) finding is more severe than the
// projects/eventProject omission T1 originally flagged for the other three
// sites.
// ---------------------------------------------------------------------------

/**
 * FINDING (new, round-3): `dispatchAgentRun` (orchestrator/agent-dispatch.ts)
 * — the module's OWN doc comment names it "the generic standalone-run path
 * for an UNATTENDED runnable roster agent", i.e. THE real production site
 * for "a standalone agent run completes" — never calls
 * `fireAgentCompleteTriggers` anywhere. Verified by reading the full function
 * body and grepping the whole tree: zero non-test references to
 * `fireAgentCompleteTriggers` exist outside orchestrator/flow-trigger.ts
 * itself. `dispatchAgentRun`'s own signature has no `forgeRoot`/`queueRoot`/
 * flow-roster parameter at all, so it COULD NOT call it even if it tried.
 * This means test #11's "stages a claimable run request when a standalone
 * agent run completes" acceptance criterion has NEVER been exercised through
 * the real completion path — every existing passing test (including this
 * file's own #11 tests above) calls `fireAgentCompleteTriggers` directly with
 * a hand-built `flows` array, which is exactly the "test on the wrong
 * surface" trap this round's ruling was about, one level deeper than the
 * `projects` field.
 *
 * This is a DIFFERENT KIND of gap than the other three sites' — cron,
 * webhook, and flow-complete all pass SOME opts to their staging call, just
 * without `projects`. Here, the staging call is never reached at all. Given
 * that, an `eventProject` question for this site doesn't yet have anywhere
 * to attach — there is no wiring for it to ride on. Escalated rather than
 * invented.
 */
// ---------------------------------------------------------------------------
// This test drives the REAL dispatchAgentRun completion path, which routes
// through runAgent's dry-bridge/no-spawn suppression seam
// (orchestrator/run-agent.ts) BEFORE the injected fakeQueryFn is ever
// reached. That seam is env-only (FORGE_ARCHITECT_NO_SPAWN /
// FORGE_DRY_BRIDGE — no injectable override), and CI sets
// FORGE_ARCHITECT_NO_SPAWN=1 for every `npm test` run (.github/workflows/ci.yml).
// The test MUST establish its own non-suppressed precondition rather than
// inherit it from whatever the ambient environment happens to be — a prior
// version of this test asserted `suppressed === false` while relying on the
// CI/ambient env to already have both vars unset, which is guaranteed FALSE
// under CI and made the test unpassable there regardless of production
// correctness (the reported defect).
// ---------------------------------------------------------------------------

test('(RED) [round-3 real-path] a REAL dispatchAgentRun completion of a slug with a matching on:agent-complete watcher stages exactly the expected claimable request — fireAgentCompleteTriggers is wired to the real standalone-run completion path', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'agent-complete-wiring-'));
  const queueRoot = join(forgeRoot, '_queue');
  // Establish the precondition explicitly — never inherit it from the
  // ambient environment (CI sets FORGE_ARCHITECT_NO_SPAWN=1 for every test
  // run; this must still pass there). Restored in `finally`, including on
  // the failure path, so a throw can never leak a modified env into a
  // sibling test running later in this same file's process.
  const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const savedDry = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  try {
    // A real, valid on:agent-complete watcher for the exact agent we're about
    // to dispatch — if the wiring exists, this MUST fire.
    const watcherDir = join(forgeRoot, 'studio', 'flows', 'watcher-flow');
    mkdirSync(watcherDir, { recursive: true });
    writeFileSync(
      join(watcherDir, 'flow.yaml'),
      [
        'id: watcher-flow',
        'name: watcher-flow',
        'version: 1',
        'goal: fixture watcher for the round-3 wiring-gap pin',
        'project: null',
        'kb: null',
        'costCeilingUsd: 5',
        'origin: seed',
        'nodes:',
        '  - { id: only, agent: developer-ralph }',
        'edges: []',
        'triggers:',
        '  - on: agent-complete',
        '    target: { kind: flow, ref: downstream-flow }',
        '    agent: project-scoped-review',
      ].join('\n'),
    );

    // Wraps fakeQueryFn with an invocation spy: with the no-spawn/dry-bridge
    // guard removed above, the test must DEMONSTRATE its own no-real-spawn
    // safety — the injected fake being the thing that actually ran — rather
    // than rely on the env var it just deleted.
    let queryFnCalled = false;
    const spiedQueryFn: StreamQueryFn = ((params: { prompt: unknown; options?: unknown }) => {
      queryFnCalled = true;
      return (fakeQueryFn(0.01) as unknown as (p: typeof params) => unknown)(params);
    }) as unknown as StreamQueryFn;

    const runId = '_agent-complete-wiring-test';
    const result = await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: join(ROOT, 'skills'),
      runId,
      logsRoot: join(forgeRoot, '_logs'),
      queryFn: spiedQueryFn,
    });

    assert.equal(
      result.result.suppressed,
      false,
      'sanity: the dispatch actually ran (not suppressed) — now guaranteed by the explicit env deletion above, not inherited from ambient state',
    );
    assert.equal(
      queryFnCalled,
      true,
      'the injected fake queryFn must be the thing that actually ran with the guard removed — proves this test is still safe with no real SDK call, rather than merely asserting suppressed:false and hoping',
    );

    // The CORRECT target behaviour: a matching on:agent-complete watcher
    // stages exactly one claimable request now that this site is wired.
    const staged = listFlowRunRequests({ queueRoot });
    assert.equal(
      staged.length,
      1,
      `expected exactly ONE staged request for "downstream-flow" (a real, valid on:agent-complete watcher exists) — got ${JSON.stringify(staged)}.`,
    );
  } finally {
    if (savedNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn;
    if (savedDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = savedDry;
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

/**
 * Second, narrower finding: EVEN IF `fireAgentCompleteTriggers` were wired up
 * (test above), it would still drop `projects`/`eventProject` — the exact
 * class of defect T1 found at the other three sites (confirmed directly at
 * this module's `stageFlowRunRequest` call site by reading
 * orchestrator/flow-trigger.ts). Driven through the REAL, unmocked
 * `fireAgentCompleteTriggers` (the function itself, not a hand-built
 * FlowRunRequest) — this is the "one real-path test per firing site"
 * requirement's answer for the scoping-specific half of this site's defect,
 * complementing the wiring-gap test above.
 */
test('(RED) [round-3 real-path] fireAgentCompleteTriggers drops a trigger\'s declared projects: onto the staged file, same class of defect as the other three sites', async () => {
  const fireAgentCompleteTriggers = await loadFireAgentCompleteTriggers();
  const root = setup();
  try {
    const flows = [
      {
        id: 'watcher-flow',
        triggers: [
          {
            on: 'agent-complete',
            target: { kind: 'flow', ref: 'demo-runner-flow' },
            agent: 'doc-updater',
            projects: ['gitpulse', 'betterado'],
          } as unknown as FlowTrigger,
        ],
      },
    ];

    await fireAgentCompleteTriggers(flows, 'doc-updater', { queueRoot: root });

    const staged = listFlowRunRequests({ queueRoot: root });
    assert.equal(staged.length, 1);
    const raw = staged[0].req as unknown as Record<string, unknown>;
    assert.deepEqual(
      raw['projects'],
      ['gitpulse', 'betterado'],
      `expected the staged request to carry the trigger's declared projects: — got ${JSON.stringify(raw)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
