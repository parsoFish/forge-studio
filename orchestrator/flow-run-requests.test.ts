import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  stageFlowRunRequest,
  listFlowRunRequests,
  drainFlowRunRequests,
  flowRunsDir,
  type FlowRunRequest,
} from './flow-run-requests.ts';

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'flow-runs-'));
}

test('staged request lands in _queue/flow-runs/, NOT _queue/pending/ (no mis-claim)', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { flowId: 'forge-develop', origin: 'trigger', triggeredBy: 'forge-architect', sourceInitiativeId: 'INIT-2026-06-26-x' },
      { queueRoot: root },
    );
    assert.equal(existsSync(join(root, 'pending')), false, 'must not write into pending/');
    assert.equal(readdirSync(flowRunsDir(root)).length, 1);
    const reqs = listFlowRunRequests({ queueRoot: root });
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].req.flowId, 'forge-develop');
    assert.equal(reqs[0].req.sourceInitiativeId, 'INIT-2026-06-26-x');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain dispatches each request via injected startFlowRun, then removes it', () => {
  const root = setup();
  try {
    stageFlowRunRequest(
      { flowId: 'forge-develop', origin: 'trigger', triggeredBy: 'forge-architect', sourceInitiativeId: 'INIT-2026-06-26-a', createdAt: '2026-06-26T10-00-00' },
      { queueRoot: root },
    );
    const dispatched: FlowRunRequest[] = [];
    const results = drainFlowRunRequests({ queueRoot: root, startFlowRun: (r) => dispatched.push(r) });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].flowId, 'forge-develop');
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
      { flowId: 'some-flow', origin: 'trigger', triggeredBy: 'other', createdAt: '2026-06-26T11-00-00' },
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
      { flowId: 'forge-develop', origin: 'trigger', triggeredBy: 'x', sourceInitiativeId: 'INIT-2026-06-26-b', createdAt: '2026-06-26T12-00-00' },
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
