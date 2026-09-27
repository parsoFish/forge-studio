// @vitest-environment jsdom
/**
 * Row 156 (bead `forge-8vfn.8.1.44`, ruling 1852) — the flow monitor's
 * `pickDefaultRun` (`lib/run-selection.ts`, moved out of
 * `app/flows/[id]/page.tsx` by this same row) never picks a FAILED run
 * (priority: gated → active → complete → planned). After S10 ACT 2 stops its
 * second run, a fresh monitor mount showed ACT 1's own COMPLETE run instead —
 * and `RunRail`'s cards (`components/studio/RunRail.tsx`'s `RunCard`) were
 * already clickable (`onClick={() => onSelect(run.id)}`) but exposed no
 * `data-action` a user or a story could press to reach the failed run.
 *
 * THIS FILE pins the fix — `[data-action="select-run-<runId>"]` on that SAME
 * card element. The run's own id is CONCATENATED into the `data-action`
 * value, the same `open-initiative-<id>` convention `InitiativeDetail.tsx`
 * already uses — never a bare `select-run` plus a separate `data-run-id` to
 * scope it, which no story DSL verb can target: a bare `press` resolves an
 * unscoped `[data-action]` via `.first()`, ambiguous the moment two run cards
 * are on the rail, and `pressWithin`'s scoped selector only matches an action
 * on a DESCENDANT of the scoping attribute's element, never the SAME element
 * a card's `data-run-id` and `data-action` both sit on.
 *
 * Pinned through a REAL, INTERACTIVE render: jsdom +
 * `react-dom/client` (the `kickoff-publish-and-stay.test.ts` convention),
 * because the defect is about a PRESS changing what the page shows and
 * SURVIVING A REMOUNT (the sessionStorage sticky layer) — neither is
 * observable under `renderToStaticMarkup`, which is why `run-controls-
 * render.test.ts` / `run-operator-stop-render.test.ts` (this same
 * component pair, initial-render only) cannot cover it.
 *
 * `SelectableMonitor` below is the SMALLEST REAL component tree that owns
 * run selection: it mounts the REAL `RunRail` and the REAL `RunControls`,
 * wired through the REAL production selection primitives
 * (`resolveInitialRun` / `readStickyRunSelection` / `writeStickyRunSelection`,
 * `lib/run-selection.ts`) — the exact functions `app/flows/[id]/page.tsx`
 * itself calls from `loadData`/`handleSelectRun`. It is not a second,
 * reimplemented selection mechanism; it is the page's own wiring, minus the
 * kickoff/scheduler/topology/event-tail/ledger furniture that is irrelevant
 * to this defect and would otherwise need its own fetch mocking to mount at
 * all.
 */
import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { useCallback, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/flows/forge-develop',
  useSearchParams: () => new URLSearchParams(),
}));

import { RunRail } from '../../components/studio/RunRail.tsx';
import { RunControls } from '../../components/studio/RunControls.tsx';
import { readStickyRunSelection, resolveInitialRun, writeStickyRunSelection } from '../../lib/run-selection.ts';
import type { Run, RunStatus } from '../../lib/studio-client.ts';

const FLOW_ID = 'forge-develop';

function makeRun(id: string, status: RunStatus, over: Partial<Run> = {}): Run {
  return {
    id,
    flowId: FLOW_ID,
    initiativeId: `INIT-${id}`,
    initiative: `initiative ${id}`,
    status,
    origin: 'architect',
    costUsd: 1,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: [FLOW_ID],
    ...over,
  };
}

const RUN_A = makeRun('run-a', 'complete');
const RUN_B = makeRun('run-b', 'failed', { failNote: 'gate red' });

/** The page's own selection wiring — `app/flows/[id]/page.tsx`'s `loadData`
 *  initial pick and `handleSelectRun`, over the SAME `lib/run-selection.ts`
 *  primitives — minus every other piece of that page. */
function SelectableMonitor({ runs }: { runs: Run[] }): JSX.Element {
  const [activeRun, setActiveRun] = useState<Run | null>(() =>
    resolveInitialRun(runs, { sticky: readStickyRunSelection(FLOW_ID) }));
  const handleSelectRun = useCallback((runId: string) => {
    const found = runs.find((r) => r.id === runId) ?? null;
    setActiveRun(found);
    if (found) writeStickyRunSelection(FLOW_ID, found.id);
  }, [runs]);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(RunRail, {
      runs, activeRunId: activeRun?.id ?? null, onSelect: handleSelectRun, flowId: FLOW_ID,
    }),
    React.createElement(RunControls, { run: activeRun, schedulerStrip: false }),
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  try { window.sessionStorage.clear(); } catch { /* not available in this env */ }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(runs: Run[]): Promise<void> {
  await act(async () => {
    root.render(React.createElement(SelectableMonitor, { runs }));
  });
}

test('156: today\'s default pick is the COMPLETE run — RunControls renders nothing for it', async () => {
  await mount([RUN_A, RUN_B]);
  expect(container.querySelector('[data-section="run-controls"]')).toBeNull();
});

test(
  '156: the failed run\'s card carries a pressable select-run handle, and pressing it selects that run',
  async () => {
    await mount([RUN_A, RUN_B]);
    const card = container.querySelector<HTMLElement>('[data-action="select-run-run-b"]');
    expect(card, 'RunRail must expose a select-run control on the failed run\'s own card').not.toBeNull();

    await act(async () => { card!.click(); });

    const controls = container.querySelector('[data-section="run-controls"]');
    expect(controls, 'selecting the failed run must make RunControls render for it').not.toBeNull();
    expect(controls!.getAttribute('data-run-id')).toBe('run-b');
    expect(controls!.getAttribute('data-run-status')).toBe('failed');
  },
);

test('156: the select-run press wires to the SAME handler the card was already clicking — no second mechanism', async () => {
  await mount([RUN_A, RUN_B]);
  // The whole card is the control (data-action sits on the same element as
  // the pre-existing onClick), not a nested button — pressing anywhere on
  // the card (not just a sub-element) must select it.
  const card = container.querySelector<HTMLElement>('[data-action="select-run-run-b"]');
  expect(card!.hasAttribute('data-run-status')).toBe(true);
  await act(async () => { card!.click(); });
  expect(container.querySelector('[data-section="run-controls"]')?.getAttribute('data-run-id')).toBe('run-b');
});

test('156: the selection is STICKY — a fresh mount (remount) still shows the pressed run', async () => {
  await mount([RUN_A, RUN_B]);
  const card = container.querySelector<HTMLElement>('[data-action="select-run-run-b"]');
  await act(async () => { card!.click(); });
  expect(container.querySelector('[data-section="run-controls"]')?.getAttribute('data-run-id')).toBe('run-b');

  // Remount — a fresh page load reads the sticky pick straight off
  // sessionStorage, exactly like app/flows/[id]/page.tsx's own loadData.
  await act(async () => { root.unmount(); });
  root = createRoot(container);
  await mount([RUN_A, RUN_B]);

  const controls = container.querySelector('[data-section="run-controls"]');
  expect(controls, 'the remounted page must still show the sticky-selected failed run').not.toBeNull();
  expect(controls!.getAttribute('data-run-id')).toBe('run-b');
});
