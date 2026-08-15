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
  pollKbDrain,
  pollAgentFix,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_MAX_ATTEMPTS,
  type PolledAgentRunStatus,
  type PolledKbDrainStatus,
  type PolledAgentFixStatus,
} from './agent-dispatch';
import type { AgentRunStatus, KbDrainStatus, AgentFixStatus } from './studio-client';

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

// ---------------------------------------------------------------------------
// pollKbDrain (W6-B13) — same pollUntilTerminal core as pollAgentRun above,
// over the drain status shape. Only the parts that DIFFER from pollAgentRun's
// own coverage are re-asserted here (immediate fetch, interval cadence, and
// stop() are already proven generic by pollUntilTerminal — these tests focus
// on the drain-specific wiring: two-arg fetchStatus, terminal-state variety,
// and the explicit 'timed-out' state carrying the last real round/counts).
// ---------------------------------------------------------------------------

function drainStatus(overrides: Partial<KbDrainStatus> = {}): KbDrainStatus {
  return {
    ok: true, runId: 'kb-drain-1', kbId: 'forge-dev', state: 'running', round: 1,
    counts: { auto: 0, agent: 1, user: 0 }, perFinding: [], costUsd: 0,
    updatedAt: '2026-08-15T00:00:00.000Z', ...overrides,
  };
}

test('pollKbDrain: fetches immediately with (kbId, runId) and reports the first status via onUpdate', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(drainStatus({ round: 3 }));
  const onUpdate = vi.fn();
  const stop = pollKbDrain('forge-dev', 'kb-drain-1', { fetchStatus, onUpdate });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(fetchStatus).toHaveBeenCalledWith('forge-dev', 'kb-drain-1');
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'running', round: 3 }));
  stop();
});

test('pollKbDrain: stops polling once a terminal state ("green") is reached', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(drainStatus({ state: 'green', round: 2, counts: { auto: 0, agent: 0, user: 0 } }));
  const onUpdate = vi.fn();
  const stop = pollKbDrain('forge-dev', 'kb-drain-1', { fetchStatus, onUpdate, intervalMs: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'green' }));
  stop();
});

test('pollKbDrain: "needs-you" is ALSO a terminal state — no further polling once reached (a KB re-lint after the drain window would be a different call, not this poll)', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(drainStatus({ state: 'needs-you', round: 4 }));
  const onUpdate = vi.fn();
  const stop = pollKbDrain('forge-dev', 'kb-drain-1', { fetchStatus, onUpdate, intervalMs: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  stop();
});

test('pollKbDrain: reaching maxAttempts while still "running" emits an explicit "timed-out" status carrying the last real round/counts — the run keeps going server-side, this is only "the browser stopped watching"', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(drainStatus({ state: 'running', round: 2, counts: { auto: 0, agent: 3, user: 0 }, costUsd: 0.5 }));
  const onUpdate = vi.fn();
  const stop = pollKbDrain('forge-dev', 'kb-drain-1', { fetchStatus, onUpdate, intervalMs: 10, maxAttempts: 3 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  const finalCall = onUpdate.mock.calls.at(-1)?.[0] as PolledKbDrainStatus;
  expect(finalCall.state).toBe('timed-out');
  expect(finalCall.round).toBe(2);
  expect(finalCall.costUsd).toBe(0.5);
  const callsAtTimeout = fetchStatus.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchStatus).toHaveBeenCalledTimes(callsAtTimeout);
  stop();
});

test('pollKbDrain: the returned cleanup function stops all future polling', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(drainStatus());
  const onUpdate = vi.fn();
  const stop = pollKbDrain('forge-dev', 'kb-drain-1', { fetchStatus, onUpdate, intervalMs: 100 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  stop();
  const callsAtStop = fetchStatus.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetchStatus).toHaveBeenCalledTimes(callsAtStop);
});

// ---------------------------------------------------------------------------
// pollAgentFix (W6-B13) — the retired LintResolutionPanel.pollFix's
// replacement: same bounded/explicit-timeout mechanics, fixing sweep finding
// C9#2 (submitUser used to await a 45×2s poll that silently stayed
// 'running' forever past budget, re-enabling "Apply answer" with zero
// feedback).
// ---------------------------------------------------------------------------

function fixStatus(overrides: Partial<AgentFixStatus> = {}): AgentFixStatus {
  return { ok: true, state: 'running', cleared: false, ...overrides };
}

test('pollAgentFix: fetches immediately with (kbId, runId) and reports the first status', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(fixStatus({ state: 'cleared', cleared: true }));
  const onUpdate = vi.fn();
  const stop = pollAgentFix('forge-dev', 'fix-run-1', { fetchStatus, onUpdate });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(fetchStatus).toHaveBeenCalledWith('forge-dev', 'fix-run-1');
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'cleared', cleared: true }));
  stop();
});

test('pollAgentFix: exhausting the poll budget while still "running" emits an explicit "timed-out" state — never the old silent still-"running" forever (C9#2)', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(fixStatus({ state: 'running' }));
  const onUpdate = vi.fn();
  const stop = pollAgentFix('forge-dev', 'fix-run-1', { fetchStatus, onUpdate, intervalMs: 10, maxAttempts: 3 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  const finalCall = onUpdate.mock.calls.at(-1)?.[0] as PolledAgentFixStatus;
  expect(finalCall.state).toBe('timed-out');
  stop();
});

test('pollAgentFix: stops polling once "not-cleared" or "failed" is reached', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(fixStatus({ state: 'not-cleared' }));
  const onUpdate = vi.fn();
  const stop = pollAgentFix('forge-dev', 'fix-run-1', { fetchStatus, onUpdate, intervalMs: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  stop();
});
