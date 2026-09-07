// @vitest-environment jsdom
/**
 * Ruling 441 — the project page's "Run onboarding agent" press is TWO calls and
 * one press, and this file is what makes S1 beat 4's premise checkable without
 * a funded story run.
 *
 * `POST /api/studio/onboarding/start` no longer dispatches: it mints the
 * session at `briefing`. The brief travels through the SAME generic
 * question-form affordance a spine-started session shows on its own page, and
 * THAT dispatches. So this form is a client of the generic surface rather than
 * a second way to start an onboarding agent — ADR 043's direction — while the
 * operator still presses once.
 *
 * S1 beat 4 asserts `onboard-run-status: 'running'` immediately after this
 * press. It reads a status polled from the runId, and the component only
 * publishes that runId once the brief has been ACCEPTED — so the two
 * assertions below (both calls made, in that order; no runId published when
 * the brief is refused) are exactly beat 4's precondition.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const startOnboardingSession = vi.fn();
const postSessionAffordance = vi.fn();

vi.mock('@/lib/studio-client', () => ({
  startOnboardingSession: (...a: unknown[]) => startOnboardingSession(...a),
  fetchActiveOnboarding: vi.fn(async () => ({ ok: true })),
  // The REAL shape: `AgentRunStatus.costUsd` is a required number (the parser
  // defaults it with `?? 0`), and the component renders `costUsd.toFixed(4)`.
  // A thinner mock crashes the component and would have been read as a product
  // defect — a fake must be as complete as the type it stands in for.
  getAgentRunStatus: vi.fn(async () => ({ ok: true, status: 'running', costUsd: 0, events: 0 })),
}));
vi.mock('@/lib/session-client', () => ({
  postSessionAffordance: (...a: unknown[]) => postSessionAffordance(...a),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  startOnboardingSession.mockReset();
  postSessionAffordance.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountAndPress(): Promise<void> {
  const { OnboardWithAgent } = await import('./OnboardWithAgent');
  await act(async () => {
    root.render(React.createElement(OnboardWithAgent, { projectId: 'demoproj' }));
  });
  const run = container.querySelector<HTMLButtonElement>('[data-action="run-onboarding-agent"]');
  expect(run, 'the run control must render').not.toBeNull();
  await act(async () => { run!.click(); });
}

test('441: one press makes BOTH calls — start mints, then the brief goes through the generic affordance', async () => {
  startOnboardingSession.mockResolvedValue({ ok: true, sessionId: 'sess-1', runId: 'run-1' });
  postSessionAffordance.mockResolvedValue({ ok: true });

  await mountAndPress();

  expect(startOnboardingSession).toHaveBeenCalledTimes(1);
  expect(postSessionAffordance).toHaveBeenCalledTimes(1);
  const [kind, sessionId, affordanceId, body] = postSessionAffordance.mock.calls[0] as [string, string, string, Record<string, unknown>];
  expect(kind).toBe('onboarding');
  expect(sessionId).toBe('sess-1');
  expect(affordanceId).toBe('briefing-question-form');
  expect(Array.isArray(body.answers)).toBe(true);
  // The dispatch is the SECOND call's job, so the order is load-bearing, not
  // incidental: a brief posted before the session exists has nowhere to land.
  expect(startOnboardingSession.mock.invocationCallOrder[0])
    .toBeLessThan(postSessionAffordance.mock.invocationCallOrder[0]);
});

test('441: a refused brief publishes NO runId — the press must not claim a run that was never dispatched', async () => {
  startOnboardingSession.mockResolvedValue({ ok: true, sessionId: 'sess-1', runId: 'run-1' });
  postSessionAffordance.mockResolvedValue({ ok: false, error: 'nope' });

  await mountAndPress();

  expect(postSessionAffordance).toHaveBeenCalledTimes(1);
  // The runId is what S1 beat 4's status poll reads. Publishing it after a
  // refused brief would show `running` for an agent that never started — the
  // declared-data-fails-open shape, on the one surface the operator watches.
  expect(container.querySelector('[data-action="open-onboarding-run"]')).toBeNull();
});
