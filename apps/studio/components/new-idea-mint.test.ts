// @vitest-environment jsdom
/**
 * `NewIdeaBox` must not publish an architect session id it has not minted
 * (bead `forge-8vfn.6.11.5`).
 *
 * WHY THIS FILE OPTS INTO jsdom, like its neighbour
 * `studio/session/kickoff-mint-before-navigate.test.ts`.
 *
 * The defect is a key that is PRESENT AND EMPTY from first paint:
 * `data-architect-session-id={startedSessionId ?? ''}`. A static render can
 * see the empty half; only a real mint can prove the other half — that the
 * attribute appears, carrying the id, once the POST resolves. Both halves
 * matter, because the two obvious wrong fixes fail in opposite directions:
 * deleting the attribute would leave the pinned S2 beat 10 / S4 beat 9 with
 * nothing to bind, and leaving it empty is the shipped defect.
 *
 * WHAT IT COST. `SessionMinted.tsx` in this same component tree states the
 * rule in its docstring — "No id, no element: the link cannot point at a
 * session that was never created" — and `NewIdeaBox` renders that component
 * correctly at :187 while publishing the SAME id the other way on its own
 * wrapper. One fact, two publications, one of them lying. The H6 authoring
 * sitting spent an S2 run reaching this: a real architect turn ran
 * 02:03:02→02:03:09Z and beat 10 still read
 * `data-architect-session-id: expected a value to bind as
 * <architectSessionId>, got ""`.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-05T02-03-02-641bb6b6';

vi.mock('@/lib/bridge-client', () => ({
  startArchitect: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
}));

const ROSTER = {
  projects: [{ id: 'story-s2', name: 'story-s2' }],
  capability: { allowedTiers: ['sonnet', 'opus'], strategy: 'range' as const },
  state: 'ok' as const,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Set a React-controlled input's value the way a user would. */
function setControlled(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

const box = () => container.querySelector('[data-section="new-idea"]');

test('6.11.5: before Start, the form publishes NO architect session id — not an empty one', async () => {
  const { NewIdeaBox } = await import('@/components/NewIdeaBox');

  await act(async () => {
    root.render(React.createElement(NewIdeaBox, { roster: ROSTER }));
  });

  // THE DEFECT: shipped as `data-architect-session-id=""`, so a consumer that
  // waits for the key to appear is answered instantly by a value that names
  // no session. `SessionMinted` renders nothing here, and the wrapper must
  // agree with it — one fact, published once.
  expect(box(), 'the form must render').not.toBeNull();
  expect(box()!.hasAttribute('data-architect-session-id')).toBe(false);
  expect(container.querySelector('[data-action="view-architect-session"]')).toBeNull();
});

test('6.11.5: once Start mints a session, the id IS published under the key the stories bind', async () => {
  const { NewIdeaBox } = await import('@/components/NewIdeaBox');

  await act(async () => {
    root.render(React.createElement(NewIdeaBox, { roster: ROSTER }));
  });

  const project = container.querySelector<HTMLSelectElement>('[data-field="project"]');
  const idea = container.querySelector<HTMLTextAreaElement>('[data-field="idea"]');
  expect(project, 'the project select must render').not.toBeNull();
  expect(idea, 'the idea textarea must render').not.toBeNull();

  await act(async () => {
    setControlled(project!, 'story-s2');
    setControlled(idea!, 'Add a --since flag that filters the digest by date.');
  });

  const start = container.querySelector<HTMLButtonElement>('[data-action="start-architect"]');
  expect(start, 'the start control must render').not.toBeNull();
  expect(start!.disabled, 'start must be enabled once project and idea are set').toBe(false);

  await act(async () => {
    start!.click();
  });

  // The other direction: deleting the attribute to fix the empty string would
  // leave S2 beat 10 and S4 beat 9 with nothing to bind. The key must exist
  // the moment — and only the moment — there is a session to name.
  expect(box()!.getAttribute('data-architect-session-id')).toBe(MINTED);
  expect(container.querySelector('[data-session-id]')!.getAttribute('data-session-id')).toBe(MINTED);
});
