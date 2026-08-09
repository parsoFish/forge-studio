/**
 * ACCEPTANCE TEST (T3, forge-76y) — fixture-parity pin.
 *
 * T1 RULING binds scope: ONLY arm 1 of `deriveTriggerFields`'s cron branch
 * (orchestrator/mint-triggered-initiative.ts:95 —
 * `sourceFlowId ?? parse(triggeredBy)`) is the target of this defect. Arm 2
 * (mint-triggered-initiative.ts:99 — `req.triggerKind ?? req.origin`) is
 * load-bearing and stays untouched; the second companion test below
 * documents why (a real cron fire never sets `triggerKind` at all, so it can
 * never supersede the `origin` fallback).
 *
 * THE DEFECT: the hand-built cron `FlowRunRequest` literal used as a test
 * fixture in cli/bridge-studio-triggers.test.ts:155-165 ("current hand-built
 * shape") does NOT carry the same field set a REAL cron fire actually
 * stages via `stageFlowRunRequest` (orchestrator/cron-triggers.ts's
 * `makeFireFn`, lines 154-172). The hand-built literal is missing
 * `sourceFlowId`, `concurrency`, `projects`, and `eventProject` — fields the
 * real staging site always sets for a scoped, sourced cron trigger. Any
 * fixture builder that copies that literal's shape silently produces
 * unrealistic requests that never exercise `deriveTriggerFields`'s
 * `sourceFlowId` arm (arm 1) at all.
 *
 * This test drives a REAL cron fire — `syncCronTriggers` + `job.trigger()`,
 * mirroring the real-path pattern in orchestrator/cron-triggers.test.ts's
 * "a fire stages a flow-run request" test (lines 169-210) — and diffs the
 * staged request's field-path set against the hand-built literal replicated
 * VERBATIM below. cli/bridge-studio-triggers.test.ts itself is NOT modified;
 * this is a read-only parity copy for comparison only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cron } from 'croner';

import { syncCronTriggers, stopAllCronTriggers } from './cron-triggers.ts';
import { flowRunsDir } from './flow-run-requests.ts';
import type { FlowRunRequest } from './flow-run-requests.ts';

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'flow-run-fixture-parity-'));
}

// 6-field (seconds-precision) pattern croner supports, fired deterministically
// via job.trigger() rather than waiting on the wall clock — same constant
// cron-triggers.test.ts uses for its real-fire test.
const EVERY_SECOND_CRON = '* * * * * *';

/**
 * Mirrors cron-triggers.test.ts's `writeFlow`, but with a non-null `project`
 * binding AND a `projects:` scoping row on the trigger declaration — so the
 * real fire exercises every field the fixture-parity gap concerns
 * (sourceFlowId, concurrency, projects, eventProject all get set, not just
 * the always-on `concurrency` default).
 */
function writeFlow(forgeRoot: string, flowId: string, projectId: string): void {
  const dir = join(forgeRoot, 'studio', 'flows', flowId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'flow.yaml'),
    `id: ${flowId}
name: ${flowId}
version: 1
goal: Test fixture.
project: ${projectId}
kb: null
costCeilingUsd: 5
origin: seed
nodes:
  - { id: dev, agent: developer-ralph }
edges: []
triggers:
  - { on: cron, schedule: '${EVERY_SECOND_CRON}', target: { kind: flow, ref: downstream }, projects: ['${projectId}'] }
`,
  );
}

/**
 * Recursively enumerate field paths present on a plain-object JSON value.
 * Arrays are treated as opaque leaves (the parity concern is WHICH fields
 * exist, not array internals) and any path in `exclude` is dropped. Used to
 * compare field SETS between the real staged request and the hand-built
 * fixture literal, independent of value/timing differences.
 */
function fieldPaths(obj: unknown, exclude: Set<string>, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return [];
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (exclude.has(path)) continue;
    out.push(path);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...fieldPaths(v, exclude, path));
    }
  }
  return out.sort();
}

// Fields whose VALUES are timing-derived (wall-clock) and therefore excluded
// from the parity comparison — the pin is about field SET parity, not value
// equality of timestamps that can never match across two independent calls.
const TIMING_FIELDS = new Set(['createdAt', 'payload.firedAt']);

/**
 * Fire a real cron trigger for `flowId`/`projectId` and return the single
 * staged FlowRunRequest it produced. Asserts the fixture precondition
 * (exactly one staged file) BEFORE returning/reading its content, per the
 * no-false-negative rule: a fire that silently failed to stage anything
 * must fail loudly here, not surface as a confusing downstream assertion.
 */
async function fireRealCronAndCaptureStaged(
  forgeRoot: string,
  queueRoot: string,
  armed: Map<string, Cron>,
  flowId: string,
  projectId: string,
): Promise<FlowRunRequest> {
  writeFlow(forgeRoot, flowId, projectId);
  const result = syncCronTriggers({ forgeRoot, queueRoot, armed });
  assert.equal(result.armed.length, 1, `expected exactly one armed cron trigger, got: ${JSON.stringify(result)}`);
  const job = armed.get(result.armed[0])!;

  // The SAME production path the scheduler arms — fired deterministically.
  await job.trigger();

  const dir = flowRunsDir(queueRoot);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1, `expected exactly one staged flow-run request, got: ${JSON.stringify(files)}`);
  return JSON.parse(readFileSync(join(dir, files[0]), 'utf8')) as FlowRunRequest;
}

test('RED pin — real cron-fired FlowRunRequest field set diverges from the hand-built fixture literal', async () => {
  const forgeRoot = setup();
  const queueRoot = setup();
  const armed = new Map<string, Cron>();
  try {
    const staged = await fireRealCronAndCaptureStaged(forgeRoot, queueRoot, armed, 'flow-fixture-parity', 'demo-project');

    // Sanity: this really is the cron fire we just triggered.
    assert.equal(staged.origin, 'cron');
    assert.equal(staged.triggeredBy, 'cron:flow-fixture-parity');

    // --- the hand-built literal, replicated VERBATIM from
    // cli/bridge-studio-triggers.test.ts:155-165 ("current hand-built
    // shape"). That file is NOT modified — this is a read-only parity copy.
    const handBuiltFixtureLiteral: FlowRunRequest = {
      target: { kind: 'flow', ref: 'worker-triggered' },
      origin: 'cron',
      triggeredBy: 'cron:watcher-triggered',
      payload: { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };

    const realFields = fieldPaths(staged, TIMING_FIELDS);
    const fixtureFields = fieldPaths(handBuiltFixtureLiteral, TIMING_FIELDS);

    assert.deepEqual(
      realFields,
      fixtureFields,
      `field-set parity gap: a REAL cron fire stages ${JSON.stringify(realFields)} but the hand-built ` +
        `fixture literal (cli/bridge-studio-triggers.test.ts:155-165) only carries ${JSON.stringify(fixtureFields)} — ` +
        `missing from the fixture: ${JSON.stringify(realFields.filter((f) => !fixtureFields.includes(f)))}`,
    );
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(queueRoot, { recursive: true, force: true });
  }
});

test('companion (not independently RED) — a real cron fire always carries sourceFlowId', async () => {
  const forgeRoot = setup();
  const queueRoot = setup();
  const armed = new Map<string, Cron>();
  try {
    const staged = await fireRealCronAndCaptureStaged(forgeRoot, queueRoot, armed, 'flow-source-invariant', 'demo-project');

    // The invariant `deriveTriggerFields`'s arm 1 depends on and the fixture
    // builder (implement phase) must preserve: a real cron fire's staged
    // request always resolves `sourceFlowId` to the declaring flow id.
    assert.equal(
      staged.sourceFlowId,
      'flow-source-invariant',
      `expected sourceFlowId to be set to the declaring flow id, got: ${JSON.stringify(staged)}`,
    );
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(queueRoot, { recursive: true, force: true });
  }
});

test('companion (not independently RED) — triggerKind is ABSENT on real cron fires (documents why arm 2 stays)', async () => {
  const forgeRoot = setup();
  const queueRoot = setup();
  const armed = new Map<string, Cron>();
  try {
    const staged = await fireRealCronAndCaptureStaged(forgeRoot, queueRoot, armed, 'flow-no-trigger-kind', 'demo-project');

    // cron-triggers.ts's makeFireFn never sets `triggerKind` on the staged
    // request (only webhook/agent-complete origins ever would) — so
    // mint-triggered-initiative.ts:99's `req.triggerKind ?? req.origin`
    // fallback arm is the ONLY way a cron-originated Run.trigger.kind is
    // ever populated. That arm is out of T1's ruled scope for this defect
    // and must not be collapsed away by any fix to arm 1.
    assert.equal(
      'triggerKind' in staged,
      false,
      `expected a real cron fire to never set triggerKind, got: ${JSON.stringify(staged)}`,
    );
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(queueRoot, { recursive: true, force: true });
  }
});
