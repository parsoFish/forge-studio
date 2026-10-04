/**
 * W7-A3 (projects-16/17/32, flows-02); M7-E row 205 (ADR 011/031) — DOM
 * contract pins for `EnqueueOutcomeLineView`
 * (`components/studio/EnqueueOutcomeLine.tsx`), the honest post-enqueue line
 * under Plan / Start development / Start Run.
 *
 * Kills: "Development started — the unifier will open a PR"; a "view run →"
 * that links the flow index instead of the run the enqueue returned; a
 * restarting/down serve asserting progress with no honest notice.
 *
 * RUN: npx vitest run lib/enqueue-outcome-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EnqueueOutcomeLineView } from '@/components/studio/EnqueueOutcomeLine';
import type { ServeStatus } from '@/lib/bridge-client';

const INIT = 'INIT-2026-08-18-add-version-flag';
const RUNNING: ServeStatus = { state: 'running', pid: 123, restarts: 0, nextRestartAt: null, halt: null };

function render(props: Partial<React.ComponentProps<typeof EnqueueOutcomeLineView>>): string {
  return renderToStaticMarkup(React.createElement(EnqueueOutcomeLineView, {
    kind: 'develop',
    runAction: 'open-develop-run',
    serve: RUNNING,
    ...props,
  }));
}

test('develop enqueue, serve running → develop-flow claim (no unifier), run link carries flow + the initiative (stable run handle)', () => {
  const html = render({ runId: INIT, flowId: 'forge-develop' });
  expect(html).toContain('data-component="enqueue-outcome"');
  expect(html).toContain('data-enqueue-kind="develop"');
  expect(html).toContain('Development enqueued — the develop flow will open a PR for review.');
  expect(html.toLowerCase()).not.toContain('unifier');
  expect(html).toMatch(new RegExp(`<a[^>]*data-action="open-develop-run"[^>]*href="/flows/forge-develop/run/${INIT}"`));
  expect(html).not.toContain('data-component="serve-status-notice"');
});

test('plan enqueue, serve restarting → the shared notice mounts + the run link is still kept', () => {
  const html = render({
    kind: 'plan',
    runAction: 'open-plan-run',
    runId: 'c1',
    flowId: 'forge-architect',
    serve: { state: 'restarting', pid: null, restarts: 1, nextRestartAt: '2026-01-01T00:00:01.000Z', halt: null },
  });
  expect(html).toContain('Planning enqueued — forge serve will decompose it into work items.');
  expect(html).toContain('data-component="serve-status-notice"');
  expect(html).toContain('data-serve-state="restarting"');
  expect(html).toMatch(/<a[^>]*data-action="open-plan-run"[^>]*href="\/flows\/forge-architect\/run\/c1"/);
});

test('serve not yet read (null) → claim still renders, no notice fabricated', () => {
  const html = render({ serve: null, runId: 'c1', flowId: 'forge-develop' });
  expect(html).toContain('Development enqueued — the develop flow will open a PR for review.');
  expect(html).not.toContain('data-component="serve-status-notice"');
});

test('no cycle/flow in the result → no run link fabricated', () => {
  const html = render({});
  expect(html).not.toContain('data-action="open-develop-run"');
});

// ---------------------------------------------------------------------------
// Bead `forge-8vfn.7.6.8` (T1 rulings 536/537) — THE MINTED-RUN RULE.
//
// The minted-session convention already covers a session an operator has just
// created: the surface publishes the id BEFORE the navigation that consumes it
// (`data-minted-session-id`, `data-architect-session-id`,
// `data-onboard-session-id`), so a story can bind it from the page that minted
// it. A minted RUN had no such attribute. This line received `runId`, built the
// href from it, and published the id NOWHERE — so the run was nameable only by
// reading a URL out of an anchor, which no beat can do.
//
// Ruling 536 records the cost: S10 has five routes that need `<runId>` and no
// beat could bind it. `recovery-requeue` mounts this same component, so act 2's
// requeued run is covered by the same attribute (537).
// ---------------------------------------------------------------------------

test('7.6.8: the line publishes the run id it was handed, on the always-present root', () => {
  const html = render({ runId: INIT, flowId: 'forge-develop' });
  expect(html).toMatch(new RegExp(`<div[^>]*data-component="enqueue-outcome"[^>]*data-run-id="${INIT}"`));
});

test('7.6.8: the published id and the run link cannot disagree — one runId, two consumers', () => {
  // The failure this kills is not "no attribute" but "an attribute that names a
  // different run than the link beside it" — the two-notions-of-one-thing class
  // this campaign keeps paying for. Both are derived from the same prop, and
  // this asserts the rendered result, not the derivation.
  const html = render({ runId: INIT, flowId: 'forge-develop' });
  const published = /data-run-id="([^"]*)"/.exec(html)?.[1] ?? null;
  const linked = /<a[^>]*data-action="open-develop-run"[^>]*href="\/flows\/forge-develop\/run\/([^"]*)"/.exec(html)?.[1] ?? null;
  expect(published).toBe(INIT);
  expect(linked).not.toBeNull();
  expect(decodeURIComponent(linked!)).toBe(published);
});

test('7.6.8: no run id, no attribute — never an empty string a beat could bind', () => {
  // `data-run-id=""` would read to the runner as "the product minted nothing",
  // which is a DIFFERENT and more useful failure than "absent" only when a run
  // really was minted. Here no run exists, so the honest answer is silence: the
  // omit-don't-default discipline the ledger row and the cost surfaces keep.
  const html = render({ runId: undefined, flowId: 'forge-develop' });
  expect(html).toContain('data-component="enqueue-outcome"');
  expect(html).not.toContain('data-run-id');
});
