// @vitest-environment jsdom
/**
 * `Instructions` (project-builder) MINTS AND STAYS — the project-page
 * instructions launcher used to `router.push` straight from inside the click
 * that started the session (`Instructions.tsx:66`), the same
 * mint-then-navigate shape M1-G (`forge-8vfn.5.5`, PR #246) closed for
 * architect and demo via `components/studio/session/SessionMinted.tsx`.
 * `forge-8vfn.5.10` re-derived this as one of the four surviving sites and
 * this door pins the fix.
 *
 * THE HREF CARRIES NO QUERY STRING — this was already true of the pre-fix
 * `router.push('/sessions/instructions/' + id)` and stays true here: the
 * session shell resolves `project` itself off `listInstructionsSessions()`
 * (`app/sessions/[kind]/[sessionId]/page.tsx`), so a bare
 * `/sessions/instructions/<id>` is a working address without one — and the
 * runner matches a minted anchor's `href` EXACTLY
 * (`scripts/stories/beats.mjs`), so a query string would render a link a
 * human can click and no beat can ever find (`authoring-launcher-mint.test.ts`
 * pins the same rule for the authoring launcher).
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-25T00-00-00-instructions01';
const push = vi.fn();

vi.mock('@/lib/bridge-client', () => ({
  startInstructions: vi.fn(async () => ({ ok: true, sessionId: MINTED })),
}));

vi.mock('@/lib/studio-client', () => ({
  fetchStudioSessions: vi.fn(async () => []),
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

const section = () => container.querySelector('[data-section="instructions-source"]')?.closest('section');

async function render() {
  const { Instructions } = await import('@/components/studio/project-builder/Instructions');
  await act(async () => {
    root.render(
      React.createElement(Instructions, {
        project: 'gitweave',
        value: '',
        onChange: () => {},
      }),
    );
  });
  // Flush the `fetchStudioSessions` effect.
  await act(async () => {});
}

test('the minted id key is published from first paint, empty — never absent', async () => {
  await render();

  const el = section();
  expect(el, 'the instructions section must render').not.toBeNull();
  expect(el!.getAttribute('data-instructions-session-id')).toBe('');
});

test('launching mints a session, publishes the id, and does NOT navigate from the click', async () => {
  await render();

  const launch = container.querySelector<HTMLButtonElement>('[data-action="launch-instructions"]');
  expect(launch, 'the launch control must render').not.toBeNull();

  await act(async () => {
    launch!.click();
  });
  await act(async () => {});

  expect(section()!.getAttribute('data-instructions-session-id')).toBe(MINTED);
  expect(push, 'the click itself must never navigate').not.toHaveBeenCalled();

  const link = container.querySelector('[data-action="view-instructions-session"]');
  expect(link, 'the way in must render once the id exists').not.toBeNull();
  expect(link!.getAttribute('data-session-id')).toBe(MINTED);
  expect(link!.getAttribute('href')).toBe(`/sessions/instructions/${MINTED}`);
});
