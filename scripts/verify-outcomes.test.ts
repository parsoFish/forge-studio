/**
 * Kills: (a) `const PROJECT = flag('project', 'mdtoc')` — mdtoc lives inside
 * forge's own repo and must never be the harness ground (CLAUDE.md, 1.0.md
 * global constraints); (b) verify-cycle.mjs:423-425, where 'project tests green
 * post-merge' passes on `tests.ok` alone — so a cycle that never merged still
 * scores a green post-merge row by running the tests on unmerged main.
 *
 * ACCEPTANCE TESTS (T3, M0-A fix round 2, Defects B + C) appended below the
 * three pre-existing cases above (left untouched).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROJECT, buildOutcomeChecks } from './lib/verify-outcomes.mjs';
import { sumAuthoritativeCostUsd } from '../orchestrator/event-cost.ts';

// `classifyReflectorProgress` / `sumAuthoritativeCostFromLines` are NEW
// exports the implementer will add (M0-A round 2, defects B + C) — they do
// not exist yet. A static `import { name } from '...'` for a binding that
// does not exist throws a SyntaxError at MODULE LOAD, which would fail
// EVERY test in this file uniformly and mask the three pre-existing
// (currently green) cases above — exactly the "broken import that hides the
// others" this file's brief says not to do. Resolved dynamically instead, so
// a missing export surfaces as its own red assertion (calling `undefined`)
// exactly where each new case uses it, never as a whole-file load failure.
const { classifyReflectorProgress, sumAuthoritativeCostFromLines } = await import('./lib/verify-outcomes.mjs');

test('the default ground is gitpulse, never mdtoc', () => {
  assert.equal(DEFAULT_PROJECT, 'gitpulse');
});

test('post-merge tests are SKIPPED WITH A REASON when the cycle never reached merge', () => {
  const checks = buildOutcomeChecks({
    finalStatus: 'failed', manifestInDone: false,
    wi: { total: 4, complete: 4, failed: 0 },
    tests: { ran: true, ok: true, label: 'npm test' },
    cost: 10, costCeiling: 60, reflectTheme: { present: false, reason: 'none' },
  });
  const merged = checks.find((c) => c.name === 'cycle reached merge (done)');
  const post = checks.find((c) => c.name === 'project tests green post-merge');
  assert.equal(merged.pass, false);
  assert.equal(post.skipped, true, 'a green suite on an unmerged tree is not post-merge evidence');
  assert.equal(post.pass, false, 'a skipped row never counts as a pass');
  assert.match(post.detail, /merge/i, 'the skip must say why it was skipped');
});

test('post-merge tests are judged normally once the cycle reached merge', () => {
  const checks = buildOutcomeChecks({
    finalStatus: 'done', manifestInDone: true,
    wi: { total: 4, complete: 4, failed: 0 },
    tests: { ran: true, ok: true, label: 'npm test' },
    cost: 10, costCeiling: 60, reflectTheme: { present: true, reason: '1 theme(s)' },
  });
  const post = checks.find((c) => c.name === 'project tests green post-merge');
  assert.equal(post.skipped, undefined);
  assert.equal(post.pass, true);
});

// ---------------------------------------------------------------------------
// Defect B — `classifyReflectorProgress(logLines) → { state, detail }`
//
// Every fixture line below is a REAL line, verbatim, from an actual cycle's
// events.jsonl — never invented JSON (per this file's brief).
//
// `lost`/`started` fixtures: run 1's own log, the exact evidence quoted in the
// M0-A round-2 brief —
//   /home/parso/forge-m0-a/_logs/2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command/events.jsonl
//   lines 463 (finalize.trigger-firing, non-reflector), 464 (reflector.start),
//   466 (cycle.reflection-lost, cause: manifest-unreadable).
//
// `ended` fixture: no run in THIS lane's logs ever reached reflector.end (that
// is the whole defect) — real reflector.start/reflector.end lines from a
// genuinely-completed cycle, taken from the main forge repo's own history —
//   /home/parso/forge/_logs/2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests/events.jsonl
//   lines 56 (reflector.start) and 60 (reflector.end).
// ---------------------------------------------------------------------------

const RUN1_FINALIZE_TRIGGER_FIRING_LINE =
  '{"event_id":"EV_mtcsg3d1_i64eyzn2","cycle_id":"2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command","started_at":"2026-08-28T10:07:52.069Z","initiative_id":"INIT-2026-08-28-init-2026-08-28-coupling-command","phase":"orchestrator","skill":"finalize-merged","event_type":"log","input_refs":[],"output_refs":[],"message":"finalize.trigger-firing","metadata":{"on":"merged","target":{"kind":"agent","ref":"reflector"},"source_flow":"forge-develop"}}';

const RUN1_REFLECTOR_START_LINE =
  '{"event_id":"EV_mtcsg3d1_15u2nxiq","cycle_id":"2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command","started_at":"2026-08-28T10:07:52.069Z","initiative_id":"INIT-2026-08-28-init-2026-08-28-coupling-command","phase":"reflection","skill":"reflector","event_type":"start","input_refs":["/home/parso/forge-m0-a/_queue/in-flight/INIT-2026-08-28-init-2026-08-28-coupling-command.md","/home/parso/forge-m0-a/_logs/2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command/events.jsonl"],"output_refs":[],"message":"reflector.start"}';

const RUN1_CYCLE_REFLECTION_LOST_LINE =
  '{"event_id":"EV_mtcsg3d2_qxal39w7","cycle_id":"2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command","started_at":"2026-08-28T10:07:52.070Z","initiative_id":"INIT-2026-08-28-init-2026-08-28-coupling-command","parent_event_id":"EV_mtcsg3d1_15u2nxiq","phase":"reflection","skill":"reflector","event_type":"error","input_refs":[],"output_refs":[],"message":"cycle.reflection-lost","metadata":{"cause":"manifest-unreadable","detail":"ENOENT: no such file or directory, open \'/home/parso/forge-m0-a/_queue/in-flight/INIT-2026-08-28-init-2026-08-28-coupling-command.md\'"}}';

const COMPLETED_CYCLE_REFLECTOR_START_LINE =
  '{"event_id":"EV_mptp6krr_xyvdfq7l","cycle_id":"2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests","started_at":"2026-05-31T11:29:44.871Z","initiative_id":"INIT-2026-05-31-release-definition-unit-tests","phase":"reflection","skill":"reflector","event_type":"start","input_refs":["/home/parso/forge/_queue/in-flight/INIT-2026-05-31-release-definition-unit-tests.md","/home/parso/forge/_logs/2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests/events.jsonl"],"output_refs":[],"message":"reflector.start"}';

const COMPLETED_CYCLE_REFLECTOR_END_LINE =
  '{"event_id":"EV_mptpaa5u_rb0uzs5z","cycle_id":"2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests","started_at":"2026-05-31T11:32:37.746Z","initiative_id":"INIT-2026-05-31-release-definition-unit-tests","parent_event_id":"EV_mptp6krr_xyvdfq7l","phase":"reflection","skill":"reflector","event_type":"end","input_refs":["/home/parso/forge/_logs/2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests/events.jsonl","/home/parso/forge/_queue/done/INIT-2026-05-31-release-definition-unit-tests.md"],"output_refs":["/home/parso/forge/_logs/2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests/retro.md"],"cost_usd":0.8428437999999998,"duration_ms":170924,"message":"reflector.end","metadata":{"status":"closed","project":"terraform-provider-betterado","origin":"architect","result_subtype":"success","tool_use":{"brainReads":7,"themeWrites":8,"retroWrites":1,"bashCalls":5},"lint_status":"clean","retention":"interesting","bench_candidates_emitted":0}}';

test('classifyReflectorProgress: no reflector lines at all → none', () => {
  const result = classifyReflectorProgress([RUN1_FINALIZE_TRIGGER_FIRING_LINE]);
  assert.equal(result.state, 'none');
});

test('classifyReflectorProgress: a start only, no end and no loss → started (reads as slow, not dead — the exact ambiguity B fixes)', () => {
  const result = classifyReflectorProgress([RUN1_FINALIZE_TRIGGER_FIRING_LINE, RUN1_REFLECTOR_START_LINE]);
  assert.equal(result.state, 'started');
});

test('classifyReflectorProgress: a start then an end → ended', () => {
  const result = classifyReflectorProgress([COMPLETED_CYCLE_REFLECTOR_START_LINE, COMPLETED_CYCLE_REFLECTOR_END_LINE]);
  assert.equal(result.state, 'ended');
});

test('classifyReflectorProgress: a start then cycle.reflection-lost → lost, with detail NAMING THE CAUSE (this is the 12-of-47-minute defect B fixes — a dead reflector must not read as merely slow)', () => {
  const result = classifyReflectorProgress([
    RUN1_FINALIZE_TRIGGER_FIRING_LINE,
    RUN1_REFLECTOR_START_LINE,
    RUN1_CYCLE_REFLECTION_LOST_LINE,
  ]);
  assert.equal(result.state, 'lost');
  assert.equal(typeof result.detail, 'string');
  assert.match(result.detail, /manifest-unreadable/, 'the detail must name the real cause carried on cycle.reflection-lost, not a generic "lost" string');
});

// ---------------------------------------------------------------------------
// Defect C — `sumAuthoritativeCostFromLines(lines) → number`
//
// Every fixture line is REAL, verbatim, from run 1's own log —
//   /home/parso/forge-m0-a/_logs/2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command/events.jsonl
// lines 3 (architect.end, cost_usd:0) and 32 (project-manager end,
// cost_usd:0.544421 — project-manager never emits `iteration` events, so it
// counts in FULL) are verbatim/unmodified. Line 108 (developer-loop `ralph.end`
// for WI-1, cost_usd:0.46645539999999985 — a RESTATEMENT of the iteration cost
// below, per orchestrator/event-cost.ts's doc comment) is also verbatim. Line
// 105 (the developer-loop WI-1 `iteration` event carrying the SAME
// cost_usd:0.46645539999999985 as its own authoritative source) is
// field-accurate but trims ~4.5KB of `tools_used`/`bash_commands`/
// `last_assistant_text` noise irrelevant to cost summation — every field this
// test or the rule under test reads (event_id, cycle_id, phase, skill,
// event_type, iteration, cost_usd, tokens_in/out, work_item_id) is copied
// verbatim from that real line.
// ---------------------------------------------------------------------------

const RUN1_ARCHITECT_END_LINE =
  '{"event_id":"EV_mtcrcsso_6flclayq","cycle_id":"2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command","started_at":"2026-08-28T09:37:18.792Z","initiative_id":"INIT-2026-08-28-init-2026-08-28-coupling-command","phase":"architect","skill":"architect","event_type":"end","input_refs":[],"output_refs":["/home/parso/forge-m0-a/_queue/in-flight/INIT-2026-08-28-init-2026-08-28-coupling-command.md"],"message":"architect.end","cost_usd":0,"duration_ms":272360,"metadata":{"origin":"architect","session_id":"2026-08-28T09-32-42-baf7f1e0"}}';

const RUN1_PM_END_LINE =
  '{"event_id":"EV_mtcrgy3x_8p7aekma","cycle_id":"2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command","started_at":"2026-08-28T09:40:32.301Z","initiative_id":"INIT-2026-08-28-init-2026-08-28-coupling-command","parent_event_id":"EV_mtcrcsst_7h5lkurn","phase":"project-manager","skill":"project-manager","event_type":"end","input_refs":["/home/parso/forge-m0-a/_queue/in-flight/INIT-2026-08-28-init-2026-08-28-coupling-command.md"],"output_refs":["/home/parso/forge-m0-a/_worktrees/INIT-2026-08-28-init-2026-08-28-coupling-command/.forge/work-items"],"duration_ms":182888,"cost_usd":0.544421,"metadata":{"work_item_count":4,"result_subtype":"success","tool_use":{"brainReads":0,"writes":10},"parse_errors":{},"set_errors":[],"per_item_error_count":0,"hidden_coupling_violations":[],"planned_count":4}}';

// Field-accurate trim of the real line 105 (see comment above) — same
// event_id/cycle_id/phase/skill/event_type/iteration/cost_usd/tokens as the
// real log.
const RUN1_DEVLOOP_WI1_ITERATION_LINE = JSON.stringify({
  event_id: 'EV_mtcrkjhz_mt79f7va',
  cycle_id: '2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command',
  started_at: '2026-08-28T09:43:19.991Z',
  initiative_id: 'INIT-2026-08-28-init-2026-08-28-coupling-command',
  parent_event_id: 'EV_mtcrh5rf_440619gx',
  phase: 'developer-loop',
  skill: 'developer-ralph',
  event_type: 'iteration',
  iteration: 1,
  input_refs: ['/home/parso/forge-m0-a/_worktrees/INIT-2026-08-28-init-2026-08-28-coupling-command/.forge/work-items/WI-1.md'],
  output_refs: [],
  cost_usd: 0.46645539999999985,
  tokens_in: 21,
  tokens_out: 8252,
  metadata: { work_item_id: 'WI-1' },
});

const RUN1_DEVLOOP_WI1_END_LINE =
  '{"event_id":"EV_mtcrklck_so1xqy0h","cycle_id":"2026-08-28T09-37-15_INIT-2026-08-28-init-2026-08-28-coupling-command","started_at":"2026-08-28T09:43:22.388Z","initiative_id":"INIT-2026-08-28-init-2026-08-28-coupling-command","parent_event_id":"EV_mtcrh5rf_440619gx","phase":"developer-loop","skill":"developer-ralph","event_type":"end","input_refs":["/home/parso/forge-m0-a/_worktrees/INIT-2026-08-28-init-2026-08-28-coupling-command/.forge/work-items/WI-1.md"],"output_refs":["/home/parso/forge-m0-a/_worktrees/wi/INIT-2026-08-28-init-2026-08-28-coupling-command/WI-1/AGENT.md","/home/parso/forge-m0-a/_worktrees/wi/INIT-2026-08-28-init-2026-08-28-coupling-command/WI-1/CHANGELOG.md","/home/parso/forge-m0-a/_worktrees/wi/INIT-2026-08-28-init-2026-08-28-coupling-command/WI-1/fix_plan.md","/home/parso/forge-m0-a/_worktrees/wi/INIT-2026-08-28-init-2026-08-28-coupling-command/WI-1/src/coupling.ts","/home/parso/forge-m0-a/_worktrees/wi/INIT-2026-08-28-init-2026-08-28-coupling-command/WI-1/test/coupling.test.ts"],"cost_usd":0.46645539999999985,"duration_ms":157826,"message":"ralph.end","metadata":{"work_item_id":"WI-1","status":"complete","iterations":1,"stop_reason":"quality-gates-pass","tool_use":{"reads":6,"brainReads":0,"writes":5,"bashCalls":9,"testRuns":3}}}';

const RUN1_COST_LINES = [
  RUN1_ARCHITECT_END_LINE,
  RUN1_PM_END_LINE,
  RUN1_DEVLOOP_WI1_ITERATION_LINE,
  RUN1_DEVLOOP_WI1_END_LINE,
];

test('sumAuthoritativeCostFromLines: developer-loop restatement (iteration → end) is counted ONCE, agreeing with orchestrator/event-cost.ts sumAuthoritativeCostUsd for the SAME input', () => {
  const fromLines = sumAuthoritativeCostFromLines(RUN1_COST_LINES);

  // The real rule, imported (not duplicated), fed the SAME lines parsed to events.
  const events = RUN1_COST_LINES.map((l) => JSON.parse(l));
  const expected = sumAuthoritativeCostUsd(events);

  assert.equal(fromLines, expected, 'sumAuthoritativeCostFromLines must agree with the single source of truth for the same input');
  // Ground it in the real numbers, not just internal agreement: architect
  // (0) + project-manager (0.544421, no iteration events, counted in full) +
  // developer-loop's ONE authoritative iteration cost (0.46645539999999985) —
  // the WI-1 ralph.end restatement of that SAME dollar figure must NOT be
  // added again.
  assert.ok(Math.abs(fromLines - 1.0108764) < 1e-9, `expected ~1.0108764, got ${fromLines}`);
});

test('sumAuthoritativeCostFromLines: a naive per-line sum (the sumCycleCost bug) double-counts the restated developer-loop cost — proves the two-different-costs defect', () => {
  const authoritative = sumAuthoritativeCostFromLines(RUN1_COST_LINES);
  const naive = RUN1_COST_LINES.reduce((total, l) => {
    const e = JSON.parse(l);
    return typeof e.cost_usd === 'number' ? total + e.cost_usd : total;
  }, 0);
  assert.ok(
    naive > authoritative,
    `a naive sum (${naive}) must overstate the authoritative sum (${authoritative}) by double-counting WI-1's restated ralph.end cost`,
  );
  assert.ok(Math.abs(naive - authoritative - 0.46645539999999985) < 1e-9, 'the overstatement must be exactly WI-1\'s restated cost');
});
