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
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from '@forge/stations/testing';
import { createLogger, FORGE_ROOT, type EventLogEntry } from '@forge/kernel';
import type { CycleInput } from '../../cycle-context.ts';
import { classifyCycleFailure, loadAgentDefinition, skillPath } from '@forge/agents';

// Seam F4: this file lives in packages/flows and may not reach into
// packages/stations' own test-fixtures (package-layer-order) — loads the
// canonical project-manager def itself via @forge/agents (rank-safe).
const canonicalDef = (slug: string) => loadAgentDefinition(skillPath(slug));

const DEFAULT_INITIATIVE_ID = 'INIT-2026-05-20-pm-decomp-test';

function manifestBody(initiativeId: string): string {
  return `---
initiative_id: ${initiativeId}
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-05-20T00:00:00Z
iteration_budget: 3
cost_budget_usd: 1
class: code
phase: in-flight
origin: architect
---

# Test initiative

## Acceptance criteria

Given a user is authenticated, when they request /api/health, then the response is 200.

Given no Authorization header, when /api/data is requested, then the response is 401.
`;
}

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

/**
 * `initiativeId` is parametrized (default: the original hardcoded literal,
 * unchanged for every pre-existing test) so a test that needs a NAME NO
 * OTHER TEST IN THIS FILE HAS EVER USED — the `_logs` residue test below —
 * can ask for one. All four tests otherwise share one process, and
 * `runProjectManager` derives `runAgent`'s `runId` (and therefore any
 * spawn-marker dir name) from `cycleId` (forge-8vfn.8.1.17), which this
 * harness mints as `<ts>_<initiativeId>`; reusing the same literal
 * initiativeId across tests would still let an EARLIER test's residue
 * already be present in a LATER test's own before-snapshot, silently
 * defeating the very check it exists to make.
 */
function setupHarness(initiativeId: string = DEFAULT_INITIATIVE_ID): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-decomp-'));
  const worktree = join(dir, 'projects', 'testproj');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(
    join(worktree, 'package.json'),
    JSON.stringify({ name: 'testproj', version: '0.0.1', scripts: { test: 'echo no tests' } }, null, 2),
  );
  const manifestPath = join(dir, '_queue', 'in-flight', `${initiativeId}.md`);
  mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(manifestPath, manifestBody(initiativeId));
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-cycle-decomp', logsDir);
  const input: CycleInput = {
    initiativeId,
    manifestPath,
    projectRepoPath: worktree,
    worktreePath: worktree,
    // forge-8vfn.8.1.17: runProjectManager requires a real cycleId now — it
    // embeds `initiativeId`, so the uniqueness this file's setupHarness doc
    // relies on (see above) still holds for the runId-derived marker dir.
    cycleId: `2026-05-20T00-00-00_${initiativeId}`,
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

    await runProjectManager(h.input, h.logger, { agentDef: canonicalDef('project-manager'), queryFn });

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
      () => runProjectManager(h.input, h.logger, { agentDef: canonicalDef('project-manager'), queryFn }),
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

    // A one-WI decomposition reads the class table (the under-decomposed flag);
    // this test is about the depends_on shape, so any bound table will do.
    const classProfiles = {
      profileFor: () => ({ singleWiAllowed: true }),
      readChangeClass: () => 'code',
      isChangeClass: (v: unknown) => v === 'code',
      hollowGateGuardFor: () => false,
    } as unknown as NonNullable<NonNullable<Parameters<typeof runProjectManager>[2]>['classProfiles']>;
    await runProjectManager(h.input, h.logger, { agentDef: canonicalDef('project-manager'), queryFn, classProfiles });

    const events = readEvents(h.logger);
    const end = events.find((e) => e.event_type === 'end' && e.phase === 'project-manager');
    assert.ok(end, 'expected pm end event on success');
    assert.equal((end.metadata as { work_item_count: number }).work_item_count, 1);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

/**
 * Every top-level entry name directly under THIS REPO's own `_logs/` (never
 * the harness's tmpdir one) — before/after, never "must be empty": a real
 * checkout legitimately carries real `_logs/INIT-*` dirs from real forge
 * runs, so only entries that APPEAR during this test count as a violation.
 */
function repoLogsEntries(): Set<string> {
  try {
    return new Set(readdirSync(join(FORGE_ROOT, '_logs')));
  } catch {
    return new Set(); // no _logs/ at all yet — a fresh checkout, not a violation
  }
}

test(
  "runProjectManager: never writes into the repo's own _logs (forge-8vfn.8.1.10) — " +
    "setupHarness's tmpdir logger must be the ONLY place the run's spawn marker lands",
  async () => {
    const before = repoLogsEntries();
    // A name NEVER used by any other test in this file or any prior run of
    // this one (see `setupHarness`'s doc) — otherwise an earlier test's own
    // residue would already sit in `before`, and this check would silently
    // pass over a real leak.
    const h = setupHarness(`INIT-2026-05-20-pm-decomp-residue-${randomUUID()}`);
    try {
      const { queryFn } = makeStubQueryFn([
        {
          initiativeId: h.input.initiativeId,
          // Two WIs (not one) — a single-WI decomposition also needs a bound
          // `ClassProfilePort` (see the depends_on=[] test above); this test
          // is about `_logs` residue, not that gate, so it reuses the
          // no-classProfiles-needed shape the first test already proved.
          wis: [{ wiId: 'WI-1' }, { wiId: 'WI-2', filename: 'src/wi2.ts' }],
        },
      ]);
      await runProjectManager(h.input, h.logger, { agentDef: canonicalDef('project-manager'), queryFn });

      const after = repoLogsEntries();
      const created = [...after].filter((name) => !before.has(name));
      assert.deepEqual(
        created,
        [],
        `runProjectManager must not create anything under this repo's own _logs/ — its ` +
          `harness logger (setupHarness) is rooted in a tmpdir, and runAgent's spawn marker ` +
          `must follow the injected logger, not <FORGE_ROOT>/_logs. Found: ${created.join(', ')}`,
      );
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  },
);
