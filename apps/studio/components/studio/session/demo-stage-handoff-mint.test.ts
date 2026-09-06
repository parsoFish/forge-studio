// @vitest-environment jsdom
/**
 * `DemoStageHandoff` must publish the demo session id it mints on its OWN root
 * — T1 ruling 332, correcting my own #490.
 *
 * WHAT #490 GOT WRONG. S1 beat 8 could not bind `/sessions/demo/<demoSessionId>`,
 * so #490 put `data-demo-session-id` on `DemoTimeline`'s root. That component
 * lives in `components/studio/project-builder/` and renders on the PROJECT
 * page. **Beat 7 stands on the onboarding SESSION page**, whose handoff is THIS
 * component — it carries `data-action="launch-demo-builder"` and renders
 * `SessionMinted kind="demo"`, and its root published nothing. So the beat
 * asserted a key the page it stands on never rendered, and #490 fixed a real
 * gap in the wrong component for this beat.
 *
 * WHAT THAT COST, AND THE LESSON UNDER IT (§15.213). Beat 7 was GREEN in S1 run
 * 5 because it did not yet assert the key; I ADDED that assertion myself in the
 * sweep (#494); runs 6 and 7 then red — and I reported the new failure as a
 * product regression, escalated it as a P1 "deterministic demo-builder hang"
 * blocking an exit row, and a bisect of `#487 → #493` was ordered around it.
 * There was no regression. **When a beat you amended goes red, the first
 * suspect is the amendment.**
 *
 * The "hang" was a second misreading in the same investigation:
 * `/api/demo-builder/start` (`bridge-studio-demo.ts:408-496`) contains **no
 * spawn call** — it writes `status.json` at `phase: 'briefing'` and returns.
 * The spawn is one route later at `/api/demo-builder/brief`, which the story
 * never posts. `briefing` + `error: null` + no `_logs/*demo*` is the CORRECT
 * post-`start` state, and the `/proc` probe reporting "no SDK child seen" was
 * telling the truth about a process that was never going to spawn one.
 *
 * WHY THIS TEST SETTLES THE OPEN QUESTION. It was NOT known whether
 * `startDemoBuilder`'s response reached the client in those runs — the session
 * directory existed, so the POST succeeded server-side. Mocking the response
 * and asserting the key appears decides it by fixture rather than by theory
 * (ruling 332), which is the whole reason this is a jsdom test and not a
 * static render.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-06T05-39-01-951c6eda';

vi.mock('@/lib/bridge-client', () => ({
  startDemoBuilder: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
}));

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

/**
 * The component's own root — the element beat 7 reads. Anchored on the launch
 * handle's parent rather than a new `data-section`: the fix this test drives is
 * ONE attribute, and inventing a second one to make the test easier to write
 * would grow the DOM contract for the test's convenience.
 */
const handoff = () => container.querySelector('[data-action="launch-demo-builder"]')!.parentElement;

test('332: before the handoff, no demo session id is published — not an empty one', async () => {
  const { DemoStageHandoff } = await import('@/components/studio/session/DemoStageHandoff');

  await act(async () => {
    root.render(React.createElement(DemoStageHandoff, { project: 'gitweave' }));
  });

  expect(handoff(), 'the handoff must render').not.toBeNull();
  // "No id, no key" (forge-8vfn.6.11.5): a key rendered present-and-empty is
  // indistinguishable from one about to be filled, so a consumer waiting for it
  // is answered by a value naming nothing.
  expect(handoff()!.hasAttribute('data-demo-session-id')).toBe(false);
  expect(container.querySelector('[data-action="view-demo-session"]')).toBeNull();
});

test('332: once the handoff mints a session, the id IS published on the root S1 beat 7 reads', async () => {
  const { DemoStageHandoff } = await import('@/components/studio/session/DemoStageHandoff');

  await act(async () => {
    root.render(React.createElement(DemoStageHandoff, { project: 'gitweave' }));
  });

  const launch = container.querySelector<HTMLButtonElement>('[data-action="launch-demo-builder"]');
  expect(launch, 'the launch control must render').not.toBeNull();

  await act(async () => {
    launch!.click();
  });

  // The assertion beat 7 makes. It also SETTLES the open question: if the
  // response reaches the client, the key is here. Anything else observed in a
  // live run after this is a different defect, not this one.
  expect(handoff()!.getAttribute('data-demo-session-id')).toBe(MINTED);

  // And the way in is unchanged — one fact, published twice, both true.
  const link = container.querySelector('[data-action="view-demo-session"]');
  expect(link, 'the way in must still render').not.toBeNull();
  expect(link!.getAttribute('data-session-id')).toBe(MINTED);
});
