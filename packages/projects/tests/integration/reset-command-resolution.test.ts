/**
 * DEFECT 1 + DEFECT 2 fixes (found running `forge project reset --apply`
 * against a real project, gitpulse):
 *
 *   DEFECT 1 — the contract Rebuild's template merge ADDED
 *   `testProcess.ci: { cmd: ["npm","run","ci"] }` to `.forge/project.json`
 *   even though the project's `package.json` had no `"ci"` script — a
 *   declared command nothing can ever run. `computeContractDrift` must never
 *   turn a template-supplied command into an `'add'` row unless it actually
 *   RESOLVES in the project; when it doesn't, the row stays `'unchanged'` and
 *   a named `CommandAdvisory` says which command and why.
 *
 *   DEFECT 2 — `.gitignore` drift always read as "a tracked-config line ...
 *   is being replaced", even for a pure APPEND of missing `SCRATCH_PATHS`
 *   entries with no tracked-config line involved. `GitignoreDrift.message`
 *   must name which case happened, and list the appended entries.
 *
 * Fixtures follow `reset-drift-report.test.ts`'s own patterns
 * (`isolatedForgeRoot`, `projectWithGitignore`) — this file sits beside it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeContractDrift, applyContractReset } from '../../reset.ts';
import { SCRATCH_PATHS } from '../../preflight.ts';
import { projectStartersDir, FORGE_ROOT } from '@forge/kernel';

function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'reset-cmdres-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return root;
}

/** A gitpulse-shaped cli project: no persisted appType (the explicit
 *  `--app-type cli` an operator supplies), `package.json` scripts as given —
 *  or no `package.json` at all when `scripts` is `undefined`. */
function cliProject(scripts: Record<string, string> | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-cmdres-project-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify({ name: 'gitpulse-shaped', testProcess: { local: { cmd: ['npm', 'test'] } } }, null, 2)}\n`,
    'utf8',
  );
  if (scripts) {
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'gitpulse-shaped', scripts }, null, 2)}\n`, 'utf8');
  }
  return dir;
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// DEFECT 1 — (a) no "ci" script: no 'add', a named advisory, apply writes nothing
// ---------------------------------------------------------------------------

test('DEFECT 1 (a): a cli project whose package.json lacks "ci" gets NO testProcess.ci add, plus a named advisory; apply writes nothing for it', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = cliProject({ build: 'tsc', test: 'node --test', acceptance: 'node --test acceptance', demo: 'node demo.js' });
  try {
    const drift = computeContractDrift(dir, { forgeRoot, appType: 'cli' });

    const ciRow = drift.rows.find((r) => r.section === 'testProcess.ci');
    assert.ok(ciRow, 'expected a testProcess.ci row');
    assert.equal(ciRow!.action, 'unchanged', 'an unresolvable command must never be reported as add');
    assert.equal(ciRow!.after, undefined, 'nothing is proposed to write when the command cannot resolve');

    assert.equal(drift.commandAdvisories.length, 1, `expected exactly one advisory: ${JSON.stringify(drift.commandAdvisories)}`);
    const advisory = drift.commandAdvisories[0]!;
    assert.equal(advisory.section, 'testProcess.ci');
    assert.match(advisory.message, /testProcess\.ci/);
    assert.match(advisory.message, /"npm run ci"/);
    assert.match(advisory.message, /no "ci" script in package\.json/);

    const result = applyContractReset(dir, drift);
    assert.ok(!result.applied.some((r) => r.section === 'testProcess.ci'), 'testProcess.ci must not be in the applied set');

    const written = JSON.parse(readFileSync(join(dir, '.forge', 'project.json'), 'utf8')) as { testProcess?: { ci?: unknown } };
    assert.equal(written.testProcess?.ci, undefined, 'project.json must carry no testProcess.ci after apply');
  } finally {
    cleanup(forgeRoot, dir);
  }
});

// ---------------------------------------------------------------------------
// DEFECT 1 — (b) a "ci" script present: the add happens as before
// ---------------------------------------------------------------------------

test('DEFECT 1 (b): a cli project WITH a "ci" script gets the testProcess.ci add, no advisory', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = cliProject({ test: 'node --test', ci: 'node --test && eslint .' });
  try {
    const drift = computeContractDrift(dir, { forgeRoot, appType: 'cli' });

    const ciRow = drift.rows.find((r) => r.section === 'testProcess.ci');
    assert.ok(ciRow, 'expected a testProcess.ci row');
    assert.equal(ciRow!.action, 'add');
    assert.deepEqual(ciRow!.after, { cmd: ['npm', 'run', 'ci'] });
    assert.equal(
      drift.commandAdvisories.filter((a) => a.section === 'testProcess.ci').length,
      0,
      'a resolvable command must never raise an advisory',
    );

    const result = applyContractReset(dir, drift);
    assert.ok(result.applied.some((r) => r.section === 'testProcess.ci'));
    const written = JSON.parse(readFileSync(join(dir, '.forge', 'project.json'), 'utf8')) as { testProcess?: { ci?: unknown } };
    assert.deepEqual(written.testProcess?.ci, { cmd: ['npm', 'run', 'ci'] });
  } finally {
    cleanup(forgeRoot, dir);
  }
});

// ---------------------------------------------------------------------------
// DEFECT 2 — (c) append-only case names itself and lists the entries
// ---------------------------------------------------------------------------

test('DEFECT 2 (c): an append-only .gitignore drift (no tracked-config line involved) says APPEND and lists the entries', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-cmdres-nostarters-'));
  const dir = mkdtempSync(join(tmpdir(), 'reset-cmdres-gi-append-'));
  try {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      `${JSON.stringify({ name: 'gi-append-fixture', testProcess: { local: { cmd: ['true'] } } }, null, 2)}\n`,
    );

    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.gitignoreDrift.action, 'regenerate');
    assert.match(drift.gitignoreDrift.message ?? '', /append/i, `expected an APPEND message: ${drift.gitignoreDrift.message}`);
    for (const p of SCRATCH_PATHS) {
      assert.ok(
        (drift.gitignoreDrift.message ?? '').includes(p),
        `append message must list the entry "${p}": ${drift.gitignoreDrift.message}`,
      );
    }
  } finally {
    cleanup(forgeRoot, dir);
  }
});

// ---------------------------------------------------------------------------
// DEFECT 2 — (d) the replace case's message is unchanged
// ---------------------------------------------------------------------------

test('DEFECT 2 (d): a replace case (a tracked-config line to swap out) keeps the original message', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-cmdres-nostarters-'));
  const dir = mkdtempSync(join(tmpdir(), 'reset-cmdres-gi-replace-'));
  try {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n# forge scratch — DO NOT EDIT\n.forge/\ndist/\n');
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      `${JSON.stringify({ name: 'gi-replace-fixture', testProcess: { local: { cmd: ['true'] } } }, null, 2)}\n`,
    );

    const drift = computeContractDrift(dir, { forgeRoot });
    assert.equal(drift.gitignoreDrift.action, 'regenerate');
    assert.equal(
      drift.gitignoreDrift.message,
      'a tracked-config line (e.g. a blanket .forge/) is being replaced with the canonical scratch stanza',
    );
  } finally {
    cleanup(forgeRoot, dir);
  }
});
