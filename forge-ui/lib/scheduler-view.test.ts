/**
 * W7-A3 (flows-01 / flows-23 / projects-16 / projects-17 / projects-32) —
 * pinned contract for `scheduler-view.ts`, the pure derivation behind the
 * SchedulerCard and every "enqueued — now what?" success line.
 *
 * Kills:
 *  - a card that offers Start while the daemon is running (or Pause while it
 *    is stopped) — actions are derived from `running`/`paused`, never a
 *    fixed button row;
 *  - a null status rendered as "stopped" (fail-open): unknown is its own
 *    state with NO actions;
 *  - an enqueue success line that claims "started"/"building" while the
 *    scheduler is stopped, or that still names the retired unifier phase;
 *  - a run link that drops the run the enqueue just returned, or one keyed on
 *    the CYCLE id (dead until the scheduler claims — the initiative id is the
 *    stable handle the bridge resolves in every queue state).
 */
import { test, expect } from 'vitest';

import { deriveSchedulerView, describeEnqueueOutcome } from './scheduler-view.ts';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

test('null status → unknown, no actions (fail-closed: never offer a control we cannot honour)', () => {
  const v = deriveSchedulerView(null);
  expect(v.state).toBe('unknown');
  expect(v.label).toBe('Scheduler status unknown');
  expect(v.hint).toBe('Could not read the scheduler from the bridge.');
  expect(v.actions).toEqual([]);
});

test('running → pause+stop only (never a Start button while running)', () => {
  const v = deriveSchedulerView({ running: true, pid: 4917, paused: false });
  expect(v.state).toBe('running');
  expect(v.label).toBe('Scheduler running');
  expect(v.hint).toBe('Claiming queued work as it arrives.');
  expect(v.actions).toEqual(['pause', 'stop']);
  expect(v.actions).not.toContain('start');
});

test('running + queued count → the hint names the count (singular/plural)', () => {
  expect(deriveSchedulerView({ running: true }, { queuedCount: 1 }).hint).toBe('Claiming queued work — 1 queued run.');
  expect(deriveSchedulerView({ running: true }, { queuedCount: 3 }).hint).toBe('Claiming queued work — 3 queued runs.');
});

test('running + paused → paused state, resume+stop', () => {
  const v = deriveSchedulerView({ running: true, pid: 1, paused: true });
  expect(v.state).toBe('paused');
  expect(v.label).toBe('Scheduler paused');
  expect(v.hint).toBe('In-flight runs keep going; nothing new is claimed.');
  expect(v.actions).toEqual(['resume', 'stop']);
});

test('stopped → start only; a stale paused flag does not turn a stopped daemon into "paused"', () => {
  const v = deriveSchedulerView({ running: false, paused: true });
  expect(v.state).toBe('stopped');
  expect(v.label).toBe('Scheduler stopped');
  expect(v.hint).toBe('Queued work will not run until you start it.');
  expect(v.actions).toEqual(['start']);
});

test('stopped + queued count → the hint says the queued runs will NOT start (honest, not "started")', () => {
  expect(deriveSchedulerView({ running: false }, { queuedCount: 1 }).hint).toBe('1 queued run will not start until the scheduler runs.');
  expect(deriveSchedulerView({ running: false }, { queuedCount: 2 }).hint).toBe('2 queued runs will not start until the scheduler runs.');
});

// ---- describeEnqueueOutcome ------------------------------------------------

const enq = { runId: 'INIT-2026-08-18-add-version-flag', flowId: 'forge-develop' };

test('enqueue while the scheduler runs → the kind-specific claim, no start needed, run href carries flow AND the stable run handle', () => {
  const dev = describeEnqueueOutcome('develop', { running: true, paused: false }, enq);
  expect(dev.claim).toBe('Development enqueued — the develop flow will open a PR for review.');
  expect(dev.needsSchedulerStart).toBe(false);
  expect(dev.runHref).toBe('/flows/forge-develop/run/INIT-2026-08-18-add-version-flag');

  const plan = describeEnqueueOutcome('plan', { running: true }, { runId: 'INIT-2026-01-01-a', flowId: 'forge-architect' });
  expect(plan.claim).toBe('Planning enqueued — the scheduler will decompose it into work items.');
  expect(plan.runHref).toBe('/flows/forge-architect/run/INIT-2026-01-01-a');

  const flow = describeEnqueueOutcome('flow', { running: true }, { flowId: 'my-flow' });
  expect(flow.claim).toBe('Run enqueued — the scheduler will pick it up.');
  expect(flow.runHref).toBe('/flows/my-flow');
});

test('enqueue while the scheduler is stopped (or unknown) → honest "nothing will run" claim + needsSchedulerStart', () => {
  for (const scheduler of [{ running: false }, null]) {
    const o = describeEnqueueOutcome('develop', scheduler, enq);
    expect(o.claim).toBe('Enqueued — the scheduler is stopped, so nothing will run until you start it.');
    expect(o.needsSchedulerStart).toBe(true);
    // The link to the run the enqueue returned is kept even when nothing runs yet.
    expect(o.runHref).toBe('/flows/forge-develop/run/INIT-2026-08-18-add-version-flag');
  }
});

test('enqueue while paused → kind claim + paused rider, no start needed', () => {
  const o = describeEnqueueOutcome('plan', { running: true, paused: true }, { runId: 'INIT-2026-01-01-c', flowId: 'forge-architect' });
  expect(o.claim).toBe('Planning enqueued — the scheduler will decompose it into work items. The scheduler is paused — resume it to let this run start.');
  expect(o.needsSchedulerStart).toBe(false);
});

test('no flow/cycle in the result → runHref null (never a fabricated link)', () => {
  expect(describeEnqueueOutcome('develop', { running: true }, {}).runHref).toBeNull();
});

test('the retired unifier phase is never named (projects-17)', () => {
  const src = readFileSync(join(HERE, 'scheduler-view.ts'), 'utf8');
  expect(src.toLowerCase()).not.toContain('unifier');
});
