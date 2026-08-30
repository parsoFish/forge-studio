/**
 * W7-B2 pinned render tests — `KbActionGroupView` (the ONE action group on
 * the KB health tab, knowledge-05/09/19/24/32/33). Pure-view render pins via
 * renderToStaticMarkup, same technique as kb-drain-panel-render.test.ts.
 */

import { test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KbActionGroupView, type KbActionGroupViewProps } from '@/components/studio/knowledge/KbActionGroup';

function baseProps(overrides: Partial<KbActionGroupViewProps> = {}): KbActionGroupViewProps {
  return {
    kbId: 'forge-dev',
    activeJob: null,
    activeJobReason: null,
    drainState: 'idle',
    busy: null,
    consolidatePollState: null,
    consolidateState: null,
    actionResult: null,
    actionError: null,
    deleteArmed: false,
    deleteText: '',
    onDrain: () => {},
    onConsolidate: () => {},
    onRecheckConsolidate: () => {},
    onCleanupPlan: () => {},
    onRefreshIndex: () => {},
    onDeleteArm: () => {},
    onDeleteCancel: () => {},
    onDeleteTextChange: () => {},
    onDeleteConfirm: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<KbActionGroupViewProps> = {}): string {
  return renderToStaticMarkup(React.createElement(KbActionGroupView, baseProps(overrides)));
}

function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

const FIVE_ACTIONS = ['drain-to-green', 'kb-maintain-session', 'start-kb-cleanup', 'kb-index', 'kb-delete'];

test('idle: all five actions render, ENABLED, each with an explanation line (knowledge-32)', () => {
  const html = render();
  expect(html).toContain('data-component="kb-action-group"');
  expect(html).toContain('data-active-job="none"');
  for (const a of FIVE_ACTIONS) {
    const tag = tagContaining(html, `data-action="${a}"`);
    expect(tag, a).not.toBe('');
    expect(tag, a).not.toContain('disabled');
  }
  // One-line explanations distinguish the three brain-fix entry points.
  expect(html).toContain('round by round');
  expect(html).toContain('ONE pass over the current agent-tier findings');
  expect(html).toContain('Review-first');
});

test('a server-reported active job disables EVERY action and shows its reason (knowledge-05)', () => {
  const html = render({
    activeJob: { kind: 'drain', runId: 'forge-dev-drain-x' },
    activeJobReason: 'a drain-to-green run is active for this kb (forge-dev-drain-x) — wait for it to finish or cancel it',
  });
  expect(html).toContain('data-active-job="drain"');
  expect(html).toContain('data-component="kb-action-gate-reason"');
  expect(html).toContain('forge-dev-drain-x');
  for (const a of FIVE_ACTIONS) {
    expect(tagContaining(html, `data-action="${a}"`), a).toContain('disabled');
  }
});

test('a LOCALLY-observed running drain gates instantly, before any server poll (knowledge-05)', () => {
  const html = render({ drainState: 'running' });
  expect(html).toContain('data-active-job="drain"');
  for (const a of FIVE_ACTIONS) {
    expect(tagContaining(html, `data-action="${a}"`), a).toContain('disabled');
  }
});

test('a watching consolidate gates the group too', () => {
  const html = render({ consolidatePollState: 'watching', consolidateState: 'running' });
  expect(html).toContain('data-active-job="consolidate"');
  expect(tagContaining(html, 'data-action="drain-to-green"')).toContain('disabled');
});

test('consolidate outcome STAYS on screen (no 6-second pill — knowledge-19) with the poll-state vocabulary preserved', () => {
  const html = render({ actionResult: 'consolidate: cleared 3/3 ✓', consolidatePollState: 'terminal', consolidateState: 'cleared' });
  const resultTag = tagContaining(html, 'data-component="kb-action-result"');
  expect(resultTag).toContain('data-consolidate-state="cleared"');
  expect(resultTag).toContain('data-poll-state="terminal"');
  expect(html).toContain('consolidate: cleared 3/3 ✓');
});

test('delete is a typed-id confirm: input + confirm disabled until the EXACT kb id is typed (knowledge-24)', () => {
  const armedWrong = render({ deleteArmed: true, deleteText: 'forge-de' });
  expect(armedWrong).toContain('data-field="kb-delete-confirm"');
  expect(tagContaining(armedWrong, 'data-action="kb-delete-confirm"')).toContain('disabled');
  const armedRight = render({ deleteArmed: true, deleteText: 'forge-dev' });
  expect(tagContaining(armedRight, 'data-action="kb-delete-confirm"')).not.toContain('disabled');
  expect(armedRight).toContain('data-action="kb-delete-cancel"');
});

test('timed-out consolidate poll renders the re-check affordance', () => {
  const html = render({ consolidatePollState: 'timed-out', consolidateState: 'running' });
  expect(html).toContain('data-action="re-check"');
});

test('an action error renders in the persistent result line', () => {
  const html = render({ actionError: 'a consolidate run is active for this kb (x) — wait for it to finish' });
  expect(tagContaining(html, 'data-component="kb-action-result"')).not.toBe('');
  expect(html).toContain('wait for it to finish');
});
