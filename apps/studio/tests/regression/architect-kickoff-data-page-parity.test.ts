// @vitest-environment jsdom
/**
 * crosscut-R12 (forge-6gv.2.1) — the architect kickoff form is served at two
 * addresses reporting different `data-page` values.
 *
 * `/architect/new` (`app/architect/new/page.tsx`) and `/sessions/architect/new`
 * (`app/sessions/[kind]/new/page.tsx`'s `kind === 'architect'` early return,
 * W7-B6) render the SAME converged form (`NewIdeaBox`) — the whole point of
 * W7-B6 was that the two entries stop being two forms. But the host shell
 * around it still declared two different `data-page` identities:
 * `"architect-new"` on the first, `"session-kickoff"` (the GENERIC kickoff
 * shape's value, shared with every non-architect kind on this same page) on
 * the second. A journey or story reading `data-page` off the converged form
 * would see a different page identity depending only on which URL it typed.
 *
 * FIX: `/sessions/architect/new` now declares `"architect-new"` too —
 * matching `/architect/new`, the more specific and pre-existing name, rather
 * than the generic per-kind fallback. `mainData={{ 'data-kickoff-kind':
 * 'architect' }}` is UNCHANGED (that attribute already told the two apart at
 * the field level; this fixes the ROOT identity).
 *
 * No story exercises `/sessions/architect/new` directly (verified: no
 * `sessions/architect/new` route assertion in `tests/stories/*`) — every
 * `page: 'session-kickoff'` story assertion is a NON-architect kind
 * (authoring/etc, the page's generic branch, untouched here) — so this fix
 * needed no story-beat change.
 *
 * jsdom (like this file's sibling `kickoff-publish-and-stay.test.ts`):
 * `StudioArchitectShell` renders `data-page` unconditionally on `<main>`
 * regardless of the roster fetch's resolution, so no `act(async …)` wait is
 * needed — but the page's other reads still need real mocks to avoid an
 * unhandled rejection.
 *
 * RUN: npx vitest run --root apps/studio tests/regression/architect-kickoff-data-page-parity.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SessionKickoffPage from '@/app/sessions/[kind]/new/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sessions/architect/new',
  useParams: () => ({ kind: 'architect' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/lib/bridge-client', () => ({
  startInstructions: vi.fn(), startDemoBuilder: vi.fn(), startProjectBrain: vi.fn(), startAuthoring: vi.fn(),
}));

vi.mock('@/lib/studio-client', () => ({
  fetchStudioProjects: vi.fn(async () => [{ id: 'gitpulse', name: 'gitpulse' }]),
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('RED crosscut-R12: /sessions/architect/new declares data-page="architect-new", matching /architect/new', async () => {
  await act(async () => {
    root.render(React.createElement(SessionKickoffPage, { params: { kind: 'architect' } }));
  });

  expect(container.querySelector('main[data-page="architect-new"]')).not.toBeNull();
  expect(container.querySelector('main[data-page="session-kickoff"]')).toBeNull();
  // The field-level identity is unchanged — this fixes the ROOT, not this.
  expect(container.querySelector('main[data-kickoff-kind="architect"]')).not.toBeNull();
});
