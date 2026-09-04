/**
 * W8-A3 — the repoint confirmation, on every surface that can move an
 * initiative between flows (`flows-37`).
 *
 * WHY THIS FILE EXISTS. Adversarial review round 2 found that two of the three
 * confirmations this lane added shipped with **no test at all** — the project
 * page's Start-work group and (before it was added) the roadmap card's — and
 * that an untested new UI path is exactly how round 1's own S2-3 happened (the
 * fix turned a silently-corrupting control into a permanently-409 one, and
 * nothing noticed). Round 2 also found the panel had been hand-copied per
 * surface, which is the same shape as the defect being closed. There is one
 * component now, and this file pins it plus the one surface whose confirmation
 * state is reachable from props alone.
 *
 * WHAT IS NOT COVERED, AND WHY — stated plainly rather than implied. The
 * project page's Start-work panel only appears after a refused POST, and
 * `renderToStaticMarkup` cannot click; jsdom and testing-library are not
 * installed and this file deliberately does not add them. So for that ONE
 * surface, only the bar it renders (below) and the client call it makes
 * (`startFlowRun`/`planInitiative` sending `confirmRepoint`, pinned over the
 * wire in `apps/forge/ui-bridge-flow-run-repoint.test.ts` and `apps/forge/ui-bridge-plan.test.ts`)
 * are covered; the wiring between them is not. The roadmap card IS fully
 * covered here, because its confirmation state is reachable from props, and its
 * decision half is pinned in `lib/roadmap-card-state.test.ts`.
 */
import { test, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/projects/mdtoc',
  useSearchParams: () => new URLSearchParams(),
}));

import { RepointConfirmBar } from '../components/studio/RepointConfirmBar.tsx';
import { InitiativeDetail } from '../components/studio/InitiativeDetail.tsx';

function markup(Component: unknown, props: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(Component as never, props as never));
}

const BAR = {
  initiativeId: 'INIT-2026-08-18-alpha',
  currentFlowId: 'my-authored-flow',
  targetFlowId: 'forge-develop',
  verb: 'Start development',
  onConfirm: () => {},
  onCancel: () => {},
};

test('flows-37: the bar names the initiative, the flow of origin AND the target — all three, or the operator cannot judge it', () => {
  const html = markup(RepointConfirmBar, BAR);
  expect(html).toContain('data-component="repoint-confirm"');
  expect(html).toContain('data-initiative-id="INIT-2026-08-18-alpha"');
  expect(html).toContain('data-current-flow="my-authored-flow"');
  expect(html).toContain('data-target-flow="forge-develop"');
  // The flow of origin must be in the VISIBLE copy, not only in an attribute —
  // "no flow-of-origin disclosure in the option label" is the finding verbatim.
  expect(html).toContain('my-authored-flow');
  expect(html).toContain('forge-develop');
});

test('flows-37: the bar offers both a confirm and a cancel — a confirmation with no way out is a forced move', () => {
  const html = markup(RepointConfirmBar, BAR);
  expect(html).toContain('data-action="confirm-repoint"');
  expect(html).toContain('data-action="cancel-repoint"');
});

test('flows-37: a busy bar disables the confirm but never the cancel', () => {
  const html = markup(RepointConfirmBar, { ...BAR, busy: true });
  expect(html).toMatch(/data-action="confirm-repoint"[^>]*disabled/);
  expect(html).not.toMatch(/data-action="cancel-repoint"[^>]*disabled/);
});

// ---- the roadmap card, whose confirmation state IS reachable from props -----

function card(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expanded: true,
    initiativeId: 'INIT-2026-08-18-alpha',
    status: 'pending',
    dependsOnInitiatives: [],
    blocked: false,
    blockedBy: [],
    unplanned: true,
    wiLevels: null,
    runCycleIds: [],
    plan: { status: 'idle', error: null },
    canStartDevelopment: false,
    develop: { status: 'idle', error: null },
    attempt: { attemptCount: 1, priorCycleIds: [] },
    recoveryDetail: null,
    recoveryBusy: false,
    recoveryNote: '',
    onInspectRecovery: () => {},
    onRecoveryAction: () => {},
    onPlan: () => {},
    onStart: () => {},
    onDismissRepoint: () => {},
    ...over,
  };
}

test('flows-37 (review round 2, finding 1): a refused PLAN renders the confirmation, not a dead retry button', () => {
  // KILLS: `planStateFromResult` collapsing `repoint-requires-confirm` into
  // `{status:'error'}`. That relabelled the button "retry — plan", which
  // re-posted the identical unconfirmed request forever — round 1's S2-3
  // re-shipped one component over.
  const html = markup(InitiativeDetail, card({
    plan: { status: 'needs-confirm', error: null, currentFlowId: 'my-authored-flow' },
  }));
  expect(html).toContain('data-component="repoint-confirm"');
  expect(html).toContain('data-current-flow="my-authored-flow"');
  expect(html).toContain('data-target-flow="forge-architect"');
  // Review round 3, S1-1 + S3-13: the FIRST version of this assertion checked
  // that the label "retry — plan" was absent — which is true whether or not the
  // unconfirmed control renders, because on `needs-confirm` the ternary yields
  // "Plan →". The implementation that shipped (bar rendered, button still live
  // and enabled directly above it) passed it. Assert the CONTROL's absence.
  expect(html, 'the unconfirmed control must not stay live beside the confirmation it raised')
    .not.toContain('data-action="plan-initiative"');
  expect(html).not.toContain('retry — plan');
});

test('flows-37 (review round 2, finding 2): a refused per-card START renders the confirmation — this control names ONE initiative, so it can ask', () => {
  // KILLS: the "no confirm because it is a batch" argument being applied to a
  // control that posts exactly one named initiative, through a route that (until
  // this round) could not be confirmed through at all.
  const html = markup(InitiativeDetail, card({
    unplanned: false,
    canStartDevelopment: true,
    develop: { status: 'needs-confirm', error: null, currentFlowId: 'my-authored-flow' },
  }));
  expect(html).toContain('data-component="repoint-confirm"');
  expect(html).toContain('data-target-flow="forge-develop"');
  // Round 3, S1-1 + S3-13, as above.
  expect(html, 'the unconfirmed control must not stay live beside the confirmation it raised')
    .not.toContain('data-action="start-development"');
  expect(html).not.toContain('retry — start development');
});

test('flows-37: an idle card renders its control and no confirmation', () => {
  const html = markup(InitiativeDetail, card());
  expect(html).not.toContain('data-component="repoint-confirm"');
  // The positive control: hiding the button on `needs-confirm` must not hide it
  // in the state the operator actually starts from.
  expect(html).toContain('data-action="plan-initiative"');
});
