/**
 * Unit tests for packages/projects/project-config.ts's `.forge/quality_gate_cmd`
 * sidecar single-sourcing — the concern behind the production
 * `project-config-sidecar.ts` (`readQualityGateSidecar` +
 * `injectSidecarIntoTestProcess`), exercised end-to-end through
 * `loadProjectConfig`: the sidecar fills `testProcess.local.cmd` when
 * project.json omits it, project.json's own `testProcess.local.cmd` wins when
 * both are present, and the sidecar re-roots correctly when project.json
 * declares only `testProcess.ci`.
 *
 * Split out of project-config.test.ts (originally 1,025 lines, 77 cases) when
 * that file grew past the 800-line baseline cap — see
 * scripts/baselines/file-size.json / scripts/check-file-size.mjs. Siblings:
 * project-config.test.ts (the barrel — load-path mechanics,
 * `readAgentInstructionsFile`, `PROJECT_CONFIG_REL_PATH`),
 * project-config-validate.test.ts (every direct `validateProjectConfig(...)`
 * field-validation case), project-config-repo.test.ts (pre-existing —
 * `repo:`/`REPO_RE`).
 *
 * newTempDir()/writeConfig() are duplicated from the pre-split file into this
 * sibling (house style — see project-create-atomicity.test.ts's own header)
 * rather than exported/imported, so each file's fixtures stay independently
 * readable.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadProjectConfig } from '../../project-config.ts';

function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-project-config-test-'));
}

function writeConfig(projectRoot: string, contents: string): void {
  const dir = join(projectRoot, '.forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), contents);
}

test('loadProjectConfig: single-sources quality_gate_cmd from the .forge/quality_gate_cmd sidecar', () => {
  const root = newTempDir();
  try {
    // project.json OMITS quality_gate_cmd; the sidecar is the single source.
    writeConfig(root, JSON.stringify({}));
    writeFileSync(
      join(root, '.forge', 'quality_gate_cmd'),
      'go test -tags all ./azuredevops/internal/service/release/...\n',
    );
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.deepEqual(cfg!.quality_gate_cmd, [
      'go', 'test', '-tags', 'all', './azuredevops/internal/service/release/...',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: project.json testProcess.local.cmd wins over the sidecar when both present', () => {
  const root = newTempDir();
  try {
    writeConfig(root, JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }));
    writeFileSync(join(root, '.forge', 'quality_gate_cmd'), 'go test ./...\n');
    const cfg = loadProjectConfig(root);
    assert.deepEqual(cfg!.quality_gate_cmd, ['npm', 'test']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectConfig: the sidecar fills testProcess.local.cmd when the JSON omits local', () => {
  const dir = newTempDir();
  try {
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'quality_gate_cmd'), 'go test ./...\n');
    writeConfig(dir, JSON.stringify({ testProcess: { ci: { cmd: ['make', 'ci'] } } }));
    const cfg = loadProjectConfig(dir);
    assert.ok(cfg);
    assert.deepEqual(cfg.testProcess.local.cmd, ['go', 'test', './...']);
    assert.deepEqual(cfg.quality_gate_cmd, ['go', 'test', './...']);
    assert.deepEqual(cfg.ci_gate, ['make', 'ci']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

