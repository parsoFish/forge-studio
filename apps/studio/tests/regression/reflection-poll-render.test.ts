// @vitest-environment jsdom
/**
 * The reflect page never re-fetches — forge-8vfn.8.1.42, ruling 1849.
 *
 * Real S10 run 39: the operator opened `/artifact?type=reflection`
 * (`data-action="open-reflect"`) ~35s BEFORE the reflector started.
 * `fetchReflection()` (app/artifact/page.tsx) returned no questions, and
 * `ReflectionGate` renders `[data-question-index]` only when
 * `questions.length > 0`. Nothing on the page re-ran `fetchReflection` —
 * `useBridgeRecoveryWhenFailed` fires only on a TRANSPORT error, and this read
 * SUCCEEDED, it just answered "not yet" — so the reflector's 4 real questions,
 * filed 10 minutes later, never reached the screen.
 *
 * This mounts the same shape page.tsx wires — `useReflectionPoll` feeding
 * `ReflectionGate`'s `data` prop — with `fetchReflection` mocked, and proves
 * the poll delivers newly-arrived questions to the SAME mounted tree (no
 * remount), stops once the wait is over, stops at unmount, and never starts
 * for a non-reflection type. `demo-timeline-mint.test.ts` / `new-idea-mint.
 * test.ts` establish this repo's jsdom + react-dom/client + `act` technique
 * (forge-ui's vitest `environment` is `node` — no jsdom / testing-library by
 * default, see those files' headers) for the exact reason this test needs it:
 * only a real mounted tree runs effects, so only it can prove a poll fires.
 *
 * RUN: cd apps/studio && npx vitest run tests/regression/reflection-poll-render.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { ReflectionData } from '@/lib/bridge-client';

const fetchReflectionMock = vi.fn<(cycleId: string) => Promise<ReflectionData | null>>();

vi.mock('@/lib/bridge-client', () => ({
  fetchReflection: (cycleId: string) => fetchReflectionMock(cycleId),
  postReflectionAnswers: vi.fn(async () => ({ ok: true })),
}));

// Imported AFTER the mock is declared (hoisted above these by vitest) — both
// modules resolve `fetchReflection`/`postReflectionAnswers` through the
// mocked `@/lib/bridge-client`.
import { useReflectionPoll } from '@/lib/use-reflection-poll';
import { ReflectionGate } from '@/components/studio/artifact/ReflectionGate';

const TWO_QUESTIONS = [
  { question: 'How was WI sizing?', header: 'How was WI sizing?' },
  { question: 'Did deps hold?', header: 'Did deps hold?' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  fetchReflectionMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** The exact wiring `app/artifact/page.tsx` uses for `type=reflection`: the
 *  hook feeds `setReflectionData`, `ReflectionGate` renders the result. */
function ReflectionView({ cycleId, enabled }: { cycleId: string; enabled: boolean }): React.JSX.Element {
  const [data, setData] = React.useState<ReflectionData | null>(null);
  useReflectionPoll(cycleId, enabled, data, setData, POLL_MS, BOUND_MS);
  return React.createElement(ReflectionGate, { cycleId, data });
}

const POLL_MS = 1000;
const BOUND_MS = 5000;

test('a later fetch that finds questions renders them into the SAME mounted tree — no remount', async () => {
  fetchReflectionMock.mockResolvedValue(null); // "not started yet" (404 → null), like real run 39

  await act(async () => {
    root.render(React.createElement(ReflectionView, { cycleId: 'demo-cycle', enabled: true }));
  });

  expect(container.textContent).toContain('No reflection questions filed for this cycle yet.');
  expect(container.querySelector('[data-question-index]')).toBeNull();
  const rootNodeBefore = container.firstElementChild;

  fetchReflectionMock.mockResolvedValue({ cycleId: 'demo-cycle', questions: TWO_QUESTIONS, answered: false });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  });

  expect(container.querySelectorAll('[data-question-index]').length).toBe(2);
  // Same DOM node identity — the tree updated in place, it was not torn down
  // and rebuilt (a remount would hand back a distinct element).
  expect(container.firstElementChild).toBe(rootNodeBefore);
});

test('stops polling once the reflection is answered', async () => {
  fetchReflectionMock.mockResolvedValueOnce({ cycleId: 'demo-cycle', questions: [], answered: false });
  fetchReflectionMock.mockResolvedValueOnce({ cycleId: 'demo-cycle', questions: [], answered: true });

  await act(async () => {
    root.render(React.createElement(ReflectionView, { cycleId: 'demo-cycle', enabled: true }));
  });

  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
  expect(fetchReflectionMock).toHaveBeenCalledTimes(1);

  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
  expect(fetchReflectionMock).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-section="reflect-done"]')).not.toBeNull();

  // Now answered — further ticks (well past the bound too) must not re-fetch.
  await act(async () => { await vi.advanceTimersByTimeAsync(BOUND_MS * 2); });
  expect(fetchReflectionMock).toHaveBeenCalledTimes(2);
});

test('stops polling at unmount — a tick after unmount never fires', async () => {
  fetchReflectionMock.mockResolvedValue(null);

  await act(async () => {
    root.render(React.createElement(ReflectionView, { cycleId: 'demo-cycle', enabled: true }));
  });

  act(() => root.unmount());

  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
  expect(fetchReflectionMock).not.toHaveBeenCalled();
});

test('never polls for a non-reflection type (enabled=false)', async () => {
  fetchReflectionMock.mockResolvedValue(null);

  await act(async () => {
    root.render(React.createElement(ReflectionView, { cycleId: 'demo-cycle', enabled: false }));
  });

  await act(async () => { await vi.advanceTimersByTimeAsync(BOUND_MS * 2); });
  expect(fetchReflectionMock).not.toHaveBeenCalled();
});

test('respects the bound — an automated cycle stuck at zero questions stops eventually', async () => {
  fetchReflectionMock.mockResolvedValue({
    cycleId: 'demo-cycle', questions: [], answered: false, mode: 'automated',
  });

  await act(async () => {
    root.render(React.createElement(ReflectionView, { cycleId: 'demo-cycle', enabled: true }));
  });

  await act(async () => { await vi.advanceTimersByTimeAsync(BOUND_MS + POLL_MS); });
  const callsAtBound = fetchReflectionMock.mock.calls.length;
  expect(callsAtBound).toBeGreaterThan(0);

  await act(async () => { await vi.advanceTimersByTimeAsync(BOUND_MS * 3); });
  // No further calls once the bound has elapsed.
  expect(fetchReflectionMock.mock.calls.length).toBe(callsAtBound);
});
