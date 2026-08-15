/**
 * Unit tests for `./agent-dispatch.ts` — the poll helper extracted from the
 * two hand-rolled, byte-identical `useEffect`+`setInterval` poll loops in
 * `components/studio/agent-builder/RunPanel.tsx` (lines ~153-169) and
 * `app/projects/[id]/page.tsx`'s `OnboardWithAgent` (lines ~575-590 — its
 * own comment admits the duplication: "Bounded like RunPanel."). Both loops
 * shared ONE silent defect: hitting the attempt ceiling while a run was
 * still `'running'` just stopped polling and left the stale `'running'`
 * status on screen forever — an operator watching the panel saw a run that
 * looked eternally in-flight with no signal the poll itself had given up.
 * `pollAgentRun` makes that condition an explicit `'timed-out'` state
 * instead, delivered through the same `onUpdate` callback both call sites
 * already render from. It also wraps the fetch in a try/catch: a throwing
 * `fetchStatus` counts as one failed attempt and keeps polling — never an
 * unhandled rejection.
 *
 * Pure logic, no DOM — testable with plain fake timers + an injected
 * `fetchStatus` (default: `getAgentRunStatus`, `./studio-client.ts`), no
 * jsdom needed (none is installed in this repo).
 *
 * RUN: npx vitest run lib/agent-dispatch.test.ts   (from forge-ui/)
 */

import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pollAgentRun,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_MAX_ATTEMPTS,
  type PolledAgentRunStatus,
} from './agent-dispatch';
import type { AgentRunStatus } from './studio-client';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function status(overrides: Partial<AgentRunStatus> = {}): AgentRunStatus {
  return { ok: true, state: 'running', costUsd: 0, events: 0, ...overrides };
}

test('pollAgentRun: fetches immediately and reports the first status via onUpdate, before any timer fires', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'running', events: 1 }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'running', events: 1 }));
  stop();
});

test('pollAgentRun: keeps polling at intervalMs while state stays "running"', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'running' }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 100, maxAttempts: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchStatus).toHaveBeenCalledTimes(3);
  stop();
});

test('pollAgentRun: stops polling once a terminal state ("done") is reached — no further fetchStatus calls', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'done', costUsd: 1.23, events: 4 }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 100 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'done', costUsd: 1.23, events: 4 }));
  stop();
});

test('pollAgentRun: reaching maxAttempts while still "running" emits an explicit "timed-out" status — never a silent freeze', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'running', costUsd: 0.5, events: 7 }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 10, maxAttempts: 3 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  // Drain every scheduled interval tick up to the ceiling.
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  const finalCall = onUpdate.mock.calls.at(-1)?.[0] as PolledAgentRunStatus;
  expect(finalCall.state).toBe('timed-out');
  // The last REAL poll's cost/events are preserved on the timed-out status —
  // a timeout must not also erase what was already known about the run.
  expect(finalCall.costUsd).toBe(0.5);
  expect(finalCall.events).toBe(7);
  // No further polling once timed out.
  const callsAtTimeout = fetchStatus.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchStatus).toHaveBeenCalledTimes(callsAtTimeout);
  stop();
});

test('pollAgentRun: the returned cleanup function stops all future polling and onUpdate calls', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'running' }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 100 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  stop();
  const callsAtStop = fetchStatus.mock.calls.length;
  const updatesAtStop = onUpdate.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetchStatus).toHaveBeenCalledTimes(callsAtStop);
  expect(onUpdate).toHaveBeenCalledTimes(updatesAtStop);
});

test('pollAgentRun: default interval/attempt-ceiling constants match the ~3-minute-at-2s bound both original call sites used', () => {
  expect(DEFAULT_POLL_INTERVAL_MS).toBe(2000);
  expect(DEFAULT_POLL_MAX_ATTEMPTS).toBe(90);
});

test('pollAgentRun: a throwing fetchStatus counts as a failed attempt and keeps polling — never an unhandled rejection', async () => {
  const fetchStatus = vi.fn()
    .mockRejectedValueOnce(new Error('network blip'))
    .mockResolvedValue(status({ state: 'done', costUsd: 2, events: 3 }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 10 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(onUpdate).not.toHaveBeenCalled(); // the throw itself reports no fabricated status
  await vi.advanceTimersByTimeAsync(10);
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'done', costUsd: 2, events: 3 }));
  stop();
});

test('pollAgentRun: an ALWAYS-throwing fetchStatus still gives up at maxAttempts with an explicit "timed-out" — bounded even with zero real status ever observed', async () => {
  const fetchStatus = vi.fn().mockRejectedValue(new Error('down'));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 10, maxAttempts: 3 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'timed-out' }));
  const callsAtTimeout = fetchStatus.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchStatus).toHaveBeenCalledTimes(callsAtTimeout); // no further polling
  stop();
});

test('pollAgentRun: with no fetchStatus override, the default resolves through the real studio-client getAgentRunStatus', async () => {
  const onUpdate = vi.fn();
  // No bridge configured in this unit-test environment -> the real
  // getAgentRunStatus degrades to its own honest 'unknown' fallback rather
  // than throwing (see studio-client.ts's own try/catch) — proving the
  // wiring reaches the real function without a jsdom/network dependency.
  const stop = pollAgentRun('run-1', { onUpdate, intervalMs: 100 });
  await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'unknown' }));
  stop();
});
