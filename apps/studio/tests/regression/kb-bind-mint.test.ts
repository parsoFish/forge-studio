// @vitest-environment jsdom
/**
 * `KbBind`'s "Build project brain with the agent" button MINTS AND STAYS —
 * it used to `router.push` an id it had just minted straight from inside the
 * click (`KbBind.tsx:37`), the same mint-then-navigate shape M1-G
 * (`forge-8vfn.5.5`, PR #246) closed for architect and demo via
 * `components/studio/session/SessionMinted.tsx`. `forge-8vfn.5.10` re-derived
 * this as one of the four surviving sites and this door pins the fix.
 *
 * THE OLD HREF CARRIED A QUERY STRING (`?project=<id>`) — deliberately
 * DROPPED here, not merely carried over. The bead's own re-derivation flags
 * it as "ruling 451's query-string class": the runner matches a minted
 * anchor's `href` EXACTLY (`scripts/stories/beats.mjs`), so a query string
 * renders a link a human can click and no beat can ever find
 * (`authoring-launcher-mint.test.ts` pins the same rule for the authoring
 * launcher, and its own note records the session shell resolving `project`
 * itself for every kind — `project-brain` included, off its own
 * `fetchProjectBrainSessions()` per-kind summary,
 * `app/sessions/[kind]/[sessionId]/page.tsx`). Nothing is lost by dropping
 * it.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-25T00-00-00-projectbrain01';
const push = vi.fn();

vi.mock('@/lib/bridge-client', () => ({
  startProjectBrain: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  push.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const panelRoot = () => container.querySelector('[data-section="build-project-brain"]')?.parentElement;

async function render() {
  const { KbBind } = await import('@/components/studio/project-builder/KbBind');
  await act(async () => {
    root.render(
      React.createElement(KbBind, {
        kb: null,
        kbs: [],
        projectId: 'gitweave',
        onChange: () => {},
      }),
    );
  });
}

test('the minted id key is published from first paint, empty — never absent', async () => {
  await render();

  const el = panelRoot();
  expect(el, 'the KB-bind panel must render').not.toBeNull();
  expect(el!.getAttribute('data-project-brain-session-id')).toBe('');
});

test('building the brain mints a session, publishes the id, and does NOT navigate from the click', async () => {
  await render();

  const create = container.querySelector<HTMLButtonElement>('[data-action="create-project-brain"]');
  expect(create, 'the create-project-brain control must render').not.toBeNull();

  await act(async () => {
    create!.click();
  });
  await act(async () => {});

  expect(panelRoot()!.getAttribute('data-project-brain-session-id')).toBe(MINTED);
  expect(push, 'the click itself must never navigate').not.toHaveBeenCalled();

  const link = container.querySelector('[data-action="view-project-brain-session"]');
  expect(link, 'the way in must render once the id exists').not.toBeNull();
  expect(link!.getAttribute('data-session-id')).toBe(MINTED);
  // No `?project=` — an exact-href-matched anchor with a query string is a
  // link no beat can find (see this file's header).
  expect(link!.getAttribute('href')).toBe(`/sessions/project-brain/${MINTED}`);
});
