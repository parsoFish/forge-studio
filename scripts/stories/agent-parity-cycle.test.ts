/**
 * agent-parity-cycle.test.ts — row 207 (bead `forge-8vfn.8.5.57`), T1 ruling
 * 1973qf. S10 is the first full develop cycle judged by row 206's run-end
 * parity, and its run 2 (head bce75b68) went red on parity ONLY. Every
 * fixture below is copied from that run's own captured `events.jsonl` (real
 * event ids, real timestamps, trimmed to the rows each case is about):
 *
 *   ACT 1 cycle `2026-10-04T15-38-31_INIT-2026-10-04-exclude-author-filter-flag`
 *   ACT 2 cycle `2026-10-04T17-05-02_INIT-2026-10-04-coupling-sort-flag`
 *
 * (A) developer-ralph writes one `ralph.end` per work item
 *     (`metadata.work_item_id`) beside one phase end per attempt — a per-WI
 *     row is never a run-level boundary (`isPerWorkItemRow`, @forge/kernel,
 *     the SAME predicate `deriveNodeStatuses` reads).
 * (B) the reflector AGENT appended its own `reflector.start`/`reflector.end`
 *     text rows into the cycle log (Python `json.dumps` spacing, microsecond
 *     timestamps, no `event_id`) inside the runtime's own reflector turn.
 *     Forge's event logger mints an `event_id` on every row it writes, so an
 *     id-less row is not a run-level emission.
 * (C) an operator-stopped attempt ends with its own `cycle.end` (C1, cycle.ts);
 *     a resumed attempt is a new FIFO pair; a final attempt still open at the
 *     story's end is DEFERRED while this run's own serve is alive and judged
 *     after the batch's own serve stop (C2) — excused only when that stop
 *     killed the daemon with this initiative in `_queue/in-flight/`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { channelParityVerdict, describeAgentParity, agentParityVerdict } from './agent-parity.mjs';
import { serveStopEvidence, judgeDeferredCycleChannels } from './agent-parity-serve-stop.mjs';

const ACT1 = '/r/_logs/2026-10-04T15-38-31_INIT-2026-10-04-exclude-author-filter-flag';
const ACT2 = '/r/_logs/2026-10-04T17-05-02_INIT-2026-10-04-coupling-sort-flag';
const ACT2_INIT = 'INIT-2026-10-04-coupling-sort-flag';

const ACT1_DEV_ROWS = [
  { event_id: 'EV_mutzq73u_6ltwqkzt', started_at: '2026-10-04T15:43:28.122Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start' },
  { event_id: 'EV_mutzq743_umpznvn4', started_at: '2026-10-04T15:43:28.131Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'start' },
  { event_id: 'EV_mutztkdh_yorucicm', parent_event_id: 'EV_mutzq7ds_nu5ojp7z', started_at: '2026-10-04T15:46:05.285Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', message: 'ralph.end', metadata: { work_item_id: 'WI-1', status: 'complete' } },
  { event_id: 'EV_muu05jgm_yrd7unqm', parent_event_id: 'EV_mutztkea_7ae7vn8z', started_at: '2026-10-04T15:55:23.974Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', message: 'ralph.end', metadata: { work_item_id: 'WI-2', status: 'complete' } },
  { event_id: 'EV_muu0bqim_thc0ceai', parent_event_id: 'EV_muu05jhi_51yhd5f3', started_at: '2026-10-04T16:00:13.054Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', message: 'ralph.end', metadata: { work_item_id: 'WI-3', status: 'complete' } },
  { event_id: 'EV_muu0bqj9_yu7fxnbo', parent_event_id: 'EV_mutzq743_umpznvn4', started_at: '2026-10-04T16:00:13.077Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', metadata: { work_item_count: 3, complete: 3, failed: 0 } },
  { event_id: 'EV_muu0sci1_fbjaebus', started_at: '2026-10-04T16:13:08.041Z', phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end', metadata: { status: 'pr-open' } },
];

const ACT1_REFLECTOR_ROWS = [
  { event_id: 'EV_muu218y6_1knlmbvy', started_at: '2026-10-04T16:48:02.958Z', phase: 'closure', skill: 'cycle', event_type: 'start', message: 'closure.start' },
  { event_id: 'EV_muu220a6_rc0l4awr', parent_event_id: 'EV_muu218y6_1knlmbvy', started_at: '2026-10-04T16:48:38.382Z', phase: 'closure', skill: 'cycle', event_type: 'end', message: 'closure.end' },
  { event_id: 'EV_muu220a8_elp7caaa', started_at: '2026-10-04T16:48:38.384Z', phase: 'reflection', skill: 'reflector', event_type: 'start', message: 'reflector.start' },
  { started_at: '2026-10-04T16:55:15.833175Z', phase: 'reflection', skill: 'reflector', event_type: 'start', message: 'reflector.start', metadata: {} },
  { started_at: '2026-10-04T16:55:15.833175Z', phase: 'reflection', skill: 'reflector', event_type: 'end', message: 'reflector.end', metadata: { themes_written: 2, questions_written: 4 } },
  { event_id: 'EV_muu2aqc5_pkqghub0', parent_event_id: 'EV_muu220a8_elp7caaa', started_at: '2026-10-04T16:55:25.397Z', phase: 'reflection', skill: 'reflector', event_type: 'end', message: 'reflector.end', metadata: { status: 'closed' } },
  { event_id: 'EV_muu2as4y_qo01lj71', started_at: '2026-10-04T16:55:27.730Z', phase: 'reflection', skill: 'reflector', event_type: 'start', message: 'reflector.start' },
  { event_id: 'EV_muu2c1hq_ty5pth48', parent_event_id: 'EV_muu2as4y_qo01lj71', started_at: '2026-10-04T16:56:26.510Z', phase: 'reflection', skill: 'reflector', event_type: 'end', message: 'reflector.end', metadata: { status: 'closed' } },
];

// ACT 2 as captured (pre-C1 product: the stopped attempt wrote no cycle.end).
const ACT2_STOP_ERROR_ROWS = [
  { event_id: 'EV_muu2voty_pp4xv98w', started_at: '2026-10-04T17:11:43.222Z', phase: 'orchestrator', skill: 'flow-budgets', event_type: 'log', message: 'flow.operator-stop' },
  { event_id: 'EV_muu2voty_46uu9up7', started_at: '2026-10-04T17:11:43.222Z', phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: 'operator-stop: the operator requested this run stop — halting at a clean boundary (resumable; the worktree and branch are kept).' },
  { event_id: 'EV_muu2vou0_lsoufwhg', started_at: '2026-10-04T17:11:43.224Z', phase: 'orchestrator', skill: 'cycle', event_type: 'log', message: 'failure_classification' },
];
const ACT2_BEFORE_STOP = [
  { event_id: 'EV_muu2n582_zx9imscm', initiative_id: ACT2_INIT, started_at: '2026-10-04T17:05:04.562Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start' },
  { event_id: 'EV_muu2n58b_mbwd75ix', started_at: '2026-10-04T17:05:04.571Z', phase: 'project-manager', skill: 'project-manager', event_type: 'start' },
  { event_id: 'EV_muu2r3y8_fm8yxb8c', parent_event_id: 'EV_muu2n58b_mbwd75ix', started_at: '2026-10-04T17:08:09.536Z', phase: 'project-manager', skill: 'project-manager', event_type: 'end', metadata: { work_item_count: 3 } },
  { event_id: 'EV_muu2r3ya_1ub3lgvw', started_at: '2026-10-04T17:08:09.538Z', phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end', metadata: { status: 'ready-for-review' } },
  { event_id: 'EV_muu2r92w_31wkod90', initiative_id: ACT2_INIT, started_at: '2026-10-04T17:08:16.184Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start' },
  { event_id: 'EV_muu2r933_zibv5d0d', started_at: '2026-10-04T17:08:16.191Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'start' },
  { event_id: 'EV_muu2votb_rgqf5afu', parent_event_id: 'EV_muu2r9dv_38mhh4i6', started_at: '2026-10-04T17:11:43.199Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', message: 'ralph.end', metadata: { work_item_id: 'WI-1', status: 'complete' } },
  { event_id: 'EV_muu2voty_e6rz1ju4', parent_event_id: 'EV_muu2r933_zibv5d0d', started_at: '2026-10-04T17:11:43.222Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', metadata: { work_item_count: 3, complete: 1, failed: 2 } },
  ...ACT2_STOP_ERROR_ROWS,
];
const ACT2_RESUMED = [
  { event_id: 'EV_muu2vv9a_d95ku8tu', initiative_id: ACT2_INIT, started_at: '2026-10-04T17:11:51.550Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start' },
  { event_id: 'EV_muu2vv9i_bc5nqcqv', started_at: '2026-10-04T17:11:51.558Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'start' },
  { event_id: 'EV_muu2vwp4_pjphjmj7', parent_event_id: 'EV_muu2vvk0_8l5udxwm', started_at: '2026-10-04T17:11:53.416Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', message: 'ralph.end', metadata: { work_item_id: 'WI-1', status: 'complete' } },
  { event_id: 'EV_muu2yuzj_a7wa5kwp', parent_event_id: 'EV_muu2vwpp_t8mdsfh4', started_at: '2026-10-04T17:14:11.167Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', message: 'ralph.end', metadata: { work_item_id: 'WI-2', status: 'complete' } },
  { event_id: 'EV_muu2yvux_bhujf8gm', parent_event_id: 'EV_muu2yv09_7am9yds6', started_at: '2026-10-04T17:14:12.297Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', message: 'ralph.end', metadata: { work_item_id: 'WI-3', status: 'failed' } },
  { event_id: 'EV_muu2yvvj_qo6m5k4h', parent_event_id: 'EV_muu2vv9i_bc5nqcqv', started_at: '2026-10-04T17:14:12.319Z', phase: 'developer-loop', skill: 'developer-ralph', event_type: 'end', metadata: { work_item_count: 3, complete: 2, failed: 1 } },
  { event_id: 'EV_muu2yvvj_objl6hge', started_at: '2026-10-04T17:14:12.319Z', phase: 'orchestrator', skill: 'demo-agent', event_type: 'start', metadata: { agent_slug: 'demo-agent' } },
  { event_id: 'EV_muu2zchu_n1a7ubj6', parent_event_id: 'EV_muu2yvvj_objl6hge', started_at: '2026-10-04T17:14:33.858Z', phase: 'orchestrator', skill: 'demo-agent', event_type: 'end', metadata: { agent_slug: 'demo-agent' } },
  { event_id: 'EV_muu2zchu_vee5ho6d', started_at: '2026-10-04T17:14:33.858Z', phase: 'orchestrator', skill: 'adversarial-review', event_type: 'start', metadata: { agent_slug: 'adversarial-review' } },
];
const ACT2_AS_CAPTURED = [...ACT2_BEFORE_STOP, ...ACT2_RESUMED];
// The SAME log once C1 lands: the stopped attempt closes itself (cycle.ts's
// catch writes `cycle.end`, status 'stopped', right after the classification).
const C1_STOPPED_END = {
  event_id: 'EV_c1_stopped_end', started_at: '2026-10-04T17:11:43.230Z', phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end',
  metadata: { status: 'stopped', error: 'OperatorStopError: operator-stop: …' },
};
const ACT2_AFTER_C1 = [...ACT2_BEFORE_STOP, C1_STOPPED_END, ...ACT2_RESUMED];

/** stopStudioThenScheduler's own result shape, as run 2's batch teardown printed it. */
function serveStopResult({ drained = false, inFlight = [`/r/_queue/in-flight/${ACT2_INIT}.md`] } = {}) {
  return {
    sched: { stopped: 3168766, how: drained ? 'SIGTERM' : 'SIGKILL', drained, unknown: false, note: null },
    census: { empty: true },
    deferred: {
      claim: { claimed: inFlight.map((path) => ({ path, state: 'in-flight', reason: 'created_at inside this run' })) },
      artefacts: { dest: '/r/_logs/_story-run-artefacts-clear/batch-teardown/1791127799725', captured: [`_logs/${ACT2.split('/').pop()}`] },
    },
    lines: [],
  };
}

describe('(A) per-work-item ralph.end rows are not run-level boundaries', () => {
  test('S10 run 2 ACT 1: three per-WI ralph.end rows beside one phase end per attempt is ok, never extra-end', () => {
    const v = channelParityVerdict(ACT1, ACT1_DEV_ROWS);
    assert.equal(v.kind, 'cycle');
    assert.deepEqual(v.violations, [], describeAgentParity(agentParityVerdict([{ dir: ACT1, rows: ACT1_DEV_ROWS }])).join('\n'));
  });

  test('a per-WI end with NO phase end is still missing-end on the phase lane — the exclusion never closes a lane', () => {
    const rows = ACT1_DEV_ROWS.filter((r) => r.event_id !== 'EV_muu0bqj9_yu7fxnbo');
    const v = channelParityVerdict(ACT1, rows);
    assert.deepEqual(v.violations.map((x) => [x.kind, x.key, x.eventIds]), [
      ['missing-end', 'developer-loop::developer-ralph', ['EV_mutzq743_umpznvn4']],
    ]);
  });
});

describe('(B) an id-less row is not a run-level emission', () => {
  test('S10 run 2 ACT 1: the agent-appended reflector.start/end pair inside turn muu220a8 is not a double-start', () => {
    const v = channelParityVerdict(ACT1, ACT1_REFLECTOR_ROWS);
    assert.deepEqual(v.violations, []);
  });

  test('a forged end that DOES carry an id still counts — exclusion is by missing id, never by message or timing', () => {
    const forged = { event_id: 'EV_reflector_28401d0a', started_at: '2026-10-02T03:28:23Z', phase: 'reflection', skill: 'reflector', event_type: 'end', message: 'reflector.end' };
    const rows = [...ACT1_REFLECTOR_ROWS.slice(0, 3), forged, ...ACT1_REFLECTOR_ROWS.slice(5)];
    const v = channelParityVerdict(ACT1, rows);
    assert.deepEqual(v.violations.map((x) => [x.kind, x.eventIds]), [['extra-end', ['EV_muu2aqc5_pkqghub0']]]);
  });
});

describe('(C) cycle attempts', () => {
  test('as captured (pre-C1): the stopped attempt never closed — double-start + missing-end, named by event id', () => {
    const v = channelParityVerdict(ACT2, ACT2_AS_CAPTURED);
    const cycleLane = v.violations.filter((x) => x.key === 'orchestrator::cycle');
    assert.deepEqual(cycleLane.map((x) => [x.kind, x.eventIds]), [
      ['double-start', ['EV_muu2r92w_31wkod90', 'EV_muu2vv9a_d95ku8tu']],
      ['missing-end', ['EV_muu2r92w_31wkod90']],
      ['missing-end', ['EV_muu2vv9a_d95ku8tu']],
    ]);
  });

  test('after C1, a resumed attempt is a new pair: no double-start; the open final attempt is a plain missing-end with no serve evidence', () => {
    const v = channelParityVerdict(ACT2, ACT2_AFTER_C1);
    assert.deepEqual(v.violations.map((x) => [x.kind, x.key, x.eventIds]), [
      ['missing-end', 'orchestrator::cycle', ['EV_muu2vv9a_d95ku8tu']],
      ['missing-end', 'orchestrator::adversarial-review', ['EV_muu2zchu_vee5ho6d']],
    ]);
  });

  test('at story end, with this run\'s own serve still alive, the open final attempt is DEFERRED — not ok-by-silence, not a violation yet', () => {
    const v = channelParityVerdict(ACT2, ACT2_AFTER_C1, { serveAlivePid: 3168766 });
    assert.deepEqual(v.violations, []);
    assert.deepEqual(v.deferred.map((d) => [d.key, d.eventIds]), [
      ['orchestrator::cycle', ['EV_muu2vv9a_d95ku8tu']],
      ['orchestrator::adversarial-review', ['EV_muu2zchu_vee5ho6d']],
    ]);
    assert.ok(describeAgentParity(agentParityVerdict([{ dir: ACT2, rows: ACT2_AFTER_C1 }], { serveAlivePid: 3168766 }))
      .some((l) => l.includes('DEFERRED') && l.includes('EV_muu2vv9a_d95ku8tu') && l.includes('3168766')));
  });

  test('an EARLIER attempt left open is never deferred — only the final attempt can still be in flight', () => {
    const v = channelParityVerdict(ACT2, ACT2_AS_CAPTURED, { serveAlivePid: 3168766 });
    assert.ok(v.violations.some((x) => x.kind === 'missing-end' && x.eventIds[0] === 'EV_muu2r92w_31wkod90'));
  });

  test('after the batch serve stop KILLED the daemon with this initiative in flight, the final attempt is satisfied, naming the pid', () => {
    const v = channelParityVerdict(ACT2, ACT2_AFTER_C1, { serveStop: serveStopEvidence(serveStopResult()) });
    assert.deepEqual(v.violations, []);
    assert.equal(v.satisfied.length, 2);
    assert.match(v.satisfied[0].reason, /3168766/);
  });

  test('a daemon that DRAINED is no excuse — it awaited its cycles, so a missing end is the product\'s', () => {
    const v = channelParityVerdict(ACT2, ACT2_AFTER_C1, { serveStop: serveStopEvidence(serveStopResult({ drained: true })) });
    assert.equal(v.violations.length, 2);
  });

  test('a kill that did not hold THIS initiative in flight is no excuse', () => {
    const v = channelParityVerdict(ACT2, ACT2_AFTER_C1, { serveStop: serveStopEvidence(serveStopResult({ inFlight: ['/r/_queue/in-flight/INIT-other.md'] })) });
    assert.equal(v.violations.length, 2);
  });

  test('serveStopEvidence: no stopped pid, a refused teardown, or no deferred claim is NO evidence (null)', () => {
    assert.equal(serveStopEvidence(null), null);
    assert.equal(serveStopEvidence({ sched: { stopped: null, drained: false }, deferred: null }), null);
    assert.equal(serveStopEvidence({ sched: null, census: { empty: false }, deferred: null }), null);
    assert.equal(serveStopEvidence({ ...serveStopResult(), deferred: null }), null);
  });
});

describe('judgeDeferredCycleChannels — the batch-end half of C2', () => {
  const deferredEntry = { channel: ACT2, reported: [] };

  test('re-reads the deferred channel from the serve stop\'s own capture and excuses the killed final attempt', () => {
    const reads = [];
    const out = judgeDeferredCycleChannels({
      deferred: [deferredEntry], stop: serveStopResult(),
      readRows: (dir) => { reads.push(dir); return ACT2_AFTER_C1; },
    });
    assert.deepEqual(reads, [`/r/_logs/_story-run-artefacts-clear/batch-teardown/1791127799725/_logs/${ACT2.split('/').pop()}`]);
    assert.deepEqual(out.violations, []);
    assert.ok(out.lines.some((l) => l.includes('3168766')));
  });

  test('no serve-stop result at all: the deferred final attempt is a violation — never excused without the harness\'s own kill', () => {
    const out = judgeDeferredCycleChannels({ deferred: [deferredEntry], stop: null, readRows: () => ACT2_AFTER_C1, liveExists: () => true });
    assert.deepEqual(out.violations.map((x) => [x.kind, x.eventIds]), [
      ['missing-end', ['EV_muu2vv9a_d95ku8tu']], ['missing-end', ['EV_muu2zchu_vee5ho6d']],
    ]);
  });

  test('a deferred channel the stop never captured and that is gone from _logs is UNMEASURED, never silently passed', () => {
    const stop = { ...serveStopResult(), deferred: { ...serveStopResult().deferred, artefacts: { dest: '/x', captured: [] } } };
    const out = judgeDeferredCycleChannels({ deferred: [deferredEntry], stop, readRows: () => [], liveExists: () => false });
    assert.deepEqual(out.violations.map((x) => x.kind), ['unmeasured']);
  });

  test('a violation already reported at story end is not counted twice', () => {
    const reported = [{ kind: 'missing-end', channel: ACT2, key: 'orchestrator::cycle', eventIds: ['EV_muu2r92w_31wkod90'] }];
    const out = judgeDeferredCycleChannels({ deferred: [{ channel: ACT2, reported }], stop: serveStopResult(), readRows: () => ACT2_AS_CAPTURED });
    assert.ok(!out.violations.some((x) => x.eventIds?.[0] === 'EV_muu2r92w_31wkod90' && x.kind === 'missing-end'));
    assert.ok(out.violations.some((x) => x.kind === 'double-start'));
  });
});

describe('wiring — the deferred final attempt is judged AFTER the serve stop, on that stop\'s own result', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  test('run.mjs: stopStudioThenScheduler, THEN reportDeferredCycleParity on its result, before the host lock releases', () => {
    const s = read('./run.mjs');
    const stopAt = s.indexOf('const stop = await stopStudioThenScheduler(ROOT');
    const judgeAt = s.indexOf('reportDeferredCycleParity({');
    const releaseAt = s.lastIndexOf('await release();');
    assert.ok(stopAt > 0 && judgeAt > stopAt && releaseAt > judgeAt, `order stop ${stopAt} < judge ${judgeAt} < release ${releaseAt}`);
    assert.match(s.slice(judgeAt, judgeAt + 200), /deferred: deferredCycleParity, stop,/);
    assert.match(s, /await runStory\(story, uiUrl, startedMs, args\.ceilingUsd, writtenThisRun, deferredCycleParity\)/);
  });

  test('run-story.mjs: story-end parity hands every deferred channel to the batch; run-observe reads the live serve pid for it', () => {
    const s = read('./run-story.mjs');
    assert.match(s, /deferInto: deferredCycleParity/);
    assert.match(read('./run-observe.mjs'), /serveAlivePid: deferInto === null \? null : ownSchedulerPidState\(root\)\.pid/);
  });
});
