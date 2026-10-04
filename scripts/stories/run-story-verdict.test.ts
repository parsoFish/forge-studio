/**
 * run-story-verdict.test.ts — row 191 (bead `forge-8vfn.8.5.29`), T1 ruling
 * 1973en: THE LAST PER-STORY VERDICT LINE MUST BE FINAL.
 *
 * Measured on a costed S1 run's log (`_1.0/reports/m7-e-s1-verify-r8.log`):
 * `[stories] S1: green — 11/11 beats green` printed at :4627, then
 * `[stories] S1: CONTAINMENT FAILURE — 1 change(s) in projects/story-s1
 * that nothing this run minted accounts for (named above). The run is RED
 * regardless of its beats.` printed at :4639, and the run exited 1. A
 * reader (T1) took the green line as the verdict, because it was the ONLY
 * line shaped like a per-story verdict (`${id}: ${status} — N/M beats
 * green`) — the containment line that actually decided the exit code uses
 * different words and never restates that shape.
 *
 * `containmentVerdict` is a PURE function (no browser, no bridge —
 * `host-head.test.ts`'s own `quiet` fixture is the precedent for calling it
 * directly rather than reading source text), so these doors drive it
 * directly and capture BOTH `console.log` and `console.error` IN ORDER —
 * "the LAST line" is an actual assertion here, not a guess about print
 * order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { containmentVerdict } from './run-story-verdict.mjs';

function withCapturedLines<T>(fn: () => T): { result: T; lines: string[] } {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    return { result: fn(), lines };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

// The baseline every case below starts from: every containment check clean,
// beats green. Shaped like `host-head.test.ts`'s own `quiet` fixture,
// extended with `row.greenBeats`/`row.beats` since this row's fix reads them.
const quiet = {
  story: { id: 'S1', ground: { project: 'story-s1' } },
  ownGroundDrift: { mergeAlignmentFailure: null, undeclared: [], unmatchedDeclarations: [], clear: { unremoved: [] } },
  trailing: { census: { empty: true }, reappearedArtefacts: [] },
  fence: { reappeared: [], groundEscapes: [], escapes: [] },
  realFence: { ok: true },
  forkGrounds: { redReason: null },
  hostHead: { red: false },
  hostRefs: { red: false },
  row: { status: 'green', greenBeats: 11, beats: 11 },
  spendHalt: null,
  galleryRegenFailure: null,
  parityViolations: [],
};

test('row 191 (the measured bug): green beats + a containment failure — the LAST verdict line says red and matches the exit code', () => {
  const { result, lines } = withCapturedLines(() => containmentVerdict({
    ...quiet,
    ownGroundDrift: { ...quiet.ownGroundDrift, undeclared: ['projects/story-s1/rogue.txt'] },
  }));
  assert.equal(result, 1, 'a containment failure must exit non-zero even though every beat was green');
  const last = lines[lines.length - 1];
  assert.equal(
    last, '[stories] S1: red — 11/11 beats green',
    `the LAST printed line must restate the per-story verdict as red, matching the exit code; got: ${JSON.stringify(lines)}`,
  );
});

test('row 191: clean containment + green beats — the LAST verdict line says green and the exit code is 0', () => {
  const { result, lines } = withCapturedLines(() => containmentVerdict({ ...quiet }));
  assert.equal(result, 0);
  assert.equal(lines[lines.length - 1], '[stories] S1: green — 11/11 beats green');
});

test('row 191: red beats, no containment failure — the LAST verdict line says red and the exit code is 1', () => {
  const { result, lines } = withCapturedLines(() => containmentVerdict({
    ...quiet,
    row: { status: 'red', greenBeats: 8, beats: 11 },
  }));
  assert.equal(result, 1);
  assert.equal(lines[lines.length - 1], '[stories] S1: red — 8/11 beats green');
});

test('row 191: a spend halt with green beats still ends on a red restated line, matching the exit code', () => {
  const { result, lines } = withCapturedLines(() => containmentVerdict({
    ...quiet,
    spendHalt: { reason: 'ceiling reached', note: 'stopped at beat 8 of 23' },
  }));
  assert.equal(result, 1);
  assert.equal(lines[lines.length - 1], '[stories] S1: red — 11/11 beats green');
});

// Row 206 (bead `forge-8vfn.8.5.56`) — a parity violation names the channel
// and both event ids in the printed reason, not only in the final restated
// line, so a reader does not have to re-derive which dispatch double-started.
test('row 206: a parity violation prints the channel and event ids and reds the run regardless of green beats', () => {
  const { result, lines } = withCapturedLines(() => containmentVerdict({
    ...quiet,
    parityViolations: [
      { kind: 'double-start', channel: '_agent-onboarding-agent-x', key: 'onboarding-agent', eventIds: ['EV_1', 'EV_2'] },
    ],
  }));
  assert.equal(result, 1);
  assert.ok(
    lines.some((l) => l.includes('double-start') && l.includes('_agent-onboarding-agent-x') && l.includes('EV_1') && l.includes('EV_2')),
    `expected a line naming the channel and both event ids; got: ${JSON.stringify(lines)}`,
  );
  assert.equal(lines[lines.length - 1], '[stories] S1: red — 11/11 beats green');
});

test('row 206: no parity violations — the baseline still reads green', () => {
  const { result, lines } = withCapturedLines(() => containmentVerdict({ ...quiet }));
  assert.equal(result, 0);
  assert.equal(lines[lines.length - 1], '[stories] S1: green — 11/11 beats green');
});

test('row 191: EVERY containment gate ends with the SAME restated line as its own return 1, never only the detailed reason', () => {
  // Each case flips ONE containment input red, read from the SAME `quiet`
  // baseline — a gate that forgot to call `printFinal` before its own
  // `return 1` reds THIS test, not a human reading a log months later.
  const cases: Array<[string, Record<string, unknown>]> = [
    ['mergeAlignmentFailure', { ownGroundDrift: { ...quiet.ownGroundDrift, mergeAlignmentFailure: 'merge closure could not be verified' } }],
    ['undeclared', { ownGroundDrift: { ...quiet.ownGroundDrift, undeclared: ['x'] } }],
    ['unmatchedDeclarations', { ownGroundDrift: { ...quiet.ownGroundDrift, unmatchedDeclarations: ['y'] } }],
    ['clear.unremoved', { ownGroundDrift: { ...quiet.ownGroundDrift, clear: { unremoved: ['_agent-z'] } } }],
    ['trailing.census', { trailing: { census: { empty: false, reason: 'still alive' }, reappearedArtefacts: [] } }],
    ['trailing.reappearedArtefacts', { trailing: { census: { empty: true }, reappearedArtefacts: ['brain/x'] } }],
    ['fence.reappeared', { fence: { ...quiet.fence, reappeared: ['brain/x'] } }],
    ['hostHead.red', { hostHead: { red: true, summary: 'HEAD moved a..b on refs/heads/work' } }],
    ['hostRefs.red', { hostRefs: { red: true, summary: '1 ref(s) changed outside refs/remotes/* (1 moved, 0 created, 0 deleted)' } }],
    ['fence.groundEscapes', { fence: { ...quiet.fence, groundEscapes: ['projects/story-s1/x'] } }],
    ['realFence', { realFence: { ok: false, moved: ['projects/real'], unreadable: [] } }],
    ['fence.escapes', { fence: { ...quiet.fence, escapes: [{ owner: 'this-run', paths: ['a'] }] } }],
    ['forkGrounds', { forkGrounds: { redReason: 'CONTAINMENT FAILURE — fork case ground' } }],
    ['galleryRegenFailure', { galleryRegenFailure: 'foreign untracked target' }],
    ['parityViolations', { parityViolations: [{ kind: 'double-start', channel: '_agent-onboarding-agent-x', key: 'onboarding-agent', eventIds: ['EV_1', 'EV_2'] }] }],
  ];
  for (const [name, patch] of cases) {
    const { result, lines } = withCapturedLines(() => containmentVerdict({ ...quiet, ...patch }));
    assert.equal(result, 1, `${name} must exit non-zero`);
    assert.equal(
      lines[lines.length - 1], '[stories] S1: red — 11/11 beats green',
      `${name}'s own last line must restate red, got: ${JSON.stringify(lines)}`,
    );
  }
});
