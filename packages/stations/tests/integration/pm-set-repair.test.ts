/**
 * forge-mfv5.1.34 (D-49) — a PM set-validation failure earns bounded REPAIR
 * turns fed every error verbatim, replays the SAME validation over the
 * replacement set, and on exhaustion fails by name with the errors recorded in
 * the manifest. The D-47 acceptance revise is folded into this one loop.
 *
 * Fixture: the live gitweave I2 failure (2026-10-11T02-16-05 cycle), COPIED
 * read-only into `test-fixtures/pm-repair-i2/` (`*.md.fixture`) — the rejected WI-1..12 set and
 * the approved manifest (machine paths stripped). The live run failed with
 * exactly two errors: WI-3 creates 7 files over the D-18 bound of 5, and AC5
 * (`python3 -m pytest tests/`) carried by no work-item gate.
 *
 * Every spawn is a stub `queryFn` (M7-COMMON §6.16): no test here can reach a
 * live model even if the loop under test is broken.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from '../../phases/project-manager.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import { parseManifest, type CycleInput } from '@forge/flows';
import { PM_SET_VALIDATION_UNREPAIRED_PREFIX, PM_REPAIR_NEEDS_REPLAN_PREFIX } from '@forge/contracts';
import { testClassProfilePort } from '../test-fixtures/class-profile-port-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const FIXTURE = resolve(import.meta.dirname, '..', 'test-fixtures', 'pm-repair-i2');
const FIXTURE_WIS = join(FIXTURE, 'work-items');
const MANIFEST = readFileSync(join(FIXTURE, 'manifest.md.fixture'), 'utf8');
const INIT = 'INIT-2026-10-11-i2-apply-engine-terraform-retired';

const D18_ERROR = 'WI-3: creates lists 7 path(s), exceeding the D-18 sizing bound of 5';
const AC5_ERROR = 'AC5 (uncarried: `python3 -m pytest tests/`';

/** A set = file name → content. */
type WiSet = Record<string, string>;

function fixtureSet(): WiSet {
  const set: WiSet = {};
  // `.md.fixture` on disk: the gitweave paths these files cite do not exist in forge (check-stale-path-citations).
  for (const f of readdirSync(FIXTURE_WIS)) set[f.replace(/\.fixture$/, '')] = readFileSync(join(FIXTURE_WIS, f), 'utf8');
  return set;
}

const MOVED_OUT_OF_WI3 = ['config/org.yaml', 'config/rulesets.yaml', 'tests/fixtures/org-empty.json'];

function newWi(id: string, deps: string[], files: string[], gate: string[]): string {
  return `---
work_item_id: ${id}
initiative_id: ${INIT}
status: pending
depends_on: ${JSON.stringify(deps)}
domain: config
acceptance_criteria:
  - given: "the files exist"
    when: "the gate runs"
    then: "it exits 0"
files_in_scope: ${JSON.stringify(files)}
creates: ${JSON.stringify(files)}
quality_gate_cmd: ${JSON.stringify(gate)}
estimated_iterations: 1
---

# ${id}
`;
}

/** The correct repair: WI-3 split to ≤5 creates (WI-3 keeps its id so every
 *  dependant still resolves), the moved files in WI-3b, plus WI-13 whose gate
 *  runs AC5's command as written. */
function repairedSet(): WiSet {
  const set = fixtureSet();
  set['WI-3.md'] = set['WI-3.md']!
    .split('\n')
    .filter((l) => !MOVED_OUT_OF_WI3.some((p) => l.trim() === `- ${p}`))
    .join('\n');
  set['WI-3b.md'] = newWi('WI-3b', ['WI-3'], [...MOVED_OUT_OF_WI3, 'tests/test_gw_seed.py'], ['python3', '-m', 'pytest', 'tests/test_gw_seed.py']);
  set['WI-13.md'] = newWi('WI-13', ['WI-12'], ['tests/test_suite_whole.py'], ['python3', '-m', 'pytest', 'tests/']);
  return set;
}

type Spawn = { prompt: string; ceilingUsd: unknown; maxTurns: unknown };

/** Spawn `i` writes `sets[i]` (clamped to the last) into `.forge/work-items/`;
 *  `extra[i]` adds files (the needs-replan marker). Records each spawn. */
function scripted(sets: WiSet[], opts: { costUsd?: number; extra?: Record<number, WiSet>; subtype?: Record<number, string>; throwAt?: number } = {}): { queryFn: PmQueryFn; spawns: Spawn[] } {
  const spawns: Spawn[] = [];
  const queryFn: PmQueryFn = (params) => {
    const i = spawns.length;
    const o = params.options as { cwd: string; maxBudgetUsd?: unknown; maxTurns?: unknown };
    spawns.push({ prompt: String((params as { prompt: unknown }).prompt), ceilingUsd: o.maxBudgetUsd, maxTurns: o.maxTurns });
    const set = { ...sets[Math.min(i, sets.length - 1)]!, ...(opts.extra?.[i] ?? {}) };
    return (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/x.md' } }] } };
      const dir = resolve(o.cwd, '.forge', 'work-items');
      mkdirSync(dir, { recursive: true });
      for (const [name, body] of Object.entries(set)) writeFileSync(join(dir, name), body);
      // A turn stopped mid-write leaves a partial set behind before the throw.
      if (opts.throwAt === i) throw new Error('operator-stop: stub stop mid-turn');
      yield { type: 'result', subtype: opts.subtype?.[i] ?? 'success', duration_ms: 1, total_cost_usd: opts.costUsd ?? 0.5 };
    })();
  };
  return { queryFn, spawns };
}

function harness(manifest = MANIFEST): { dir: string; worktree: string; logger: ReturnType<typeof createLogger>; input: CycleInput } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-set-repair-'));
  const worktree = join(dir, 'projects', 'gitweave');
  mkdirSync(join(worktree, '.forge'), { recursive: true });
  writeFileSync(join(worktree, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['python3', '-m', 'pytest'] } } }));
  const manifestPath = join(dir, '_queue', 'in-flight', `${INIT}.md`);
  mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(manifestPath, manifest);
  mkdirSync(join(dir, '_logs'), { recursive: true });
  const logger = createLogger('TEST-pm-set-repair', join(dir, '_logs'));
  const input: CycleInput = {
    initiativeId: INIT, manifestPath, projectRepoPath: worktree, worktreePath: worktree,
    cycleId: `2026-10-11T02-16-05_${INIT}`,
  };
  return { dir, worktree, logger, input };
}

const events = (h: ReturnType<typeof harness>): EventLogEntry[] =>
  readFileSync(h.logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);
const manifestNow = (h: ReturnType<typeof harness>) => parseManifest(readFileSync(h.input.manifestPath, 'utf8'));
const run = (h: ReturnType<typeof harness>, queryFn: PmQueryFn): Promise<unknown> =>
  runProjectManager(h.input, h.logger, { agentDef: canonicalDef('project-manager'), queryFn, classProfiles: testClassProfilePort() });
const within = async (fn: (h: ReturnType<typeof harness>) => Promise<void>, manifest?: string): Promise<void> => {
  const h = harness(manifest);
  try { await fn(h); } finally { rmSync(h.dir, { recursive: true, force: true }); }
};

test('I2 replay: the first repair brief carries BOTH live errors verbatim, the current set and the turn bound', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet(), repairedSet()]);
    await run(h, queryFn);
    assert.equal(spawns.length, 2, 'one decomposition + one repair turn');
    const brief = spawns[1]!.prompt;
    assert.ok(brief.includes(D18_ERROR), `D-18 error verbatim in the brief:\n${brief}`);
    assert.ok(brief.includes(AC5_ERROR), `D-47 error verbatim in the brief:\n${brief}`);
    assert.match(brief, /turn 1 of 2/i);
    for (const id of ['WI-1', 'WI-3', 'WI-9b', 'WI-12']) assert.ok(brief.includes(`${id}.md`), `current set lists ${id}`);
  }));

test('I2 replay: a correct replacement set passes the SAME validation → success, replacement ids persisted, nothing recorded', () =>
  within(async (h) => {
    const { queryFn } = scripted([fixtureSet(), repairedSet()]);
    await run(h, queryFn);
    const ev = events(h);
    const end = ev.find((e) => e.message === 'pm.repair.end');
    assert.equal((end?.metadata as { resolved?: boolean })?.resolved, true);
    assert.ok(ev.find((e) => e.phase === 'project-manager' && e.event_type === 'end'), 'the pass succeeds');
    const m = manifestNow(h);
    assert.ok(m.specs?.includes('WI-3b') && m.specs?.includes('WI-13'), `specs: ${m.specs}`);
    assert.equal(m.pm_validation_errors, undefined);
    assert.ok(existsSync(join(h.worktree, '.forge', 'work-items', 'WI-13.md')), 'the replacement set is the live set');
  }));

test('still-violating repairs → exactly REPAIR_TURNS_MAX turns → fails by name, errors in the manifest and REJECTED.md', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet()]);
    await assert.rejects(() => run(h, queryFn), (err: Error) => {
      assert.ok(err.message.includes(PM_SET_VALIDATION_UNREPAIRED_PREFIX), err.message);
      assert.ok(err.message.includes(D18_ERROR) && err.message.includes(AC5_ERROR), err.message);
      return true;
    });
    assert.equal(spawns.length, 3, 'decomposition + 2 repair turns, never a third');
    assert.match(spawns[2]!.prompt, /turn 2 of 2/i);
    const recorded = manifestNow(h).pm_validation_errors ?? [];
    assert.ok(recorded.some((e) => e.includes(D18_ERROR)) && recorded.some((e) => e.includes(AC5_ERROR)), `recorded: ${recorded}`);
    const forge = join(h.worktree, '.forge');
    const rejected = readdirSync(forge).filter((d) => d.startsWith('work-items-rejected-')).sort().at(-1)!;
    const note = readFileSync(join(forge, rejected, 'REJECTED.md'), 'utf8');
    assert.ok(note.split('\n').some((l) => l.startsWith('- ') && l.includes(D18_ERROR)), note);
    assert.ok(note.split('\n').some((l) => l.startsWith('- ') && l.includes(AC5_ERROR)), note);
  }));

test('budget stop: a repair turn whose ceiling would breach cost_budget_usd never spawns; failure names the stop and the errors', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet()], { costUsd: 2.4 });
    await assert.rejects(() => run(h, queryFn), (err: Error) => {
      assert.ok(err.message.includes('pm-repair-budget-exhausted'), err.message);
      assert.ok(err.message.includes(D18_ERROR), err.message);
      return true;
    });
    assert.equal(spawns.length, 1, 'no repair spawn past the budget');
  }, MANIFEST.replace('cost_budget_usd: 22', 'cost_budget_usd: 3')));

test('needs re-plan: a repair that declares a plan-level problem stops by name, no further turn, never a re-plan', () =>
  within(async (h) => {
    const marker = { '_needs-replan.md': 'AC6 needs GitHub Actions secrets the plan never provisions — the architect must change AC6.\n' };
    const { queryFn, spawns } = scripted([fixtureSet()], { extra: { 1: marker } });
    await assert.rejects(() => run(h, queryFn), (err: Error) => {
      assert.ok(err.message.includes(PM_REPAIR_NEEDS_REPLAN_PREFIX), err.message);
      assert.ok(err.message.includes('AC6 needs GitHub Actions secrets'), err.message);
      return true;
    });
    assert.equal(spawns.length, 2, 'the declaring turn is the last');
  }));

test('every repair turn is capped: its ceiling is below the first pass and positive', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet(), repairedSet()]);
    await run(h, queryFn);
    const ceiling = spawns[1]!.ceilingUsd;
    assert.equal(typeof ceiling, 'number');
    assert.ok((ceiling as number) > 0 && (ceiling as number) < (spawns[0]!.ceilingUsd as number), `repair ceiling ${ceiling} vs pass ${spawns[0]!.ceilingUsd}`);
  }));

test('needs re-plan: the agent-written reason is bounded before it reaches the summary and the log', () =>
  within(async (h) => {
    const { queryFn } = scripted([fixtureSet()], { extra: { 1: { '_needs-replan.md': `REASON ${'x'.repeat(5000)}` } } });
    await assert.rejects(() => run(h, queryFn), (err: Error) => {
      assert.ok(err.message.includes('REASON xxx'), err.message.slice(0, 200));
      assert.ok(!err.message.includes('x'.repeat(2500)), 'the reason is capped');
      return true;
    });
  }));

// ---- review round (code-review of the D-49 loop) ---------------------------

test('a repair turn cut off by its cap never resolves on the strength of a truncated set', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet(), repairedSet()], { subtype: { 1: 'error_max_turns' } });
    await run(h, queryFn);
    assert.equal(spawns.length, 3, 'the capped turn does not count as a repair; a second turn runs');
    assert.match(spawns[2]!.prompt, /repair turn 1 ended error_max_turns/);
  }));

test('a repair turn that writes nothing keeps the errors it was fed, and the next turn reads the same previous set', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet(), {}, repairedSet()]);
    await run(h, queryFn);
    assert.equal(spawns.length, 3);
    assert.ok(spawns[2]!.prompt.includes(D18_ERROR) && spawns[2]!.prompt.includes('the repair turn wrote no work items'), spawns[2]!.prompt);
    assert.ok(spawns[2]!.prompt.includes('WI-9b.md'), 'the previous set is still listed');
  }));

test('a turn that throws leaves no claimable set, and the original error propagates', () =>
  within(async (h) => {
    const { queryFn } = scripted([fixtureSet()], { throwAt: 1 });
    await assert.rejects(() => run(h, queryFn), /operator-stop: stub stop mid-turn/);
    const dir = join(h.worktree, '.forge', 'work-items');
    assert.ok(!existsSync(dir) || !readdirSync(dir).some((f) => /^WI-.*\.md$/.test(f)), 'nothing claimable');
  }));

test('a capped first pass keeps its own classification: no repair turn', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet()], { subtype: { 0: 'error_max_turns' } });
    await assert.rejects(() => run(h, queryFn));
    assert.equal(spawns.length, 1);
  }));

// ---- row 2: Requeue repair mode --------------------------------------------

const RECORDED = MANIFEST.replace('---\n\n## Context', `pm_validation_errors:\n  - '${D18_ERROR}'\n---\n\n## Context`);

function plantRejected(h: ReturnType<typeof harness>): void {
  const dir = join(h.worktree, '.forge', 'work-items-rejected-2026-10-11T02-29-44-657Z');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(fixtureSet())) writeFileSync(join(dir, name), body);
  writeFileSync(join(dir, 'REJECTED.md'), `# Rejected work-item set\n\n## Set errors\n\n- ${D18_ERROR}\n`);
}
const runResumed = (h: ReturnType<typeof harness>, queryFn: PmQueryFn): Promise<unknown> =>
  runProjectManager({ ...h.input, resumeFrom: 'plan' }, h.logger, { agentDef: canonicalDef('project-manager'), queryFn, classProfiles: testClassProfilePort() });

test('Requeue repair mode: the recorded failure restores the rejected set, the FIRST spawn is a repair turn, a correct set → success', () =>
  within(async (h) => {
    assert.ok(RECORDED.includes('pm_validation_errors'), 'fixture carries the recorded errors');
    plantRejected(h);
    const { queryFn, spawns } = scripted([repairedSet()]);
    await runResumed(h, queryFn);
    assert.equal(spawns.length, 1, 'no decomposition spawn — the repair turn is the only one');
    assert.match(spawns[0]!.prompt, /Repair turn 1 of 2/);
    assert.ok(spawns[0]!.prompt.includes(D18_ERROR) && spawns[0]!.prompt.includes(AC5_ERROR));
    const m = manifestNow(h);
    assert.equal(m.pm_validation_errors, undefined, 'a completed decomposition clears the record');
    assert.ok(m.specs?.includes('WI-13'));
  }, RECORDED));

test('Requeue repair mode with no rejected set refuses by name — never a blind re-decompose', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([repairedSet()]);
    await assert.rejects(() => runResumed(h, queryFn), /pm-repair-no-prior-set/);
    assert.equal(spawns.length, 0);
  }, RECORDED));

test('resume at plan WITHOUT recorded errors is a normal decomposition (today\'s path)', () =>
  within(async (h) => {
    const { queryFn, spawns } = scripted([fixtureSet(), repairedSet()]);
    await runResumed(h, queryFn);
    assert.doesNotMatch(spawns[0]!.prompt, /Repair turn/);
  }));

// ---- row 6 (forge-mfv5.1.35): the live I2 repair resolved but stayed unclaimable --
// The live Requeue stamped `resume_from: plan`; the success path left it set, so
// kickoffBuiltReason read "the manifest resumes from plan" and the card never
// reached KICKOFF. The restored rejected set's REJECTED.md was also fed to the
// repair turn as an unparseable work item.

const RESUMED_RECORDED = RECORDED.replace('pm_validation_errors:', 'resume_from: plan\npm_validation_errors:');

test('row 6: a repair-mode success commits the set like a first pass — specs written, resume_from and the errors cleared', () =>
  within(async (h) => {
    assert.equal(parseManifest(RESUMED_RECORDED).resume_from, 'plan', 'fixture is the live shape');
    plantRejected(h);
    const { queryFn } = scripted([repairedSet()]);
    await runResumed(h, queryFn);
    const m = manifestNow(h);
    assert.equal(m.resume_from, undefined, 'the plan marker is consumed — otherwise the Kickoff gate never derives');
    assert.equal(m.pm_validation_errors, undefined);
    assert.ok(m.specs?.includes('WI-3b') && m.specs?.includes('WI-13'), `${m.specs}`);
  }, RESUMED_RECORDED));

test('row 6: the rejected set\'s REJECTED.md marker is never parsed as a work item (not fed to the repair turn)', () =>
  within(async (h) => {
    plantRejected(h);
    const { queryFn, spawns } = scripted([repairedSet()]);
    await runResumed(h, queryFn);
    assert.doesNotMatch(spawns[0]!.prompt, /REJECTED\.md/, spawns[0]!.prompt.slice(0, 600));
  }, RESUMED_RECORDED));
