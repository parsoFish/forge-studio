/**
 * forge-mfv5.1.43 (D-20 amended) — a work item closes only when its gate AND
 * every acceptance criterion's falsifying check pass at its head.
 *
 * Calls `buildWiQualityGate` — the function `developer-loop.ts` hands `runRalph`
 * as its `qualityGate`, so `quality-gates-pass` (and the iter-0
 * `already-complete` shortcut) see exactly this composite. Real `node --test`
 * runs in a tmp dir: no network, no spawn of an agent, no git write.
 *
 * The fixture is the I3b WI-14 shape: the WI gate passes, AC1 is an
 * `expect: pass` test, AC2 says "the suite FAILS without GW_CALLER_TOKEN"
 * (`expect: fail` + `unsetEnv`). While the suite merely SKIPS without the token,
 * AC2 does not fail and the work item must not close.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readFileSync } from 'node:fs';
import type { EventLogEntry, EventLogger } from '@forge/kernel';
import { parseWorkItem, serializeWorkItem, writeWorkItemStatus, type WorkItem } from '@forge/flows';

import { emitGateEvent } from '../../phases/dev-loop-events.ts';

import { buildWiQualityGate, type AcCheckRun } from '../../phases/wi-quality-gate.ts';

const GATE = [process.execPath, '-e', 'process.exit(0)'];
const nodeTest = (file: string): string[] => [process.execPath, '--test', file];

const SKIPS_WITHOUT_TOKEN = `import { test } from 'node:test';
test('live', { skip: !process.env.GW_CALLER_TOKEN }, () => {});\n`;
const FAILS_WITHOUT_TOKEN = `import { test } from 'node:test';
test('live', () => { if (!process.env.GW_CALLER_TOKEN) throw new Error('GW_CALLER_TOKEN is unset'); });\n`;
const PASSES = `import { test } from 'node:test';\ntest('ok', () => {});\n`;

function wi(acs: WorkItem['acceptance_criteria']): WorkItem {
  return {
    work_item_id: 'WI-14', initiative_id: 'INIT-2026-10-11-i3b-self-service', status: 'pending', depends_on: [],
    acceptance_criteria: acs, files_in_scope: [], quality_gate_cmd: GATE, estimated_iterations: 1, body: '',
  };
}

const TWO_ACS = (dir: string): WorkItem['acceptance_criteria'] => [
  { given: 'the CLI', when: 'the pass test runs', then: 'it passes', check: { argv: nodeTest(join(dir, 'pass.test.mjs')), expect: 'pass' } },
  { id: 'AC1b', given: 'GW_CALLER_TOKEN unset', when: 'the live suite runs', then: 'it FAILS', check: { argv: nodeTest(join(dir, 'live.test.mjs')), expect: 'fail', unsetEnv: ['GW_CALLER_TOKEN'] } },
];

function harness(w: WorkItem, dir: string, extra: Partial<Parameters<typeof buildWiQualityGate>[0]> = {}) {
  const runs: AcCheckRun[] = [];
  const judged: string[][] = [];
  let gateRuns = 0;
  const gate = buildWiQualityGate({
    worktreePath: dir, effective: w.quality_gate_cmd!, accGate: undefined, wi: w, requiredPathsSource: 'files-in-scope',
    ciGateUnsetEnv: undefined, localGateTimeoutMs: 60_000, initiativeId: w.initiative_id,
    onRun: () => { gateRuns++; }, onAcCheck: (r) => runs.push(r), onChecksJudged: (s) => judged.push([...s]),
    ...extra,
  });
  return { gate, runs, judged, gateRuns: () => gateRuns };
}

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'forge-ac-checks-'));
  const saved = process.env.GW_CALLER_TOKEN;
  process.env.GW_CALLER_TOKEN = 'set-in-the-forge-env'; // unsetEnv must strip it from the check's child
  const ctx = process.env.NODE_TEST_CONTEXT; // the fixtures' own `node --test` must report as a top-level run
  delete process.env.NODE_TEST_CONTEXT;
  try { fn(dir); } finally {
    if (ctx !== undefined) process.env.NODE_TEST_CONTEXT = ctx;
    if (saved === undefined) delete process.env.GW_CALLER_TOKEN; else process.env.GW_CALLER_TOKEN = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('WI gate passes but the expect-fail check does not fail (the suite only skips) → NOT complete', () => withDir((dir) => {
  writeFileSync(join(dir, 'pass.test.mjs'), PASSES);
  writeFileSync(join(dir, 'live.test.mjs'), SKIPS_WITHOUT_TOKEN);
  const h = harness(wi(TWO_ACS(dir)), dir);
  assert.equal(h.gate({ iteration: 1 }), false, 'a WI whose AC2 cannot fail must not close');
  assert.deepEqual(h.runs.map((r) => [r.label, r.expect, r.satisfied]), [['AC1', 'pass', true], ['AC1b', 'fail', false]]);
  assert.match(h.runs[1]!.info.stderrTail, /AC1b expected the check to FAIL/);
  assert.deepEqual(h.judged, [['AC1']]);
}));

test('both checks satisfied (the suite now FAILS without the token) → complete, both checks reported', () => withDir((dir) => {
  writeFileSync(join(dir, 'pass.test.mjs'), PASSES);
  writeFileSync(join(dir, 'live.test.mjs'), FAILS_WITHOUT_TOKEN);
  const h = harness(wi(TWO_ACS(dir)), dir);
  assert.equal(h.gate({ iteration: 1 }), true);
  assert.deepEqual(h.runs.map((r) => [r.label, r.satisfied, r.info.passed]), [['AC1', true, true], ['AC1b', true, true]]);
  assert.match(h.runs[1]!.info.command, /^\[AC1b expect fail\] /);
  assert.deepEqual(h.judged, [['AC1', 'AC1b']]);
}));

test('the WI gate failing short-circuits: no check runs, nothing judged', () => withDir((dir) => {
  const w = { ...wi(TWO_ACS(dir)), quality_gate_cmd: [process.execPath, '-e', 'process.exit(1)'] };
  const h = harness(w, dir);
  assert.equal(h.gate({ iteration: 1 }), false);
  assert.equal(h.gateRuns(), 1);
  assert.deepEqual(h.runs, []);
  assert.deepEqual(h.judged, []);
}));

test('an expect-fail check whose command cannot run is unsatisfied AND errored — never a pass by inversion', () => withDir((dir) => {
  const w = wi([{ given: 'g', when: 'w', then: 't', check: { argv: ['forge-no-such-binary-ac-gate'], expect: 'fail' } }]);
  const h = harness(w, dir);
  assert.equal(h.gate({ iteration: 1 }), false);
  assert.equal(h.runs[0]!.satisfied, false);
  assert.equal(h.runs[0]!.info.errored, true);
}));

test('an expect-fail check that runs zero tests (a summary saying nothing ran) is unsatisfied', () => withDir((dir) => {
  // A runner that reports 0 passed / 0 failed / 1 skipped and exits non-zero (a collection-time crash shape).
  const argv = [process.execPath, '-e', "console.log('# pass 0\\n# fail 0\\n# skipped 1'); process.exit(1)"];
  const h = harness(wi([{ given: 'g', when: 'w', then: 't', check: { argv, expect: 'fail' } }]), dir);
  assert.equal(h.gate({ iteration: 1 }), false);
  assert.match(h.runs[0]!.info.stderrTail, /ran 0 tests/);
}));

test('requiresEnv: a check needing an unset var is errored; the live tier\'s requiresEnv never demands a var the check unsets', () => withDir((dir) => {
  writeFileSync(join(dir, 'live.test.mjs'), FAILS_WITHOUT_TOKEN);
  const needs = wi([{ given: 'g', when: 'w', then: 't', check: { argv: nodeTest(join(dir, 'live.test.mjs')), expect: 'pass', requiresEnv: ['FORGE_AC_GATE_NEVER_SET'] } }]);
  const h1 = harness(needs, dir);
  assert.equal(h1.gate({ iteration: 1 }), false);
  assert.equal(h1.runs[0]!.info.rejectReason, 'live-env-missing');
  const accGate = { match: 'live.test.mjs', requires_env: ['GW_CALLER_TOKEN'] };
  const unsets = wi([{ given: 'g', when: 'w', then: 't', check: { argv: nodeTest(join(dir, 'live.test.mjs')), expect: 'fail', unsetEnv: ['GW_CALLER_TOKEN'] } }]);
  const h2 = harness(unsets, dir, { accGate });
  assert.equal(h2.gate({ iteration: 1 }), true, JSON.stringify(h2.runs[0]?.info));
}));

test('a work item without checks keeps its gate verdict unchanged (plan WIs, D-47)', () => withDir((dir) => {
  const h = harness(wi([{ given: 'g', when: 'w', then: 't' }]), dir);
  assert.equal(h.gate({ iteration: 1 }), true);
  assert.deepEqual(h.runs, []);
  assert.deepEqual(h.judged, [[]]);
}));

/** Records every emitted entry (the shape `developer-loop.project-skills-logged.test.ts` uses). */
function recordingLogger(): { logger: EventLogger; emitted: EventLogEntry[] } {
  const emitted: EventLogEntry[] = [];
  const logger: EventLogger = {
    cycleId: 'cycle-ac-checks', logFilePath: '/dev/null',
    emit(partial) { const e = { event_id: `e${emitted.length + 1}`, cycle_id: 'cycle-ac-checks', started_at: '', ...partial } as EventLogEntry; emitted.push(e); return e; },
  };
  return { logger, emitted };
}

test('close: each check logs its own gate event naming the criterion, and forge ticks exactly the satisfied boxes', () => withDir((dir) => {
  writeFileSync(join(dir, 'pass.test.mjs'), PASSES);
  writeFileSync(join(dir, 'live.test.mjs'), SKIPS_WITHOUT_TOKEN);
  const acs = TWO_ACS(dir);
  const spec = join(dir, 'WI-14.md');
  writeFileSync(spec, serializeWorkItem({ ...wi(acs), body: '# WI-14\n\n- [ ] AC1: GIVEN the CLI\n- [ ] AC1b: GIVEN GW_CALLER_TOKEN unset\n' }));
  const { logger, emitted } = recordingLogger();
  let satisfied: readonly string[] = [];
  // The wiring `developer-loop.ts` uses: onRun → emitGateEvent (a check's info carries `ac`); onChecksJudged → the ticked set.
  const gateFor = () => buildWiQualityGate({
    worktreePath: dir, effective: GATE, accGate: undefined, wi: wi(acs), requiredPathsSource: 'files-in-scope',
    ciGateUnsetEnv: undefined, localGateTimeoutMs: 60_000, initiativeId: 'INIT-2026-10-11-i3b-self-service',
    onRun: (info) => { if (info.ac) emitGateEvent(logger, 'INIT-2026-10-11-i3b-self-service', 'p', 'WI-14', info); },
    onChecksJudged: (s) => { satisfied = s; },
  });
  assert.equal(gateFor()({ iteration: 1 }), false);
  writeFileSync(join(dir, 'live.test.mjs'), FAILS_WITHOUT_TOKEN);
  assert.equal(gateFor()({ iteration: 2 }), true);
  const ac = emitted.map((e) => [e.message, (e.metadata as Record<string, unknown>).acceptance_criterion, e.event_type]);
  assert.deepEqual(ac, [
    ['gate.pass', 'AC1', 'log'], ['gate.fail', 'AC1b', 'error'],
    ['gate.pass', 'AC1', 'log'], ['gate.pass', 'AC1b', 'log'],
  ]);
  writeWorkItemStatus(spec, 'complete', satisfied);
  const closed = parseWorkItem(readFileSync(spec, 'utf8'));
  assert.equal(closed.status, 'complete');
  assert.match(closed.body, /- \[x\] AC1: GIVEN the CLI/);
  assert.match(closed.body, /- \[x\] AC1b: GIVEN GW_CALLER_TOKEN unset/);
}));

test('no WI gate at all: the checks alone decide — a WI with checks never closes unchecked', () => withDir((dir) => {
  writeFileSync(join(dir, 'live.test.mjs'), SKIPS_WITHOUT_TOKEN);
  const w = wi([{ given: 'g', when: 'w', then: 't', check: { argv: nodeTest(join(dir, 'live.test.mjs')), expect: 'fail', unsetEnv: ['GW_CALLER_TOKEN'] } }]);
  const h = harness(w, dir, { effective: [] });
  assert.equal(h.gate({ iteration: 1 }), false);
  assert.deepEqual(h.runs.map((r) => [r.label, r.satisfied]), [['AC1', false]]);
}));

/**
 * forge-mfv5.1.44 — I3b round 3 WI-15 AC3: a guard check (`python3 -c <grep program>`, expect pass) whose program TEXT names the
 * live suite's `match` was classed as the live suite, inherited its requiresEnv, and its clean exit 0 was refused as an acceptance gate
 * with no runner summary (−7 no-tests-ran). An inline program is code, not the suite the command targets: the guard keeps its exit code.
 */
const ACC = { match: 'tests/acceptance', requires_env: ['GW_CALLER_TOKEN'] };
const guard = (exit: number): string[] => [process.execPath, '-e', `/* grep -rqnE 'gw-acc-' gitweave tests/acceptance */ process.exit(${exit})`];

test('forge-mfv5.1.44: a guard check whose program names the suite match passes on exit 0 (gate.pass naming AC3), fails on exit 1', () => withDir((dir) => {
  const ac = (exit: number): WorkItem['acceptance_criteria'] => [{ id: 'AC3', given: 'g', when: 'w', then: 't', check: { argv: guard(exit), expect: 'pass' } }];
  const { logger, emitted } = recordingLogger();
  const onRun = (info: AcCheckRun['info']): void => { if (info.ac) emitGateEvent(logger, 'INIT-x', 'p', 'WI-15', info); };
  const passing = harness(wi(ac(0)), dir, { accGate: ACC, effective: [], onRun });
  assert.equal(passing.gate({ iteration: 1 }), true, JSON.stringify(passing.runs[0]?.info));
  assert.equal(passing.runs[0]!.info.rejectReason, undefined);
  assert.deepEqual(emitted.map((e) => [e.message, (e.metadata as Record<string, unknown>).acceptance_criterion]), [['gate.pass', 'AC3']]);
  const failing = harness(wi(ac(1)), dir, { accGate: ACC, effective: [] });
  assert.equal(failing.gate({ iteration: 1 }), false);
  assert.equal(failing.runs[0]!.info.exitCode, 1);
}));

test('forge-mfv5.1.44: explicit requiresEnv on a guard check does not make it an acceptance gate — exit 0 keeps its verdict', () => withDir((dir) => {
  const w = wi([{ id: 'AC3', given: 'g', when: 'w', then: 't', check: { argv: guard(0), expect: 'pass', requiresEnv: ['GW_CALLER_TOKEN'] } }]);
  const h = harness(w, dir, { effective: [] });
  assert.equal(h.gate({ iteration: 1 }), true, JSON.stringify(h.runs[0]?.info));
}));

test('forge-mfv5.1.44 control: a check that targets the suite and prints no runner summary is still refused by name', () => withDir((dir) => {
  // The suite path is an argument the command targets (a script file's argument), so the check is classed as the live suite.
  writeFileSync(join(dir, 'run_acc.mjs'), 'process.exit(0);\n');
  const argv = [process.execPath, join(dir, 'run_acc.mjs'), 'tests/acceptance'];
  const verdicts: AcCheckRun['info'][] = [];
  const h = harness(wi([{ id: 'AC2', given: 'g', when: 'w', then: 't', check: { argv, expect: 'pass' } }]), dir, { accGate: ACC, effective: [], onVerdict: (v) => { verdicts.push(v); } });
  assert.equal(h.gate({ iteration: 1 }), false);
  assert.equal(h.runs[0]!.info.rejectReason, 'no-tests-ran');
  assert.match(h.runs[0]!.info.stderrTail, /acceptance gate output carries no recognised test summary/);
  // forge-mfv5.1.59: the refusal names the argv token that classed the check, in the brief the agent reads.
  assert.match(h.runs[0]!.info.stderrTail, /\[forge ac-check\] AC2 classed acceptance by argv\[2\] 'tests\/acceptance'/);
  assert.match(verdicts[0]!.stderrTail, /AC2 classed acceptance by argv\[2\] 'tests\/acceptance'/);
}));

test('forge-mfv5.1.44 control: the WI gate itself keeps the D-34 substring match — an inline program naming the suite is still an acceptance gate', () => withDir((dir) => {
  const infos: AcCheckRun['info'][] = [];
  const h = harness(wi([{ given: 'g', when: 'w', then: 't' }]), dir, { accGate: ACC, effective: guard(0), onRun: (i) => { infos.push(i); } });
  assert.equal(h.gate({ iteration: 1 }), false);
  assert.equal(infos[0]!.rejectReason, 'no-tests-ran');
}));

/**
 * forge-mfv5.1.59 — I4 WI-18 SB8a/SB13/SB17/SB7b: every argv string ≤ 500 chars, so each probe is exec-split
 * (`<interp> -c "exec(''.join(sys.argv[1:]))" chunk1 chunk2 …`). A chunk carrying `--ignore=tests/acceptance` classed the check as the
 * live suite and its exit 0 was refused −7. The chunks are the program's own argv: the probe keeps its exit code.
 */
test('forge-mfv5.1.59: an exec-split probe whose program argv names the suite match passes on exit 0, fails on exit 1', () => withDir((dir) => {
  const probe = (exit: number): string[] => [process.execPath, '-e', "eval(process.argv.slice(1).join(''))", "/* pytest -q --ignore=tests/acceptance */ process.stdout.write('[2, 1, 1]');", ` process.exit(${exit});`];
  const ac = (exit: number): WorkItem['acceptance_criteria'] => [{ id: 'SB13', given: 'g', when: 'w', then: 't', check: { argv: probe(exit), expect: 'pass' } }];
  const passing = harness(wi(ac(0)), dir, { accGate: ACC, effective: [] });
  assert.equal(passing.gate({ iteration: 1 }), true, JSON.stringify(passing.runs[0]?.info));
  assert.equal(passing.runs[0]!.info.rejectReason, undefined);
  assert.equal(passing.runs[0]!.info.stdoutTail.trim(), '[2, 1, 1]', 'the program ran with its chunks joined');
  const failing = harness(wi(ac(1)), dir, { accGate: ACC, effective: [] });
  assert.equal(failing.gate({ iteration: 1 }), false);
  assert.equal(failing.runs[0]!.info.exitCode, 1);
  assert.doesNotMatch(failing.runs[0]!.info.stderrTail, /classed acceptance/, 'an unclassed check names no class');
}));
