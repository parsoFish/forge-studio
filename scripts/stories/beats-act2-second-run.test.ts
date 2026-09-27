/**
 * beats-act2-second-run.test.ts — row 149 (bead `forge-8vfn.8.1.40`, rulings
 * 1771 / 1774 / 1794): S10's ACT 2 used to stop a run mid-flight with nothing
 * running — its only initiative was already merged and reflected by the time
 * ACT 2's beats executed (`REVIEW_LOOP` + `CLOSE` run before `ACT_2` in
 * `S10.story.mjs`'s own `beats` array), so `stop-run` had no control to press
 * and the beats after it read a page that never carried the attributes they
 * asked for.
 *
 * THE FIX starts a SECOND, small initiative through the real UI (never a
 * hand-written queue file), waits for its first work item, stops it
 * mid-flight, resumes it through the run's own `resume-run` control (never
 * `requeue-run`/`recovery-requeue`, which the row's own ruling reserves for a
 * different act), and asserts both that the finished work item survived and
 * that the unfinished one resumes rather than being skipped.
 *
 * ROUND 2 (adversarial review, two blockers). (1) Waiting for WI-1 to be
 * `complete` before pressing stop let WI-2's own worktree already exist by
 * the time the press landed — the operator stop is honoured only before a
 * WI's worktree is created or at a node boundary (`developer-loop.ts:1152`,
 * `flow-runner.ts:461-464`; no wedge budget is threaded in production,
 * `docs/decisions/028-flow-engine.md` ~262-269), so WI-2 ran to completion
 * regardless and "WI-2 resumes" passed vacuously. The fix waits for `active`
 * and asserts an explicit `pending` for the NEXT work item right after the
 * halt, before any resume. (2) `pickDefaultRun` ranks ACT 1's own `complete`
 * run above a resumed run's transient `planned` state, and ACT 1 has its own
 * `complete` `WI-1` — so a bare `wi-id`/`status` assertion could pass against
 * the WRONG run. The fix requires `run-id` on every monitor hex assertion.
 *
 * ROUND 3 (adversarial review again): `run-id` alone is ITSELF vacuous —
 * `data-run-id` is rendered on every rail card too (`RunRail.tsx:232`), not
 * only on the SELECTED run's `RunControls` section, so the together-rule
 * (`beats-page-read.mjs`) is satisfied by ACT 2's own (always-present) rail
 * card regardless of which run is actually selected. The fix pairs `run-id`
 * with `section: 'run-controls'` (`RunControls.tsx:189`, a value no rail
 * card carries), which only works because `data-section` has a second,
 * always-rendered carrier on this page (`HistoryLedger.tsx:106-108`,
 * mounted unconditionally at `app/flows/[id]/page.tsx:887`) that keeps
 * `section` out of the solo path. Proved directly on `resolveExpectations`
 * in `beats-page-read.test.ts`'s "ROW 149 ROUND 2/3" tests before trusting
 * it here.
 *
 * This asserts the REAL S10 story, through the REAL parser, rather than a
 * hand-built fixture — same convention as `beats-kb-select-nav.test.ts` and
 * `beats-cost-route.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateStory } from './story-file.mjs';

async function act2Beats() {
  const story = (await import('../../tests/stories/S10.story.mjs')).default;
  return validateStory(story).beats;
}

test('row 149: ACT 2 starts a second initiative through the real UI', async () => {
  const beats = await act2Beats();
  const startsArchitect = beats.some((b: any) =>
    (b.do ?? []).some((step: any) => step.press === 'start-work-architect'));
  assert.ok(startsArchitect, 'a beat must press start-work-architect a second time, for a second idea');

  const secondDevelop = beats.filter((b: any) =>
    (b.do ?? []).some((step: any) => step.press === 'start-development'));
  assert.equal(
    secondDevelop.length, 2,
    'start-development must be pressed twice: once for ACT 1\'s initiative, once for ACT 2\'s',
  );
});

test('row 149: ACT 2 presses stop-run, never abandon-run, on a route keyed by a 2nd cycle id', async () => {
  const beats = await act2Beats();
  const stopIndex = beats.findIndex((b: any) =>
    (b.do ?? []).some((step: any) => step.press === 'stop-run'));
  assert.notEqual(stopIndex, -1, 'a beat must press stop-run');

  const stopBeat = beats[stopIndex];
  assert.ok(
    !(stopBeat.do ?? []).some((step: any) => step.press === 'abandon-run'),
    'the stop beat must never also press the destructive abandon-run',
  );
  assert.match(
    stopBeat.expect.route, /^\/flows\/forge-develop\/run\/<[A-Za-z][A-Za-z0-9_]*>$/,
    'the run page keys on a CYCLE id placeholder',
  );
  assert.notEqual(
    stopBeat.expect.route, '/flows/forge-develop/run/<cycleId>',
    'ACT 2\'s own run must bind a placeholder distinct from ACT 1\'s <cycleId> — reusing it would ' +
      'press stop-run against the FIRST (already merged) run instead of the second one',
  );
});

test('row 149: a beat asserts the operator-stop reason and the failed status', async () => {
  const beats = await act2Beats();
  const stopReasonBeat = beats.find((b: any) => b.expect.data['run-stop-reason'] === 'operator-stop');
  assert.ok(stopReasonBeat, 'a beat must assert data-run-stop-reason="operator-stop"');
  assert.equal(
    stopReasonBeat.expect.data['run-status'], 'failed',
    'the same beat (or the same record) must assert the failed status the operator-stop note explains',
  );
});

test('row 149: ACT 2 resumes via resume-run, never requeue-run or recovery-requeue', async () => {
  const beats = await act2Beats();
  const pressed = beats.flatMap((b: any) => (b.do ?? []).map((step: any) => step.press).filter(Boolean));
  assert.ok(pressed.includes('resume-run'), 'a beat must press resume-run');
  assert.ok(
    !pressed.includes('requeue-run'),
    'requeue-run wipes the worktree fresh from main — not this row\'s act',
  );
  assert.ok(
    !pressed.includes('recovery-requeue'),
    'recovery-requeue is the roadmap drawer\'s own control, on a different page from resume-run',
  );
});

test('row 149: the survived and the re-run work item are DIFFERENT wi-id records', async () => {
  const beats = await act2Beats();
  const wiBeats = beats.filter((b: any) => Object.hasOwn(b.expect.data, 'wi-id'));
  assert.ok(wiBeats.length >= 2, 'at least two beats must assert a specific work item\'s hex status');

  const wiIds = new Set(wiBeats.map((b: any) => b.expect.data['wi-id']));
  assert.ok(wiIds.size >= 2, 'the survived and the re-run work item must be two different wi-id values');

  for (const b of wiBeats) {
    assert.equal(b.expect.data['hex-kind'], 'wi', 'a wi-id assertion must be scoped to a wi-kind hex');
    assert.equal(b.expect.route, '/flows/forge-develop', 'per-work-item status only exists on the monitor');
    assert.equal(
      b.expect.data['run-id'], '<cycleId2>',
      'row 149 round 2: EVERY monitor hex beat must also assert run-id, or it can pass against ' +
        'ACT 1\'s own stale run instead of the second one',
    );
    assert.equal(
      b.expect.data['section'], 'run-controls',
      'row 149 round 3: run-id alone is VACUOUS — data-run-id is on every rail card too ' +
        '(RunRail.tsx:232), so it must be paired with section: "run-controls" ' +
        '(RunControls.tsx:189), the only value that pins run-id to the SELECTED run\'s own ' +
        'element rather than any rail card that happens to carry the wanted id ' +
        '(beats-page-read.test.ts\'s "ROW 149 ROUND 2/3" tests prove this on resolveExpectations ' +
        'directly)',
    );
  }
});

test(
  'row 156: EVERY monitor hex beat presses select-run-<cycleId2> FIRST — the monitor\'s shown run ' +
    'is chosen explicitly, never left to pickDefaultRun/the rail\'s group order',
  async () => {
    const beats = await act2Beats();
    const wiBeats = beats.filter((b: any) => Object.hasOwn(b.expect.data, 'wi-id'));
    assert.ok(wiBeats.length >= 2, 'at least two beats must assert a specific work item\'s hex status');

    for (const b of wiBeats) {
      const first = (b.do ?? [])[0];
      assert.ok(
        first !== undefined && Object.hasOwn(first, 'pressBound'),
        `every monitor hex beat's FIRST do step must be a pressBound (beat: ${b.act})`,
      );
      assert.deepEqual(
        first.pressBound,
        { action: 'select-run-', bind: 'cycleId2' },
        'row 156 (forge-8vfn.8.1.44, ruling 1852): RunCard\'s handle concatenates the run\'s own id ' +
          'into data-action (the SAME open-initiative-<id> convention pressBound already resolves for ' +
          '"open the second initiative") — a bare press: "select-run" cannot target one card among ' +
          'two on the rail, and pressWithin\'s scoped selector never matches an action and its scoping ' +
          'attribute on the SAME element, so this is the one DSL shape that reaches it',
      );
    }
  },
);

test('row 149 round 2: the stop is pressed while WI-1 is active, never after it is complete', async () => {
  const beats = await act2Beats();
  const stopIndex = beats.findIndex((b: any) =>
    (b.do ?? []).some((step: any) => step.press === 'stop-run'));
  assert.notEqual(stopIndex, -1, 'a beat must press stop-run');

  const before = beats.slice(0, stopIndex);
  const wi1CompleteBeforeStop = before.some((b: any) =>
    b.expect.data['wi-id'] === 'WI-1' && b.expect.data['status'] === 'complete');
  assert.ok(
    !wi1CompleteBeforeStop,
    'no beat before the stop may wait for WI-1 to be complete — by then WI-2\'s own worktree ' +
      'already exists and the stop cannot land before it, making the resume checks vacuous',
  );

  const wi1ActiveBeforeStop = before.some((b: any) =>
    b.expect.data['wi-id'] === 'WI-1' && b.expect.data['status'] === 'active');
  assert.ok(wi1ActiveBeforeStop, 'a beat before the stop must wait for WI-1 to be active (still running)');
});

test('row 149 round 2: after the halt, WI-2 is explicitly asserted NOT complete', async () => {
  const beats = await act2Beats();
  const stopIndex = beats.findIndex((b: any) =>
    (b.do ?? []).some((step: any) => step.press === 'stop-run'));
  const resumeIndex = beats.findIndex((b: any) =>
    (b.do ?? []).some((step: any) => step.press === 'resume-run'));
  assert.notEqual(stopIndex, -1, 'a beat must press stop-run');
  assert.notEqual(resumeIndex, -1, 'a beat must press resume-run');
  assert.ok(resumeIndex > stopIndex, 'resume must come after stop');

  const betweenStopAndResume = beats.slice(stopIndex + 1, resumeIndex);
  const wi2NotComplete = betweenStopAndResume.find((b: any) =>
    b.expect.data['wi-id'] === 'WI-2' && Object.hasOwn(b.expect.data, 'status'));
  assert.ok(wi2NotComplete, 'a beat between stop and resume must assert WI-2\'s status explicitly');
  assert.notEqual(
    wi2NotComplete.expect.data['status'], 'complete',
    'WI-2 must be asserted NOT complete after the halt — "unfinished work" must be a checked ' +
      'fact, not an assumption made from having waited for WI-1 alone',
  );

  const wi1CompleteAfterStop = betweenStopAndResume.some((b: any) =>
    b.expect.data['wi-id'] === 'WI-1' && b.expect.data['status'] === 'complete');
  assert.ok(wi1CompleteAfterStop, 'a beat between stop and resume must assert WI-1 finished naturally');
});

test('row 149: a beat resolves the second run\'s own cycle id, distinct from ACT 1\'s', async () => {
  const beats = await act2Beats();
  const bindsCycleId2 = beats.some((b: any) => Object.values(b.expect.data).includes('<cycleId2>'));
  assert.ok(bindsCycleId2, 'a beat must bind <cycleId2> — the second run\'s own cycle id');

  const bindsRunId2 = beats.some((b: any) => Object.values(b.expect.data).includes('<runId2>'));
  assert.ok(bindsRunId2, 'a beat must bind <runId2> — the second initiative\'s own id');
});
