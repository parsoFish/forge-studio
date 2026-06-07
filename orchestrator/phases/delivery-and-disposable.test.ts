/**
 * Phase F:
 *  - emitDeliverySummary (cascade-v4 #1): the git-derived delivery ground truth
 *    the reflector grounds on instead of stale per-WI status.
 *  - manifest `disposable` round-trip (cascade-v4 #7): throwaway cycles skip
 *    durable reflection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { collectMissingDeliveries, emitDeliverySummary, prBodyHasGitTruthSections, unifierIterationCap } from './developer-loop.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';
import type { CycleInput } from '../cycle-context.ts';
import { parseManifest, serializeManifest } from '../manifest.ts';

function deliveryHarness(): {
  input: CycleInput;
  logger: ReturnType<typeof createLogger>;
  git: (args: string[]) => string;
  events: () => EventLogEntry[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-delivered-'));
  const wt = join(dir, 'wt');
  mkdirSync(wt, { recursive: true });
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' }).toString();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(wt, 'base.txt'), 'base\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-delivered', logsDir);
  const input: CycleInput = {
    initiativeId: 'INIT-2026-06-01-delivered',
    manifestPath: join(dir, 'm.md'),
    projectRepoPath: wt,
    worktreePath: wt,
  };
  return {
    input,
    logger,
    git,
    events: () =>
      readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('emitDeliverySummary: reports the branch git diff-stat as ground truth (files + insertions > 0)', () => {
  const h = deliveryHarness();
  try {
    h.git(['checkout', '-q', '-b', 'init/x']);
    writeFileSync(join(h.input.worktreePath, 'feature.ts'), Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join('\n') + '\n');
    h.git(['add', '-A']);
    h.git(['commit', '-q', '-m', 'feat: real work']);

    emitDeliverySummary(h.input, h.logger, 'evt');
    const d = h.events().find((e) => e.message === 'dev-loop.delivered');
    assert.ok(d, 'expected dev-loop.delivered event');
    const md = d.metadata as { files_changed: number; insertions: number; commits: number; base: string };
    assert.equal(md.base, 'main');
    assert.ok(md.files_changed >= 1, `files_changed should be >=1, got ${md.files_changed}`);
    assert.ok(md.insertions >= 20, `insertions should be >=20, got ${md.insertions}`);
    assert.ok(md.commits >= 1, `commits should be >=1, got ${md.commits}`);
  } finally {
    h.cleanup();
  }
});

test('emitDeliverySummary: an empty branch reports zeros (the genuine no-delivery case)', () => {
  const h = deliveryHarness();
  try {
    h.git(['checkout', '-q', '-b', 'init/empty']); // no commits beyond base
    emitDeliverySummary(h.input, h.logger, 'evt');
    const d = h.events().find((e) => e.message === 'dev-loop.delivered');
    assert.ok(d);
    const md = d.metadata as { files_changed: number; commits: number };
    assert.equal(md.files_changed, 0);
    assert.equal(md.commits, 0);
  } finally {
    h.cleanup();
  }
});

test('unifierIterationCap: a trivial 1-file diff caps low', () => {
  const h = deliveryHarness();
  try {
    h.git(['checkout', '-q', '-b', 'init/x']);
    writeFileSync(join(h.input.worktreePath, 'one.ts'), 'export const a = 1;\n');
    h.git(['add', '-A']);
    h.git(['commit', '-q', '-m', 'trivial']);
    assert.equal(unifierIterationCap(h.input.worktreePath), 4, '≤2 files ⇒ tight cap');
  } finally {
    h.cleanup();
  }
});

test('unifierIterationCap: a mid-size diff (5 files) gets the middle cap', () => {
  const h = deliveryHarness();
  try {
    h.git(['checkout', '-q', '-b', 'init/x']);
    for (let i = 0; i < 5; i++) writeFileSync(join(h.input.worktreePath, `f${i}.ts`), `export const x${i} = ${i};\n`);
    h.git(['add', '-A']);
    h.git(['commit', '-q', '-m', '5 files']);
    assert.equal(unifierIterationCap(h.input.worktreePath), 8, '3–10 files ⇒ middle cap');
  } finally {
    h.cleanup();
  }
});

test('manifest: disposable round-trips through parse + serialize', () => {
  const md = [
    '---',
    'initiative_id: INIT-2026-06-01-verify',
    'project: demo',
    'created_at: 2026-06-01T00:00:00Z',
    'iteration_budget: 3',
    'cost_budget_usd: 1',
    'phase: pending',
    'disposable: true',
    '---',
    '',
    '# verification throwaway',
    '',
  ].join('\n');
  const parsed = parseManifest(md);
  assert.equal(parsed.disposable, true);
  const round = parseManifest(serializeManifest(parsed));
  assert.equal(round.disposable, true, 'disposable must survive a serialize→parse round-trip');
});

test('manifest: absent disposable ⇒ undefined (normal reflection)', () => {
  const md = [
    '---',
    'initiative_id: INIT-2026-06-01-normal',
    'project: demo',
    'created_at: 2026-06-01T00:00:00Z',
    'iteration_budget: 3',
    'cost_budget_usd: 1',
    'phase: pending',
    '---',
    '',
    '# normal',
    '',
  ].join('\n');
  assert.equal(parseManifest(md).disposable, undefined);
});

// -------------------------------------------------------------------------
// Wave B (2026-06-04): collectMissingDeliveries — incomplete-delivery gate
// -------------------------------------------------------------------------

/**
 * Build a minimal git repo + WI directory for the incomplete-delivery tests.
 *
 * Returns { worktreePath, workItemsDir, git, cleanup }.
 */
function missingDeliveryHarness(committedFiles: string[] = []): {
  worktreePath: string;
  workItemsDir: string;
  git: (...args: string[]) => void;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-missing-del-'));
  const wiDir = join(dir, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');

  // Baseline commit on main.
  writeFileSync(join(dir, 'README.md'), '# baseline\n');
  git('add', 'README.md');
  git('commit', '-m', 'baseline');
  git('checkout', '-b', 'forge/wi-test');

  // Commit the requested files onto the branch.
  for (const f of committedFiles) {
    const fp = join(dir, f);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, `// ${f}\n`);
    git('add', f);
  }
  if (committedFiles.length > 0) {
    git('commit', '-m', 'branch work');
  }

  return {
    worktreePath: dir,
    workItemsDir: wiDir,
    git,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Write a minimal WI YAML file with optional creates[] entries. */
function writeWI(
  wiDir: string,
  id: string,
  creates: string[],
): void {
  const createsYaml =
    creates.length > 0
      ? `creates:\n${creates.map((p) => `  - ${p}`).join('\n')}\n`
      : '';
  const yaml = [
    '---',
    `work_item_id: ${id}`,
    'initiative_id: INIT-2026-06-04-test',
    'status: pending',
    'acceptance_criteria:',
    '  - given: "a clean tree"',
    '    when: "gate runs"',
    '    then: "it passes"',
    `files_in_scope:\n${creates.map((p) => `  - ${p}`).join('\n') || '  - README.md'}`,
    createsScrubbed(createsYaml),
    'quality_gate_cmd: ["true"]',
    'estimated_iterations: 1',
    'depends_on: []',
    '---',
    `# ${id}`,
    '',
  ].join('\n');
  writeFileSync(join(wiDir, `${id}.md`), yaml);
}

function createsScrubbed(s: string): string {
  // Return empty string if no creates — avoids a blank "creates:" line
  return s.trimEnd();
}

test('collectMissingDeliveries: all declared creates[] present in diff → no missing', () => {
  const { worktreePath, workItemsDir, cleanup } = missingDeliveryHarness(['pkg/resource.go', 'pkg/resource_test.go']);
  try {
    writeWI(workItemsDir, 'WI-1', ['pkg/resource.go', 'pkg/resource_test.go']);
    const result = collectMissingDeliveries(worktreePath, workItemsDir);
    if (result.indeterminate) throw new Error(`unexpected indeterminate: ${result.reason}`);
    assert.deepEqual(result.missing, [], `expected no missing deliveries, got ${JSON.stringify(result.missing)}`);
  } finally {
    cleanup();
  }
});

test('collectMissingDeliveries: a creates[] path absent from diff → returns it', () => {
  // Branch has resource.go but NOT resource_test.go
  const { worktreePath, workItemsDir, cleanup } = missingDeliveryHarness(['pkg/resource.go']);
  try {
    writeWI(workItemsDir, 'WI-1', ['pkg/resource.go', 'pkg/resource_test.go']);
    const result = collectMissingDeliveries(worktreePath, workItemsDir);
    if (result.indeterminate) throw new Error(`unexpected indeterminate: ${result.reason}`);
    assert.equal(result.missing.length, 1, `expected 1 missing, got ${JSON.stringify(result.missing)}`);
    assert.equal(result.missing[0]?.work_item_id, 'WI-1');
    assert.equal(result.missing[0]?.path, 'pkg/resource_test.go');
  } finally {
    cleanup();
  }
});

test('collectMissingDeliveries: WI with empty creates is exempt', () => {
  // Branch has nothing new, but WI-1 has no creates[] — exempt
  const { worktreePath, workItemsDir, cleanup } = missingDeliveryHarness([]);
  try {
    writeWI(workItemsDir, 'WI-1', []); // no creates
    const result = collectMissingDeliveries(worktreePath, workItemsDir);
    if (result.indeterminate) throw new Error(`unexpected indeterminate: ${result.reason}`);
    assert.deepEqual(result.missing, [], 'WI with no creates should not be flagged');
  } finally {
    cleanup();
  }
});

// re-review #2: the delivery check is the LAST backstop for a hollow PR, so it
// must fail CLOSED — an uncomputable check (non-git worktree / no base branch)
// returns `indeterminate`, which the unifier gate treats as a block, NOT the old
// fail-open `[]` that silently let a possibly-incomplete delivery through.
test('collectMissingDeliveries: fails CLOSED (indeterminate) when the base branch cannot be determined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-no-git-'));
  const wiDir = join(dir, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });
  try {
    const result = collectMissingDeliveries(dir, wiDir); // not a git repo → cannot verify
    assert.equal(result.indeterminate, true, 'a non-git worktree must be indeterminate, not silently empty');
    if (result.indeterminate) assert.match(result.reason, /cannot verify delivery/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------
// prBodyHasGitTruthSections — the pr_self_contained body check (2026-06-04).
// The unifier authors `## Why`/`## What`/`## How` and is told NOT to add a
// `## Demo` heading (pr.ts appends that at PR-open). The gate must validate
// the git-truth shape, never `## Demo` — asserting `## Demo` was unwinnable
// and false-failed the release_folder re-run (burned the unifier budget).
// -------------------------------------------------------------------------

test('prBodyHasGitTruthSections: the real unifier-authored Why/What/How body passes', () => {
  const body = [
    '## Why',
    '',
    'Azure DevOps release pipelines are organised into folder hierarchies. Before this change betterado could not manage them via Terraform.',
    '',
    '## What',
    '',
    '- `betterado_release_folder` resource with full CRUD.',
    '- Provider registration + 5 gomock unit tests.',
    '',
    '## How',
    '',
    'Follows the established resource_release_definition.go pattern (schema → expand/flatten → CRUD).',
    '',
  ].join('\n');
  assert.equal(prBodyHasGitTruthSections(body), true);
});

test('prBodyHasGitTruthSections: a body WITHOUT `## Demo` is still valid (the regression)', () => {
  // This is the exact shape the agent is instructed to produce; the old gate
  // (`/^## Demo\\b/m`) rejected it and burned the whole unifier budget.
  const body = [
    '## Why',
    'Operators previously had no Terraform-managed way to create release folders, so IaC rollouts were incomplete and manual.',
    '## What',
    'A new `betterado_release_folder` resource with full CRUD, provider registration, and five gomock unit tests covering create/read/update/delete.',
    '## How',
    'Follows the established resource pattern: schema, expand/flatten, CRUD against the existing mocked ReleaseClient. No new client plumbing.',
  ].join('\n\n');
  assert.equal(prBodyHasGitTruthSections(body), true);
  assert.ok(!/^## Demo\b/m.test(body), 'fixture deliberately has no ## Demo heading');
});

test('prBodyHasGitTruthSections: a stub / empty body is rejected', () => {
  assert.equal(prBodyHasGitTruthSections(''), false);
  assert.equal(prBodyHasGitTruthSections('## What\n\nx\n'), false, 'too short + no Why/How');
  assert.equal(prBodyHasGitTruthSections('## Demo\n\njust a demo link, no real body'), false, '## Demo alone is not a self-contained body');
});

test('collectMissingDeliveries: multiple WIs — only the one with missing paths reported', () => {
  const { worktreePath, workItemsDir, cleanup } = missingDeliveryHarness(['pkg/impl.go']);
  try {
    writeWI(workItemsDir, 'WI-1', ['pkg/impl.go']);          // present → ok
    writeWI(workItemsDir, 'WI-2', ['pkg/impl_test.go']);     // absent → missing
    const result = collectMissingDeliveries(worktreePath, workItemsDir);
    if (result.indeterminate) throw new Error(`unexpected indeterminate: ${result.reason}`);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]?.work_item_id, 'WI-2');
    assert.equal(result.missing[0]?.path, 'pkg/impl_test.go');
  } finally {
    cleanup();
  }
});
