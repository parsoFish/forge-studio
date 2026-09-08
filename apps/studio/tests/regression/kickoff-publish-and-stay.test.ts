// @vitest-environment jsdom
/**
 * The kickoff page mints a session, PUBLISHES its id, and STAYS — it does not
 * navigate. Bead `forge-8vfn.5.10`'s sessions-owned site, completed; operator
 * ruling 396 (2026-09-07).
 *
 * WHY THE PREMISE CHANGED. This file was `kickoff-mint-before-navigate.test.ts`
 * and asserted that the minted id reached the DOM before `router.push` ran
 * (#320's `flushSync`). That was the right fix for the race #317 shipped, and
 * it worked — S9 run 4 (2026-09-07) proved it: the id was minted and the page
 * DID navigate. The beat still failed, for the next reason down:
 *
 *     no real-nav path to "/sessions/authoring/new" from
 *     "/sessions/authoring/<sid>": no [data-nav] pillar and no link points at
 *     it. The runner does not fall back to page.goto — an unreachable route
 *     must not pass as a beat.
 *
 * A press that navigates by itself leaves no page for anyone — an operator, a
 * story, a screen reader — to read the mint off, and it leaves the destination
 * reachable only by having already gone there. So the operator ruled the
 * navigation out: the launcher publishes the id and offers a REAL ANCHOR to the
 * session. `data-action` sits ON the `<a>` and the `href` IS the session route,
 * because that is the only shape the runner's nav resolution can follow
 * (`scripts/stories/beats.mjs`: `[data-nav][href]` or `a[href]`, never a click).
 *
 * THE THREE ASSERTIONS, and why each is the one that distinguishes the two
 * implementations: the attribute holds the real id (not `""`, #317's defect);
 * an anchor points AT the session route (not a button, which would red the next
 * beat exactly as this one redded); and `router.push` is never called (the
 * whole of ruling 396 — a call-order test would pass on both).
 *
 * POSITIVE CONTROL (run both ways, recorded in the PR body): restore the
 * `router.push` line and the third assertion fails while the first two still
 * pass — which is precisely why the first two were not enough.
 *
 * jsdom, alone among the studio tests, for the same reason as before: what the
 * DOM actually holds after the press needs a document.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const MINTED = '2026-09-03T02-47-47-3412d9d3';

/** A spy that must never fire — ruling 396's whole content. */
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sessions/authoring/new',
  useParams: () => ({ kind: 'authoring' }),
}));

// The real `next/link` forwards every prop it does not consume onto the
// anchor it renders — `data-action` included, which is how the other links on
// this page carry their handles. A mock that dropped them would hide exactly
// the defect this file exists to catch, so it spreads.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
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

test('396: the press publishes the minted id, offers a real anchor to it, and does NOT navigate', async () => {
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

  const main = container.querySelector('main[data-page="session-kickoff"]');
  expect(
    main?.getAttribute('data-minted-session-id'),
    'before the press the attribute is the empty string — present, so "not started yet" and "the key is missing" are never the same DOM',
  ).toBe('');

  const start = container.querySelector<HTMLButtonElement>('[data-action="start-session"]');
  expect(start, 'the start control must render').not.toBeNull();
  expect(start!.disabled, 'start must be enabled once the form is filled').toBe(false);

  await act(async () => {
    start!.click();
  });

  expect(
    container.querySelector('main[data-page="session-kickoff"]')?.getAttribute('data-minted-session-id'),
    'the id the POST minted must be readable on the page that minted it',
  ).toBe(MINTED);

  const link = container.querySelector<HTMLAnchorElement>('a[data-action="open-minted-session"]');
  expect(link, 'a REAL anchor must point at the minted session — a button satisfies no nav resolution').not.toBeNull();
  expect(
    link!.getAttribute('href'),
    'the href is the session route EXACTLY — a nav resolution matches `a[href="<route>"]`, so a query '
      + 'string leaves the anchor visible to a human and invisible to everything else (S9 run 2)',
  ).toBe(`/sessions/authoring/${MINTED}`);

  expect(push, 'ruling 396: the press must NOT navigate — the operator stays on the page that minted').not.toHaveBeenCalled();
});
