/**
 * Unit tests for packages/projects/project-config.ts — the BARREL: load-path
 * mechanics (`loadProjectConfig` file-absent / malformed-JSON / happy-path),
 * `PROJECT_CONFIG_REL_PATH`, the AGENTS.md/CLAUDE.md agent-instruction-file
 * binding (`AGENT_INSTRUCTION_FILES` + `readAgentInstructionsFile`, Stage A
 * single-source), and the file-based round-trip cases for fields whose
 * shape-level validation is pinned elsewhere.
 *
 * The loader returns the parsed config when valid, returns null when the file
 * is absent (caller decides fail-closed), and throws when the file is present
 * but malformed (fail-closed per CONTRACTS.md C1 + council 04 F8).
 *
 * Split by concern when this file (originally 1,025 lines, 77 cases) grew
 * past the 800-line baseline cap — see scripts/baselines/file-size.json /
 * scripts/check-file-size.mjs, mirroring the production concern split:
 * `project-config-types.ts` (the `ProjectConfig` type family — no dedicated
 * type-only test content exists in this package, so no sibling test file was
 * created for it), `project-config-validate.ts` (the field parsers behind
 * `validateProjectConfig`) and `project-config-sidecar.ts` (the
 * `.forge/quality_gate_cmd` sidecar). Note `validateProjectConfig` itself
 * stays in the BARREL production file (project-config.ts) — see that file's
 * header for why (a literal circular-import avoidance) — so this test split
 * groups by call surface: every case here drives `loadProjectConfig` (or a
 * barrel-only constant), never `validateProjectConfig` directly. Siblings:
 * `project-config-validate.test.ts` (every direct `validateProjectConfig(...)`
 * case — testProcess.ci/acceptance shape, M2 fields, artifactRoot,
 * releaseProcess, buildProcess field validation, timeoutMs, flat-key
 * migration rejection, derivation equality), `project-config-sidecar.test.ts`
 * (the `.forge/quality_gate_cmd` single-sourcing interplay),
 * `project-config-repo.test.ts` (pre-existing — `repo:`/`REPO_RE` field
 * validation).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadProjectConfig,
  PROJECT_CONFIG_REL_PATH,
  readAgentInstructionsFile,
  AGENT_INSTRUCTION_FILES,
} from '../../project-config.ts';

function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-project-config-test-'));
}

function writeConfig(projectRoot: string, contents: string): void {
  const dir = join(projectRoot, '.forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), contents);
}

test('loadProjectConfig: returns null when .forge/project.json is missing', () => {
  const root = newTempDir();
  try {
    const cfg = loadProjectConfig(root);
    assert.equal(cfg, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: happy path — minimal valid config', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({
        testProcess: { local: { cmd: ['npm', 'test'] } },
      }),
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.deepEqual(cfg.quality_gate_cmd, ['npm', 'test']);
    assert.equal(cfg.metrics, undefined);
    assert.equal(cfg.sweep, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: throws when testProcess is missing', () => {
  const root = newTempDir();
  try {
    writeConfig(root, JSON.stringify({}));
    assert.throws(() => loadProjectConfig(root), /missing required `testProcess`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: optional metrics block round-trips', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({
        testProcess: { local: { cmd: ['true'] } },
        metrics: {
          command: ['bash', '-lc', 'node bench.js'],
          baselines_dir: 'docs/baselines/',
          tolerance_pct: 1.5,
        },
      }),
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg?.metrics);
    assert.deepEqual(cfg.metrics.command, ['bash', '-lc', 'node bench.js']);
    assert.equal(cfg.metrics.baselines_dir, 'docs/baselines/');
    assert.equal(cfg.metrics.tolerance_pct, 1.5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: optional sweep block round-trips', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({
        testProcess: { local: { cmd: ['go', 'test', './...'] } },
        sweep: {
          start_command: ['bash', '-lc', 'npm run preview'],
          draw_function: 'src/sweep/draw.ts',
          measurement_extractor: 'src/sweep/extract.ts',
        },
      }),
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg?.sweep);
    assert.equal(cfg.sweep.draw_function, 'src/sweep/draw.ts');
    assert.equal(cfg.sweep.measurement_extractor, 'src/sweep/extract.ts');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: throws on malformed JSON', () => {
  const root = newTempDir();
  try {
    writeConfig(root, '{ not json');
    assert.throws(() => loadProjectConfig(root), /JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: throws when neither testProcess.local.cmd nor sidecar is present', () => {
  const root = newTempDir();
  try {
    writeConfig(root, JSON.stringify({}));
    assert.throws(() => loadProjectConfig(root), /missing required `testProcess`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PROJECT_CONFIG_REL_PATH is `.forge/project.json` per C1', () => {
  assert.equal(PROJECT_CONFIG_REL_PATH, '.forge/project.json');
});

test('loadProjectConfig: ci_gate + ci_fix_cmd round-trip from project.json', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({
        testProcess: {
          local: { cmd: ['go', 'test', './...'] },
          ci: {
            cmd: ['bash', '-c', 'make test && golangci-lint run ./... && make terrafmt-check'],
            fixCmd: ['bash', '-c', 'make fmt && make terrafmt'],
          },
        },
      }),
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.deepEqual(cfg.ci_gate, [
      'bash',
      '-c',
      'make test && golangci-lint run ./... && make terrafmt-check',
    ]);
    assert.deepEqual(cfg.ci_fix_cmd, ['bash', '-c', 'make fmt && make terrafmt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: releaseProcess round-trips from project.json', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: {
          steps: [
            { kind: 'changelog', phase: 'pre-merge', text: 'Write a CHANGELOG entry.' },
          ],
          changelogPath: 'CHANGELOG.md',
        },
      }),
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg?.releaseProcess);
    assert.deepEqual(cfg.releaseProcess.steps, [
      { kind: 'changelog', phase: 'pre-merge', text: 'Write a CHANGELOG entry.' },
    ]);
    assert.equal(cfg.releaseProcess.changelogPath, 'CHANGELOG.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ----- AGENTS.md single-source binding (Stage A) -----

test('AGENT_INSTRUCTION_FILES prefers AGENTS.md over CLAUDE.md', () => {
  assert.deepEqual([...AGENT_INSTRUCTION_FILES], ['AGENTS.md', 'CLAUDE.md']);
});

test('readAgentInstructionsFile reads AGENTS.md (preferred) and trims', () => {
  const root = newTempDir();
  try {
    writeFileSync(join(root, 'AGENTS.md'), '\n# Agents\n\nBuild: npm test\n\n');
    const got = readAgentInstructionsFile(root);
    assert.equal(got?.file, 'AGENTS.md');
    assert.equal(got?.content, '# Agents\n\nBuild: npm test');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readAgentInstructionsFile falls back to CLAUDE.md when AGENTS.md absent', () => {
  const root = newTempDir();
  try {
    writeFileSync(join(root, 'CLAUDE.md'), '# Legacy instructions');
    const got = readAgentInstructionsFile(root);
    assert.equal(got?.file, 'CLAUDE.md');
    assert.equal(got?.content, '# Legacy instructions');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readAgentInstructionsFile returns null when neither file exists or content is empty', () => {
  const root = newTempDir();
  try {
    assert.equal(readAgentInstructionsFile(root), null);
    writeFileSync(join(root, 'AGENTS.md'), '   \n  ');
    assert.equal(readAgentInstructionsFile(root), null, 'empty/whitespace file is treated as absent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: AGENTS.md is the single source — its content overrides project.json instructions', () => {
  const root = newTempDir();
  try {
    writeConfig(root, JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } }, instructions: 'stale json instructions' }));
    writeFileSync(join(root, 'AGENTS.md'), '# Real instructions\n\nNever touch dist/.');
    const cfg = loadProjectConfig(root);
    assert.equal(cfg?.instructions, '# Real instructions\n\nNever touch dist/.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: project.json instructions is the legacy fallback when no AGENTS.md/CLAUDE.md', () => {
  const root = newTempDir();
  try {
    writeConfig(root, JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } }, instructions: 'json fallback' }));
    const cfg = loadProjectConfig(root);
    assert.equal(cfg?.instructions, 'json fallback');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: buildProcess round-trips (R1-04-F3)', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({
        testProcess: { local: { cmd: ['npm', 'test'] } },
        buildProcess: { local: ['npm', 'run', 'build'], remote: '.github/workflows/ci.yml' },
      }),
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.deepEqual(cfg.buildProcess, { local: ['npm', 'run', 'build'], remote: '.github/workflows/ci.yml' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: buildProcess absent → undefined (byte-compatible)', () => {
  const root = newTempDir();
  try {
    writeConfig(root, JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }));
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.equal(cfg.buildProcess, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: malformed buildProcess throws (fail-closed)', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } }, buildProcess: { local: 'not-an-array' } }),
    );
    assert.throws(() => loadProjectConfig(root), /buildProcess\.local/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: buildProcess.remote path traversal is rejected', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } }, buildProcess: { remote: '../../etc/passwd' } }),
    );
    assert.throws(() => loadProjectConfig(root), /buildProcess\.remote/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

