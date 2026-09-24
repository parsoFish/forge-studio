/**
 * forge-6gv.13.1 (projects-42) — `onboardReattachIsLive`
 * (components/studio/project-builder/OnboardWithAgent.tsx), pure and
 * render-independent (same reason `onboardLaunchState` is, per that
 * function's own doc comment): whether a reattach's raw `phase: 'running'`
 * means the run is ACTUALLY still live, once the server's honestly-derived
 * `lifecycle` companion is folded in.
 *
 * Killed implementation: `OnboardWithAgent` trusting `r.phase === 'running'`
 * alone — a LEAKED run (dispatch process died, no terminal marker ever
 * written) read 'running' forever with nothing to contradict it.
 *
 * RUN: npx vitest run apps/studio/tests/unit/onboard-reattach-is-live.test.ts   (from apps/studio/)
 */
import { test, expect } from 'vitest';

import { onboardReattachIsLive } from '../../components/studio/project-builder/OnboardWithAgent';
import type { SessionLifecycle } from '../../lib/session-lifecycle-client';

function lifecycle(state: SessionLifecycle['state']): SessionLifecycle {
  return { state, needsYou: false, error: null, idleMs: null, cancellable: true };
}

test('projects-42: a non-"running" phase is never live, whatever the lifecycle says', () => {
  expect(onboardReattachIsLive('complete', lifecycle('terminal'))).toBe(false);
  expect(onboardReattachIsLive(null, null)).toBe(false);
});

test('projects-42: phase "running" with no lifecycle (an older/degraded response) stays live — the honest unknown, never worse than the pre-fix blind trust', () => {
  expect(onboardReattachIsLive('running', null)).toBe(true);
});

test('projects-42: phase "running" + lifecycle "working" is live — the ordinary in-flight case', () => {
  expect(onboardReattachIsLive('running', lifecycle('working'))).toBe(true);
});

test('projects-42 (the leaked-run fix): phase "running" + lifecycle "stalled" is NOT live — a dead process past the stall ceiling must not read as live', () => {
  expect(onboardReattachIsLive('running', lifecycle('stalled'))).toBe(false);
});

test('projects-42: phase "running" + lifecycle "crashed" is NOT live', () => {
  expect(onboardReattachIsLive('running', lifecycle('crashed'))).toBe(false);
});
