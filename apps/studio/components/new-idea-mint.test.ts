// @vitest-environment jsdom
/**
 * `NewIdeaBox` publishes its architect session id under the shape the DOM
 * contract ratified for every minting surface: **`""` before the mint, the id
 * after, never absent** (rulings 409/422/436), with the way in offered as a
 * separate act — a real anchor that exists only once there is a session to
 * point at.
 *
 * WHY THIS FILE OPTS INTO jsdom, like its neighbour
 * `studio/session/kickoff-publish-and-stay.test.ts`: only a real mint can prove
 * the second half — that the attribute FILLS and the anchor APPEARS once the
 * POST resolves. Both halves matter, because the wrong fixes fail in opposite
 * directions: deleting the attribute leaves the pinned S2 beat 10 / S4 beat 9
 * with nothing to bind, and an anchor rendered before the mint points at a
 * session that was never created.
 *
 * THE HISTORY THIS FILE INVERTS, kept because it was bought with a funded run.
 * `forge-8vfn.6.11.5` made the key present-and-empty the DEFECT: an S2 run whose
 * architect really had started (a turn ran 02:03:02→02:03:09Z) read
 * `data-architect-session-id: expected a value to bind as
 * <architectSessionId>, got ""`, because the runner's post-`do` read was
 * answered instantly by a value naming no session. The fix then was to publish
 * only once the id existed — which made the key ABSENT, and an observer that
 * collects nested `data-*` in one read sees absent as "no key" rather than "not
 * yet": the same race, one step earlier.
 *
 * **What changed is the RUNNER, not the judgement.** Ruling 438 (`7fd63d74`): a
 * beat whose expectation carries a `<name>` placeholder always enters the
 * bounded wait, and an unfilled binding reports "minted nothing within N ms".
 * An empty value can no longer answer a wait, so the always-present form is the
 * safe one — and it is what the contract requires at all four minting sites.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { ProjectRoster } from '@/lib/use-project-roster';

const MINTED = '2026-09-05T02-03-02-641bb6b6';

vi.mock('@/lib/bridge-client', () => ({
  startArchitect: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
}));

// The architect's real shape: strategy is fixed (it declares no `surface:`,
// so `interactive` is false) and a session ceiling IS enforceable — the field
// the form's cost-ceiling input rides on.
const ROSTER: ProjectRoster = {
  projects: [{ id: 'story-s2', name: 'story-s2' }],
  capability: {
    interactive: false,
    runtimeSdks: ['claude'],
    fanoutCapable: false,
    materials: [],
    costCeilingEnforceable: true,
  },
  state: 'ok',
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

test('436/438: before Start the key is PRESENT and EMPTY — never absent — and no anchor points at a session that does not exist', async () => {
  const { NewIdeaBox } = await import('@/components/NewIdeaBox');

  await act(async () => {
    root.render(React.createElement(NewIdeaBox, { roster: ROSTER }));
  });

  // The attribute is the BINDING HANDLE and must exist from first paint, so a
  // reader can tell "not yet" from "no key" (ruling 409's shape; safe since 438
  // stopped an empty value from answering a bounded wait). The ANCHOR is a
  // different claim — it navigates — so it must NOT exist yet.
  expect(box(), 'the form must render').not.toBeNull();
  expect(box()!.hasAttribute('data-architect-session-id')).toBe(true);
  expect(box()!.getAttribute('data-architect-session-id')).toBe('');
  expect(container.querySelector('[data-action="view-architect-session"]')).toBeNull();
});

test('436/438: once Start mints a session the key FILLS, and the real anchor appears pointing at that session', async () => {
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
  // leave S2 beat 10 and S4 beat 9 with nothing to bind.
  expect(box()!.getAttribute('data-architect-session-id')).toBe(MINTED);
  expect(container.querySelector('[data-session-id]')!.getAttribute('data-session-id')).toBe(MINTED);

  // The anchor, asserted by the handle a story presses and by where it GOES.
  // `SessionMinted` builds that handle as `view-${kind}-session`, so a grep for
  // the literal string finds it in tests only and misses the product — §15.237's
  // class (a matcher blind inside an identifier), here inside a template
  // literal. This assertion is what makes the control provable by name.
  const anchor = container.querySelector<HTMLAnchorElement>('[data-action="view-architect-session"]');
  expect(anchor, 'the way in is offered as a real anchor, not a navigation').not.toBeNull();
  expect(anchor!.getAttribute('href')).toBe(`/sessions/architect/${MINTED}`);
  expect(anchor!.getAttribute('data-session-kind')).toBe('architect');
});
