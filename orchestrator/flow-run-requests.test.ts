import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  stageFlowRunRequest,
  listFlowRunRequests,
  drainFlowRunRequests,
  flowRunsDir,
  type FlowRunRequest,
} from './flow-run-requests.ts';
import { getPaths } from './queue.ts';
import { serializeManifest, type InitiativeManifest } from './manifest.ts';

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'flow-runs-'));
}

/**
 * Seed a `_queue/pending/<id>.md` manifest with `origin: 'triggered'` +
 * `flow_id`, the shape `hasActiveTriggeredRun` scans for. Mirrors the field
 * set `mintTriggeredInitiative` writes (see mint-triggered-initiative.test.ts).
 */
function seedTriggeredManifest(queueRoot: string, id: string, flowId: string): void {
  const paths = getPaths(queueRoot);
  mkdirSync(paths.pending, { recursive: true });
  const manifest: InitiativeManifest = {
    initiative_id: id,
    project: 'someproj',
    project_repo_path: '/tmp/someproj',
    created_at: new Date().toISOString(),
    iteration_budget: 5,
    cost_budget_usd: 10,
    phase: 'pending',
    origin: 'triggered',
    flow_id: flowId,
    body: `# ${id}`,
  };
  writeFileSync(join(paths.pending, `${id}.md`), serializeManifest(manifest));
}

test('staged request lands in _queue/flow-runs/, NOT _queue/pending/ (no mis-claim)', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'forge-develop' }, origin: 'trigger', triggeredBy: 'forge-architect', sourceInitiativeId: 'INIT-2026-06-26-x' },
      { queueRoot: root },
    );
    assert.equal(existsSync(join(root, 'pending')), false, 'must not write into pending/');
    assert.equal(readdirSync(flowRunsDir(root)).length, 1);
    const reqs = listFlowRunRequests({ queueRoot: root });
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].req.target.ref, 'forge-develop');
    assert.equal(reqs[0].req.sourceInitiativeId, 'INIT-2026-06-26-x');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain dispatches each request via injected startFlowRun, then removes it', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'forge-develop' }, origin: 'trigger', triggeredBy: 'forge-architect', sourceInitiativeId: 'INIT-2026-06-26-a', createdAt: '2026-06-26T10-00-00' },
      { queueRoot: root },
    );
    const dispatched: FlowRunRequest[] = [];
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: (r) => dispatched.push(r) });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].target.ref, 'forge-develop');
    assert.equal(dispatched[0].sourceInitiativeId, 'INIT-2026-06-26-a');
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 0, 'dispatched request must be removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain drops a context-free request (no source initiative) without dispatching', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'some-flow' }, origin: 'trigger', triggeredBy: 'other', createdAt: '2026-06-26T11-00-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });
    assert.equal(called, false);
    assert.deepEqual(results.map((r) => r.status), ['skipped-no-initiative']);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain surfaces a dispatch error and leaves the request in place', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'forge-develop' }, origin: 'trigger', triggeredBy: 'x', sourceInitiativeId: 'INIT-2026-06-26-b', createdAt: '2026-06-26T12-00-00' },
      { queueRoot: root },
    );
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => { throw new Error('boom'); },
    });
    assert.equal(results[0].status, 'error');
    assert.match(results[0].detail ?? '', /boom/);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 1, 'failed request stays for the next sweep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty queue → drain returns []', () => {
  const root = setup();
  try {
    assert.deepEqual(drainFlowRunRequests({ queueRoot: root }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-041 §2 concurrency: origination requests are skipped when a prior
// `origin: 'triggered'` run of the SAME target flow is still active.
// ---------------------------------------------------------------------------

test('drain skips an origination request when a triggered run of the same flow is active (concurrency: forbid/omitted)', () => {
  const root = setup();
  try {
    seedTriggeredManifest(root, 'INIT-2026-07-25-webhook-tick-100000', 'tick');
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, false, 'startFlowRun must not be invoked');
    assert.deepEqual(results.map((r) => r.status), ['skipped-concurrency']);
    assert.equal(listFlowRunRequests({ queueRoot: root }).length, 0, 'the skipped request is removed, not left to retry forever');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain does NOT skip an origination request with concurrency: allow even when a triggered run is active', () => {
  const root = setup();
  try {
    seedTriggeredManifest(root, 'INIT-2026-07-25-webhook-tick-100000', 'tick');
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', concurrency: 'allow', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, true, 'startFlowRun must be invoked when concurrency is allow');
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain does NOT skip an origination request when no triggered run is active', () => {
  const root = setup();
  try {
    // No seeded manifest anywhere in the queue.
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, true);
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain does NOT skip an origination request when the active triggered run targets a DIFFERENT flow', () => {
  const root = setup();
  try {
    seedTriggeredManifest(root, 'INIT-2026-07-25-webhook-other-100000', 'other-flow');
    stageFlowRunRequest(
      { target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', createdAt: '2026-07-25T10-05-00' },
      { queueRoot: root },
    );
    let called = false;
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: () => { called = true; } });

    assert.equal(called, true, 'a triggered run of a different flow must not block this origination');
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
