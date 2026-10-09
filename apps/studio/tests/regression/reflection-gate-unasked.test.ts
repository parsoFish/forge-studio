// @vitest-environment jsdom
/**
 * forge-nk1y.3 — the reflection gate stays reachable when the reflector asked
 * nothing: it surfaces once for the operator's close act (the gate is the
 * factory's declared pause), never the "not filed yet" note forever.
 *
 *   filed + [] + not answered → data-section="reflect-unasked" with
 *     data-action="close-reflection"; pressing it posts the close and lands on
 *     reflect-done with data-reflect-closed="true".
 *   NOT filed + []            → the old "No reflection questions filed" note
 *     (the reflector is still running) — no close act.
 *   a refused close (bridge 409) → the refusal shown by name, no done state.
 *
 * Technique: jsdom + react-dom/client + act, as reflection-poll-render.test.ts.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const postReflectionCloseMock = vi.fn<(cycleId: string) => Promise<{ ok: boolean; error?: string }>>();
const postReflectionAnswersMock = vi.fn(async () => ({ ok: true }));

vi.mock('@/lib/bridge-client', () => ({
  postReflectionClose: (cycleId: string) => postReflectionCloseMock(cycleId),
  postReflectionAnswers: () => postReflectionAnswersMock(),
}));

import { ReflectionGate } from '@/components/studio/artifact/ReflectionGate';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  postReflectionCloseMock.mockReset();
  postReflectionAnswersMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const CYCLE = '2026-10-09T02-00-00_INIT-2026-10-09-zero-ask';

async function render(data: { questions: []; answered: boolean; filed?: boolean; mode?: 'interactive' }): Promise<void> {
  await act(async () => {
    root.render(React.createElement(ReflectionGate, { cycleId: CYCLE, data: { cycleId: CYCLE, ...data } }));
  });
}

test('filed EMPTY list, not answered → the close act is reachable, and pressing it lands on reflect-done (closed)', async () => {
  postReflectionCloseMock.mockResolvedValue({ ok: true });
  await render({ questions: [], answered: false, filed: true, mode: 'interactive' });

  expect(container.querySelector('[data-section="reflect-unasked"]')).not.toBeNull();
  const close = container.querySelector<HTMLButtonElement>('[data-action="close-reflection"]');
  expect(close).not.toBeNull();
  expect(close!.disabled).toBe(false);

  await act(async () => { close!.click(); });

  expect(postReflectionCloseMock).toHaveBeenCalledWith(CYCLE);
  expect(postReflectionAnswersMock).not.toHaveBeenCalled();
  const done = container.querySelector('[data-section="reflect-done"]');
  expect(done).not.toBeNull();
  expect(done!.getAttribute('data-reflect-closed')).toBe('true');
});

test('NOT filed yet (reflector still running) → the "not filed" note, no close act', async () => {
  await render({ questions: [], answered: false, filed: false });
  expect(container.textContent).toContain('No reflection questions filed for this cycle yet.');
  expect(container.querySelector('[data-action="close-reflection"]')).toBeNull();
});

test('a refused close is shown by name and does not fake the done state', async () => {
  postReflectionCloseMock.mockResolvedValue({ ok: false, error: 'close refused: 2 questions unanswered' });
  await render({ questions: [], answered: false, filed: true });
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-action="close-reflection"]')!.click(); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('close refused: 2 questions unanswered');
  expect(container.querySelector('[data-section="reflect-done"]')).toBeNull();
});

test('an already-closed reflection (answered) renders reflect-done, no close act', async () => {
  await render({ questions: [], answered: true, filed: true });
  expect(container.querySelector('[data-section="reflect-done"]')).not.toBeNull();
  expect(container.querySelector('[data-action="close-reflection"]')).toBeNull();
});

test('an unreadable filed list is named and offers NO close (review finding: the close could never succeed)', async () => {
  await act(async () => {
    root.render(React.createElement(ReflectionGate, {
      cycleId: CYCLE,
      data: { cycleId: CYCLE, questions: [], answered: false, filed: true, unreadable: true },
    }));
  });
  expect(container.querySelector('[data-section="reflect-unreadable"]')).not.toBeNull();
  expect(container.querySelector('[data-action="close-reflection"]')).toBeNull();
});
