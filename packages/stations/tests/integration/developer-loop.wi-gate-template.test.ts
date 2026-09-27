/**
 * forge-mfv5.3.6 (operator ruling 2026-09-12) — wiring pin for the per-WI gate
 * template: a WI with NO `quality_gate_cmd`, in a project that declares
 * `testProcess.local.perWorkItem`, RUNS the template filled with its package.
 *
 * Drives the exact production pair `developer-loop.ts`'s per-WI dispatch
 * calls — `deriveWiGateCmd` decides `effective`, `buildWiQualityGate` runs it
 * — against a real temp dir, with a fake gate script that echoes its argv, so
 * the assertion reads what the gate child was actually handed.
 * (`runDeveloperLoop` itself always spawns a real SDK query; see
 * `developer-loop.gate-resource-prefix.test.ts`'s note.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GateRunInfo } from '@forge/agents';
import type { WorkItem } from '@forge/flows';

import { buildWiQualityGate, deriveWiGateCmd } from '../../phases/wi-quality-gate.ts';

const GIT_DIR = 'azuredevops/internal/service/git';

function wi(): WorkItem {
  return {
    work_item_id: 'WI-3',
    initiative_id: 'initiative-wi-gate-template',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: [`${GIT_DIR}/resource_repo.go`, `${GIT_DIR}/*_test.go`],
    estimated_iterations: 1,
    body: '',
  };
}

function runGate(dir: string, effective: readonly string[], item: WorkItem): GateRunInfo {
  let info: GateRunInfo | undefined;
  const gate = buildWiQualityGate({
    worktreePath: dir,
    accGate: undefined,
    effective,
    wi: item,
    requiredPathsSource: 'files-in-scope',
    ciGateUnsetEnv: undefined,
    localGateTimeoutMs: undefined,
    initiativeId: item.initiative_id,
    onRun: (i) => { info = i; },
  });
  const passed = gate();
  assert.ok(info, 'onRun must fire');
  assert.equal(passed, true, JSON.stringify(info));
  return info!;
}

test('forge-mfv5.3.6 wiring: a WI with no quality_gate_cmd runs the project template filled with its package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wi-gate-template-'));
  try {
    // A real branch diff that touches the WI's declared file, so the gate's
    // required-paths check passes and only the argv is under test.
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'fake-gate.sh'), 'echo "ARGV:$*"\n', 'utf8');
    git('add', 'fake-gate.sh');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'wi-3');
    mkdirSync(join(dir, GIT_DIR), { recursive: true });
    writeFileSync(join(dir, GIT_DIR, 'resource_repo.go'), 'package git\n', 'utf8');
    git('add', `${GIT_DIR}/resource_repo.go`);
    git('commit', '-q', '-m', 'wi-3');
    const item = wi();
    const derived = deriveWiGateCmd({
      wi: item,
      template: ['sh', 'fake-gate.sh', 'test', './{package}/...'],
      fallback: ['sh', 'fake-gate.sh', 'test', './azuredevops/internal/service/servicehook/...'],
    });
    assert.ok(derived.cmd, 'a gate must be derived');
    const info = runGate(dir, derived.cmd!, item);
    assert.match(info.stdoutTail, new RegExp(`ARGV:test \\./${GIT_DIR}/\\.\\.\\.`), 'the gate child must be handed the filled template');
    assert.doesNotMatch(info.stdoutTail, /servicehook/, 'the frozen project-wide gate must not be what ran');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
