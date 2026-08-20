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
  pollPreflightFix,
  pollDisplayState,
  pollUntilTerminal,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_MAX_ATTEMPTS,
  type PolledAgentRunStatus,
  type PolledKbDrainStatus,
  type PolledAgentFixStatus,
  type PolledPreflightFixStatus,
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

test('pollAgentFix: "unmount mid-poll" — calling the returned stop fn while still "running" makes NO further fetch calls (review round MEDIUM: KbDrainPanel.tsx now stores this exact stop fn in a ref and calls it from the SAME unmount-cleanup effect the runId poll already uses — this pins the underlying mechanism that fix relies on: a still-running poll, once stopped, genuinely produces zero further fetchStatus calls, not just zero further onUpdate calls)', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(fixStatus({ state: 'running' }));
  const onUpdate = vi.fn();
  const stop = pollAgentFix('forge-dev', 'fix-run-1', { fetchStatus, onUpdate, intervalMs: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  // Simulate the component unmounting WHILE the poll is still 'running' (the
  // exact scenario the discarded-stop-fn defect covered: an operator submits
  // a user-tier answer, then navigates away before it clears).
  stop();
  const callsAtUnmount = fetchStatus.mock.calls.length;
  const updatesAtUnmount = onUpdate.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetchStatus).toHaveBeenCalledTimes(callsAtUnmount);
  expect(onUpdate).toHaveBeenCalledTimes(updatesAtUnmount);
});

// ---------------------------------------------------------------------------
// pollPreflightFix (W6-B14) — ContractResolutionPanel.tsx's `submitUser` used
// to `await` a hand-rolled 45×2s loop DIRECTLY in the click handler, so its
// result was simply discarded on nav-away, and the ceiling was never
// surfaced as an explicit state (the same bug class W6-B13 already fixed
// three times over — pollAgentRun/pollKbDrain/pollAgentFix).
// ---------------------------------------------------------------------------

function preflightFixStatus(overrides: Partial<PolledPreflightFixStatus> = {}): PolledPreflightFixStatus {
  return { ok: true, state: 'running', cleared: false, ...overrides };
}

test('pollPreflightFix: fetches immediately with (projectId, runId) and reports the first status', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(preflightFixStatus({ state: 'cleared', cleared: true }));
  const onUpdate = vi.fn();
  const stop = pollPreflightFix('gitpulse', 'pf-run-1', { fetchStatus, onUpdate });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(fetchStatus).toHaveBeenCalledWith('gitpulse', 'pf-run-1');
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'cleared', cleared: true }));
  stop();
});

test('pollPreflightFix: exhausting the poll budget while still "running" emits an explicit "timed-out" state — never a silent freeze', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(preflightFixStatus({ state: 'running' }));
  const onUpdate = vi.fn();
  const stop = pollPreflightFix('gitpulse', 'pf-run-1', { fetchStatus, onUpdate, intervalMs: 10, maxAttempts: 3 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  const finalCall = onUpdate.mock.calls.at(-1)?.[0] as PolledPreflightFixStatus;
  expect(finalCall.state).toBe('timed-out');
  stop();
});

test('pollPreflightFix: stops polling once "not-cleared" or "failed" is reached', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(preflightFixStatus({ state: 'not-cleared' }));
  const onUpdate = vi.fn();
  const stop = pollPreflightFix('gitpulse', 'pf-run-1', { fetchStatus, onUpdate, intervalMs: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  stop();
});

test('pollPreflightFix: "unmount mid-poll" — calling the returned stop fn makes NO further fetch calls, matching pollAgentFix\'s own unmount contract', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(preflightFixStatus({ state: 'running' }));
  const onUpdate = vi.fn();
  const stop = pollPreflightFix('gitpulse', 'pf-run-1', { fetchStatus, onUpdate, intervalMs: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  stop();
  const callsAtUnmount = fetchStatus.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetchStatus).toHaveBeenCalledTimes(callsAtUnmount);
});

// ---------------------------------------------------------------------------
// pollDisplayState (W6-B14) — the ONE shared derivation every fixed poll
// surface uses to render the three-state operator-intent contract
// (`data-poll-state="watching|timed-out|terminal"`): watching while
// 'running', an explicit 'timed-out' (never silence), and every other real
// outcome collapsed to 'terminal'. `null` (no run yet) is its own, 4th,
// pre-dispatch case — callers render idle and omit the attribute.
// ---------------------------------------------------------------------------

test('pollDisplayState: null/undefined (no run dispatched yet) -> null, never a fabricated state', () => {
  expect(pollDisplayState(null)).toBeNull();
  expect(pollDisplayState(undefined)).toBeNull();
});

test('pollDisplayState: state "running" -> "watching"', () => {
  expect(pollDisplayState({ state: 'running' })).toBe('watching');
});

test('pollDisplayState: state "timed-out" -> "timed-out"', () => {
  expect(pollDisplayState({ state: 'timed-out' })).toBe('timed-out');
});

test('pollDisplayState: every other real state (done/cleared/not-cleared/failed/suppressed/unknown/green/needs-you/...) -> "terminal"', () => {
  for (const s of ['done', 'cleared', 'not-cleared', 'failed', 'suppressed', 'unknown', 'green', 'needs-you']) {
    expect(pollDisplayState({ state: s })).toBe('terminal');
  }
});

// ---------------------------------------------------------------------------
// W7-FIX-A1 (A1-10): a FAILED read (`{ok:false, state:'unknown', error}`,
// the fail-closed shape studio-client's three polls now return) is neither
// a terminal fact about the run nor a fabricated 'running' — the wrapper
// keeps watching (bounded by maxAttempts), reports the failure via onUpdate
// so the panel can show the bridge's text, and stops the moment a REAL
// terminal status arrives. A `state:'unknown'` that the bridge itself
// answered (`ok:true`) is still terminal ("no state recorded").
// ---------------------------------------------------------------------------

test('pollAgentRun: a failed read {ok:false,state:"unknown",error} is reported via onUpdate AND keeps polling; a later real "done" stops it', async () => {
  const failed: AgentRunStatus = { ok: false, state: 'unknown', costUsd: 0, events: 0, error: 'bridge unreachable (Failed to fetch)' };
  const fetchStatus = vi.fn<() => Promise<AgentRunStatus>>()
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(failed)
    .mockResolvedValue(status({ state: 'done', costUsd: 2, events: 9 }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 100, maxAttempts: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, state: 'unknown', error: 'bridge unreachable (Failed to fetch)' }));
  await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchStatus).toHaveBeenCalledTimes(3);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true, state: 'done', costUsd: 2 }));
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchStatus).toHaveBeenCalledTimes(3);
  stop();
});

test('pollAgentRun: a bridge-answered {ok:true,state:"unknown"} (no state recorded) is STILL terminal — no further polling', async () => {
  const fetchStatus = vi.fn().mockResolvedValue(status({ state: 'unknown' }));
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 100 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  stop();
});

test('pollAgentRun: reads that fail every time still give up at maxAttempts with an explicit "timed-out" carrying the last failed read (never a silent freeze, never a phantom "running")', async () => {
  const failed: AgentRunStatus = { ok: false, state: 'unknown', costUsd: 0, events: 0, error: 'boom' };
  const fetchStatus = vi.fn().mockResolvedValue(failed);
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-1', { fetchStatus, onUpdate, intervalMs: 100, maxAttempts: 3 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchStatus).toHaveBeenCalledTimes(3);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, state: 'timed-out', error: 'boom' }));
  stop();
});

test('pollAgentFix: a failed read {ok:false,state:"unknown"} keeps polling; a later real "cleared" stops it', async () => {
  const failed: AgentFixStatus = { ok: false, state: 'unknown', cleared: false, error: 'boom' };
  const fetchStatus = vi.fn<() => Promise<AgentFixStatus>>()
    .mockResolvedValueOnce(failed)
    .mockResolvedValue({ ok: true, state: 'cleared', cleared: true });
  const onUpdate = vi.fn();
  const stop = pollAgentFix('kb-1', 'run-1', { fetchStatus, onUpdate, intervalMs: 100, maxAttempts: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, state: 'unknown', error: 'boom' }));
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchStatus).toHaveBeenCalledTimes(2);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'cleared', cleared: true }));
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchStatus).toHaveBeenCalledTimes(2);
  stop();
});

test('pollPreflightFix: a failed read {ok:false,state:"unknown"} keeps polling; a later real "not-cleared" stops it', async () => {
  const fetchStatus = vi.fn<() => Promise<AgentFixStatus>>()
    .mockResolvedValueOnce({ ok: false, state: 'unknown', cleared: false, error: 'boom' })
    .mockResolvedValue({ ok: true, state: 'not-cleared', cleared: false });
  const onUpdate = vi.fn();
  const stop = pollPreflightFix('proj', 'run-1', { fetchStatus, onUpdate, intervalMs: 100, maxAttempts: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, state: 'unknown' }));
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchStatus).toHaveBeenCalledTimes(2);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'not-cleared' }));
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchStatus).toHaveBeenCalledTimes(2);
  stop();
});

test('pollDisplayState: a FAILED read ({ok:false, state:"unknown"}) -> "watching" (the poll is still going — the panel shows the read failure, not a stopped run); an answered {ok:true, state:"unknown"} stays "terminal"', () => {
  expect(pollDisplayState({ ok: false, state: 'unknown' })).toBe('watching');
  expect(pollDisplayState({ ok: true, state: 'unknown' })).toBe('terminal');
  expect(pollDisplayState({ ok: false, state: 'timed-out' })).toBe('timed-out');
  expect(pollDisplayState({ ok: false, state: 'failed' })).toBe('terminal');
});

test('pollAgentRun: a failed read the bridge ANSWERED with 404 ({ok:false,state:"unknown",status:404}) is TERMINAL — R6-04 D22 "never dispatched" is a definitive answer, never polled for 3 minutes as a live run', async () => {
  const fetchStatus = vi.fn().mockResolvedValue({ ok: false, state: 'unknown', costUsd: 0, events: 0, error: 'no run found', status: 404 });
  const onUpdate = vi.fn();
  const stop = pollAgentRun('run-gone', { fetchStatus, onUpdate, intervalMs: 100, maxAttempts: 50 });
  await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  expect(onUpdate).toHaveBeenCalledTimes(1);
  expect(pollDisplayState(onUpdate.mock.calls[0][0])).toBe('terminal');
  stop();
});

test('isStillWatching / pollDisplayState: transport (no status) and 5xx failed reads keep watching; 4xx failed reads are terminal', () => {
  expect(pollDisplayState({ ok: false, state: 'unknown' })).toBe('watching');
  expect(pollDisplayState({ ok: false, state: 'unknown', status: 500 })).toBe('watching');
  expect(pollDisplayState({ ok: false, state: 'unknown', status: 503 })).toBe('watching');
  expect(pollDisplayState({ ok: false, state: 'unknown', status: 404 })).toBe('terminal');
  expect(pollDisplayState({ ok: false, state: 'unknown', status: 400 })).toBe('terminal');
});

// ---------------------------------------------------------------------------
// W7-B2 (knowledge-15) — progress-aware ceiling: demonstrated progress
// (a changing progressKey) RESETS the attempt counter, so 'timed-out' bounds
// SILENCE, never run length. pollKbDrain keys on the status file's own
// updatedAt/state/round/perFinding-length, which the drain now advances per
// transition AND heartbeats every ~10s.
// ---------------------------------------------------------------------------

test('pollKbDrain: a run whose updatedAt keeps ADVANCING never hits the ceiling (knowledge-15)', async () => {
  let tickCount = 0;
  const fetchStatus = vi.fn().mockImplementation(async () => {
    tickCount += 1;
    // updatedAt advances every poll — a live, heartbeating drain.
    return drainStatus({ updatedAt: `2026-08-15T00:00:${String(tickCount % 60).padStart(2, '0')}.000Z` });
  });
  const onUpdate = vi.fn();
  const stop = pollKbDrain('forge-dev', 'kb-drain-1', { fetchStatus, onUpdate, intervalMs: 10, maxAttempts: 3 });
  // Far past 3 attempts — with a fixed ceiling this would have timed out.
  for (let i = 0; i < 12; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(fetchStatus.mock.calls.length).toBeGreaterThan(6);
  expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'timed-out' }));
  stop();
});

test('pollKbDrain: a run whose status STOPS MOVING still times out after maxAttempts silent polls', async () => {
  const frozen = drainStatus({ updatedAt: '2026-08-15T00:00:07.000Z' });
  const fetchStatus = vi.fn().mockResolvedValue(frozen);
  const onUpdate = vi.fn();
  const stop = pollKbDrain('forge-dev', 'kb-drain-1', { fetchStatus, onUpdate, intervalMs: 10, maxAttempts: 3 });
  for (let i = 0; i < 8; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'timed-out' }));
  stop();
});

test('pollUntilTerminal: progressKey resets attempts ONLY on change — identical keys still consume the budget', async () => {
  const statuses = [
    { state: 'running', key: 'a' }, { state: 'running', key: 'a' },
    { state: 'running', key: 'b' }, // progress! resets
    { state: 'running', key: 'b' }, { state: 'running', key: 'b' },
  ];
  let i = 0;
  const fetchStatus = vi.fn().mockImplementation(async () => statuses[Math.min(i++, statuses.length - 1)]);
  const timedOut = vi.fn();
  const stop = pollUntilTerminal<{ state: string; key: string }>({
    fetchStatus,
    isRunning: (s) => s.state === 'running',
    progressKey: (s) => s.key,
    intervalMs: 10,
    maxAttempts: 3,
    onUpdate: () => {},
    onTimeout: timedOut,
  });
  for (let j = 0; j < 10; j++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  // Budget: polls 1,2 (a,a) consume 2; poll 3 (b) resets then consumes 1;
  // polls 4,5 (b,b) consume 2 more → ceiling at poll 5.
  expect(timedOut).toHaveBeenCalledTimes(1);
  expect(fetchStatus).toHaveBeenCalledTimes(5);
  stop();
});
