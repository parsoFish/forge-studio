/**
 * Unit tests for orchestrator/project-config.ts.
 *
 * The loader returns the parsed config when valid, returns null when the file
 * is absent (caller decides fail-closed), and throws when the file is present
 * but malformed (fail-closed per CONTRACTS.md C1 + council 04 F8).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadProjectConfig,
  PROJECT_CONFIG_REL_PATH,
  validateProjectConfig,
} from './project-config.ts';

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
        demo: {
          shape: 'browser',
          command: ['bash', '-lc', 'npx playwright test'],
          preview_command: ['npm', 'run', 'preview'],
        },
        quality_gate_cmd: ['npm', 'test'],
      }),
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.equal(cfg.demo.shape, 'browser');
    assert.deepEqual(cfg.demo.command, ['bash', '-lc', 'npx playwright test']);
    assert.deepEqual(cfg.quality_gate_cmd, ['npm', 'test']);
    assert.equal(cfg.metrics, undefined);
    assert.equal(cfg.sweep, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: throws when demo block is missing', () => {
  const root = newTempDir();
  try {
    writeConfig(root, JSON.stringify({ quality_gate_cmd: ['npm', 'test'] }));
    assert.throws(() => loadProjectConfig(root), /demo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: throws on bad demo.shape value', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({
        demo: { shape: 'video', command: ['true'] },
        quality_gate_cmd: ['true'],
      }),
    );
    assert.throws(() => loadProjectConfig(root), /demo\.shape/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: throws when quality_gate_cmd is missing', () => {
  const root = newTempDir();
  try {
    writeConfig(
      root,
      JSON.stringify({ demo: { shape: 'none' } }),
    );
    assert.throws(() => loadProjectConfig(root), /quality_gate_cmd/);
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
        demo: { shape: 'cli-diff', command: ['echo', 'demo'] },
        quality_gate_cmd: ['true'],
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
        demo: { shape: 'harness', command: ['go', 'test', './...'] },
        quality_gate_cmd: ['go', 'test', './...'],
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

test('validateProjectConfig: shape: "none" is accepted without a demo.command', () => {
  const cfg = validateProjectConfig({
    demo: { shape: 'none' },
    quality_gate_cmd: ['true'],
  });
  assert.equal(cfg.demo.shape, 'none');
  assert.equal(cfg.demo.command, undefined);
});

test('validateProjectConfig: shape: "browser" requires a preview_command', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        demo: { shape: 'browser', command: ['true'] },
        quality_gate_cmd: ['true'],
      }),
    /preview_command/,
  );
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
        demo: { shape: 'harness', command: ['go', 'test', './...'] },
        quality_gate_cmd: ['go', 'test', './...'],
        ci_gate: ['bash', '-c', 'make test && golangci-lint run ./... && make terrafmt-check'],
        ci_fix_cmd: ['bash', '-c', 'make fmt && make terrafmt'],
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

test('loadProjectConfig: ci_gate + ci_fix_cmd are optional (absent ⇒ undefined)', () => {
  const cfg = validateProjectConfig({
    demo: { shape: 'none' },
    quality_gate_cmd: ['true'],
  });
  assert.equal(cfg.ci_gate, undefined);
  assert.equal(cfg.ci_fix_cmd, undefined);
});

test('validateProjectConfig: ci_gate must be an argv string[] when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        demo: { shape: 'none' },
        quality_gate_cmd: ['true'],
        ci_gate: 'make test && lint',
      }),
    /ci_gate/,
  );
});

// ----- A2/A3 testing-contract seams (2026-06-06) -----

test('validateProjectConfig: ci_gate_unset_env + standing_work_item_acs + acceptance_gate round-trip', () => {
  const cfg = validateProjectConfig({
    demo: { shape: 'none' },
    quality_gate_cmd: ['true'],
    ci_gate_unset_env: ['TF_ACC'],
    standing_work_item_acs: ['live acc test', 'CI must be green'],
    acceptance_gate: { match: 'acceptancetests', required: true, requires_env: ['TF_ACC'] },
  });
  assert.deepEqual(cfg.ci_gate_unset_env, ['TF_ACC']);
  assert.deepEqual(cfg.standing_work_item_acs, ['live acc test', 'CI must be green']);
  assert.deepEqual(cfg.acceptance_gate, { match: 'acceptancetests', required: true, requires_env: ['TF_ACC'] });
});

test('validateProjectConfig: the three A2/A3 seams are optional (absent ⇒ undefined)', () => {
  const cfg = validateProjectConfig({ demo: { shape: 'none' }, quality_gate_cmd: ['true'] });
  assert.equal(cfg.ci_gate_unset_env, undefined);
  assert.equal(cfg.standing_work_item_acs, undefined);
  assert.equal(cfg.acceptance_gate, undefined);
});

test('validateProjectConfig: ci_gate_unset_env must be an argv string[] when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        demo: { shape: 'none' },
        quality_gate_cmd: ['true'],
        ci_gate_unset_env: 'TF_ACC',
      }),
    /ci_gate_unset_env/,
  );
});

test('validateProjectConfig: acceptance_gate requires a non-empty match', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        demo: { shape: 'none' },
        quality_gate_cmd: ['true'],
        acceptance_gate: { required: true },
      }),
    /acceptance_gate\.match/,
  );
});

test('validateProjectConfig: acceptance_gate.required must be a boolean', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        demo: { shape: 'none' },
        quality_gate_cmd: ['true'],
        acceptance_gate: { match: 'acceptancetests', required: 'yes' },
      }),
    /acceptance_gate\.required/,
  );
});
