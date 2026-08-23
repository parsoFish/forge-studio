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
    kbId: 'fixture-kb',
    nowMs: 1_755_000_000_000,
    attaching: false,
    dispatchError: null,
    cancelArmed: false,
    cancelBusy: false,
    cancelMsg: null,
    userIdx: 0,
    userNote: '',
    userBusy: false,
    userMsg: null,
    events: [],
    onCancel: () => {},
    onCancelDisarm: () => {},
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
  'round-cap', 'cost-ceiling', 'cancelled', 'failed', 'timed-out', 'unreadable',
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
// W7-B2: the DISPATCH button moved to KbActionGroup (the one action group) —
// this panel renders NO drain-to-green button any more. In its place: the
// Stop (cancel) control while running (knowledge-14), the elapsed ticker +
// real budget, and the per-round grouping (knowledge-12).
// ---------------------------------------------------------------------------

test('W7-B2: the panel renders NO drain-to-green dispatch button (it lives in KbActionGroup now)', () => {
  for (const s of ALL_DISPLAY_STATES) {
    expect(render({ displayState: s })).not.toContain('data-action="drain-to-green"');
  }
});

test('cancel-drain (Stop) renders ONLY while running; two-step arm; disarm affordance while armed (knowledge-14)', () => {
  const running = render({ displayState: 'running', runId: 'kb-drain-x' });
  expect(tagContaining(running, 'data-action="cancel-drain"')).toContain('data-cancel-armed="false"');
  expect(running).toContain('Stop');
  const armed = render({ displayState: 'running', runId: 'kb-drain-x', cancelArmed: true });
  expect(tagContaining(armed, 'data-action="cancel-drain"')).toContain('data-cancel-armed="true"');
  expect(armed).toContain('Confirm stop');
  expect(armed).toContain('data-action="cancel-drain-keep"');
  for (const s of ALL_DISPLAY_STATES.filter((x) => x !== 'running')) {
    expect(render({ displayState: s }), `state=${s}`).not.toContain('data-action="cancel-drain"');
  }
});

test('elapsed ticker renders while running when startedAt is known — never fabricated without it (knowledge-14)', () => {
  const nowMs = new Date('2026-08-20T10:02:05Z').getTime();
  const withStart = render({ displayState: 'running', startedAt: '2026-08-20T10:00:00Z', nowMs });
  expect(withStart).toContain('data-component="drain-elapsed"');
  expect(withStart).toContain('2m 5s elapsed');
  const withoutStart = render({ displayState: 'running', startedAt: undefined, nowMs });
  expect(withoutStart).not.toContain('data-component="drain-elapsed"');
});

test('the cost line names the run\'s REAL ceiling when the status carries one (knowledge-14)', () => {
  const html = render({ displayState: 'running', costUsd: 0.31, maxCostUsd: 2 });
  expect(html).toContain('$0.31 of $2.00');
});

test('the round chip uses the status\'s own maxRounds over the display constant', () => {
  const html = render({ displayState: 'running', round: 2, maxRounds: 7 });
  expect(html).toContain('round 2/7');
});

test('multi-round runs group rows under per-round headers (knowledge-12)', () => {
  const html = render({
    displayState: 'green',
    perFinding: [
      finding({ key: 'r1', tier: 'agent', outcome: 'cleared', round: 1, message: 'round one work' }),
      finding({ key: 'r2', tier: 'agent', outcome: 'cleared', round: 2, message: 'round two work' }),
    ],
  });
  expect(html).toContain('data-drain-round-group="1"');
  expect(html).toContain('data-drain-round-group="2"');
});

test('each finding row names its FILE and RULE — two findings with the same message are distinguishable (knowledge-08)', () => {
  const html = render({
    displayState: 'no-progress',
    perFinding: [
      finding({ key: 'a', file: '/x/brain/cycles/themes/alpha.md', check: 'checkStaleness', message: 'stale citation (missing): skills/x/SKILL.md' }),
      finding({ key: 'b', file: '/x/brain/cycles/themes/beta.md', check: 'checkStaleness', message: 'stale citation (missing): skills/x/SKILL.md' }),
    ],
  });
  expect(html).toContain('data-drain-finding-file="alpha.md"');
  expect(html).toContain('data-drain-finding-file="beta.md"');
  expect(html).toContain('checkStaleness');
});

test('a drain-gated finding renders its review-draft link (orch-01)', () => {
  const html = render({
    displayState: 'needs-you',
    perFinding: [finding({ key: 'g', tier: 'agent', outcome: 'needs-you', draftSession: { id: '2026-08-20T10-00-00-ab12', project: '.kb-forge-dev' } })],
  });
  expect(html).toContain('data-action="open-drain-draft"');
  expect(html).toContain('/sessions/kb-cleanup/2026-08-20T10-00-00-ab12?project=.kb-forge-dev');
});

test('cancelled terminal renders its own honest copy', () => {
  const html = render({ displayState: 'cancelled' });
  expect(html).toContain('data-drain-state="cancelled"');
  expect(html).toContain('Stopped on your request');
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

test('timed-out/unreadable: [data-action="recheck-drain"] renders ONLY in the two watch-lost states (timed-out, unreadable — W7-B2)', () => {
  expect(render({ displayState: 'timed-out' })).toContain('data-action="recheck-drain"');
  expect(render({ displayState: 'unreadable' })).toContain('data-action="recheck-drain"');
  for (const s of ALL_DISPLAY_STATES.filter((s) => s !== 'timed-out' && s !== 'unreadable')) {
    expect(render({ displayState: s }), `state=${s}`).not.toContain('data-action="recheck-drain"');
  }
});

test('unreadable (W7-B2): a bridge-ANSWERED failed read renders the honest "status unreadable" chip + the bridge\'s own error text — and never the "still watching" suffix (the poll has stopped)', () => {
  const html = render({ displayState: 'unreadable', readError: 'unknown drain run "forge-dev-drain-9"' });
  expect(html.toLowerCase()).toContain('status unreadable');
  expect(html).toContain('data-component="drain-read-error"');
  expect(html).toContain('unknown drain run');
  expect(html).not.toContain('still watching');
  // no Stop control — there is nothing verifiably live to stop
  expect(html).not.toContain('data-action="cancel-drain"');
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

test('W7-FIX-A1 review: a failed status read (readError) renders [data-component="drain-read-error"] + root data-drain-read-error while the poll keeps watching — never a bare "running" the panel never observed; absent when reads are healthy', () => {
  const html = render({ displayState: 'running', readError: 'bridge unreachable (Failed to fetch)' });
  expect(html).toContain('data-drain-read-error="bridge unreachable (Failed to fetch)"');
  expect(html).toContain('data-component="drain-read-error"');
  expect(html).toMatch(/status read failed: bridge unreachable \(Failed to fetch\) — still watching/);
  expect(render({ displayState: 'running', readError: null })).not.toContain('drain-read-error');
});

// ---------------------------------------------------------------------------
// W8-B2 (ON-3) — a finding SHOWS ITS FIX, and links back to Explore.
//
// Every assertion below kills a specific wrong implementation: rendering a
// disposition that isn't derived from the proposals, offering a disclosure
// with nothing in it, showing a truncated diff as if it were whole, and
// emitting a node link for a file that is not a graph node.
// ---------------------------------------------------------------------------

const REFUSED_FINDING: KbDrainPerFinding = {
  key: 'edge::recurrence', check: 'checkLengthSoftCap', kind: 'length.soft-cap',
  file: '/f/brain/projects/gitpulse/themes/2026-06-21-recurrence.md',
  message: 'theme exceeds the soft line cap', tier: 'agent', outcome: 'not-cleared', round: 1,
  fixHint: 'Condense without losing amendment history.',
  proposedChanges: [{
    file: 'brain/projects/gitpulse/themes/2026-06-21-recurrence.md',
    diff: '--- a/x\n+++ b/x\n-related_themes: [a, b]\n+related_themes: [b]',
    diffTruncated: false,
    disposition: 'refused',
    reasons: ['refused: deletes the related_themes edge "a", whose theme exists at a.md'],
  }],
};

function renderRefused(extra: Partial<KbDrainPerFinding> = {}): string {
  return render({ displayState: 'no-progress', kbId: 'gitpulse', perFinding: [{ ...REFUSED_FINDING, ...extra }] });
}

test('a refused finding renders its proposal DIFF, its refusal reason and the agent brief — ON-3', () => {
  const html = renderRefused();
  expect(html).toContain('data-component="drain-proposal-diff"');
  expect(html).toContain('related_themes: [a, b]');
  expect(html).toContain('data-component="drain-finding-reasons"');
  expect(html).toContain('whose theme exists at a.md');
  expect(html).toContain('data-component="drain-finding-brief"');
  expect(html).toContain('Condense without losing amendment history.');
});

test('the row advertises a DERIVED disposition and the proposal/reason counts', () => {
  const tag = tagContaining(renderRefused(), 'data-drain-finding-disposition');
  expect(tag).toContain('data-drain-finding-disposition="refused"');
  expect(tag).toContain('data-drain-finding-proposals="1"');
  expect(tag).toContain('data-drain-finding-reasons="1"');
});

test('one landed file plus one refused file reports MIXED — never a single clean claim covering both', () => {
  const html = render({ displayState: 'no-progress', kbId: 'gitpulse', perFinding: [{
    ...REFUSED_FINDING,
    proposedChanges: [
      { file: 'a.md', diff: 'd', disposition: 'applied' },
      { file: 'b.md', diff: 'd', disposition: 'refused', reasons: ['nope'] },
    ],
  }] });
  expect(tagContaining(html, 'data-drain-finding-disposition')).toContain('data-drain-finding-disposition="mixed"');
  expect(html).toContain('data-drain-finding-proposals="2"');
});

test('a theme finding deep-links to its own node in Explore (?node=), and an index page does NOT', () => {
  expect(renderRefused()).toContain('data-action="open-finding-node"');
  expect(renderRefused()).toContain('/knowledge?id=gitpulse&amp;node=2026-06-21-recurrence');
  // A category index page is a real finding target but not a graph node — the
  // link must be absent, never a link that lands on the shared NotFound.
  const idx = renderRefused({ file: '/f/brain/projects/gitpulse/patterns.md' });
  expect(idx).not.toContain('data-action="open-finding-node"');
  expect(idx).toContain('patterns.md');
});

test('with no kbId in context there is no node link — the derivation fails closed', () => {
  const html = render({ displayState: 'no-progress', kbId: '', perFinding: [REFUSED_FINDING] });
  expect(html).not.toContain('data-action="open-finding-node"');
});

test('a finding with nothing to show renders NO disclosure — an empty drawer is its own small lie', () => {
  const html = render({ displayState: 'no-progress', kbId: 'gitpulse', perFinding: [finding({ outcome: 'cleared' })] });
  expect(html).not.toContain('data-component="drain-finding-detail"');
});

test('a truncated diff SAYS so — a cut diff can never read as a whole one', () => {
  const html = renderRefused({ proposedChanges: [{
    file: 'a.md', diff: '--- a/a\n+++ b/a\n-x', diffTruncated: true, disposition: 'refused', reasons: ['r'],
  }] });
  expect(html).toContain('data-component="drain-proposal-truncated"');
});

test('a crashed fix turn is shown as its own fact, beside the derived outcome rather than inside it', () => {
  const html = renderRefused({ turnError: 'synthetic turn crash', outcome: 'cleared' });
  expect(html).toContain('data-component="drain-finding-turn-error"');
  expect(html).toContain('synthetic turn crash');
  expect(tagContaining(html, 'data-drain-finding-outcome')).toContain('data-drain-finding-outcome="cleared"');
});

test('the pending outcome renders a glyph rather than a blank cell', () => {
  const html = render({ displayState: 'running', kbId: 'gitpulse', perFinding: [finding({ outcome: 'pending' })] });
  expect(tagContaining(html, 'data-drain-finding-outcome')).toContain('data-drain-finding-outcome="pending"');
});
