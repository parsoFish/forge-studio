/**
 * `ReviewVerdictForm` — the cycle verdict gate's DOM contract.
 *
 * WHY THIS FILE EXISTS (bead `forge-8vfn.7.5.4`, filed under T1 ruling 432).
 * Authoring story S10 needs to drive one anchored send-back at the verdict
 * gate, and a census of every handle the eleven pinned stories assert found the
 * send-back HALF of a verdict unreachable: only `verdict-approve` is ever
 * pressed anywhere in the corpus. The reason is here — this component published
 * `data-action` on its submit button and `data-component` / `data-form-*` on
 * its panel, and **nothing else**. Its rationale textarea, its approve /
 * send-back radios and its GIVEN-WHEN-THEN inputs carried no `data-field` at
 * all, so the story DSL — which resolves `[data-field=…]` and `[data-action=…]`
 * and nothing else — could not type into them or switch the form's kind.
 *
 * THE SEND-BACK WAS THEREFORE UNREACHABLE, not merely untested. A field with no
 * handle is not a field a story can use, and the one gate in the product where
 * a human sends work back could not be exercised end to end by the harness that
 * exists to prove the product works.
 *
 * SCOPE, honestly. `renderToStaticMarkup` runs no `useState` and no click
 * handler (there is no jsdom in this suite), so this file pins the INITIAL
 * render — the same disclosed limitation every sibling component test in this
 * directory carries. What it can prove is exactly what was missing: that every
 * control a story must reach is NAMED.
 *
 * RUN: npx vitest run components/ReviewVerdictForm.test.ts   (from apps/studio/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ReviewVerdictForm } from '../../components/ReviewVerdictForm';

const render = (): string =>
  renderToStaticMarkup(React.createElement(ReviewVerdictForm, { initiativeId: 'INIT-2026-09-08-x' }));

/**
 * The send-back kind. The acceptance-criteria block renders only on it, and
 * `renderToStaticMarkup` runs no click handler, so the branch is reachable here
 * only through the component's own `initialKind` — which exists for exactly
 * that reason and defaults to `approve`, leaving every caller unchanged.
 */
const renderSendBack = (): string =>
  renderToStaticMarkup(
    React.createElement(ReviewVerdictForm, { initiativeId: 'INIT-2026-09-08-x', initialKind: 'send-back' }),
  );

test('7.5.4: the panel still publishes what it always did', () => {
  const html = render();
  expect(html).toContain('data-component="verdict-form"');
  expect(html).toContain('data-form-state="editing"');
  expect(html).toContain('data-form-kind="approve"');
  expect(html).toContain('data-initiative-id="INIT-2026-09-08-x"');
  expect(html).toContain('data-ac-count="0"');
});

test('7.5.4 (RED): the rationale textarea is NAMED — a story must be able to type the reason', () => {
  expect(render()).toContain('data-field="verdict-rationale"');
});

test('7.5.4 (RED): both verdict kinds are NAMED — without these the send-back is unreachable', () => {
  const html = render();
  // The kind is a radio pair, so a story SELECTS one by its option handle —
  // the shape `kickoff-model-tier-option` already established in S9.
  expect(html).toContain('data-field="verdict-kind-option"');
  expect(html).toContain('data-verdict-kind="approve"');
  expect(html).toContain('data-verdict-kind="send-back"');
});

test('7.5.4 (RED): the first acceptance criterion\'s three inputs are NAMED and NUMBERED', () => {
  const html = renderSendBack();
  // Parametrised by row, the shape S2's `demo-step-<n>` already established:
  // a fixed name could only ever address one row.
  expect(html).toContain('data-field="verdict-ac-given-1"');
  expect(html).toContain('data-field="verdict-ac-when-1"');
  expect(html).toContain('data-field="verdict-ac-then-1"');
});

test('7.5.4 (RED): adding and removing a criterion are NAMED acts', () => {
  const html = renderSendBack();
  expect(html).toContain('data-action="add-criterion"');
  expect(html).toContain('data-action="remove-criterion-1"');
});

test('7.5.4: the acceptance-criteria section reports how many rows it has', () => {
  const html = renderSendBack();
  expect(html).toContain('data-section="acceptance-criteria"');
  expect(html).toContain('data-ac-row-count="1"');
});

test('7.5.4 POSITIVE CONTROL: the submit CTA keeps the action name the corpus already knows', () => {
  // `approve-and-merge` on the approve kind — renaming it would break the
  // handle `DemoReviewSurface` publishes for the same act, and a story cannot
  // tell two surfaces apart by anything else.
  expect(render()).toContain('data-action="approve-and-merge"');
});

test('7.5.4 POSITIVE CONTROL: a disabled submit says WHY, so a red beat names the cause', () => {
  // The CTA is disabled until the rationale is non-empty, which is the state a
  // story lands in first. Without a reason the beat can only report that a
  // press did nothing.
  const html = render();
  expect(html).toContain('data-disabled-reason="a rationale is required before a verdict can be submitted"');
});

test('7.5.4 POSITIVE CONTROL: the approve kind renders NO acceptance criteria — the default is unchanged', () => {
  // `initialKind` exists to make a branch renderable, not to change what the
  // form opens on. A caller that passes nothing gets exactly what it always got.
  const html = render();
  expect(html).not.toContain('data-section="acceptance-criteria"');
  expect(html).toContain('data-form-kind="approve"');
});

test('7.5.4: the send-back kind reports its criterion count on the panel too', () => {
  expect(renderSendBack()).toContain('data-ac-count="1"');
});
