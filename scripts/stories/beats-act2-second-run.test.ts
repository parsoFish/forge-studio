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
  }
});

test('row 149: a beat resolves the second run\'s own cycle id, distinct from ACT 1\'s', async () => {
  const beats = await act2Beats();
  const bindsCycleId2 = beats.some((b: any) => Object.values(b.expect.data).includes('<cycleId2>'));
  assert.ok(bindsCycleId2, 'a beat must bind <cycleId2> — the second run\'s own cycle id');

  const bindsRunId2 = beats.some((b: any) => Object.values(b.expect.data).includes('<runId2>'));
  assert.ok(bindsRunId2, 'a beat must bind <runId2> — the second initiative\'s own id');
});
