/**
 * kb-drain-panel-render.test.ts (W6-B13 review round) — DOM regression pins
 * for `KbDrainPanelView` (forge-ui/components/studio/knowledge/KbDrainPanel.tsx),
 * mirroring `run-panel-render.test.ts`'s technique exactly (see that file's
 * own header for the full rationale).
 *
 * WHY THE VIEW, NOT THE CONTAINER: `KbDrainPanel`'s "interesting" states
 * (running/green/needs-you/no-progress/round-cap/cost-ceiling/failed/
 * timed-out) only ever exist via an async `fetchActiveOrLatestKbDrain`/
 * `pollKbDrain` result — `renderToStaticMarkup` never runs effects, so a
 * render test against the CONTAINER could only ever observe its permanently
 * stuck initial 'attaching' state (source-text pins on the parent page
 * confirm the container is WIRED — they do not, and cannot, prove what each
 * terminal state actually RENDERS). `KbDrainPanelView` is the pure,
 * hooks-free presentational half — every terminal-vocab value is reachable
 * directly via its own props, exactly like `KbHealth.tsx`'s existing
 * `health` prop.
 *
 * RUN: cd forge-ui && npx vitest run lib/kb-drain-panel-render.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KbDrainPanelView, type KbDrainPanelViewProps } from '@/components/studio/knowledge/KbDrainPanel';
import type { KbDrainPerFinding } from '@/lib/studio-client';
import type { KbDrainDisplayState } from '@/lib/kb-drain-view';

function baseProps(overrides: Partial<KbDrainPanelViewProps> = {}): KbDrainPanelViewProps {
  return {
    displayState: 'idle',
    round: 0,
    runId: null,
    costUsd: 0,
    counts: { auto: 0, agent: 0, user: 0 },
    perFinding: [],
    dispatching: false,
    attaching: false,
    dispatchError: null,
    userIdx: 0,
    userNote: '',
    userBusy: false,
    userMsg: null,
    events: [],
    onDrain: () => {},
    onRecheck: () => {},
    onUserNoteChange: () => {},
    onSubmitUserAnswer: () => {},
    onSkipUser: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<KbDrainPanelViewProps> = {}): string {
  return renderToStaticMarkup(React.createElement(KbDrainPanelView, baseProps(overrides)));
}

function finding(overrides: Partial<KbDrainPerFinding> = {}): KbDrainPerFinding {
  return { key: 'k1', check: 'checkProjectBrainIndexes', kind: 'index.project', file: 'themes/x.md', message: 'not listed', tier: 'agent', outcome: 'not-cleared', ...overrides };
}

function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Root data-* contract — every value in KbDrainState + the two UI-only
// values ('idle'/'attaching') + the poll-exhaustion 'timed-out'.
// ---------------------------------------------------------------------------

const ALL_DISPLAY_STATES: KbDrainDisplayState[] = [
  'idle', 'attaching', 'running', 'green', 'needs-you', 'no-progress',
  'round-cap', 'cost-ceiling', 'failed', 'timed-out',
];

test('root [data-component="kb-drain-panel"][data-drain-state] renders EVERY display-state value verbatim — the full vocabulary, not just a subset', () => {
  for (const s of ALL_DISPLAY_STATES) {
    const html = render({ displayState: s });
    expect(html).toContain('data-component="kb-drain-panel"');
    expect(html).toContain(`data-drain-state="${s}"`);
  }
});

test('data-drain-round reflects the round prop, including 0', () => {
  expect(render({ round: 0 })).toContain('data-drain-round="0"');
  expect(render({ displayState: 'running', round: 3 })).toContain('data-drain-round="3"');
  expect(render({ displayState: 'round-cap', round: 5 })).toContain('data-drain-round="5"');
});

test('data-drain-run-id is empty before any run, and the real id once one exists', () => {
  expect(render({ runId: null })).toContain('data-drain-run-id=""');
  expect(render({ displayState: 'running', runId: 'forge-dev-drain-abc123' })).toContain('data-drain-run-id="forge-dev-drain-abc123"');
});

test('the drain-to-green root also carries id="kb-drain-panel" — the anchor KbHealth.tsx\'s goto-drain-panel link targets', () => {
  expect(render()).toContain('id="kb-drain-panel"');
});

// ---------------------------------------------------------------------------
// Button disabled matrix — dispatching/running/attaching → disabled;
// every terminal state (with dispatching/attaching both false) → enabled.
// ---------------------------------------------------------------------------

test('drain-to-green button DISABLED while dispatching', () => {
  const html = render({ dispatching: true, displayState: 'idle' });
  const tag = tagContaining(html, 'data-action="drain-to-green"');
  expect(tag).toContain('disabled');
});

test('drain-to-green button DISABLED while displayState is "running"', () => {
  const html = render({ displayState: 'running', dispatching: false, attaching: false });
  const tag = tagContaining(html, 'data-action="drain-to-green"');
  expect(tag).toContain('disabled');
});

test('drain-to-green button DISABLED while attaching (the mount-time reattach fetch is still in flight)', () => {
  const html = render({ attaching: true, displayState: 'attaching' });
  const tag = tagContaining(html, 'data-action="drain-to-green"');
  expect(tag).toContain('disabled');
});

test('drain-to-green button ENABLED for every terminal state once dispatching/attaching are both false — an operator must always be able to re-run', () => {
  const terminals: KbDrainDisplayState[] = ['green', 'needs-you', 'no-progress', 'round-cap', 'cost-ceiling', 'failed', 'timed-out'];
  for (const s of terminals) {
    const html = render({ displayState: s, dispatching: false, attaching: false });
    const tag = tagContaining(html, 'data-action="drain-to-green"');
    expect(tag, `state=${s}`).not.toContain('disabled');
  }
});

test('drain-to-green button ENABLED for the idle state (no run has ever been dispatched)', () => {
  const html = render({ displayState: 'idle', dispatching: false, attaching: false });
  const tag = tagContaining(html, 'data-action="drain-to-green"');
  expect(tag).not.toContain('disabled');
});

// ---------------------------------------------------------------------------
// Per-finding rows — data-drain-finding-tier / -outcome, split by tier.
// ---------------------------------------------------------------------------

test('per-finding rows render [data-drain-finding-tier] and [data-drain-finding-outcome] for every auto/agent finding, one row each', () => {
  const html = render({
    displayState: 'no-progress',
    perFinding: [
      finding({ key: 'a1', tier: 'auto', outcome: 'cleared', message: 'index regenerated' }),
      finding({ key: 'g1', tier: 'agent', outcome: 'not-cleared', message: 'still missing' }),
    ],
  });
  expect(html).toContain('data-drain-section="progress"');
  expect(html).toContain('data-drain-finding-tier="auto"');
  expect(html).toContain('data-drain-finding-outcome="cleared"');
  expect(html).toContain('data-drain-finding-tier="agent"');
  expect(html).toContain('data-drain-finding-outcome="not-cleared"');
  expect(html).toContain('index regenerated');
  expect(html).toContain('still missing');
});

test('USER-tier findings do NOT appear in the progress section — only auto/agent do', () => {
  const html = render({
    displayState: 'needs-you',
    perFinding: [finding({ key: 'u1', tier: 'user', outcome: 'needs-you', message: 'operator call' })],
  });
  expect(html).not.toContain('data-drain-section="progress"');
});

test('zero auto/agent findings renders no progress section at all', () => {
  const html = render({ displayState: 'green', perFinding: [] });
  expect(html).not.toContain('data-drain-section="progress"');
});

// ---------------------------------------------------------------------------
// needs-you user-tier walkthrough — data-user-index/-total, the input +
// submit/skip actions, and the C9#3 exhausted-completion state.
// ---------------------------------------------------------------------------

test('needs-you: [data-drain-section="needs-you"][data-user-index][data-user-total] render with the current finding\'s own row + input', () => {
  const html = render({
    displayState: 'needs-you',
    userIdx: 0,
    perFinding: [
      finding({ key: 'u1', tier: 'user', outcome: 'needs-you', message: 'decide A' }),
      finding({ key: 'u2', tier: 'user', outcome: 'needs-you', message: 'decide B' }),
    ],
  });
  expect(html).toContain('data-drain-section="needs-you"');
  expect(html).toContain('data-user-index="0"');
  expect(html).toContain('data-user-total="2"');
  expect(html).toContain('decide A');
  expect(html).not.toContain('decide B');
  expect(html).toContain('data-component="user-resolution-input"');
  expect(html).toContain('data-action="submit-user-resolution"');
  expect(html).toContain('data-action="skip-user-resolution"');
});

test('needs-you: mid-walkthrough (userIdx=1) shows the SECOND finding, not the first', () => {
  const html = render({
    displayState: 'needs-you',
    userIdx: 1,
    perFinding: [
      finding({ key: 'u1', tier: 'user', outcome: 'needs-you', message: 'decide A' }),
      finding({ key: 'u2', tier: 'user', outcome: 'needs-you', message: 'decide B' }),
    ],
  });
  expect(html).toContain('data-user-index="1"');
  expect(html).toContain('decide B');
  expect(html).not.toContain('decide A');
});

test('needs-you: submit-user-resolution DISABLED when the note is empty; ENABLED once non-empty', () => {
  const props = { displayState: 'needs-you' as const, perFinding: [finding({ tier: 'user', outcome: 'needs-you' })] };
  const emptyTag = tagContaining(render({ ...props, userNote: '' }), 'data-action="submit-user-resolution"');
  expect(emptyTag).toContain('disabled');
  const filledTag = tagContaining(render({ ...props, userNote: 'do X' }), 'data-action="submit-user-resolution"');
  expect(filledTag).not.toContain('disabled');
});

test('needs-you: submit + skip BOTH disabled while userBusy — no double-dispatch mid-poll', () => {
  const props = { displayState: 'needs-you' as const, perFinding: [finding({ tier: 'user', outcome: 'needs-you' })], userNote: 'do X', userBusy: true };
  const html = render(props);
  expect(tagContaining(html, 'data-action="submit-user-resolution"')).toContain('disabled');
  expect(tagContaining(html, 'data-action="skip-user-resolution"')).toContain('disabled');
});

test('needs-you: stepping PAST the last finding renders [data-component="user-tier-exhausted"] — the C9#3 fix, never re-showing the last item forever', () => {
  const html = render({
    displayState: 'needs-you',
    userIdx: 2,
    perFinding: [
      finding({ key: 'u1', tier: 'user', outcome: 'needs-you', message: 'decide A' }),
      finding({ key: 'u2', tier: 'user', outcome: 'needs-you', message: 'decide B' }),
    ],
  });
  expect(html).toContain('data-component="user-tier-exhausted"');
  expect(html).toContain('Reviewed all 2');
  // No stale finding row or input once exhausted.
  expect(html).not.toContain('data-component="user-resolution-input"');
});

test('needs-you section is ABSENT for every non-needs-you state, even with a user-tier finding present in perFinding', () => {
  const html = render({
    displayState: 'no-progress',
    perFinding: [finding({ tier: 'user', outcome: 'needs-you' })],
  });
  expect(html).not.toContain('data-drain-section="needs-you"');
});

// ---------------------------------------------------------------------------
// timed-out — the explicit re-check affordance (never silent).
// ---------------------------------------------------------------------------

test('timed-out: [data-action="recheck-drain"] renders ONLY in the timed-out state', () => {
  expect(render({ displayState: 'timed-out' })).toContain('data-action="recheck-drain"');
  for (const s of ALL_DISPLAY_STATES.filter((s) => s !== 'timed-out')) {
    expect(render({ displayState: s }), `state=${s}`).not.toContain('data-action="recheck-drain"');
  }
});

test('timed-out: the state copy explicitly says the run keeps going server-side (never implies it stopped)', () => {
  const html = render({ displayState: 'timed-out' });
  const lower = html.toLowerCase();
  expect(lower).toContain('server');
  expect(lower).toContain('re-check');
});

// ---------------------------------------------------------------------------
// Other terminal-state rendering + companions
// ---------------------------------------------------------------------------

test('green renders [data-component="drain-green"]; no other terminal state does', () => {
  expect(render({ displayState: 'green' })).toContain('data-component="drain-green"');
  for (const s of ALL_DISPLAY_STATES.filter((s) => s !== 'green')) {
    expect(render({ displayState: s }), `state=${s}`).not.toContain('data-component="drain-green"');
  }
});

test('a dispatchError renders [data-component="drain-dispatch-error"] with the message verbatim; absent when there is no error', () => {
  const html = render({ dispatchError: 'no bridge configured' });
  expect(html).toContain('data-component="drain-dispatch-error"');
  expect(html).toContain('no bridge configured');
  expect(render({ dispatchError: null })).not.toContain('data-component="drain-dispatch-error"');
});

test('the state chip + counts summary render only once a real status exists (hasStatus), never for idle/attaching', () => {
  expect(render({ displayState: 'idle' })).not.toContain('data-component="drain-state-chip"');
  expect(render({ displayState: 'attaching' })).not.toContain('data-component="drain-state-chip"');
  expect(render({ displayState: 'running' })).toContain('data-component="drain-state-chip"');
});

test('the ActivityLog drawer mounts once a runId exists, and stays absent before any run', () => {
  expect(render({ runId: null })).not.toContain('data-component="activity-drawer"');
  const html = render({ displayState: 'running', runId: 'forge-dev-drain-abc123' });
  expect(html).toContain('data-component="activity-drawer"');
});
