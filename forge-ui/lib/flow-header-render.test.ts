/**
 * DOM regression + acceptance tests for item forge-zyc pins 2 and 4, both
 * against the REAL `FlowHeader` component
 * (forge-ui/components/studio/flow-builder/FlowHeader.tsx). Renders via
 * `react-dom/server`'s `renderToStaticMarkup`, following
 * `./run-panel-render.test.ts` / `./standing-triggers-render.test.ts`'s
 * established precedent (no jsdom / `@testing-library/react` in this repo —
 * see those files' headers for the full rationale). `useEffect` (the KB
 * fetch) does not run under `renderToStaticMarkup`, which is fine — neither
 * pin below depends on it.
 *
 * --- Pin 2 (authorability) ---------------------------------------------
 *
 * FlowHeader.tsx:361-373 renders one `<option>` per entry of the
 * `SHIPPED_TRIGGER_KINDS` mirror (studio-client.ts:245) into the
 * `data-field="trigger-kind"` select — the ONLY place an operator can pick a
 * trigger kind to author. The mirror carries only 4 of the SSOT's 7 shipped
 * ids (see ./trigger-kind-parity.test.ts's pin-1 RED) — so today's select
 * offers `flow-complete`/`merged`/`cron`/`webhook` only, and an operator can
 * never author an `agent-complete`, `pr-merged`, or `issue-raised` trigger
 * from the UI, even though all three are shipped, real, dispatchable kinds
 * server-side. This test reads the REAL orchestrator SSOT directly (same
 * mechanism as pin 1) and asserts the rendered select's option-value set is
 * the full 7 — RED today because the component only ever renders the
 * mirror's 4.
 *
 * --- Pin 4 (display) -----------------------------------------------------
 *
 * FlowHeader.tsx's `triggerKindPhrase` (:136-140) is:
 *
 *   if (tr.on === 'cron')    return `cron ${tr.schedule ?? ''} →`;
 *   if (tr.on === 'webhook') return `webhook ${tr.webhook?.id ?? ''} →`;
 *   if (tr.on === 'merged')  return 'on merged →';
 *   return 'on complete →';                          // <- the fallback
 *
 * Every kind that isn't cron/webhook/merged falls into the last line and is
 * mislabeled "on complete →" — including `pr-merged`, which is NOT a
 * completion event at all (it fires when a GitHub PR is merged, an EXTERNAL
 * webhook-family receipt — see orchestrator/flow-trigger.ts:40-44), and
 * `issue-raised` (a GitHub issue being opened — not a completion of
 * anything), and `agent-complete` (which IS a completion, but of a specific
 * *agent* run, not "on complete" generically — indistinguishable on the UI
 * from an `on: merged`/`flow-complete` chip once mislabeled the same way).
 * `TRIGGER_KINDS`'s rows (orchestrator/flow-trigger.ts:52-62) carry no
 * separate display-text field (only `id`/`origin`/`status`/`fires`), so the
 * honest fallback shape this test pins is `on <kind> →` — i.e. the row's own
 * `id`, not a fabricated friendlier phrase: "on pr-merged →", "on
 * issue-raised →", "on agent-complete →". RED today because the actual
 * rendered phrase for all three is "on complete →".
 *
 * RUN: npx vitest run lib/flow-header-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowHeader } from '@/components/studio/flow-builder/FlowHeader';
import type { Flow, FlowTrigger } from '@/lib/studio-client';

// The real, on-disk SSOT — same mechanism as ./trigger-kind-parity.test.ts's
// pin-1 test, reused here so pin 2 checks against the true registry rather
// than a second hand-copied literal list that could itself drift.
import { SHIPPED_TRIGGER_KIND_IDS as SSOT_SHIPPED_IDS } from '../../orchestrator/flow-trigger.ts';

type Props = {
  flowId: string;
  state: { name: string; goal: string; project: string; kb: string; triggers: FlowTrigger[] };
  onChange: (next: unknown) => void;
  onSave: () => Promise<{ ok: boolean; version?: number; error?: string }>;
  flows: Flow[];
  onFlowSelect: (id: string) => void;
  isNew?: boolean;
};

function baseFlows(): Flow[] {
  return [
    { id: 'flow-a', name: 'Flow A', goal: '', nodes: [], edges: [], triggers: [] },
    { id: 'flow-b', name: 'Flow B', goal: '', nodes: [], edges: [], triggers: [] },
  ];
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    flowId: 'flow-a',
    state: { name: 'Test flow', goal: '', project: '', kb: '', triggers: [] },
    onChange: () => {},
    onSave: async () => ({ ok: true }),
    flows: baseFlows(),
    onFlowSelect: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<Props> = {}): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(FlowHeader as any, baseProps(overrides)));
}

/** Return the `<option value="...">` values inside the `<select
 *  data-field="{dataField}">` element. Assumes (true for this component's
 *  plain generated markup, confirmed against its real rendered output) the
 *  target `data-field` attribute sits on the `<select>` tag itself and the
 *  select's children are only `<option>` tags — sufficient for pinning
 *  purposes without a real DOM parser (mirrors `./run-panel-render.test.ts`'s
 *  `tagContaining` precedent). */
function selectOptionValues(html: string, dataField: string): string[] {
  const marker = `data-field="${dataField}"`;
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error(`no element with ${marker} found in rendered markup`);
  const openTagEnd = html.indexOf('>', markerIdx);
  const closeTagIdx = html.indexOf('</select>', openTagEnd);
  if (openTagEnd === -1 || closeTagIdx === -1) throw new Error(`could not locate <select ${marker}>...</select> bounds`);
  const inner = html.slice(openTagEnd + 1, closeTagIdx);
  return [...inner.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

/** Return the trigger-kind PHRASE text rendered inside a trigger chip for
 *  `on: kind` — the first nested `<span>...</span>` immediately following the
 *  chip's own opening `<span data-trigger-chip=... data-trigger-kind="kind"
 *  ...>` tag (confirmed against the component's real rendered markup: that
 *  inner span is `triggerKindPhrase(tr)`'s only consumer). */
function chipPhrase(html: string, kind: string): string {
  const marker = `data-trigger-kind="${kind}"`;
  const chipMarkerIdx = html.indexOf(marker);
  if (chipMarkerIdx === -1) throw new Error(`no trigger chip with ${marker} found in rendered markup`);
  const chipOpenTagEnd = html.indexOf('>', chipMarkerIdx);
  const innerSpanOpenTagEnd = html.indexOf('>', chipOpenTagEnd + 1);
  const innerSpanCloseIdx = html.indexOf('</span>', innerSpanOpenTagEnd);
  if ([chipOpenTagEnd, innerSpanOpenTagEnd, innerSpanCloseIdx].includes(-1)) {
    throw new Error(`could not locate the phrase span for chip ${marker}`);
  }
  return html.slice(innerSpanOpenTagEnd + 1, innerSpanCloseIdx);
}

// ---------------------------------------------------------------------------
// Pin 2 — authorability: the trigger-kind select must offer ALL 7 shipped ids.
// ---------------------------------------------------------------------------

// companion (not independently RED) — precondition proof, paired with the RED
// pin below: confirms the extraction helper is really reading the
// trigger-kind select (and that today's actual shape is the known 4-option
// mirror output) before the RED test below reports that set as incomplete.
// Passes today; a regex/markup-shape mistake in this file (reading the wrong
// element, matching zero options) would fail THIS test rather than silently
// producing a false "RED" on the real assertion below.
test('companion (forge-zyc pin 2): the trigger-kind select offers ONLY shipped kinds — never the reserved manual/feed (guards over-rendering all 9)', () => {
  const html = render();
  const rendered = selectOptionValues(html, 'trigger-kind');
  // Companion to the RED pin below: the pin asserts all 7 SHIPPED ids ARE
  // present; this guards the other boundary — the 2 reserved kinds (manual,
  // feed) must NOT leak into the authoring select. Together they pin the
  // select to exactly the shipped set, mirroring the both-directions parity
  // test on SHIPPED_TRIGGER_KINDS.
  expect(rendered).not.toContain('manual');
  expect(rendered).not.toContain('feed');
});

test('RED (forge-zyc pin 2): the trigger-kind select must offer an <option> for every SHIPPED SSOT id (all 7, incl. agent-complete/pr-merged/issue-raised) — an operator must be able to author every shipped kind', () => {
  const html = render();
  const rendered = [...selectOptionValues(html, 'trigger-kind')].sort();
  const ssot = [...SSOT_SHIPPED_IDS].sort();

  const missingFromSelect = ssot.filter((id) => !rendered.includes(id));
  expect(
    missingFromSelect,
    `shipped kinds with no <option> in the trigger-kind select: ${missingFromSelect.join(', ') || '(none)'}`,
  ).toEqual([]);
  expect(rendered).toEqual(ssot);
});

// ---------------------------------------------------------------------------
// Pin 4 — display: pr-merged/issue-raised/agent-complete must not read "on
// complete →" (the generic-completion fallback phrase).
// ---------------------------------------------------------------------------

test('RED (forge-zyc pin 4): a pr-merged trigger chip must NOT read "on complete →" — a merged PR is an external webhook-family receipt, not a completion event', () => {
  const html = render({
    state: {
      name: 'Test flow', goal: '', project: '', kb: '',
      triggers: [{ on: 'pr-merged', target: { kind: 'flow', ref: 'flow-b' } } as FlowTrigger],
    },
  });
  const phrase = chipPhrase(html, 'pr-merged');
  expect(phrase).not.toBe('on complete →');
  expect(phrase).toBe('on pr-merged →');
});

test('RED (forge-zyc pin 4): an issue-raised trigger chip must NOT read "on complete →" — a raised issue is not a completion of anything', () => {
  const html = render({
    state: {
      name: 'Test flow', goal: '', project: '', kb: '',
      triggers: [{ on: 'issue-raised', target: { kind: 'flow', ref: 'flow-b' } } as FlowTrigger],
    },
  });
  const phrase = chipPhrase(html, 'issue-raised');
  expect(phrase).not.toBe('on complete →');
  expect(phrase).toBe('on issue-raised →');
});

test('RED (forge-zyc pin 4): an agent-complete trigger chip must NOT read the same generic "on complete →" an on:merged/flow-complete chip would — it completes a SPECIFIC agent, and must stay visually distinguishable', () => {
  const html = render({
    state: {
      name: 'Test flow', goal: '', project: '', kb: '',
      triggers: [{ on: 'agent-complete', target: { kind: 'flow', ref: 'flow-b' }, agent: 'developer' } as FlowTrigger],
    },
  });
  const phrase = chipPhrase(html, 'agent-complete');
  expect(phrase).not.toBe('on complete →');
  expect(phrase).toBe('on agent-complete →');
});
