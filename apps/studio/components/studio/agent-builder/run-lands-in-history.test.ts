// @vitest-environment jsdom
/**
 * A dispatch must land in the agent's own run history — ruling 401 (T1 M6),
 * measured on story S5 beat 12.
 *
 * WHAT WAS MEASURED. `_1.0/reports/m6-d-S5-1.log` (S5 10/13 at `38d96f3d`):
 *
 *     ✓ 11. Run the agent standalone against mdtoc
 *     ✗ 12. Watch the run land in the agent's own history
 *           data-ledger-count: expected "1", got "0"
 *
 * The dispatch fired and the run panel correctly read `running` — beat 11 is
 * green — and the agent's own history stayed empty. `app/agents/[id]/
 * page.tsx`'s history effect was keyed on `[slugParam, isNew]`, and a
 * dispatch changes neither, so the operator had to leave the page and come
 * back to see the run they had just started.
 *
 * WHY THE FIX IS A RE-READ AND NOT AN OPTIMISTIC ROW. The row already exists
 * when the dispatch resolves: `packages/agents/bridge-agents-slug.ts:466-479`
 * emits `agent-run.dispatched` through kernel logging's SYNCHRONOUS
 * `appendFileSync` (`packages/kernel/logging.ts:164`) before the response at
 * `:543` hands the runId back, and that marker exists — its own comment says
 * so — precisely so "the history route can attribute the run to its slug even
 * if the child dies before runAgent's own `start` event". Splicing in a row
 * here would mean inventing its status and cost, which is what
 * `HistoryLedger`'s "never fabricated rows" rule forbids.
 *
 * WHY THIS FILE NEEDS A DOM, like `agent-builder-handles.test.ts` and
 * `kickoff-mint-before-navigate.test.ts` beside it: the claim is about what
 * happens AFTER an async click handler resolves. `renderToStaticMarkup`
 * never runs the handler, so the only honest way to assert "the press
 * reported the run upward" is to commit a real click.
 *
 * SCOPE, STATED HONESTLY. This pins the seam the fix ADDS — RunPanel reports
 * a resolved dispatch, and stays silent on a refused one. The page's own two
 * lines (the nonce in the effect's dependency list, and the callback that
 * bumps it) are covered by `test:ui:typecheck` and proved end-to-end by S5
 * beat 12 itself on the next funded run; a page-level mount would need every
 * one of that route's clients stubbed, and a test that elaborate is likelier
 * to pin its own mocks than the product.
 *
 * MUTATION PASS (§15.68 — a control that is green either way is not a
 * control). Re-running with `onRunDispatched?.(r.runId)` deleted reds the
 * first test naming the missing call; re-running with it moved OUTSIDE the
 * `r.ok && r.runId` branch reds the second. Recorded in the PR body.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { RunPanel } from './RunPanel';

const RUN_ID = '_agent-story-s5-2026-09-07T12-08-01-688-45b6';

const dispatchAgentRun = vi.fn(async () => ({ ok: true, runId: RUN_ID }) as { ok: boolean; runId?: string; error?: string });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/agents/story-s5',
  useParams: () => ({ id: 'story-s5' }),
}));

// The rest-spread is load-bearing, not tidiness. The real `next/link`
// FORWARDS every extra prop onto the anchor it renders, so a mock that keeps
// only `href` and `children` silently drops `data-action` — and an assertion
// about a handle then fails against correct product code. Lane M6-A paid for
// that with a red run on 2026-09-07 while landing ruling 396; recorded here
// so the next person to extend this file does not pay for it again.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

// Exactly the four value exports RunPanel.tsx imports from this module, and
// no more — a mock that offers extra surface invites a future test to lean on
// something the component never uses.
vi.mock('@/lib/studio-client', () => ({
  dispatchAgentRun: (...args: unknown[]) => dispatchAgentRun(...(args as [])),
  parseRunInputs: () => ({}),
  // `null` = "this agent has no previous run to reattach to", which is the
  // state S5 beat 12 is measured in: a freshly created agent, dispatched
  // once. If this returned a row, the panel would reattach to it and the
  // press under test would never happen.
  fetchLatestStandaloneRun: vi.fn(async () => null),
  cancelAgentRun: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/agent-dispatch', () => ({
  // The poller would otherwise keep a timer alive past the test's own
  // lifetime; the unsubscribe it returns is what `useEffect` cleans up with.
  pollAgentRun: vi.fn(() => () => {}),
  pollDisplayState: vi.fn(() => 'running'),
}));

// Returns `EventLogEntry[]` directly (use-cycle-events.ts:19), not a wrapper —
// the ActivityLog the panel mounts once a runId exists iterates it.
vi.mock('@/lib/use-cycle-events', () => ({
  useCycleEvents: () => [],
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom implements no layout, so `Element.scrollIntoView` does not exist —
  // the ActivityLog the panel mounts once a runId is set calls it to follow
  // the tail. A jsdom gap, not a product fact, so it is stubbed rather than
  // designed around.
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
  dispatchAgentRun.mockClear();
  dispatchAgentRun.mockImplementation(async () => ({ ok: true, runId: RUN_ID }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountRunPanel(onRunDispatched: (runId: string) => void): Promise<void> {
  await act(async () => {
    root.render(
      React.createElement(RunPanel, {
        slug: 'story-s5',
        interactive: false,
        canRun: true,
        blockedMessage: '',
        projects: [{ id: 'mdtoc', name: 'mdtoc' }] as never,
        declaredMaterialKinds: [],
        defaultCostCeilingUsd: 2,
        costCeilingEnforceable: true,
        onRunDispatched,
      } as never),
    );
  });
  await act(async () => { await Promise.resolve(); });
}

test('401: a resolved standalone dispatch reports its run id upward, so the page can re-read the history that now holds it', async () => {
  const dispatched: string[] = [];
  await mountRunPanel((runId) => dispatched.push(runId));

  const run = container.querySelector('[data-action="run-agent"]');
  expect(run, 'the run control must exist before this test can claim anything').not.toBeNull();

  await act(async () => {
    (run as HTMLButtonElement).click();
  });
  await act(async () => { await Promise.resolve(); });

  expect(dispatchAgentRun).toHaveBeenCalledTimes(1);
  expect(dispatched, 'S5 beat 12: the press must tell the page a run now exists').toEqual([RUN_ID]);
});

test('401: a REFUSED dispatch reports nothing — a re-read would find no row, and a bumped key would only hide the error', async () => {
  dispatchAgentRun.mockImplementation(async () => ({ ok: false, error: 'dispatch failed' }));
  const dispatched: string[] = [];
  await mountRunPanel((runId) => dispatched.push(runId));

  const run = container.querySelector('[data-action="run-agent"]');
  await act(async () => {
    (run as HTMLButtonElement).click();
  });
  await act(async () => { await Promise.resolve(); });

  expect(dispatchAgentRun).toHaveBeenCalledTimes(1);
  expect(dispatched, 'nothing was dispatched, so there is nothing to re-read').toEqual([]);
});
