/**
 * Port conformance for the flow runner (M2-B).
 *
 * `docs/roadmaps/1.0.md` §4 M2 Lane B and SPEC.md §2 Station say the runner
 * holds the port, not the phases: "A station is executed through
 * `PhaseExecutor { run(nodeId, ctx) → CycleOutcome }`. The runner imports no
 * phase." Each test below names the wrong implementation it kills — a test that
 * would look the same had the runner kept its phase imports proves nothing.
 *
 * These drive the REAL `runFlow` signature. The suites that predate the port
 * build it through `test-fixtures/flow-runner-port.ts` so their assertions could
 * stay untouched; this file is the one that would notice if that helper started
 * papering over a port that no longer works.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runFlow } from '@forge/flows/flow-runner.ts';
import { createPhaseExecutor, registeredBandIds } from '@forge/factory/phases/executor-table.ts';
import { BAND_GUARD_IDS } from '@forge/contracts';
import type { PhaseExecutor } from '@forge/kernel';
import type { NodeExecContext } from '@forge/flows/flow-node-context.ts';
import type { CycleInput } from '@forge/flows/cycle-context.ts';
import type { EventLogger } from '@forge/kernel';
import type { FlowDefinition } from '@forge/contracts/studio/types.ts';

function makeInput(): CycleInput {
  return {
    initiativeId: 'port-conformance',
    manifestPath: '/tmp/port/manifest.md',
    projectRepoPath: '/tmp/port/project',
    worktreePath: '/tmp/port/worktree',
    dryRun: true,
  };
}

function makeLogger(): EventLogger & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    logFilePath: '/tmp/port/events.jsonl',
    cycleId: 'port-cycle',
    emit(event: unknown) {
      events.push(event);
      return { ...(event as Record<string, unknown>), event_id: `evt-${events.length}` } as ReturnType<EventLogger['emit']>;
    },
  };
}

function makeFlow(nodes: FlowDefinition['nodes'], edges: FlowDefinition['edges'] = []): FlowDefinition {
  return {
    id: 'port-flow',
    name: 'Port Flow',
    version: 1,
    goal: 'exercise the PhaseExecutor port',
    project: null,
    kb: 'cycles',
    costCeilingUsd: 25,
    origin: 'seed',
    disposable: undefined,
    nodes,
    edges,
    triggers: [],
    path: '/fake/port-flow.yaml',
  };
}

test('runFlow drives every node through the injected PhaseExecutor — a stub that touches no phase still yields a CycleOutcome (kills: a runner that reaches a phase itself for any node kind, which is what the ten removed imports allowed)', async () => {
  const seen: string[] = [];
  const stub: PhaseExecutor<NodeExecContext> = {
    async run(nodeId) {
      seen.push(nodeId);
      return 'pr-open';
    },
  };

  const result = await runFlow({
    flow: makeFlow(
      [{ id: 'pm', agent: 'project-manager' }, { id: 'review', gate: 'verdict' }],
      [{ from: 'pm', to: 'review', artifact: 'work-items' }],
    ),
    input: makeInput(),
    logger: makeLogger(),
    executor: stub,
    projectGate: { runPreflight: () => { throw new Error('the stub flow must never reach the preflight'); } },
    runClosure: async () => { throw new Error('a flow that does not terminate early must never close'); },
  });

  assert.deepEqual(seen, ['pm', 'review'], 'every node executed through the port, in topological order');
  assert.equal(result.cycleOutcome, 'pr-open', 'the outcome the port returned is the outcome runFlow reports');
});

test('the port receives the resolved node kind and the shared mutable state, so an executor can steer the run without the runner knowing which phase ran (kills: a ctx that omits `kind`, forcing the runner to keep resolving phases itself)', async () => {
  const kinds: string[] = [];
  const stub: PhaseExecutor<NodeExecContext> = {
    async run(_nodeId, ctx) {
      kinds.push(ctx.kind);
      ctx.state.reflectionStatus = 'seen-by-the-port';
      return ctx.state.cycleOutcome;
    },
  };

  const result = await runFlow({
    flow: makeFlow([{ id: 'review', gate: 'verdict' }]),
    input: makeInput(),
    logger: makeLogger(),
    executor: stub,
    projectGate: { runPreflight: () => { throw new Error('unreachable'); } },
    runClosure: async () => { throw new Error('unreachable'); },
  });

  assert.deepEqual(kinds, ['review'], 'the runner resolved the node kind and handed it over on the context');
  assert.equal(result.reflectionStatus, 'seen-by-the-port', 'state the executor mutated is the state the runner reports');
});

test('a ProjectGate that refuses parks the flow at ready-for-review, and the runner never imports the real preflight (kills: an execOnboardPreflight that calls cli/preflight directly, which would ignore the injected gate)', async () => {
  const closures: string[] = [];
  const result = await runFlow({
    flow: makeFlow([{ id: 'contract-check', agent: 'contract-check' }]),
    input: makeInput(),
    logger: makeLogger(),
    executor: createPhaseExecutor(),
    runClosure: async (_i, _l, reviewerOutcome) => { closures.push(reviewerOutcome); return { outcome: 'ready-for-review', merged: false }; },
    projectGate: {
      runPreflight: () => ({
        projectDir: '/tmp/port/project',
        projectName: 'port',
        ok: false,
        clauses: [{ clause: 'C1', title: 'quality gate declared', hard: true, pass: false, detail: 'refused by the stub gate' }],
      }),
    },
  });

  assert.equal(result.cycleOutcome, 'ready-for-review', 'a refusing gate routes the manifest to ready-for-review');
  assert.deepEqual(closures, ['ready-for-review'], 'the closure ran exactly once, with the parked outcome');
});

test('a ProjectGate that PASSES lets the flow finish — the positive control that proves the gate is the injected one (kills: an execOnboardPreflight still calling cli/preflight, which fails on this synthetic project dir and would park the run, making the refusal test above pass by accident)', async () => {
  const closures: string[] = [];
  const result = await runFlow({
    flow: makeFlow([{ id: 'contract-check', agent: 'contract-check' }]),
    input: makeInput(),
    logger: makeLogger(),
    executor: createPhaseExecutor(),
    runClosure: async (_i, _l, reviewerOutcome) => { closures.push(reviewerOutcome); return { outcome: 'ready-for-review', merged: false }; },
    projectGate: {
      runPreflight: () => ({
        projectDir: '/tmp/port/project',
        projectName: 'port',
        ok: true,
        clauses: [{ clause: 'C1', title: 'quality gate declared', hard: true, pass: true, detail: 'green by the stub gate' }],
      }),
    },
  });

  assert.deepEqual(closures, [], 'a green gate parks nothing — no closure runs');
  assert.equal(result.cycleOutcome, 'ready-for-review', 'the run reaches its own terminal state, not the parked one');
});

test('the runner source imports no phase and no preflight — the exit row, asserted rather than trusted (kills: a re-export shim that keeps the import alive while the grep looks clean)', () => {
  // The runner now lives in the package; this test stayed at the assembly
  // because it builds a real executor. Resolve the subject through the same
  // specifier the rest of the file imports it by, never a sibling-file guess.
  const src = readFileSync(new URL('../../packages/flows/flow-runner.ts', import.meta.url), 'utf8');
  assert.equal((src.match(/from '\.\/phases\//g) ?? []).length, 0, "flow-runner.ts must import nothing from './phases/'");
  // The IMPORT form, not the word: the runner's own doc comment names
  // `packages/projects/preflight.ts` to explain why it does not import it, and a test that
  // failed on prose would push that explanation out of the file.
  assert.equal((src.match(/from '\.\.\/cli\/preflight/g) ?? []).length, 0, 'flow-runner.ts must not import the preflight');
});

test('every ratified band id is registered exactly once (kills: a band silently dropped in the move to the table, which would fall through to the generic agent path instead of failing)', () => {
  assert.deepEqual([...registeredBandIds()].sort(), [...BAND_GUARD_IDS].sort());
});

test('spend that happened BEFORE the runner existed is counted by the ceiling it is supposed to be bounded by — the architect through `priorSpendEvents` (kills: a tracker seeded at $0 that lets an architect spend the run\'s whole budget without any ceiling noticing)', async () => {
  const logger = makeLogger();
  const stub: PhaseExecutor<NodeExecContext> = { async run() { return 'pr-open'; } };

  // The flow ceiling is $25 (makeFlow). The architect's synthetic `architect.end`
  // carries $20 — 80% of it — so a tracker that counted it must warn, and one
  // seeded at zero cannot.
  const architectEnd = {
    event_id: 'a-end',
    initiative_id: 'port-conformance',
    phase: 'architect',
    skill: 'architect',
    event_type: 'end',
    message: 'architect.end',
    cost_usd: 20,
    metadata: {},
  } as never;

  await runFlow({
    flow: makeFlow([{ id: 'review', gate: 'verdict' }]),
    input: makeInput(),
    logger,
    executor: stub,
    projectGate: { runPreflight: () => { throw new Error('unreachable'); } },
    runClosure: async () => { throw new Error('unreachable'); },
    priorSpendEvents: [architectEnd],
  });

  const warn = (logger.events as Array<Record<string, unknown>>).find((e) => e['message'] === 'flow.cost-warn');
  assert.ok(warn, 'the architect\'s $20 against a $25 ceiling is 80% — the tracker must have counted it');
  assert.equal((warn!['metadata'] as Record<string, unknown>)['spentUsd'], 20);
});

test('the port is optional and additive: a run given no prior spend behaves exactly as before (kills: a runner that requires the new argument, which would break every existing caller)', async () => {
  const logger = makeLogger();
  const stub: PhaseExecutor<NodeExecContext> = { async run() { return 'pr-open'; } };

  await runFlow({
    flow: makeFlow([{ id: 'review', gate: 'verdict' }]),
    input: makeInput(),
    logger,
    executor: stub,
    projectGate: { runPreflight: () => { throw new Error('unreachable'); } },
    runClosure: async () => { throw new Error('unreachable'); },
  });

  assert.ok(!(logger.events as Array<Record<string, unknown>>).some((e) => e['message'] === 'flow.cost-warn'));
});
