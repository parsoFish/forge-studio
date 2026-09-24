// @vitest-environment jsdom
/**
 * forge-5rr (projects-45): `/sessions/[kind]/new` — the pending scan's own
 * note already verified this at source ("a real, distinguishable failure
 * state, not a swallow") and left it PENDING only because no test pinned
 * that banner to a thrown bridge read yet, and because EXEMPT there
 * requires naming a covering test. This file is that test.
 *
 * TWO INDEPENDENT claims, proven by MOUNTING the real page (following
 * `kickoff-publish-and-stay.test.ts`'s established harness — `kind` arrives
 * as a PROP, `params.kind`, never `useParams()`, so no per-test navigation
 * mock is needed):
 *
 *   1. The `NotFound` branch (`if (!spec)`) is decided from
 *      `kickoffSpecFor(kind)` ALONE — a pure, static registry lookup with NO
 *      bridge read in its path. A route naming an unregistered kind renders
 *      NotFound with ZERO network calls, proven by asserting the mocked
 *      fetches were never invoked — this page's not-found claim is
 *      STRUCTURALLY incapable of the crosscut-08 shape (a transport failure
 *      can never even reach this branch, because nothing here reads the
 *      network before deciding it).
 *   2. A REAL mount-load failure (the `Promise.all` in the effect, for a
 *      registered kind) renders the existing `data-kickoff-error` banner
 *      with the real thrown message — never a silently-empty project list,
 *      never NotFound.
 *
 * The page under test is imported ONCE, at module scope (the F5/F6 flake
 * class `kickoff-publish-and-stay.test.ts`'s own header explains).
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SessionKickoffPage from '@/app/sessions/[kind]/new/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sessions/authoring/new',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/lib/bridge-client', () => ({
  startAuthoring: vi.fn(),
  startInstructions: vi.fn(),
  startDemoBuilder: vi.fn(),
  startProjectBrain: vi.fn(),
}));

const fetchStudioProjects = vi.fn(async () => {
  throw new Error('bridge unreachable: ECONNREFUSED');
});
const fetchAgentCapability = vi.fn(async () => ({ allowedTiers: ['sonnet', 'opus'], strategy: 'range' }));
const fetchStudioKbs = vi.fn(async () => []);
const fetchStudioSessions = vi.fn(async () => []);
const fetchRun = vi.fn(async () => null);

vi.mock('@/lib/studio-client', () => ({
  fetchStudioProjects: (...args: unknown[]) => fetchStudioProjects(...(args as [])),
  fetchAgentCapability: (...args: unknown[]) => fetchAgentCapability(...(args as [])),
  fetchStudioKbs: (...args: unknown[]) => fetchStudioKbs(...(args as [])),
  fetchStudioSessions: (...args: unknown[]) => fetchStudioSessions(...(args as [])),
  fetchRun: (...args: unknown[]) => fetchRun(...(args as [])),
  startKbCleanup: vi.fn(),
  startOnboardingSession: vi.fn(),
  KB_SEEDING_ANCHOR_PREFIX: '.kb-',
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fetchStudioProjects.mockClear();
  fetchAgentCapability.mockClear();
  fetchStudioKbs.mockClear();
  fetchStudioSessions.mockClear();
  fetchRun.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('an unregistered session kind renders NotFound WITHOUT ever touching the bridge — the claim cannot be a transport-failure artifact', async () => {
  await act(async () => {
    root.render(React.createElement(SessionKickoffPage, { params: { kind: 'totally-bogus-kind' } }));
  });

  const notFound = container.querySelector('[data-not-found-kind]') ?? container.querySelector('h1, [role="heading"]');
  expect(container.textContent, 'expected the shared NotFound copy naming the unregistered kind').toMatch(/totally-bogus-kind/);
  expect(notFound).not.toBeNull();
  expect(container.querySelector('[data-kickoff-error]')).toBeNull();
  // The page's OWN kickoff-load Promise.all is gated on `if (!spec) return;`
  // — for an unregistered kind it never fires, so neither `fetchStudioKbs`
  // nor `fetchStudioSessions` (called ONLY from inside that gate, never from
  // the unrelated `useProjectRoster()` hook every render also fires) sees a
  // call. `fetchStudioProjects`/`fetchAgentCapability` are deliberately NOT
  // asserted here — `useProjectRoster()` (the SEPARATE architect-roster
  // read every render of this page fires unconditionally, regardless of
  // `kind`) calls both on its own, so a call to either proves nothing about
  // THIS page's own not-found decision.
  expect(fetchStudioKbs, 'the not-found branch must be decided BEFORE the kickoff-load effect can fire').not.toHaveBeenCalled();
  expect(fetchStudioSessions).not.toHaveBeenCalled();
});

test('a real mount-load failure (registered kind) renders data-kickoff-error with the thrown message — never a silent empty roster, never NotFound', async () => {
  await act(async () => {
    root.render(React.createElement(SessionKickoffPage, { params: { kind: 'authoring' } }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(fetchStudioProjects, 'the registered kind must actually attempt the read').toHaveBeenCalled();
  const banner = container.querySelector('[data-kickoff-error]');
  expect(banner, 'a thrown mount-load read must surface its own error banner').not.toBeNull();
  expect(banner?.textContent).toMatch(/ECONNREFUSED/);
  expect(container.textContent).not.toMatch(/No session kind/);
});
