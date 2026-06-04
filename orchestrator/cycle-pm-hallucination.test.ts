/**
 * PM decomposition tests — no-feature model.
 *
 * Tests that runProjectManager:
 * 1. Succeeds with ≥1 valid work items.
 * 2. Throws with pm.empty-decomposition when zero WIs are emitted.
 * 3. Correctly classifies the pm.empty-decomposition as terminal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from './phases/project-manager.ts';
import { createLogger, type EventLogEntry } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';
import { classifyCycleFailure } from './failure-classifier.ts';

const MANIFEST_BODY = `---
initiative_id: INIT-2026-05-20-pm-decomp-test
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-05-20T00:00:00Z
iteration_budget: 3
cost_budget_usd: 1
phase: in-flight
origin: architect
---

# Test initiative

## Acceptance criteria

Given a user is authenticated, when they request /api/health, then the response is 200.

Given no Authorization header, when /api/data is requested, then the response is 401.
`;

/**
 * Frontmatter for a clean work-item that round-trips through readWorkItemsFromDir
 * and passes validateWorkItem.
 */
function makeWi(opts: {
  wiId: string;
  initiativeId: string;
  filename?: string;
  dependsOn?: string[];
}): string {
  const fname = opts.filename ?? `src/${opts.wiId.toLowerCase()}.ts`;
  const deps = (opts.dependsOn ?? []).map((d) => `'${d}'`).join(', ');
  return `---
work_item_id: ${opts.wiId}
initiative_id: ${opts.initiativeId}
status: pending
depends_on: [${deps}]
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - ${fname}
creates:
  - ${fname}
quality_gate_cmd: ['node', '--test', 'tests/${opts.wiId.toLowerCase()}.test.ts']
estimated_iterations: 1
---

Body for ${opts.wiId}.
`;
}

function makeGraph(wiIds: readonly string[]): string {
  return [
    '```mermaid',
    'graph TD',
    ...wiIds.map((id) => `  ${id}["${id}"]`),
    '```',
  ].join('\n');
}

/**
 * Build a stub SDK queryFn that writes a canned set of work items to
 * `cwd/.forge/work-items/` then emits an assistant message (with a brain
 * read so the brain-gate is satisfied) and a result message.
 */
function makeStubQueryFn(passes: Array<{
  wis: Array<{ wiId: string; filename?: string; dependsOn?: string[] }>;
  initiativeId: string;
}>): { queryFn: PmQueryFn; callCount: () => number } {
  let callIndex = 0;
  const fn: PmQueryFn = ({ options }) => {
    const passIndex = callIndex;
    callIndex += 1;
    const pass = passes[passIndex];
    if (!pass) {
      throw new Error(`stub queryFn called ${callIndex}× but only ${passes.length} pass(es) configured`);
    }
    const cwd = (options as { cwd: string }).cwd;
    return (async function* () {
      // Emit a synthetic assistant message that "reads" the brain so the
      // F-13 brain gate is satisfied.
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'brain/cycles/themes/work-item-completion-by-domain.md' },
            },
          ],
        },
      };
      // Actually write the WI files + graph the PM would have written.
      const wiDir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(wiDir, { recursive: true });
      for (const wi of pass.wis) {
        const md = makeWi({
          wiId: wi.wiId,
          initiativeId: pass.initiativeId,
          filename: wi.filename,
          dependsOn: wi.dependsOn,
        });
        writeFileSync(join(wiDir, `${wi.wiId}.md`), md);
      }
      writeFileSync(
        join(wiDir, '_graph.md'),
        makeGraph(pass.wis.map((w) => w.wiId)),
      );
      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 1234,
        total_cost_usd: 0.05,
      };
    })();
  };
  return { queryFn: fn, callCount: () => callIndex };
}

type Harness = {
  dir: string;
  worktree: string;
  manifestPath: string;
  logger: ReturnType<typeof createLogger>;
  input: CycleInput;
};

function setupHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-decomp-'));
  const worktree = join(dir, 'projects', 'testproj');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(
    join(worktree, 'package.json'),
    JSON.stringify({ name: 'testproj', version: '0.0.1', scripts: { test: 'echo no tests' } }, null, 2),
  );
  const manifestPath = join(dir, '_queue', 'in-flight', 'INIT-2026-05-20-pm-decomp-test.md');
  mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(manifestPath, MANIFEST_BODY);
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-cycle-decomp', logsDir);
  const input: CycleInput = {
    initiativeId: 'INIT-2026-05-20-pm-decomp-test',
    manifestPath,
    projectRepoPath: worktree,
    worktreePath: worktree,
  };
  return { dir, worktree, manifestPath, logger, input };
}

function readEvents(logger: ReturnType<typeof createLogger>): EventLogEntry[] {
  const text = readFileSync(logger.logFilePath, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventLogEntry);
}

test('runProjectManager: clean pass with 2 WIs succeeds — no retry', async () => {
  const h = setupHarness();
  try {
    const { queryFn, callCount } = makeStubQueryFn([
      {
        initiativeId: h.input.initiativeId,
        wis: [
          { wiId: 'WI-1' },
          { wiId: 'WI-2', filename: 'src/wi2.ts' },
        ],
      },
    ]);

    await runProjectManager(h.input, h.logger, { queryFn });

    assert.equal(callCount(), 1, 'expected exactly one SDK pass on a clean run');

    const events = readEvents(h.logger);
    const wiEmitted = events.filter((e) => e.message === 'pm.work-item-emitted');
    assert.equal(wiEmitted.length, 2, 'expected two pm.work-item-emitted events');
    // No empty-decomposition error
    assert.equal(
      events.filter((e) => e.message === 'pm.empty-decomposition').length,
      0,
    );
    // Decomposition doc written
    const decomp = readFileSync(resolve(h.worktree, '.forge', 'work-items', '_decomposition.md'), 'utf8');
    assert.match(decomp, /WI-1/);
    assert.match(decomp, /WI-2/);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('runProjectManager: zero WIs emitted → throws + emits pm.empty-decomposition (terminal)', async () => {
  const h = setupHarness();
  try {
    const { queryFn, callCount } = makeStubQueryFn([
      {
        initiativeId: h.input.initiativeId,
        wis: [], // PM emits nothing
      },
    ]);

    await assert.rejects(
      () => runProjectManager(h.input, h.logger, { queryFn }),
      /no work items emitted/,
    );
    assert.equal(callCount(), 1, 'expected exactly one SDK pass');

    const events = readEvents(h.logger);
    const terminal = events.find((e) => e.message === 'pm.empty-decomposition');
    assert.ok(terminal, 'expected terminal pm.empty-decomposition event');
    assert.equal(terminal.event_type, 'error');

    // Classifier picks this up as terminal.
    const classification = classifyCycleFailure(events);
    assert.equal(classification.kind, 'terminal');
    assert.equal(classification.recoverable, false);
    assert.match(classification.reason, /zero work items|PM emitted zero/i);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('runProjectManager: single WI with explicit depends_on = [] succeeds', async () => {
  const h = setupHarness();
  try {
    const { queryFn } = makeStubQueryFn([
      {
        initiativeId: h.input.initiativeId,
        wis: [{ wiId: 'WI-1', dependsOn: [] }],
      },
    ]);

    await runProjectManager(h.input, h.logger, { queryFn });

    const events = readEvents(h.logger);
    const end = events.find((e) => e.event_type === 'end' && e.phase === 'project-manager');
    assert.ok(end, 'expected pm end event on success');
    assert.equal((end.metadata as { work_item_count: number }).work_item_count, 1);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
