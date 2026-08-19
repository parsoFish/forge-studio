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

test('enqueue while the scheduler is stopped → honest "nothing will run" claim + needsSchedulerStart', () => {
  const o = describeEnqueueOutcome('develop', { running: false }, enq);
  expect(o.claim).toBe('Enqueued — the scheduler is stopped, so nothing will run until you start it.');
  expect(o.needsSchedulerStart).toBe(true);
  // The link to the run the enqueue returned is kept even when nothing runs yet.
  expect(o.runHref).toBe('/flows/forge-develop/run/INIT-2026-08-18-add-version-flag');
});

// W7-FIX-A3 (A3-04): an UNREADABLE status is not "stopped". A failed read
// (bridge restart, transient 5xx — `useSchedulerStatus` hands the caller
// `status: null` with ready=true) must never assert the daemon is stopped —
// the SchedulerCardView strip mounted right beneath renders "unknown" with
// NO Start button, so a "stopped… start it" claim would contradict its own
// controls. Distinct copy, still mounts the strip (needsSchedulerStart).
test('enqueue while the scheduler status is UNKNOWN (null) → "could not confirm" claim, never "stopped"', () => {
  const o = describeEnqueueOutcome('develop', null, enq);
  expect(o.claim).toBe('Enqueued — could not confirm the scheduler is running; check its status below.');
  expect(o.claim).not.toMatch(/stopped/);
  expect(o.needsSchedulerStart).toBe(true);
  expect(o.runHref).toBe('/flows/forge-develop/run/INIT-2026-08-18-add-version-flag');
  // Stopped and unknown must NOT collapse into the same copy.
  expect(o.claim).not.toBe(describeEnqueueOutcome('develop', { running: false }, enq).claim);
});

// W7-FIX-A3 (A3-07): Stop is not a silent control. While the daemon drains
// (SIGTERM sent, pid still alive) the bridge reports `stopping: true`; the
// card renders that transitional state — the running hint ("Claiming queued
// work…") is FALSE during the drain, and no action is offered until the poll
// reports running:false.
test('running + stopping → "stopping" state, drain hint, NO actions (neither Pause nor a second Stop)', () => {
  const v = deriveSchedulerView({ running: true, pid: 4917, paused: false, stopping: true }, { queuedCount: 2 });
  expect(v.state).toBe('stopping');
  expect(v.label).toBe('Scheduler stopping');
  expect(v.hint).toBe('Draining in-flight runs, then exiting — nothing new is claimed.');
  expect(v.actions).toEqual([]);
});

test('stopping wins over paused while the pid is alive; a stopped daemon is never "stopping"', () => {
  expect(deriveSchedulerView({ running: true, paused: true, stopping: true }).state).toBe('stopping');
  expect(deriveSchedulerView({ running: false, stopping: true }).state).toBe('stopped');
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

// W7-FIX-A3 (round-2 finding 3): the DRAIN window is not "running" for the
// purposes of an enqueue claim. `stopping` rides on `running: true` (the pid
// is alive while in-flight cycles settle), so the running branch below used to
// promise "the scheduler will pick it up" for a run the daemon will never
// claim — it exits as soon as the drain finishes. Same dishonest-copy class
// A3-04 removed for the unreadable status.
test('enqueue while the scheduler is STOPPING → honest drain copy, never "will pick it up"', () => {
  const o = describeEnqueueOutcome('flow', { running: true, stopping: true }, enq);
  expect(o.claim).toBe('Enqueued — the scheduler is stopping, so nothing will be claimed until you start it again.');
  expect(o.claim).not.toMatch(/will pick it up|will decompose|will open a PR/);
  expect(o.needsSchedulerStart).toBe(true);
  expect(o.runHref).toBe('/flows/forge-develop/run/INIT-2026-08-18-add-version-flag');
});

test('stopping wins over paused in the enqueue claim (a draining daemon cannot be resumed into claiming)', () => {
  const o = describeEnqueueOutcome('plan', { running: true, paused: true, stopping: true }, enq);
  expect(o.claim).toBe('Enqueued — the scheduler is stopping, so nothing will be claimed until you start it again.');
  expect(o.claim).not.toMatch(/resume it/);
  expect(o.needsSchedulerStart).toBe(true);
});

test('stopping and stopped/unknown keep DISTINCT copy (no state collapses into another)', () => {
  const claims = [
    describeEnqueueOutcome('flow', { running: true, stopping: true }, enq).claim,
    describeEnqueueOutcome('flow', { running: false }, enq).claim,
    describeEnqueueOutcome('flow', null, enq).claim,
    describeEnqueueOutcome('flow', { running: true }, enq).claim,
  ];
  expect(new Set(claims).size).toBe(4);
});
