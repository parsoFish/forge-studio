/**
 * agent-parity.test.ts — row 206 (bead `forge-8vfn.8.5.56`).
 *
 * Red-first: every case here is measured against a real capture or a shape
 * read directly out of the writer it pins (`agent-parity.mjs`'s own header
 * names the file:line for each). See
 * `_1.0/reports/m7-e-r206-parity-replay.md` for the offline replay over the
 * real `_story-logs-clear` corpus this rule was checked against before it was
 * wired into anything.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChannelDir, channelParityVerdict, agentParityVerdict, describeAgentParity } from './agent-parity.mjs';

const SESSION_KINDS = new Set(['architect', 'instructions', 'project-brain', 'demo', 'onboarding', 'authoring', 'kb-cleanup']);

// A monotonic default `started_at` so call order IS chronological order
// unless a test overrides it to pin a specific interleaving — `byTime`
// (agent-parity.mjs) sorts on this field, and an unset one ties on
// `event_id`, which is random here and would make these tests flaky.
let tick = 0;
const nextStamp = () => new Date(2026, 0, 1, 0, 0, 0, tick++).toISOString();
const start = (over = {}) => ({ event_type: 'start', event_id: `s-${Math.random()}`, started_at: nextStamp(), ...over });
const end = (over = {}) => ({ event_type: 'end', event_id: `e-${Math.random()}`, started_at: nextStamp(), ...over });

describe('classifyChannelDir', () => {
  test('_agent-* is standalone', () => {
    const c = classifyChannelDir('_agent-onboarding-agent-2026-10-03T01-23-10-524-pyvr', [], SESSION_KINDS);
    assert.equal(c.kind, 'standalone');
  });

  test('_preflight-fix-* and _brainfix-* are standalone', () => {
    assert.equal(classifyChannelDir('_preflight-fix-abc123', [], SESSION_KINDS).kind, 'standalone');
    assert.equal(classifyChannelDir('_brainfix-abc123', [], SESSION_KINDS).kind, 'standalone');
  });

  test('a registered session kind dir is a session channel, longest id wins', () => {
    const c = classifyChannelDir('_project-brain-2026-10-02T09-54-40-dd45005d', [], SESSION_KINDS);
    assert.equal(c.kind, 'session');
    assert.match(c.detail, /project-brain/);
  });

  test('_bridge-* is excluded — the Studio bridge, not an agent channel', () => {
    assert.equal(classifyChannelDir('_bridge-2026-10-02T01-57-40-634-iydgra6a', [], SESSION_KINDS).kind, 'excluded');
  });

  test('an unregistered shape is excluded — measured: a story\'s own isolated hook-fire fixture', () => {
    const c = classifyChannelDir('_hook-test-fire-story-s7-hook', [
      { phase: 'orchestrator', event_type: 'start', skill: 'hook:story-s7-hook' },
    ], SESSION_KINDS);
    assert.equal(c.kind, 'excluded');
  });

  test('more than one top-level `phase` value is a cycle log, regardless of dirname', () => {
    const rows = [
      { phase: 'orchestrator', skill: 'cycle', event_type: 'start' },
      { phase: 'architect', skill: 'architect', event_type: 'start' },
    ];
    assert.equal(classifyChannelDir('anything-at-all', rows, SESSION_KINDS).kind, 'cycle');
  });
});

describe('channelParityVerdict — standalone', () => {
  test('one start, one end: ok', () => {
    const rows = [start({ skill: 'onboarding-agent' }), end({ skill: 'onboarding-agent' })];
    const v = channelParityVerdict('_agent-onboarding-agent-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, true);
    assert.deepEqual(v.violations, []);
  });

  // Row 202 (bead `forge-8vfn.8.5.42`) — the S1 capture's own shape: two
  // `runAgent` calls landed on one run id, their starts 37 ms apart, each
  // with its own heartbeat. This is the fixture `standalone-run-own-end.test.ts`
  // pins against this module directly.
  test('two starts 37 ms apart under one run id is a double-start violation', () => {
    const s1 = start({ event_id: 'EV_s1', started_at: '2026-10-03T01:23:11.204Z', skill: 'onboarding-agent' });
    const s2 = start({ event_id: 'EV_s2', started_at: '2026-10-03T01:23:11.241Z', skill: 'onboarding-agent' });
    const e1 = end({ event_id: 'EV_e1', started_at: '2026-10-03T01:28:34.499Z', skill: 'onboarding-agent' });
    const e2 = end({ event_id: 'EV_e2', started_at: '2026-10-03T01:32:28.042Z', skill: 'onboarding-agent' });
    const v = channelParityVerdict('_agent-onboarding-agent-x', [s1, s2, e1, e2], { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    assert.equal(v.violations.length, 1);
    assert.equal(v.violations[0].kind, 'double-start');
    assert.deepEqual(v.violations[0].eventIds, ['EV_s1', 'EV_s2']);
  });

  test('two CLEANLY SEQUENTIAL complete pairs in one standalone dir is still a double-start — this run id should see exactly one dispatch', () => {
    const rows = [
      start({ event_id: 'EV_s1', started_at: '2026-10-03T01:00:00.000Z', skill: 'onboarding-agent' }),
      end({ event_id: 'EV_e1', started_at: '2026-10-03T01:00:01.000Z', skill: 'onboarding-agent' }),
      start({ event_id: 'EV_s2', started_at: '2026-10-03T01:00:02.000Z', skill: 'onboarding-agent' }),
      end({ event_id: 'EV_e2', started_at: '2026-10-03T01:00:03.000Z', skill: 'onboarding-agent' }),
    ];
    const v = channelParityVerdict('_agent-onboarding-agent-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    assert.equal(v.violations.length, 1);
    assert.equal(v.violations[0].kind, 'double-start');
    assert.deepEqual(v.violations[0].eventIds, ['EV_s1', 'EV_s2']);
  });

  test('a hook firing mid-run (its own skill, its own start/end pair) is not counted at all', () => {
    const rows = [
      start({ skill: 'brain-ingest' }),
      start({ skill: 'hook:story-s7-hook' }),
      end({ skill: 'hook:story-s7-hook' }),
      end({ skill: 'brain-ingest' }),
    ];
    const v = channelParityVerdict('_agent-brain-ingest-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, true);
  });

  test('a trailing unmatched start is `missing-end` when the harness never reaped this dir', () => {
    const rows = [start({ event_id: 'EV_s1', skill: 'onboarding-agent' })];
    const v = channelParityVerdict('_agent-onboarding-agent-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    assert.equal(v.violations[0].kind, 'missing-end');
    assert.deepEqual(v.violations[0].eventIds, ['EV_s1']);
  });

  test('a trailing unmatched start IS satisfied, never a product red, when `reapedDirs` names this exact channel', () => {
    const rows = [start({ event_id: 'EV_s1', skill: 'onboarding-agent' })];
    const v = channelParityVerdict('_agent-onboarding-agent-x', rows, {
      registeredSessionKindIds: SESSION_KINDS,
      reapedDirs: new Set(['_agent-onboarding-agent-x']),
    });
    assert.equal(v.ok, true);
    assert.equal(v.violations.length, 0);
    assert.equal(v.satisfied.length, 1);
    assert.equal(v.satisfied[0].kind, 'missing-end');
    assert.match(v.satisfied[0].reason, /harness/);
  });

  test('an end with nothing open is `extra-end`', () => {
    const rows = [end({ event_id: 'EV_e1', skill: 'onboarding-agent' })];
    const v = channelParityVerdict('_agent-onboarding-agent-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    assert.equal(v.violations[0].kind, 'extra-end');
    assert.deepEqual(v.violations[0].eventIds, ['EV_e1']);
  });

  // MEDIUM-10 — two starts under different skills in one channel. Grouping
  // by the WHOLE CHANNEL puts them in the SAME FIFO, where the second start
  // is correctly a double-start regardless of its own skill name.
  test('two starts under TWO DIFFERENT skills, no end between, is a double-start — grouping by skill made this invisible', () => {
    const rows = [
      start({ event_id: 'EV_s1', started_at: '2026-01-01T00:00:00.000Z', skill: 'onboarding-agent' }),
      start({ event_id: 'EV_s2', started_at: '2026-01-01T00:00:00.001Z', skill: 'a-completely-different-skill' }),
    ];
    const v = channelParityVerdict('_agent-onboarding-agent-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    // Not an exact count: both dangling starts ALSO each raise their own
    // `missing-end` (nothing closes either) — the grouping-by-skill DEFECT
    // this test pins is specifically that `double-start` never appeared AT
    // ALL (each skill got its own clean one-row group), so its presence is
    // the assertion, not the total violation count.
    const dbl = v.violations.find((x) => x.kind === 'double-start');
    assert.ok(dbl, JSON.stringify(v.violations));
    assert.deepEqual(dbl.eventIds, ['EV_s1', 'EV_s2']);
  });
});

describe('channelParityVerdict — session', () => {
  // Measured: _demo-2026-10-02T02-02-47-6863807e/events.jsonl (S1 run 1) —
  // two clean sequential turns, both carrying metadata.phase.
  test('several sequential turns, strictly alternating, is ok — a session reuses its id by design', () => {
    const rows = [
      start({ skill: 'demo-builder-runner', metadata: { session_id: 'x', phase: 'generating' } }),
      end({ skill: 'demo-builder-runner', metadata: { session_id: 'x', phase: 'awaiting-review' } }),
      start({ skill: 'demo-builder-runner', metadata: { session_id: 'x', phase: 'locking' } }),
      end({ skill: 'demo-builder-runner', metadata: { session_id: 'x', phase: 'locked' } }),
    ];
    const v = channelParityVerdict('_demo-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, true);
  });

  test('two turns live at once (no end between) is a double-start for a session channel too', () => {
    const rows = [
      start({ event_id: 'EV_s1', started_at: '2026-01-01T00:00:00.000Z', skill: 'demo-builder-runner', metadata: { phase: 'generating' } }),
      start({ event_id: 'EV_s2', started_at: '2026-01-01T00:00:01.000Z', skill: 'demo-builder-runner', metadata: { phase: 'locking' } }),
      end({ event_id: 'EV_e1', started_at: '2026-01-01T00:00:02.000Z', skill: 'demo-builder-runner', metadata: { phase: 'locked' } }),
      end({ event_id: 'EV_e2', started_at: '2026-01-01T00:00:03.000Z', skill: 'demo-builder-runner', metadata: { phase: 'locked' } }),
    ];
    const v = channelParityVerdict('_demo-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    assert.equal(v.violations.length, 1);
    assert.equal(v.violations[0].kind, 'double-start');
    assert.deepEqual(v.violations[0].eventIds, ['EV_s1', 'EV_s2']);
  });

  // Measured: _architect-2026-10-02T02-06-56-9f510c77/events.jsonl (S1 run 1)
  // — 9 `start` rows under the architect turn's own skill and 12 `end` rows across three
  // skills (the turn's, architect, architect-completeness-critic); only
  // the 6 rows carrying `metadata.phase` are this rule's concern, and they
  // alternate perfectly across three real turns.
  test('the real architect-session shape — stage pings, critic sub-turns and turn-cost rows — is ok', () => {
    const sid = '2026-10-02T02-06-56-9f510c77';
    const rows = [
      start({ skill: 'architect-runner', message: 'architect turn (phase=interviewing)', metadata: { session_id: sid, phase: 'interviewing', round: 1 } }),
      end({ skill: 'architect', message: 'architect.turn-cost', metadata: { priced: true } }),
      end({ skill: 'architect-runner', message: 'architect turn end (phase=awaiting-answers)', metadata: { session_id: sid, phase: 'awaiting-answers' } }),
      start({ skill: 'architect-runner', message: 'architect turn (phase=interviewing)', metadata: { session_id: sid, phase: 'interviewing', round: 2 } }),
      end({ skill: 'architect', message: 'architect.turn-cost', metadata: { priced: true } }),
      start({ skill: 'architect-runner', message: 'architect.explore.start', metadata: { session_id: sid, round: 2 } }),
      end({ skill: 'architect', message: 'architect.turn-cost', metadata: { priced: true } }),
      start({ skill: 'architect-runner', message: 'architect.draft.start', metadata: { session_id: sid, round: 1 } }),
      end({ skill: 'architect', message: 'architect.turn-cost', metadata: { priced: true } }),
      start({ skill: 'architect-completeness-critic', message: 'architect.completeness-critic.start', metadata: { session_id: sid, round: 1 } }),
      end({ skill: 'architect-completeness-critic', message: 'architect.completeness-critic.turn-cost', metadata: { priced: true } }),
      end({ skill: 'architect-completeness-critic', message: 'architect.completeness-critic.end (findings=2)', metadata: { session_id: sid, findings_count: 2 } }),
      start({ skill: 'architect-runner', message: 'architect.revise.start', metadata: { session_id: sid, round: 2 } }),
      end({ skill: 'architect', message: 'architect.turn-cost', metadata: { priced: true } }),
      end({ skill: 'architect-runner', message: 'architect turn end (phase=awaiting-verdict)', metadata: { session_id: sid, phase: 'awaiting-verdict' } }),
      start({ skill: 'architect-runner', message: 'architect turn (phase=finalizing)', metadata: { session_id: sid, phase: 'finalizing', round: 2 } }),
      start({ skill: 'architect-runner', message: 'architect.finalize.start', metadata: { session_id: sid, round: 2 } }),
      end({ skill: 'architect-runner', message: 'architect turn end (phase=committed)', metadata: { session_id: sid, phase: 'committed' } }),
    ];
    const v = channelParityVerdict('_architect-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, true, JSON.stringify(v.violations));
  });

  // MEDIUM-10 — the session-kind twin of the standalone case above: two
  // overlapping turns in one session dir under two different skill values
  // (a shape no real runner is known to produce, but the grouping bug would
  // hide it exactly the same way) must still collide into one FIFO.
  test('two turns live at once under TWO DIFFERENT skills is a double-start for a session channel too', () => {
    const rows = [
      start({ event_id: 'EV_s1', started_at: '2026-01-01T00:00:00.000Z', skill: 'demo-builder-runner', metadata: { phase: 'generating' } }),
      start({ event_id: 'EV_s2', started_at: '2026-01-01T00:00:00.001Z', skill: 'a-different-skill-entirely', metadata: { phase: 'locking' } }),
    ];
    const v = channelParityVerdict('_demo-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    const dbl = v.violations.find((x) => x.kind === 'double-start');
    assert.ok(dbl, JSON.stringify(v.violations));
    assert.deepEqual(dbl.eventIds, ['EV_s1', 'EV_s2']);
  });

  test('interactive-runner.ts\'s generic turn (the `authoring` kind) is covered the same way', () => {
    const rows = [
      start({ skill: 'interactive-runner', metadata: { session_id: 'x', session_kind: 'authoring', phase: 'analyzing', step: 'agent' } }),
      end({ skill: 'interactive-runner', message: 'interactive.turn-cost', metadata: { session_id: 'x', session_kind: 'authoring', priced: true } }),
      end({ skill: 'interactive-runner', message: 'interactive turn end (kind=authoring, phase=awaiting-review)', metadata: { session_id: 'x', session_kind: 'authoring', phase: 'awaiting-review' } }),
    ];
    const v = channelParityVerdict('_authoring-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, true);
  });
});

describe('channelParityVerdict — cycle', () => {
  test('per-phase starts are legit: two different phases each get one start, interleaved in file order', () => {
    const rows = [
      start({ event_id: 'EV_arch_s', phase: 'architect', skill: 'architect', started_at: '2026-01-01T00:00:00.000Z' }),
      start({ event_id: 'EV_orch_s', phase: 'orchestrator', skill: 'cycle', started_at: '2026-01-01T00:00:00.001Z' }),
      end({ event_id: 'EV_arch_e', phase: 'architect', skill: 'architect', started_at: '2026-01-01T00:00:00.002Z' }),
      end({ event_id: 'EV_orch_e', phase: 'orchestrator', skill: 'cycle', started_at: '2026-01-01T00:00:00.003Z' }),
    ];
    const v = channelParityVerdict('some-cycle-id', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, true, JSON.stringify(v.violations));
  });

  test('one phase genuinely overlapping itself (two starts, no end between) is still a double-start', () => {
    const rows = [
      start({ event_id: 'EV_1', phase: 'project-manager', skill: 'project-manager', started_at: '2026-01-01T00:00:00.000Z' }),
      start({ event_id: 'EV_2', phase: 'project-manager', skill: 'project-manager', started_at: '2026-01-01T00:00:00.001Z' }),
      end({ event_id: 'EV_3', phase: 'architect', skill: 'architect', started_at: '2026-01-01T00:00:00.002Z' }),
    ];
    const v = channelParityVerdict('some-cycle-id', rows, { registeredSessionKindIds: SESSION_KINDS });
    const dbl = v.violations.find((x) => x.kind === 'double-start');
    assert.ok(dbl, JSON.stringify(v.violations));
    assert.deepEqual(dbl.eventIds, ['EV_1', 'EV_2']);
  });
});

describe('agentParityVerdict', () => {
  test('ok across every channel this run launched', () => {
    const r = agentParityVerdict([
      { dir: '_agent-a', rows: [start({ skill: 'a' }), end({ skill: 'a' })] },
      { dir: '_bridge-x', rows: [{ event_type: 'file_change', phase: 'orchestrator' }] },
    ], { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 2);
  });

  test('one bad channel reds the whole run verdict, naming the channel and the event ids', () => {
    const r = agentParityVerdict([
      { dir: '_agent-a', rows: [start({ skill: 'a' }), end({ skill: 'a' })] },
      { dir: '_agent-b', rows: [start({ event_id: 'EV_b1', skill: 'b' }), start({ event_id: 'EV_b2', skill: 'b' }), end({ skill: 'b' }), end({ skill: 'b' })] },
    ], { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].channel, '_agent-b');
    assert.deepEqual(r.violations[0].eventIds, ['EV_b1', 'EV_b2']);
  });

  test('dedupes by event_id, the same defence summariseRunSpend takes', () => {
    const row = start({ event_id: 'EV_dup', skill: 'a' });
    const r = agentParityVerdict([{ dir: '_agent-a', rows: [row, { ...row }, end({ skill: 'a' })] }], { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(r.ok, true);
  });
});

describe('channelParityVerdict — MEDIUM-11, rows.unknown (readRunEvents\'s own carried read-failure fact)', () => {
  test('a channel whose events.jsonl could not be fully read is NEVER a clean pass, even with zero readable rows', () => {
    const rows = Object.assign([], { unknown: [{ dir: '_agent-a', error: 'EACCES: permission denied' }] });
    const v = channelParityVerdict('_agent-a', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    assert.equal(v.violations.length, 1);
    assert.equal(v.violations[0].kind, 'unmeasured');
    assert.equal(v.violations[0].channel, '_agent-a');
    assert.match(v.violations[0].error, /EACCES/);
  });

  test('an unmeasured channel reports BOTH the unmeasured violation AND a real double-start it could still see on the readable rows', () => {
    const rows = Object.assign(
      [start({ event_id: 'EV_s1', skill: 'a' }), start({ event_id: 'EV_s2', skill: 'a' })],
      { unknown: [{ dir: '_agent-a', error: 'unparseable event line' }] },
    );
    const v = channelParityVerdict('_agent-a', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.ok, false);
    // Not an exact count: the two dangling opens each ALSO raise their own
    // `missing-end` (no `end` row closes either) — this test's own point is
    // only that `unmeasured` rides alongside whatever the readable rows
    // genuinely show, alongside them.
    assert.ok(v.violations.some((x) => x.kind === 'unmeasured'), JSON.stringify(v.violations));
    assert.ok(v.violations.some((x) => x.kind === 'double-start'), JSON.stringify(v.violations));
  });

  test('an excluded channel (the bridge\'s own log) stays a clean exclusion even when unreadable — not an agent/session/cycle channel, per the module header', () => {
    const rows = Object.assign([], { unknown: [{ dir: '_bridge-x', error: 'EACCES: permission denied' }] });
    const v = channelParityVerdict('_bridge-x', rows, { registeredSessionKindIds: SESSION_KINDS });
    assert.equal(v.kind, 'excluded');
    assert.equal(v.ok, true);
    assert.deepEqual(v.violations, []);
  });

  test('describeAgentParity renders the unmeasured line naming the channel and the real read error, with no key/eventIds shape assumed', () => {
    const rows = Object.assign([], { unknown: [{ dir: '_agent-a', error: 'EIO: i/o error' }] });
    const r = agentParityVerdict([{ dir: '_agent-a', rows }], { registeredSessionKindIds: SESSION_KINDS });
    const lines = describeAgentParity(r);
    assert.ok(lines.some((l) => l.includes('PRODUCT RED') && l.includes('unmeasured') && l.includes('_agent-a') && l.includes('EIO: i/o error')));
  });
});

// Row 206 (bead forge-8vfn.8.5.56): the run-level rows of the row-202 S1
// capture (packages/agents/tests/unit/standalone-run-own-end.test.ts's
// S1_CAPTURE) — two starts 37 ms apart under one run id, then two ends.
test('row 206: the row-202 S1 capture (two starts 37 ms apart under one run id) is a double-start violation', () => {
  const run = '_agent-onboarding-agent-2026-10-03T01-23-10-524-pyvr';
  const meta = { agent_phase: 'onboarding', agent_slug: 'onboarding-agent', effective_ceiling_usd: 5 };
  const row = (r: Record<string, unknown>) => ({ cycle_id: run, initiative_id: run, phase: 'orchestrator', skill: 'onboarding-agent', ...r });
  const events = [
    row({ event_id: 'EV_murpk02z_z8t7ab4a', started_at: '2026-10-03T01:23:10.571Z', event_type: 'log', message: 'agent-run.dispatched' }),
    row({ event_id: 'EV_murpk0kk_yw2rdk4i', started_at: '2026-10-03T01:23:11.204Z', event_type: 'start', metadata: meta }),
    row({ event_id: 'EV_murpk0ll_9owbn3t5', started_at: '2026-10-03T01:23:11.241Z', event_type: 'start', metadata: meta }),
    row({ event_id: 'EV_murpqy0z_wxu2j2vs', started_at: '2026-10-03T01:28:34.499Z', event_type: 'end', cost_usd: 0.7996867999999998, metadata: meta }),
    row({ started_at: '2026-10-03T01:32:28.042Z', event_type: 'end', cost_usd: 1.3711322999999997, metadata: meta }),
  ];
  const v = channelParityVerdict(run, events, { registeredSessionKindIds: new Set() });
  assert.equal(v.kind, 'standalone');
  assert.equal(v.ok, false);
  assert.equal(v.violations.length, 1);
  assert.equal(v.violations[0].kind, 'double-start');
  assert.deepEqual(v.violations[0].eventIds, ['EV_murpk0kk_yw2rdk4i', 'EV_murpk0ll_9owbn3t5']);
});
