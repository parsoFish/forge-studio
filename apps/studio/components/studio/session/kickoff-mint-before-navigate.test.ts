// @vitest-environment jsdom
/**
 * The kickoff page must publish the id it minted INTO THE DOM before it
 * navigates away (bead `forge-8vfn.5.10`, sessions-owned site).
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS THE ONLY SHAPE THAT WORKS.
 *
 * PR #317 added `data-minted-session-id` and pinned it with a unit test on
 * `kickoffMainData`, a pure helper. That test was correct and is still green —
 * and it could not see the defect, because the defect was never in the helper.
 * `setMintedSessionId(id)` schedules a React state update; `router.push(...)`
 * on the next line begins navigating before React commits, so the attribute
 * reached the DOM of the page being left as the EMPTY STRING. S9 run 3 caught
 * it in production terms: `data-minted-session-id: expected a value to bind as
 * <authoringSessionId>, got ""` — on a run that dispatched a real agent.
 *
 * A call-order test ("publish is called before navigate") would PASS on the
 * broken code: #317 already called them in that order. The only assertion that
 * distinguishes the two implementations is what the DOM actually holds at the
 * moment `push` runs — which needs a document, which is why this one file opts
 * into jsdom while the other 80 studio tests stay on `node` and keep rendering
 * with `renderToStaticMarkup`.
 *
 * POSITIVE CONTROL (run both ways, recorded in the PR body): swap `flushSync`
 * back out for a bare `setMintedSessionId` and this test fails on the empty
 * string; restore it and it passes. That is the whole point of the file.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-03T02-47-47-3412d9d3';

/** What the DOM held when `router.push` was called — the whole assertion. */
let attrAtPushTime: string | null = null;
const push = vi.fn(() => {
  attrAtPushTime = document
    .querySelector('main[data-page="session-kickoff"]')
    ?.getAttribute('data-minted-session-id') ?? null;
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sessions/authoring/new',
  useParams: () => ({ kind: 'authoring' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

vi.mock('@/lib/bridge-client', () => ({
  startAuthoring: vi.fn(async () => ({ ok: true, sessionId: MINTED, project: 'mdtoc' })),
  startInstructions: vi.fn(),
  startDemoBuilder: vi.fn(),
  startProjectBrain: vi.fn(),
}));

vi.mock('@/lib/studio-client', () => ({
  fetchStudioProjects: vi.fn(async () => [{ id: 'mdtoc', name: 'mdtoc' }]),
  fetchAgentCapability: vi.fn(async () => ({ allowedTiers: ['sonnet', 'opus'], strategy: 'range' })),
  fetchStudioKbs: vi.fn(async () => []),
  fetchStudioSessions: vi.fn(async () => []),
  fetchRun: vi.fn(async () => null),
  startKbCleanup: vi.fn(),
  startOnboardingSession: vi.fn(),
  KB_SEEDING_ANCHOR_PREFIX: '.kb-',
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  attrAtPushTime = null;
  push.mockClear();
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

test('5.10: the minted id is IN THE DOM at the moment router.push is called', async () => {
  const { default: SessionKickoffPage } = await import('@/app/sessions/[kind]/new/page');

  await act(async () => {
    root.render(React.createElement(SessionKickoffPage, { params: { kind: 'authoring' } }));
  });

  const project = container.querySelector<HTMLSelectElement>('[data-field="kickoff-project"]');
  const prompt = container.querySelector<HTMLTextAreaElement>('[data-field="kickoff-prompt"]');
  expect(project, 'the project select must render').not.toBeNull();
  expect(prompt, 'the prompt textarea must render').not.toBeNull();

  await act(async () => {
    setControlled(project!, 'mdtoc');
    setControlled(prompt!, 'a skill that checks relative links resolve');
  });

  const start = container.querySelector<HTMLButtonElement>('[data-action="start-session"]');
  expect(start, 'the start control must render').not.toBeNull();
  expect(start!.disabled, 'start must be enabled once the form is filled').toBe(false);

  await act(async () => {
    start!.click();
  });

  expect(push, 'the page must navigate after a successful start').toHaveBeenCalledTimes(1);
  // THE ASSERTION. Empty string here is the shipped #317 defect: the attribute
  // existed but React had not committed the value before navigation began.
  expect(attrAtPushTime).toBe(MINTED);
});
