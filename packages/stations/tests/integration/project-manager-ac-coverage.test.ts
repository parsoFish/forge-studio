/**
 * forge-mfv5.1.26 / D-47 — through the real PM pass: an initiative acceptance
 * criterion whose WHEN is a runnable command and that no work-item gate
 * carries earns a bounded repair turn (D-49), with the criterion named
 * verbatim; if the repair turns do not carry it, the pass fails through the
 * named `PM_SET_VALIDATION_UNREPAIRED_PREFIX` path. cost_budget_usd is 10 so
 * a repair turn's ceiling fits the initiative budget (D-49's budget stop).
 *
 * AC/gate shapes copied from the gitweave I1 plan (2026-10-10), see
 * `packages/stations/tests/unit/decompose-completeness.acceptance-criteria.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from '../../phases/project-manager.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import { PM_SET_VALIDATION_UNREPAIRED_PREFIX } from '@forge/contracts';
import { REPAIR_TURNS_MAX } from '../../phases/pm-set-repair.ts';
import { testClassProfilePort } from '../test-fixtures/class-profile-port-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const INIT = 'INIT-2026-10-10-ac-coverage-test';
const AC2_WHEN = '`python3 -m pytest tests/` runs without any `--deselect` flags';

const MANIFEST = `---
initiative_id: ${INIT}
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-10-10T00:00:00Z
iteration_budget: 3
cost_budget_usd: 10
class: code
phase: in-flight
origin: architect
acceptance_criteria:
  - given: the whole tests/ directory after pruning
    when: '${AC2_WHEN}'
    then: zero tests fail
  - given: the repository root after the prune
    when: '\`cat LICENSE\` is read'
    then: LICENSE contains verbatim AGPL text
---

# AC coverage test
`;

function makeWi(id: string, gate: string[]): string {
  return `---
work_item_id: ${id}
initiative_id: ${INIT}
status: pending
depends_on: []
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - tests/test_${id.toLowerCase()}.py
creates:
  - tests/test_${id.toLowerCase()}.py
quality_gate_cmd: ${JSON.stringify(gate)}
estimated_iterations: 1
---

Body for ${id}.
`;
}

type Wi = { id: string; gate: string[] };

/** Pass `i` answers the PM's `i`-th spawn (main pass, then each repair turn);
 *  records each spawn's prompt. */
function multiPass(passes: Wi[][]): { queryFn: PmQueryFn; prompts: string[] } {
  const prompts: string[] = [];
  const queryFn: PmQueryFn = (params) => {
    const wis = passes[Math.min(prompts.length, passes.length - 1)]!;
    prompts.push(JSON.stringify((params as { prompt: unknown }).prompt));
    const cwd = (params.options as { cwd: string }).cwd;
    return (async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/x.md' } }] },
      };
      const dir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(dir, { recursive: true });
      for (const w of wis) writeFileSync(join(dir, `${w.id}.md`), makeWi(w.id, w.gate));
      writeFileSync(join(dir, '_graph.md'), ['```mermaid', 'graph TD', ...wis.map((w) => `  ${w.id}`), '```'].join('\n'));
      yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
    })();
  };
  return { queryFn, prompts };
}

function harness(): { dir: string; logger: ReturnType<typeof createLogger>; input: CycleInput } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-ac-coverage-'));
  const worktree = join(dir, 'projects', 'testproj');
  mkdirSync(join(worktree, '.forge'), { recursive: true });
  writeFileSync(join(worktree, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['python3', '-m', 'pytest'] } } }));
  const manifestPath = join(dir, '_queue', 'in-flight', `${INIT}.md`);
  mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(manifestPath, MANIFEST);
  mkdirSync(join(dir, '_logs'), { recursive: true });
  const logger = createLogger('TEST-pm-ac-coverage', join(dir, '_logs'));
  const input: CycleInput = {
    initiativeId: INIT, manifestPath, projectRepoPath: worktree, worktreePath: worktree,
    cycleId: `2026-10-10T00-00-00_${INIT}`,
  };
  return { dir, logger, input };
}

function events(logger: ReturnType<typeof createLogger>): EventLogEntry[] {
  return readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);
}

const OWN_FILE_GATE = { id: 'WI-1', gate: ['python3', '-m', 'pytest', 'tests/test_wi-1.py'] };
const WHOLE_SUITE_GATE = { id: 'WI-2', gate: ['python3', '-m', 'pytest', 'tests/'] };
const run = (h: ReturnType<typeof harness>, queryFn: PmQueryFn): Promise<unknown> =>
  runProjectManager(h.input, h.logger, { agentDef: canonicalDef('project-manager'), queryFn, classProfiles: testClassProfilePort() });

test('D-47: an uncarried runnable AC earns a repair turn, named verbatim; a repair that carries it → success', async () => {
  const h = harness();
  try {
    const { queryFn, prompts } = multiPass([[OWN_FILE_GATE], [OWN_FILE_GATE, WHOLE_SUITE_GATE]]);
    await run(h, queryFn);
    assert.equal(prompts.length, 2, 'one main pass + one repair turn');
    assert.ok(prompts[1]!.includes(JSON.stringify(AC2_WHEN).slice(1, -1)), `repair prompt names AC2 verbatim: ${prompts[1]}`);
    assert.ok(!prompts[1]!.includes('cat LICENSE'), 'the prose AC is never sent back');
    const ev = events(h.logger);
    const start = ev.find((e) => e.message === 'pm.repair.start');
    assert.ok(((start?.metadata as { errors?: string[] })?.errors ?? []).some((e) => /not exercised by any work item's quality_gate_cmd/.test(e)));
    assert.ok(ev.find((e) => e.phase === 'project-manager' && e.event_type === 'end'), 'the pass succeeds');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('D-47: repairs that do nothing → the pass fails with the PM_SET_VALIDATION_UNREPAIRED prefix, AC named', async () => {
  const h = harness();
  try {
    const { queryFn, prompts } = multiPass([[OWN_FILE_GATE], [OWN_FILE_GATE]]);
    await assert.rejects(() => run(h, queryFn), (err: Error) => {
      assert.ok(err.message.includes(PM_SET_VALIDATION_UNREPAIRED_PREFIX), err.message);
      assert.ok(err.message.includes(AC2_WHEN), `AC2 named: ${err.message}`);
      return true;
    });
    assert.equal(prompts.length, 1 + REPAIR_TURNS_MAX, 'the repair-turn bound holds');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('D-47: a first pass that already carries the AC runs no repair turn', async () => {
  const h = harness();
  try {
    const { queryFn, prompts } = multiPass([[OWN_FILE_GATE, WHOLE_SUITE_GATE]]);
    await run(h, queryFn);
    assert.equal(prompts.length, 1);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
