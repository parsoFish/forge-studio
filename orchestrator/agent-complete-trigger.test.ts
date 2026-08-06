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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listFlowRunRequests } from './flow-run-requests.ts';
import type { FlowTrigger } from './studio/types.ts';

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
