/**
 * Bead forge-mfv5.1.39 (R13/R39) — a fix round the drain HALTED (`Run.roundHalt`,
 * from `sendback.loop-halted`) reads as halted by name on every surface that
 * showed "round N running" or nothing at all: the run page root carries
 * `data-round-halt=<classification>`, its failed-run line names the round and the
 * reason beside Requeue, and the verdict card heads "Round N halted: <reason>"
 * with the way to the run page's Requeue. Rendered through the REAL components.
 */
import { test, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/flows/forge-develop',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/use-serve-status', () => ({ useServeStatus: () => ({ status: null, ready: true, refresh: async () => {} }) }));

import { RunControls } from '../../components/studio/RunControls.tsx';
import { FlowRunDetail } from '../../components/studio/FlowRunDetail.tsx';
import { DecisionCard } from '../../components/studio/gate/DecisionCard.tsx';
import type { Run, Flow } from '../../lib/studio-client.ts';
import { runFailureNoteKind } from '../../lib/run-controls.ts';

const HALT = { round: 2, classification: 'terminal', reason: 'resume-needs-rebase: the preserved worktree has uncommitted changes to tracked files — commit or discard them, then requeue: M gitweave.egg-info/SOURCES.txt' };
const RUN: Run = {
  id: '2026-10-12T05-14-21_INIT-2026-10-11-i3b', flowId: 'forge-develop', initiativeId: 'INIT-2026-10-11-i3b', initiative: 'i3b',
  status: 'failed', origin: 'architect', costUsd: 13.64, phases: {}, phaseMeta: {}, artifactsReady: {}, flowLineage: ['forge-develop'],
  failNote: 'entry rebase onto main refused', roundHalt: HALT,
};
const FLOW: Flow = { id: 'forge-develop', name: 'develop', goal: '', nodes: [], edges: [], triggers: [] };
const markup = (C: unknown, props: Record<string, unknown>): string => renderToStaticMarkup(React.createElement(C as never, props as never));

test('the run page root carries data-round-halt=<classification>; empty for a run that did not halt', () => {
  const halted = markup(FlowRunDetail, { runId: RUN.id, found: true, flow: FLOW, run: RUN, rows: [], findings: { doc: null, failed: false } });
  expect(halted).toMatch(/data-page="flow-run"[^>]*data-round-halt="terminal"/);
  const { roundHalt: _drop, ...plain } = RUN;
  const other = markup(FlowRunDetail, { runId: RUN.id, found: true, flow: FLOW, run: plain, rows: [], findings: { doc: null, failed: false } });
  expect(other).toMatch(/data-page="flow-run"[^>]*data-round-halt=""/);
});

test('the failed-run line names the halted round and its reason beside Requeue — never a bare "Run failed"', () => {
  const html = markup(RunControls, { run: RUN });
  expect(html).toContain('data-round-halt="terminal"');
  expect(html).toContain('Round 2 halted: resume-needs-rebase');
  expect(html).toContain('gitweave.egg-info/SOURCES.txt');
  expect(html).toContain('data-action="requeue-run"');
  expect(html).not.toContain('Run failed');
});

function card(roundHalt?: { halt: typeof HALT; href: string }): string {
  return markup(DecisionCard, {
    derived: { kind: 'approve' }, blockerCount: 0, resolvedCount: 0, initiativeId: RUN.initiativeId, submitting: false, submitted: null,
    error: null, composing: false, onCompose: () => {}, onSubmit: () => {}, onTypedSubmitted: () => {},
    claims: { present: true, missed: 0, major: 0, blocker: 0, stale: false }, roundHalt,
  });
}

test('the verdict card heads "Round N halted: <reason>" with the way to Requeue, and approving needs a rationale', () => {
  const html = card({ halt: HALT, href: `/flows/forge-develop/run/${RUN.id}` });
  expect(html).toMatch(/data-headline="not-ready"[^>]*>Round 2 halted: resume-needs-rebase/);
  expect(html).toContain('data-round-halt="terminal"');
  expect(html).toMatch(/data-action="open-run-recovery"[^>]*>|href="\/flows\/forge-develop\/run\/2026-10-12T05-14-21_INIT-2026-10-11-i3b"/);
  expect(html).toContain('a rationale is required to approve over a halted fix round');
  expect(html).not.toMatch(/running/i);
});

// forge-mfv5.1.57: the drain's park (`fix-loop.needs-operator`) reaches the verdict card through the same Run.roundHalt.
test('a parked fix round heads "Round N parked: <detail>" on the verdict card — no Requeue link, the send-back is the way out', () => {
  const park = { round: 3, classification: 'needs-operator', reason: 'failed fix work-item WI-17 — send back a new fix work item to supersede it, or take the worktree over' };
  const html = card({ halt: park, href: `/flows/forge-develop/run/${RUN.id}` });
  expect(html).toMatch(/data-headline="not-ready"[^>]*>Round 3 parked: failed fix work-item WI-17/);
  expect(html).toContain('data-round-halt="needs-operator"');
  expect(html).toContain('send back a new fix work item below');
  expect(html).not.toContain('data-action="open-run-recovery"');
});

test('CONTROL: without a halt the card reads as before', () => {
  const html = card();
  expect(html).toContain('Ready to approve and merge');
  expect(html).not.toContain('data-round-halt');
});

test('runFailureNoteKind: a round halt outranks the generic failNote; a budget or operator stop still outranks it', () => {
  expect(runFailureNoteKind(RUN)).toBe('round-halt');
  expect(runFailureNoteKind({ ...RUN, operatorStop: true })).toBe('operator-stop');
  expect(runFailureNoteKind({ ...RUN, stopOnBudget: { spentUsd: 5, ceilingUsd: 5, resumable: true, completedWorkItems: 0, totalWorkItems: 1 } })).toBe('budget');
  expect(runFailureNoteKind({ ...RUN, status: 'active' })).toBe(null);
});
