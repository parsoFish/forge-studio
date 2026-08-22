/**
 * W8-A3 WI-3 — `flows-28`, `flows-49`, `flows-23`: the pure half of the run's
 * recovery controls.
 *
 * THE DEFECTS THESE KILL
 * ----------------------
 *  `flows-28` (S2): a failed run's only run-scoped control anywhere in the
 *  flows pillar was `[data-action="resume-run"]` on the monitor. `requeue` and
 *  `abandon` have existed in the bridge since the recovery routes landed
 *  (`POST /api/recovery/:id/{requeue,abandon}`) and had exactly one consumer —
 *  the project roadmap canvas. The flows pillar could not reach them.
 *
 *  `flows-49` (S2): Resume never disclosed what it does. The bridge's resume
 *  route calls `runRequeue(..., { resumeFromDemo: true })`, i.e. it re-enters
 *  the successor band at the DEMO node against the preserved branch — a
 *  materially different act from a fresh requeue, which wipes the worktree and
 *  branch and re-runs from the start. Two buttons that read "Resume" and
 *  "Requeue" with no further text are not a choice an operator can make.
 *
 *  `flows-23` (S2): a QUEUED run's page had no control and no status. The
 *  control a planned run needs is not run-scoped at all — it is the scheduler,
 *  which is the only thing that turns a queued manifest into a running one.
 *
 * The control set is DERIVED from the run's status on every read. There is no
 * field on a run saying which controls it offers, so there is nothing for a
 * writer to leave stale.
 */
import { test, expect } from 'vitest';

import { deriveRunControls, runAwaitsScheduler, RUN_CONTROL_ACTIONS } from './run-controls.ts';
import type { Run, RunStatus } from './studio-client.ts';

function run(status: RunStatus, over: Partial<Run> = {}): Run {
  return {
    id: '2026-08-03T01-16-00_INIT-2026-08-03-coupling',
    flowId: 'forge-develop',
    initiativeId: 'INIT-2026-08-03-coupling',
    initiative: 'coupling change',
    status,
    origin: 'architect',
    costUsd: 1.5,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: ['forge-develop'],
    ...over,
  };
}

test('flows-28: a FAILED run offers resume, requeue AND abandon — not Resume alone', () => {
  const ids = deriveRunControls(run('failed')).map((c) => c.id);
  expect(ids).toEqual(['resume', 'requeue', 'abandon']);
});

test('flows-28: every control names the bridge action it drives, and abandon is the destructive one', () => {
  const controls = deriveRunControls(run('failed'));
  expect(controls.map((c) => c.action)).toEqual(['resume-run', 'requeue-run', 'abandon-run']);
  expect(controls.filter((c) => c.destructive).map((c) => c.id)).toEqual(['abandon']);
  // RUN_CONTROL_ACTIONS is what the DOM contract and the journeys key on.
  expect(RUN_CONTROL_ACTIONS).toEqual(['resume-run', 'requeue-run', 'abandon-run']);
});

test('flows-49: resume and requeue disclose that they are DIFFERENT acts', () => {
  const byId = Object.fromEntries(deriveRunControls(run('failed')).map((c) => [c.id, c]));
  // The resume route is `runRequeue(..., { resumeFromDemo: true })`: it re-enters
  // at the demo node against the preserved branch.
  expect(byId.resume.detail).toMatch(/demo/i);
  expect(byId.resume.detail).toMatch(/preserv/i);
  // A fresh requeue wipes the worktree + branch and re-runs from the start.
  expect(byId.requeue.detail).toMatch(/from the start|fresh/i);
  expect(byId.abandon.detail).toMatch(/worktree|branch/i);
  // Two controls whose disclosure is identical would be no disclosure at all.
  expect(byId.resume.detail).not.toBe(byId.requeue.detail);
});

test('flows-28: a run that has not failed offers no recovery control at all', () => {
  for (const status of ['planned', 'active', 'gated', 'complete'] as RunStatus[]) {
    expect(deriveRunControls(run(status)), status).toEqual([]);
  }
  expect(deriveRunControls(null)).toEqual([]);
});

test('flows-23: a QUEUED run awaits the scheduler — that, not a run-scoped button, is its control', () => {
  expect(runAwaitsScheduler(run('planned'))).toBe(true);
  for (const status of ['active', 'gated', 'complete', 'failed'] as RunStatus[]) {
    expect(runAwaitsScheduler(run(status)), status).toBe(false);
  }
  expect(runAwaitsScheduler(null)).toBe(false);
});

test('the control set is derived per read — the same run object answers by its CURRENT status only', () => {
  const failed = run('failed');
  expect(deriveRunControls(failed)).toHaveLength(3);
  expect(deriveRunControls({ ...failed, status: 'complete' })).toEqual([]);
});
