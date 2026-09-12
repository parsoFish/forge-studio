// @vitest-environment jsdom
/**
 * `DemoTimeline` must publish the demo session id it mints on its OWN root
 * (bead `forge-8vfn.6.11.26` / S1 beat 8; ruling 307).
 *
 * THE RULE IT BREAKS. `docs/forge-ui-dom-and-harness.md` (M1-G,
 * `forge-8vfn.5.5`) states it without qualification: "A surface that starts a
 * session publishes the id on its own root (`data-onboard-session-id`,
 * `data-architect-session-id`, `data-session-id`) and offers the way in as a
 * separate act." `NewIdeaBox.tsx:119` implements it for the architect and
 * `OnboardWithAgent` for onboarding. `DemoTimeline` renders `SessionMinted`
 * correctly and publishes NOTHING on its own `<section>`, so the minted demo
 * id exists only inside `SessionMinted`'s generic `data-session-id`.
 *
 * WHAT THAT COST, MEASURED. `SessionMinted` renders inside the ONBOARDING
 * session page, whose own root also carries `data-session-id`. The story
 * runner's `resolveExpectations` picks the best-covering candidate, so the
 * root wins and the key answers with the ONBOARDING id. S1 beat 8 therefore
 * cannot bind `/sessions/demo/<demoSessionId>` at all, and S1 run 5 red with
 * `route "/sessions/demo/<demoSessionId>" needs <demoSessionId>, which no
 * earlier beat bound`. `DemoTimeline.tsx:40` records the intent this test
 * enforces — "forge-8vfn.5.5 makes the id it mints observable ... so no story
 * could bind /sessions/demo/<id>" — delivered to `SessionMinted` and never to
 * the root.
 *
 * WHY jsdom, like its neighbour `new-idea-mint.test.ts`: both halves matter
 * and only one is statically visible. A static render shows the key absent
 * before the mint; only a real resolved POST shows it appearing WITH the id.
 * Publishing it eagerly as `""` would satisfy a naive "is it there" check
 * while telling every waiting consumer that a session exists when none does —
 * the `6.11.5` defect, one component over.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-06T08-41-17-3c9f2ab4';

vi.mock('@/lib/bridge-client', () => ({
  startDemoBuilder: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
  listDemoElements: vi.fn(async () => []),
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

const PROPS = {
  project: 'gitweave',
  steps: [
    { kind: 'capture' as const, text: 'Screenshot the report' },
    { kind: 'verify' as const, text: 'Run the gate' },
  ],
  hasLockedDemo: false,
  onChange: () => {},
};

/** The component's own root — the element the DOM contract names. */
const panel = () => container.querySelector('section[data-step-count]');

test('7.6.64: before the launch, DemoTimeline publishes the key EMPTY — present, never absent', async () => {
  const { DemoTimeline } = await import('@/components/studio/project-builder/DemoTimeline');

  await act(async () => {
    root.render(React.createElement(DemoTimeline, PROPS));
  });

  expect(panel(), 'the timeline must render').not.toBeNull();
  // PRESENT AND EMPTY BEFORE THE MINT — `forge-8vfn.7.6.64`, rulings
  // 409/422/436/438. This door pinned `hasAttribute === false` under 6.11.5
  // (ruling 332), and 438 reversed that on the record: absent is the same race
  // one step earlier, because an observer collecting nested `data-*` in ONE
  // read cannot tell "no key" from "not yet". What changed was the READER.
  //
  // THE ASSERTION IS `''`, NOT "absent OR empty". A door that accepted either
  // would pass against both shapes and pin neither, which is how one key came
  // to have two shapes across three sibling surfaces in the first place.
  expect(panel()!.getAttribute('data-demo-session-id')).toBe('');
  expect(container.querySelector('[data-action="view-demo-session"]')).toBeNull();
});

test('307: once the demo builder mints a session, the id IS published on the root S1 beat 7 binds', async () => {
  const { DemoTimeline } = await import('@/components/studio/project-builder/DemoTimeline');

  await act(async () => {
    root.render(React.createElement(DemoTimeline, PROPS));
  });

  const launch = container.querySelector<HTMLButtonElement>('[data-action="launch-demo-builder"]');
  expect(launch, 'the launch control must render').not.toBeNull();

  await act(async () => {
    launch!.click();
  });

  // The whole point: a key no page root shadows, carrying the minted id, so
  // `/sessions/demo/<demoSessionId>` is bindable from the page the operator
  // is standing on.
  expect(panel()!.getAttribute('data-demo-session-id')).toBe(MINTED);

  // And the existing publication is unchanged — `SessionMinted` still offers
  // the way in as a separate act. One fact, published twice, both true.
  const link = container.querySelector('[data-action="view-demo-session"]');
  expect(link, 'the way in must still render').not.toBeNull();
  expect(link!.getAttribute('data-session-id')).toBe(MINTED);
});
