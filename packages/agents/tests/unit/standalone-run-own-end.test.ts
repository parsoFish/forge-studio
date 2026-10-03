/**
 * Row 198 (bead forge-8vfn.8.5.36), T1 ruling 1973gn — `deriveStandaloneStateFromEvents`
 * must read the dispatched RUN's own `end`, never the first `end` of ANY
 * skill in its events.jsonl.
 *
 * MEASURED. A real captured run
 * (`_1.0/evidence/m7-e-run6-captures/S7-logs/_agent-brain-ingest-2026-10-02T21-28-13-741-tjs6/events.jsonl`)
 * carries a `hook:story-s7-hook` start/end (SessionEnd) at
 * 21:28:23.161/.166Z, ONE MILLISECOND before the run's own `brain-ingest`
 * end at 21:28:23.167Z. HEAD's `parsed.find((e) => e['event_type'] ===
 * 'end')` reads the FIRST `end` row regardless of skill — on that capture it
 * happens to land on the hook's end, 1ms early, with none of the hook's end
 * metadata relevant to state (harmless by luck of timing). A hook that fires
 * MID-run (PreToolUse/PostToolUse, `packages/library/studio/hook-runtime.ts`)
 * writes the identical shape — its own `start`/`end` pair, `skill:
 * hook:<hookId>` — WHILE the agent keeps working, so the same "first end
 * wins" read reports `done` while the run is still `running`, and reads the
 * ceiling-stop/`result_subtype` off the HOOK's end metadata (which never
 * carries one) instead of the run's.
 *
 * WHAT EACH TEST KILLS:
 *  - "a hook end mid-run does not end the run" kills the plain `.find(e =>
 *    event_type === 'end')` read directly: HEAD reports 'done' the instant a
 *    bound hook's own end lands, long before the agent's own end exists.
 *  - "the run's own end, once it lands after a mid-run hook, is read as
 *    done with the RUN's metadata" kills a fix that merely skips hook
 *    `start` rows but still answers from the wrong `end` (e.g. "last end"
 *    instead of "the end whose skill matches the run's own start").
 *  - "the real S7 capture shape still reads done with the run's own
 *    metadata" replays the exact measured capture (hook end 1ms before the
 *    run's own end) and asserts `outputRefs`/`costUsd` come from
 *    `brain-ingest`'s own end, not the hook's (which carries neither).
 *  - "a ceiling-stop survives a hook end with no result_subtype" kills a fix
 *    that finds *some* skill-matching end but loses the metadata-sensitive
 *    `ceilingStopped` derivation — the hook end has no `result_subtype` at
 *    all, so reading IT would silently fall through to 'done'.
 *  - "no skill field anywhere falls back to the pre-row-198 behaviour" pins
 *    the fallback the pre-existing `standalone-cost-one-rule.test.ts`
 *    fixtures depend on (none of them carry a `skill` field) — a fix must
 *    not regress a run whose events never named a skill at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveStandaloneStateFromEvents } from '../../bridge-agents-run-state.ts';

const RUN_SKILL = 'brain-ingest';
const RUN_INITIATIVE = '_agent-brain-ingest-2026-10-02T21-28-13-741-tjs6';

/** The run's own `start` plus one mid-run tool event — never its own `end`. */
const RUN_STARTED: Record<string, unknown>[] = [
  { event_type: 'start', skill: RUN_SKILL, initiative_id: RUN_INITIATIVE, message: 'agent run start' },
  { event_type: 'log', skill: RUN_SKILL, initiative_id: RUN_INITIATIVE, message: 'tool use 1' },
];

/** A hook bound to this agent firing and finishing MID-run — its own
 *  start/end pair, under `skill: hook:<hookId>`, landing strictly between
 *  the run's own start and its own end. */
const MID_RUN_HOOK: Record<string, unknown>[] = [
  { event_type: 'start', skill: 'hook:some-hook', initiative_id: RUN_INITIATIVE, message: 'Running hook "some-hook" (PreToolUse)' },
  { event_type: 'end', skill: 'hook:some-hook', initiative_id: RUN_INITIATIVE, message: 'Hook "some-hook" finished (exit 0)' },
];

/** More of the agent's own work AFTER the hook finished — proof the run was
 *  still going when the hook's end landed. */
const MORE_TOOL_USE: Record<string, unknown>[] = [
  { event_type: 'log', skill: RUN_SKILL, initiative_id: RUN_INITIATIVE, message: 'tool use 2' },
];

const RUN_OWN_END = (metadata?: Record<string, unknown>): Record<string, unknown> => ({
  event_type: 'end',
  skill: RUN_SKILL,
  initiative_id: RUN_INITIATIVE,
  message: 'agent run end',
  output_refs: ['artifacts/brain-ingest-report.md'],
  cost_usd: 0.4242,
  ...(metadata !== undefined ? { metadata } : {}),
});

test('a hook end mid-run does not end the run', () => {
  const midRun = [...RUN_STARTED, ...MID_RUN_HOOK, ...MORE_TOOL_USE];
  const state = deriveStandaloneStateFromEvents(midRun);
  assert.equal(
    state.state,
    'running',
    'the hook\'s own end is not the run\'s word — HEAD reads "done" here because it is the FIRST end of any skill',
  );
});

test('the run\'s own end, once it lands after a mid-run hook, is read as done with the run\'s metadata', () => {
  const finished = [...RUN_STARTED, ...MID_RUN_HOOK, ...MORE_TOOL_USE, RUN_OWN_END()];
  const state = deriveStandaloneStateFromEvents(finished);
  assert.equal(state.state, 'done');
  assert.deepEqual(
    state.outputRefs,
    ['artifacts/brain-ingest-report.md'],
    'outputRefs must come from the RUN\'s own end — the hook\'s end carries none',
  );
});

test('the real S7 capture shape still reads done with the run\'s own metadata', () => {
  // Byte-shape of the measured capture (started_at trimmed to the ms deltas
  // that matter): t0 dispatched → no-project-bound → the run's own start →
  // a file_change → the SessionEnd hook's start/end, 1ms before → the run's
  // own end.
  const capture: Record<string, unknown>[] = [
    { event_type: 'log', skill: RUN_SKILL, initiative_id: RUN_INITIATIVE, message: 'agent-run.dispatched', started_at: '2026-10-02T21:28:13.742Z' },
    { event_type: 'log', skill: RUN_SKILL, initiative_id: RUN_INITIATIVE, message: 'agent-dispatch.no-project-bound', started_at: '2026-10-02T21:28:14.389Z' },
    { event_type: 'start', skill: RUN_SKILL, initiative_id: RUN_INITIATIVE, started_at: '2026-10-02T21:28:14.390Z' },
    { event_type: 'file_change', skill: 'bridge', initiative_id: RUN_INITIATIVE, message: 'file.write', started_at: '2026-10-02T21:28:14.392Z' },
    { event_type: 'start', skill: 'hook:story-s7-hook', initiative_id: RUN_INITIATIVE, message: 'Running hook "story-s7-hook" (SessionEnd)', started_at: '2026-10-02T21:28:23.161Z' },
    { event_type: 'end', skill: 'hook:story-s7-hook', initiative_id: RUN_INITIATIVE, message: 'Hook "story-s7-hook" finished (exit 0)', started_at: '2026-10-02T21:28:23.166Z' },
    { event_type: 'log', skill: 'hook:story-s7-hook', initiative_id: RUN_INITIATIVE, message: 'hook.fire', started_at: '2026-10-02T21:28:23.166Z' },
    { ...RUN_OWN_END(), started_at: '2026-10-02T21:28:23.167Z' },
  ];
  const state = deriveStandaloneStateFromEvents(capture);
  assert.equal(state.state, 'done');
  assert.deepEqual(state.outputRefs, ['artifacts/brain-ingest-report.md']);
  assert.ok(state.costUsd !== null && Math.abs(state.costUsd - 0.4242) < 1e-9);
});

test('a ceiling-stop survives a hook end with no result_subtype', () => {
  const ceilingStopped = [
    ...RUN_STARTED,
    ...MID_RUN_HOOK,
    RUN_OWN_END({ result_subtype: 'error_max_budget_usd' }),
  ];
  const state = deriveStandaloneStateFromEvents(ceilingStopped);
  assert.equal(
    state.state,
    'budget-exceeded',
    'reading the hook\'s end (no result_subtype at all) instead of the run\'s own would silently fall through to "done"',
  );
});

test('no skill field anywhere falls back to the pre-row-198 behaviour', () => {
  const noSkillField: Record<string, unknown>[] = [
    { event_type: 'start', message: 'agent run start' },
    { event_type: 'end', message: 'agent run end', cost_usd: 0.5 },
  ];
  const state = deriveStandaloneStateFromEvents(noSkillField);
  assert.equal(state.state, 'done');
  assert.equal(state.costUsd, 0.5);
});

// Row 202 (bead forge-8vfn.8.5.42), T1 ruling 1973hq — the S1 capture
// (`_1.0/evidence/m7-e-gate1-s1-capture/_story-logs-clear/_agent-onboarding-agent-2026-10-03T01-23-10-524-pyvr/events.jsonl`,
// 164 rows; the start/end/heartbeat rows below copied with their real ids,
// times and costs). Its signature is TWO own-skill `start` rows 37 ms apart,
// each with heartbeats parented to its own event_id — two `runAgent` calls,
// i.e. two dispatch children on one run id (the onboarding start route AND
// its brief both spawned; see
// apps/forge/tests/regression/ui-bridge-onboarding-spawn-pid.test.ts), not a
// second pass of one agent. The reader is right to read the run's own skill's
// first `end` as `done` — `runAgent` writes exactly one end per call — and
// that is exactly what let S1 beat 6 go green while the second agent was
// still editing `.gitignore`. The fix is one dispatch per run id, upstream of
// this reader; this test pins the shape the writer produced so the cause
// stays legible.
const S1_RUN = '_agent-onboarding-agent-2026-10-03T01-23-10-524-pyvr';
const S1 = (row: Record<string, unknown>): Record<string, unknown> => ({ cycle_id: S1_RUN, initiative_id: S1_RUN, phase: 'orchestrator', ...row });
const S1_META = { agent_phase: 'onboarding', agent_slug: 'onboarding-agent', effective_ceiling_usd: 5 };
const S1_CAPTURE: Record<string, unknown>[] = [
  S1({ event_id: 'EV_murpk02z_z8t7ab4a', started_at: '2026-10-03T01:23:10.571Z', skill: 'onboarding-agent', event_type: 'log', message: 'agent-run.dispatched' }),
  S1({ event_id: 'EV_murpk0kk_yw2rdk4i', started_at: '2026-10-03T01:23:11.204Z', skill: 'onboarding-agent', event_type: 'start', metadata: S1_META }),
  S1({ event_id: 'EV_murpk0ll_9owbn3t5', started_at: '2026-10-03T01:23:11.241Z', skill: 'onboarding-agent', event_type: 'start', metadata: S1_META }),
  S1({ event_id: 'EV_murpkc5e_3gb95maj', started_at: '2026-10-03T01:23:26.210Z', parent_event_id: 'EV_murpk0kk_yw2rdk4i', skill: 'onboarding-agent', event_type: 'agent_heartbeat', message: 'agent.heartbeat' }),
  S1({ event_id: 'EV_murpkc6e_33zc9bd1', started_at: '2026-10-03T01:23:26.246Z', parent_event_id: 'EV_murpk0ll_9owbn3t5', skill: 'onboarding-agent', event_type: 'agent_heartbeat', message: 'agent.heartbeat' }),
  S1({ event_id: 'EV_murpqy0z_wxu2j2vs', started_at: '2026-10-03T01:28:34.499Z', skill: 'onboarding-agent', event_type: 'end', cost_usd: 0.7996867999999998, duration_ms: 355776, metadata: S1_META,
    output_refs: ['/home/parso/forge-m7-e-docs/projects/story-s1/.gitignore', '/home/parso/forge-m7-e-docs/projects/story-s1/.forge/project.json', '/home/parso/forge-m7-e-docs/projects/story-s1/CLAUDE.md'] }),
  S1({ started_at: '2026-10-03T01:30:18.638Z', skill: 'onboarding-agent', event_type: 'file_change', message: 'file.modify', metadata: { path: '/home/parso/forge-m7-e-docs/projects/story-s1/.gitignore', op: 'modify' } }),
  S1({ started_at: '2026-10-03T01:32:28.042Z', skill: 'onboarding-agent', event_type: 'end', cost_usd: 1.3711322999999997, duration_ms: 610043, metadata: S1_META, output_refs: [] }),
];

test('row 202: the S1 capture is two agents on one run id — two own-skill starts, each with its own heartbeats', () => {
  const starts = S1_CAPTURE.filter((e) => e['event_type'] === 'start' && e['skill'] === 'onboarding-agent');
  assert.equal(starts.length, 2, 'one dispatch writes one start; the capture carries two');
  const parents = new Set(S1_CAPTURE.filter((e) => e['event_type'] === 'agent_heartbeat').map((e) => e['parent_event_id']));
  assert.deepEqual([...parents].sort(), starts.map((e) => e['event_id']).sort(), 'both starts were live at once — concurrent agents, not sequential passes');
});

test('row 202: on the S1 shape the reader reads `done` at the FIRST agent\'s end while the second still edits the ground', () => {
  const cutAfterFirstEnd = S1_CAPTURE.slice(0, S1_CAPTURE.findIndex((e) => e['event_type'] === 'end') + 2);
  const state = deriveStandaloneStateFromEvents(cutAfterFirstEnd);
  assert.equal(state.state, 'done', 'what S1 beat 6 read, 174 ms after 01:28:34.499Z');
  assert.ok(cutAfterFirstEnd.at(-1)!['message'] === 'file.modify', 'and the second agent was still writing .gitignore after it');
  // Spend is not lost either way: the one cost rule sums every end, so the
  // full capture reads both agents ($0.80 + $1.37) — the over-spend was real.
  const full = deriveStandaloneStateFromEvents(S1_CAPTURE);
  assert.ok(full.costUsd !== null && Math.abs(full.costUsd - (0.7996867999999998 + 1.3711322999999997)) < 1e-9);
});
