/**
 * Setup tests for benchmarks/e2e/sdk.ts. Verifies tempdir layout (symlinks,
 * git init, manifest copy, shim wiring) and the gh shim's pr create + merge
 * flow without making any SDK calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  cleanupTempdir,
  readGhMetadata,
  setupTempdir,
  type RunE2eInput,
} from './sdk.ts';

const FIXTURE_MANIFEST = `---
initiative_id: INIT-2026-05-09-test
project: testproj
project_repo_path: /tmp/testproj
created_at: 2026-05-09T00:00:00Z
iteration_budget: 50
cost_budget_usd: 25
phase: in-flight
features:
  - feature_id: FEAT-1
    title: x
    depends_on: []
---

# Test initiative
`;

function makeFixture(): { seed: string; manifestPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-e2e-fixt-'));
  const seed = join(root, 'seed');
  mkdirSync(join(seed, 'src'), { recursive: true });
  writeFileSync(join(seed, 'src', 'index.ts'), 'export {};\n');
  writeFileSync(join(seed, 'package.json'), '{"name":"testproj","type":"module","version":"0.0.0"}\n');
  const manifestPath = join(root, 'manifest.md');
  writeFileSync(manifestPath, FIXTURE_MANIFEST);
  return { seed, manifestPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function baseInput(opts: { seed: string; manifestPath: string }): RunE2eInput {
  return {
    fixtureId: 't',
    initiativeId: 'INIT-2026-05-09-test',
    seedTreePath: opts.seed,
    manifestPath: opts.manifestPath,
    projectName: 'testproj',
    spec: {
      manifest_ac_command: ['true'],
      non_functional_checks: [],
      required_pr_signals: [],
    },
  };
}

test('setupTempdir: symlinks core dirs, copies seed, copies manifest, writes shims', () => {
  const { seed, manifestPath, cleanup } = makeFixture();
  try {
    const td = setupTempdir(baseInput({ seed, manifestPath }));
    try {
      for (const sub of ['brain', 'skills', 'docs', 'orchestrator', 'loops']) {
        assert.ok(existsSync(resolve(td, sub)), `${sub} symlink present`);
      }
      assert.ok(existsSync(resolve(td, 'projects', 'testproj', 'src', 'index.ts')));
      assert.ok(existsSync(resolve(td, '_queue', 'in-flight', 'INIT-2026-05-09-test.md')));
      assert.ok(existsSync(resolve(td, 'bin', 'gh')));
      assert.ok(existsSync(resolve(td, 'bin', 'vhs')));
      assert.ok(existsSync(resolve(td, 'bin', 'npx')));
      // queue destination dirs exist
      for (const q of ['pending', 'ready-for-review', 'done', 'failed']) {
        assert.ok(existsSync(resolve(td, '_queue', q)), `_queue/${q} dir present`);
      }
    } finally {
      cleanupTempdir(td);
    }
  } finally {
    cleanup();
  }
});

test('setupTempdir: project is a real git repo with main + initiative branch', () => {
  const { seed, manifestPath, cleanup } = makeFixture();
  try {
    const td = setupTempdir(baseInput({ seed, manifestPath }));
    try {
      const projDir = resolve(td, 'projects', 'testproj');
      assert.ok(existsSync(resolve(projDir, '.git')), 'projDir is a git repo');
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projDir,
        encoding: 'utf8',
      }).trim();
      assert.equal(branch, 'initiative-INIT-2026-05-09-test');
      const branches = execFileSync('git', ['branch', '--list'], {
        cwd: projDir,
        encoding: 'utf8',
      });
      assert.match(branches, /main/);
      assert.match(branches, /initiative-INIT-2026-05-09-test/);
    } finally {
      cleanupTempdir(td);
    }
  } finally {
    cleanup();
  }
});

test('gh shim: pr create writes metadata and emits a fake URL', () => {
  const { seed, manifestPath, cleanup } = makeFixture();
  try {
    const td = setupTempdir(baseInput({ seed, manifestPath }));
    try {
      const projDir = resolve(td, 'projects', 'testproj');
      const bodyFile = join(projDir, 'pr-body.md');
      writeFileSync(bodyFile, '## Why\nbecause\n');
      const out = execFileSync(
        resolve(td, 'bin', 'gh'),
        ['pr', 'create', '--body-file', bodyFile, '--title', 'Test PR'],
        { cwd: projDir, encoding: 'utf8' },
      );
      assert.match(out, /^https:\/\/bench\.local/);
      const meta = readGhMetadata(td);
      assert.ok(meta);
      assert.equal(meta!.created, true);
      assert.equal(meta!.merged, false);
      assert.match(meta!.body!, /because/);
    } finally {
      cleanupTempdir(td);
    }
  } finally {
    cleanup();
  }
});

test('gh shim: pr merge fast-forwards initiative branch into main', () => {
  const { seed, manifestPath, cleanup } = makeFixture();
  try {
    const td = setupTempdir(baseInput({ seed, manifestPath }));
    try {
      const projDir = resolve(td, 'projects', 'testproj');
      // First, make a commit on the initiative branch.
      writeFileSync(join(projDir, 'src', 'new.ts'), 'export const x = 1;\n');
      execFileSync('git', ['add', '-A'], { cwd: projDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-q', '-m', 'feat: new'], { cwd: projDir, stdio: 'pipe' });

      // PR create
      execFileSync(
        resolve(td, 'bin', 'gh'),
        ['pr', 'create', '--body-file', join(projDir, 'src', 'new.ts'), '--title', 'PR'],
        { cwd: projDir, stdio: 'pipe' },
      );

      // PR merge
      const out = execFileSync(
        resolve(td, 'bin', 'gh'),
        ['pr', 'merge', '--merge', '--delete-branch'],
        { cwd: projDir, encoding: 'utf8' },
      );
      assert.match(out, /Merged initiative-/);

      // Main should now contain the new file.
      execFileSync('git', ['checkout', '-q', 'main'], { cwd: projDir, stdio: 'pipe' });
      assert.ok(existsSync(join(projDir, 'src', 'new.ts')));

      const meta = readGhMetadata(td);
      assert.ok(meta);
      assert.equal(meta!.merged, true);
      assert.match(meta!.mergedBranch ?? '', /^initiative-/);
    } finally {
      cleanupTempdir(td);
    }
  } finally {
    cleanup();
  }
});

test('gh shim: pr merge without prior pr create exits non-zero', () => {
  const { seed, manifestPath, cleanup } = makeFixture();
  try {
    const td = setupTempdir(baseInput({ seed, manifestPath }));
    try {
      const projDir = resolve(td, 'projects', 'testproj');
      let threw = false;
      try {
        execFileSync(resolve(td, 'bin', 'gh'), ['pr', 'merge', '--merge'], {
          cwd: projDir,
          stdio: 'pipe',
        });
      } catch {
        threw = true;
      }
      assert.equal(threw, true);
    } finally {
      cleanupTempdir(td);
    }
  } finally {
    cleanup();
  }
});

test('gh shim: unsupported subcommand exits non-zero', () => {
  const { seed, manifestPath, cleanup } = makeFixture();
  try {
    const td = setupTempdir(baseInput({ seed, manifestPath }));
    try {
      let threw = false;
      try {
        execFileSync(resolve(td, 'bin', 'gh'), ['repo', 'view'], { stdio: 'pipe' });
      } catch {
        threw = true;
      }
      assert.equal(threw, true);
    } finally {
      cleanupTempdir(td);
    }
  } finally {
    cleanup();
  }
});

test('readGhMetadata: missing file returns null', () => {
  assert.equal(readGhMetadata('/nonexistent'), null);
});
