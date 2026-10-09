/**
 * Red-first tests for the pre-claim demo-checkpoint producibility check
 * (bead forge-8vfn.8.5.18, T1 ruling 1973cf — row 182).
 *
 * Covers:
 *   A. acDerivedCheckpointCommands — flattens + labels AC-derived commands,
 *      skipping criteria that name no drivable command.
 *   B. demoCheckpointPreflightRefusal — the pure predicate:
 *      - a `code`-class WI naming a bare `gitpulse` (absent from PATH, not a
 *        project script) → refused, checkpoint named.
 *      - `npm run demo` (a declared package.json script) → ok.
 *      - `node dist/cli.js` (relative; argv[0] is `node`, on PATH) → ok.
 *      - the SAME unproducible command under a class that does not capture
 *        checkpoint evidence (`docs`) → ok (no false refusal).
 *      - no work items on disk yet → ok (nothing to check).
 *   C. validateClaimable wired end-to-end — the refusal surfaces as
 *      non-terminal with `blockedClauses: 'demo-checkpoint-producibility'`,
 *      and a producible set of checkpoints still lets the claim through.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acDerivedCheckpointCommands, demoCheckpointPreflightRefusal } from '../../demo-checkpoint-preflight.ts';
import { writeWorkItem, type WorkItem } from '../../work-item.ts';
import { plantDefinition } from '../test-fixtures/claim-project.ts';
import { validateClaimable, clearAllPendingRefusalLogs, type ClaimValidationResult } from '../../claim-validator.ts';
import { SCRATCH_PATHS } from '@forge/projects';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-demo-checkpoint-'));
}

/** A minimally-valid WorkItem (SPEC §3) — only the fields this check reads
 *  (`work_item_id`, `acceptance_criteria`) vary per test. */
function workItem(overrides: Partial<WorkItem> & { work_item_id: string }): WorkItem {
  return {
    initiative_id: 'INIT-2026-01-01-test',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'a precondition', when: 'something happens', then: 'an outcome' }],
    files_in_scope: ['src/a.ts'],
    estimated_iterations: 1,
    quality_gate_cmd: ['true'],
    body: '# A work item\n',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. acDerivedCheckpointCommands
// ---------------------------------------------------------------------------

test('acDerivedCheckpointCommands: labels "AC <n>: <WI-id>", skipping criteria with no drivable command', () => {
  const items: WorkItem[] = [
    workItem({
      work_item_id: 'WI-1',
      acceptance_criteria: [
        { given: 'g', when: 'the demo runs `gitpulse --status`', then: 't' },
        { given: 'g', when: 'the user reads the dashboard', then: 't' }, // no inline code → skipped
      ],
    }),
    workItem({
      work_item_id: 'WI-2',
      acceptance_criteria: [{ given: 'g', when: 'the CLI runs `npm run demo`', then: 't' }],
    }),
  ];
  const commands = acDerivedCheckpointCommands(items);
  assert.deepEqual(commands, [
    { label: 'AC 1: WI-1', command: 'gitpulse --status' },
    { label: 'AC 3: WI-2', command: 'npm run demo' }, // index counts the skipped AC too
  ]);
});

// ---------------------------------------------------------------------------
// B. demoCheckpointPreflightRefusal
// ---------------------------------------------------------------------------

test('demoCheckpointPreflightRefusal: a code-class WI naming a bare `gitpulse` (not on PATH) → refused, checkpoint named', () => {
  const worktree = tmpDir();
  try {
    writeWorkItem(
      workItem({
        work_item_id: 'WI-3',
        acceptance_criteria: [{ given: 'g', when: 'the demo capture runs `gitpulse --status`', then: 't' }],
      }),
      worktree,
    );
    const refusal = demoCheckpointPreflightRefusal(worktree, 'code');
    assert.notEqual(refusal, null, 'expected a refusal');
    assert.match(refusal!, /AC 1: WI-3/, 'must name the checkpoint');
    assert.match(refusal!, /gitpulse/, 'must name the unresolvable executable');
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

test('demoCheckpointPreflightRefusal: `npm run demo` (a declared package.json script) → ok', () => {
  const worktree = tmpDir();
  try {
    writeFileSync(join(worktree, 'package.json'), JSON.stringify({ scripts: { demo: 'echo demo' } }));
    writeWorkItem(
      workItem({
        work_item_id: 'WI-1',
        acceptance_criteria: [{ given: 'g', when: 'the demo capture runs `npm run demo`', then: 't' }],
      }),
      worktree,
    );
    assert.equal(demoCheckpointPreflightRefusal(worktree, 'code'), null);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

test('demoCheckpointPreflightRefusal: `node dist/cli.js` (relative; argv[0] `node` resolves on PATH) → ok', () => {
  const worktree = tmpDir();
  try {
    mkdirSync(join(worktree, 'dist'), { recursive: true });
    writeFileSync(join(worktree, 'dist', 'cli.js'), 'console.log("hi")\n');
    writeWorkItem(
      workItem({
        work_item_id: 'WI-1',
        acceptance_criteria: [{ given: 'g', when: 'the demo capture runs `node dist/cli.js`', then: 't' }],
      }),
      worktree,
    );
    assert.equal(demoCheckpointPreflightRefusal(worktree, 'code'), null);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

// forge-8vfn.30.9 — a bare head not on PATH but declared in package.json "bin".
function withBinWorktree(pkg: unknown, name: string, fn: (worktree: string) => void): void {
  const worktree = tmpDir();
  const savedPath = process.env.PATH;
  try {
    writeFileSync(join(worktree, 'package.json'), JSON.stringify(pkg));
    writeWorkItem(
      workItem({
        work_item_id: 'WI-3',
        acceptance_criteria: [{ given: 'g', when: `the demo capture runs \`${name} --version\``, then: 't' }],
      }),
      worktree,
    );
    process.env.PATH = join(worktree, 'no-such-dir'); // the name cannot be on PATH
    fn(worktree);
  } finally {
    process.env.PATH = savedPath;
    rmSync(worktree, { recursive: true, force: true });
  }
}

test('demoCheckpointPreflightRefusal: a bare `gp` declared in package.json bin (target not built yet) → ok', () => {
  withBinWorktree({ name: 'gitpulse', bin: { gp: './dist/cli.js' } }, 'gp', (worktree) => {
    assert.equal(demoCheckpointPreflightRefusal(worktree, 'code'), null);
  });
});

test('demoCheckpointPreflightRefusal: an undeclared bare name still refuses, naming both lookups', () => {
  withBinWorktree({ name: 'gitpulse', bin: { gp: './dist/cli.js' } }, 'other', (worktree) => {
    const refusal = demoCheckpointPreflightRefusal(worktree, 'code');
    assert.notEqual(refusal, null);
    assert.match(refusal!, /PATH/);
    assert.match(refusal!, /package\.json "bin"/);
  });
});

test('demoCheckpointPreflightRefusal: a declared bin that escapes the worktree refuses with the named reason', () => {
  for (const target of ['../evil.js', '/usr/bin/evil', './a/../../evil.js']) {
    withBinWorktree({ name: 'x', bin: { gp: target } }, 'gp', (worktree) => {
      const refusal = demoCheckpointPreflightRefusal(worktree, 'code');
      assert.notEqual(refusal, null, target);
      assert.match(refusal!, /bin is refused/, target);
    });
  }
});

test('demoCheckpointPreflightRefusal: a malformed package.json refuses (never read as "no bin")', () => {
  withBinWorktree({}, 'gp', (worktree) => {
    writeFileSync(join(worktree, 'package.json'), '{not json');
    const refusal = demoCheckpointPreflightRefusal(worktree, 'code');
    assert.match(refusal ?? '', /unreadable or malformed/);
  });
});

test('demoCheckpointPreflightRefusal: the SAME unproducible command under a class that does not capture checkpoints (docs) → ok', () => {
  const worktree = tmpDir();
  try {
    writeWorkItem(
      workItem({
        work_item_id: 'WI-3',
        acceptance_criteria: [{ given: 'g', when: 'the demo capture runs `gitpulse --status`', then: 't' }],
      }),
      worktree,
    );
    assert.equal(
      demoCheckpointPreflightRefusal(worktree, 'docs'),
      null,
      'only the installed table\'s checkpoint-capturing class (code) is checked — a docs claim must never be false-refused on this ground',
    );
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

test('demoCheckpointPreflightRefusal: no work items on disk yet → ok (nothing to check)', () => {
  const worktree = tmpDir();
  try {
    assert.equal(demoCheckpointPreflightRefusal(worktree, 'code'), null);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// C. validateClaimable wired end-to-end
// ---------------------------------------------------------------------------

const VALID_FLOW_YAML = `id: test-cycle
name: Test Cycle
version: 1
goal: Take an approved initiative to a merged PR.
project: null
kb: cycles
costCeilingUsd: 25
origin: seed
accepts: [code]
nodes:
  - { id: architect, gate: plan }
  - { id: pm, agent: project-manager }
  - { id: review, gate: verdict }
edges:
  - { from: architect, to: pm, artifact: plan }
  - { from: pm, to: review, artifact: work-items }
triggers: []
`;

function setupContractReadyProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-project', scripts: { test: 'node test.mjs' } }));
  writeFileSync(join(dir, '.gitignore'), SCRATCH_PATHS.join('\n') + '\n');
  writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n');
  const name = dir.split('/').pop()!;
  const centralBrain = join(dir, '..', '..', 'brain', 'projects', name);
  mkdirSync(centralBrain, { recursive: true });
  writeFileSync(join(centralBrain, 'profile.md'), '# Profile\n');
  // Studio-ready definition too (SPEC §6, forge-8vfn.30.4): the claim gate refuses what Studio shows unready.
  plantDefinition(dir);
}

function setupForgeRoot(dir: string, flowYaml: string): { forgeRoot: string; flowPath: string } {
  const flowDir = join(dir, 'studio', 'flows', 'test-cycle');
  mkdirSync(flowDir, { recursive: true });
  const flowPath = join(flowDir, 'flow.yaml');
  writeFileSync(flowPath, flowYaml);
  return { forgeRoot: dir, flowPath };
}

test('validateClaimable: an unproducible demo checkpoint → refused, non-terminal, blockedClauses names it', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot, flowPath } = setupForgeRoot(root, VALID_FLOW_YAML);
    const projectDir = join(root, 'projects', 'gitpulse');
    mkdirSync(projectDir, { recursive: true });
    setupContractReadyProject(projectDir);

    const worktree = join(root, 'worktrees', 'INIT-checkpoint-bad');
    mkdirSync(worktree, { recursive: true });
    writeWorkItem(
      workItem({
        work_item_id: 'WI-3',
        acceptance_criteria: [{ given: 'g', when: 'checkpoint "AC 13: WI-3" runs `gitpulse --status`', then: 't' }],
      }),
      worktree,
    );

    const result = validateClaimable('INIT-checkpoint-bad', projectDir, forgeRoot, 'code', flowPath, worktree);
    assert.ok(!result.ok, 'expected refusal');
    if (!result.ok) {
      assert.equal(result.terminal, false, 'a fixable checkpoint command must be non-terminal (leave in pending)');
      assert.equal(result.blockedClauses, 'demo-checkpoint-producibility');
      assert.match(result.reason, /gitpulse/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    clearAllPendingRefusalLogs();
  }
});

test('validateClaimable: a producible demo checkpoint (npm run demo, declared script) → ok', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot, flowPath } = setupForgeRoot(root, VALID_FLOW_YAML);
    const projectDir = join(root, 'projects', 'gitpulse-ok');
    mkdirSync(projectDir, { recursive: true });
    setupContractReadyProject(projectDir);

    const worktree = join(root, 'worktrees', 'INIT-checkpoint-ok');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'package.json'), JSON.stringify({ scripts: { demo: 'echo demo' } }));
    writeWorkItem(
      workItem({
        work_item_id: 'WI-1',
        acceptance_criteria: [{ given: 'g', when: 'the demo capture runs `npm run demo`', then: 't' }],
      }),
      worktree,
    );

    const result = validateClaimable('INIT-checkpoint-ok', projectDir, forgeRoot, 'code', flowPath, worktree);
    assert.ok(result.ok, `expected ok but got refused: ${!result.ok ? (result as Extract<ClaimValidationResult, { ok: false }>).reason : ''}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    clearAllPendingRefusalLogs();
  }
});
