import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cron } from 'croner';

import { syncCronTriggers, stopAllCronTriggers } from './cron-triggers.ts';
import { flowRunsDir } from './flow-run-requests.ts';

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'cron-triggers-'));
}

/** Minimal valid flow.yaml (registry.ts required fields) with a single node
 *  and, optionally, the triggers block a test wants to exercise. */
function writeFlow(forgeRoot: string, flowId: string, triggersYaml: string): void {
  const dir = join(forgeRoot, 'studio', 'flows', flowId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'flow.yaml'),
    `id: ${flowId}
name: ${flowId}
version: 1
goal: Test fixture.
project: null
kb: null
costCeilingUsd: 5
origin: seed
nodes:
  - { id: dev, agent: developer-ralph }
edges: []
${triggersYaml}
`,
  );
}

// A schedule (5-field, once-a-year) that will not fire during a test run —
// used for the arm/no-rearm/stop assertions, which only care about the armed
// register's bookkeeping, never an actual firing.
const FAR_FUTURE_CRON = '0 0 1 1 *';
// A 6-field (seconds-precision) pattern croner supports, fired deterministically
// via job.trigger() rather than waiting on the wall clock.
const EVERY_SECOND_CRON = '* * * * * *';

test('sync arms a declared cron trigger', () => {
  const forgeRoot = setup();
  const armed = new Map<string, Cron>();
  try {
    writeFlow(
      forgeRoot,
      'flow-a',
      `triggers:\n  - { on: cron, schedule: '${FAR_FUTURE_CRON}', target: { kind: flow, ref: other } }\n`,
    );
    const result = syncCronTriggers({ forgeRoot, armed });
    assert.deepEqual(result.armed, ['flow-a#0#0 0 1 1 *#flow:other']);
    assert.deepEqual(result.stopped, []);
    assert.equal(result.active, 1);
    assert.equal(armed.size, 1);
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('re-sync with an unchanged declaration does not re-arm', () => {
  const forgeRoot = setup();
  const armed = new Map<string, Cron>();
  try {
    writeFlow(
      forgeRoot,
      'flow-a',
      `triggers:\n  - { on: cron, schedule: '${FAR_FUTURE_CRON}', target: { kind: flow, ref: other } }\n`,
    );
    const first = syncCronTriggers({ forgeRoot, armed });
    const jobBefore = armed.get(first.armed[0]);

    const second = syncCronTriggers({ forgeRoot, armed });

    assert.deepEqual(second.armed, [], 'unchanged declaration must not be re-armed');
    assert.deepEqual(second.stopped, []);
    assert.equal(second.active, 1, 'active count is stable across the no-op resync');
    assert.equal(armed.get(first.armed[0]), jobBefore, 'the SAME Cron instance stays armed (no churn)');
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('removing a declared trigger stops its armed job', () => {
  const forgeRoot = setup();
  const armed = new Map<string, Cron>();
  try {
    writeFlow(
      forgeRoot,
      'flow-a',
      `triggers:\n  - { on: cron, schedule: '${FAR_FUTURE_CRON}', target: { kind: flow, ref: other } }\n`,
    );
    const first = syncCronTriggers({ forgeRoot, armed });
    const key = first.armed[0];
    const job = armed.get(key)!;
    assert.equal(job.isStopped(), false);

    // Re-declare the flow with no triggers — the cron row is gone.
    writeFlow(forgeRoot, 'flow-a', 'triggers: []\n');
    const second = syncCronTriggers({ forgeRoot, armed });

    assert.deepEqual(second.stopped, [key]);
    assert.equal(armed.has(key), false);
    assert.equal(second.active, 0);
    assert.equal(job.isStopped(), true, 'the removed job is actually stopped, not just forgotten');
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('an invalid schedule notifies and is skipped, never throws', () => {
  const forgeRoot = setup();
  const armed = new Map<string, Cron>();
  const notified: string[] = [];
  try {
    writeFlow(
      forgeRoot,
      'flow-bad',
      `triggers:\n  - { on: cron, schedule: 'not-a-cron-pattern', target: { kind: flow, ref: other } }\n`,
    );
    let result: ReturnType<typeof syncCronTriggers> | undefined;
    assert.doesNotThrow(() => {
      result = syncCronTriggers({ forgeRoot, armed, notify: (m) => notified.push(m) });
    });
    assert.deepEqual(result!.armed, []);
    assert.equal(result!.active, 0);
    assert.equal(armed.size, 0);
    assert.ok(
      notified.some((m) => m.includes('flow-bad') && m.includes('invalid cron schedule')),
      `expected an invalid-schedule notification, got: ${JSON.stringify(notified)}`,
    );
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a broken flow.yaml is skipped (notified) without killing the sweep for other flows', () => {
  const forgeRoot = setup();
  const armed = new Map<string, Cron>();
  const notified: string[] = [];
  try {
    // flow-broken has no "id" field — loadFlowDefinition throws.
    mkdirSync(join(forgeRoot, 'studio', 'flows', 'flow-broken'), { recursive: true });
    writeFileSync(join(forgeRoot, 'studio', 'flows', 'flow-broken', 'flow.yaml'), 'not: a valid flow\n');
    writeFlow(
      forgeRoot,
      'flow-ok',
      `triggers:\n  - { on: cron, schedule: '${FAR_FUTURE_CRON}', target: { kind: flow, ref: other } }\n`,
    );

    const result = syncCronTriggers({ forgeRoot, armed, notify: (m) => notified.push(m) });

    assert.equal(result.active, 1, 'flow-ok still arms despite flow-broken failing to load');
    assert.ok(notified.some((m) => m.includes('flow-broken')));
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a fire stages a flow-run request (origin cron, payload.kind cron) and calls onFire', async () => {
  const forgeRoot = setup();
  const queueRoot = setup();
  const armed = new Map<string, Cron>();
  let onFireCalls = 0;
  try {
    writeFlow(
      forgeRoot,
      'flow-fast',
      `triggers:\n  - { on: cron, schedule: '${EVERY_SECOND_CRON}', target: { kind: flow, ref: downstream } }\n`,
    );
    const result = syncCronTriggers({
      forgeRoot,
      queueRoot,
      armed,
      onFire: () => {
        onFireCalls += 1;
      },
    });
    assert.equal(result.armed.length, 1);
    const job = armed.get(result.armed[0])!;

    await job.trigger();

    assert.equal(onFireCalls, 1);
    const dir = flowRunsDir(queueRoot);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'exactly one flow-run request staged');
    const staged = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
    assert.equal(staged.origin, 'cron');
    assert.equal(staged.triggeredBy, 'cron:flow-fast');
    assert.equal(staged.target.kind, 'flow');
    assert.equal(staged.target.ref, 'downstream');
    assert.equal(staged.payload.kind, 'cron');
    assert.equal(staged.payload.schedule, EVERY_SECOND_CRON);
    assert.equal(typeof staged.payload.firedAt, 'string');
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(queueRoot, { recursive: true, force: true });
  }
});

test('stopAllCronTriggers stops every job and clears the register', () => {
  const forgeRoot = setup();
  const armed = new Map<string, Cron>();
  try {
    writeFlow(
      forgeRoot,
      'flow-a',
      `triggers:\n  - { on: cron, schedule: '${FAR_FUTURE_CRON}', target: { kind: flow, ref: other } }\n`,
    );
    syncCronTriggers({ forgeRoot, armed });
    assert.equal(armed.size, 1);
    const job = [...armed.values()][0];

    stopAllCronTriggers(armed);

    assert.equal(armed.size, 0);
    assert.equal(job.isStopped(), true);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
