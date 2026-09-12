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

import { RunPanel } from '../../components/studio/agent-builder/RunPanel';

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

let lastPollUpdate: ((s: unknown) => void) | null = null;

// The REAL `AgentRunStatus` shape (`lib/studio-client.ts:1896`), not a stand-in:
// a fake `{status, costUsd}` threw on `costUsd.toFixed` in the panel's own
// render, which is the panel telling me the stub was not the thing.
const DONE_STATUS = { ok: true, state: 'done' as const, costUsd: 0.1905, events: 12 };

vi.mock('@/lib/agent-dispatch', () => ({
  // The poller would otherwise keep a timer alive past the test's own
  // lifetime; the unsubscribe it returns is what `useEffect` cleans up with.
  // 7.6.19: the tests below need to DRIVE the poll, because the defect is what
  // the panel does when the poll reports a TERMINAL status. The mock captures
  // `onUpdate` so a test can deliver `done` the way the real poller would.
  pollAgentRun: vi.fn((runId: string, opts: { onUpdate: (s: unknown) => void }) => {
    lastPollUpdate = opts.onUpdate;
    return () => {};
  }),
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
  lastPollUpdate = null;
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


// ---------------------------------------------------------------------------
// `forge-8vfn.7.6.19` — A STANDALONE RUN REACHES `done` ON DISK WITH ITS COST
// AND `/agents/:slug` SHOWS NEITHER FOR 300 s.
//
// S5 run 4 decided the fork the bead left open, from its own bytes: the bridge
// broadcast the run's terminal event 145 ms after it was written, to TWO
// subscribers, and beat 13 was still blank 4 m 25 s later. So the delivery
// happened and the page did not reflect it.
//
// THE MECHANISM IS A MISSING EDGE, not a missing subscription.
//   `app/agents/[id]/page.tsx:410` refetches the ledger on `historyNonce`;
//   `:861` bumps it from `onRunDispatched` and NOTHING ELSE.
// `onRunDispatched` fires at DISPATCH, when the run is necessarily `running`
// with no cost — so the ledger is read once, at the only moment it is
// guaranteed not to hold the answer, and nothing asks again.
//
// And the panel ALREADY KNOWS: `RunPanel.tsx:326` polls to terminal and reports
// it to its own local state. The page it sits on is never told. These tests pin
// the edge that closes it.
// ---------------------------------------------------------------------------

test('7.6.19: the panel reports the run SETTLED, so the page can re-read a ledger that now holds a cost', async () => {
  const settled: string[] = [];
  await mountRunPanelWithSettled(() => {}, (runId) => settled.push(runId));

  const run = container.querySelector('[data-action="run-agent"]');
  await act(async () => { (run as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });

  expect(settled, 'a dispatch is not a settlement — nothing has finished yet').toEqual([]);

  // The poll reports what the bridge already broadcast: done, with a cost.
  await act(async () => { lastPollUpdate?.(DONE_STATUS); });
  await act(async () => { await Promise.resolve(); });

  expect(settled, 'S5 beat 13: the page must be told the run ENDED, not only that it started').toEqual([RUN_ID]);
});

test('7.6.19: a non-terminal poll update reports NOTHING — a refetch per poll would hammer the bridge and still not be the fix', async () => {
  const settled: string[] = [];
  await mountRunPanelWithSettled(() => {}, (runId) => settled.push(runId));

  const run = container.querySelector('[data-action="run-agent"]');
  await act(async () => { (run as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });

  await act(async () => { lastPollUpdate?.({ ...DONE_STATUS, state: 'running', costUsd: 0, events: 3 }); });
  await act(async () => { lastPollUpdate?.({ ...DONE_STATUS, state: 'running', costUsd: 0, events: 3 }); });
  await act(async () => { await Promise.resolve(); });

  expect(settled, 'still running — there is no new ledger fact to read').toEqual([]);
});

test('7.6.19: settling reports ONCE, however many terminal updates arrive — the nonce is a trigger, not a counter', async () => {
  const settled: string[] = [];
  await mountRunPanelWithSettled(() => {}, (runId) => settled.push(runId));

  const run = container.querySelector('[data-action="run-agent"]');
  await act(async () => { (run as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });

  await act(async () => { lastPollUpdate?.(DONE_STATUS); });
  await act(async () => { lastPollUpdate?.(DONE_STATUS); });
  await act(async () => { await Promise.resolve(); });

  expect(settled, 'one settlement, one re-read').toEqual([RUN_ID]);
});

async function mountRunPanelWithSettled(
  onRunDispatched: (runId: string) => void,
  onRunSettled: (runId: string) => void,
): Promise<void> {
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
        onRunSettled,
      } as never),
    );
  });
  await act(async () => { await Promise.resolve(); });
}
