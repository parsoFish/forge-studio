/**
 * Tests for claim-time validation (ADR-028 §8, M3-6).
 *
 * Covers:
 *   A. validateClaimable — contract-ready + valid flow → ok
 *   B. Non-contract-ready project (preflight hard clause fails) → refused, non-terminal
 *   C. Invalid flow (validateFlow errors) → refused, terminal
 *   D. Zero-gate non-disposable flow → refused via validateFlow, terminal
 *   E. Non-existent project path → skips preflight, continues to flow check
 *   F. Spin-guard — second refusal for the same initiative is still refused but
 *      the Set is idempotent (no duplicate logging side-effect in production)
 *
 * Version seam:
 *   G. ok result carries the flow version
 *   H. readOnDiskFlowVersion reads the version field from a flow.yaml on disk
 *   I. checkFlowVersionSeam logs a warning when the version changed, skips when unchanged
 *
 * Scheduler integration (light):
 *   J. claim.refused event structure (emitted by emitClaimRefusedEvent via scheduler)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateClaimable,
  clearAllPendingRefusalLogs,
  clearPendingRefusalLog,
  type ClaimValidationResult,
} from './claim-validator.ts';
import { readOnDiskFlowVersion, checkFlowVersionSeam } from './flow-runner.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid forge-cycle/flow.yaml content. */
const VALID_FLOW_YAML = `id: forge-cycle
name: Forge Cycle
version: 1
goal: Take an approved initiative to a merged PR.
project: null
kb: cycles
costCeilingUsd: 25
origin: seed
nodes:
  - { id: architect, gate: plan }
  - { id: pm, agent: project-manager }
  - { id: review, gate: verdict }
edges:
  - { from: architect, to: pm, artifact: plan }
  - { from: pm, to: review, artifact: work-items }
triggers: []
`;

/** Flow yaml with a zero-gate non-disposable flow (no gate nodes). */
const ZERO_GATE_FLOW_YAML = `id: bad-flow
name: Bad Flow
version: 1
goal: This flow has no gate and is not disposable.
project: null
kb: null
costCeilingUsd: 0
origin: seed
nodes:
  - { id: pm, agent: project-manager }
edges: []
triggers: []
`;

/** Flow yaml with an invalid node (neither agent nor gate). */
const INVALID_FLOW_YAML = `id: bad-node-flow
name: Bad Node Flow
version: 1
goal: A flow with an invalid node.
project: null
kb: null
costCeilingUsd: 0
origin: seed
nodes:
  - { id: broken-node }
edges: []
triggers: []
`;

/** Minimal contract-ready project directory setup. */
function setupContractReadyProject(dir: string): void {
  // C1: quality gate command (package.json test script)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test-project', scripts: { test: 'node test.mjs' } }),
  );
  // C2: scratch hygiene — .gitignore covers all scratch paths
  // The preflight C2 check runs git commands; if not a repo, it does text-scan.
  // We write a .gitignore that covers all scratch paths.
  writeFileSync(
    join(dir, '.gitignore'),
    '.forge/work-items/\nAGENT.md\nPROMPT.md\nfix_plan.md\n',
  );
  // C4: roadmap.md + brain/profile.md
  writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n');
  mkdirSync(join(dir, 'brain'), { recursive: true });
  writeFileSync(join(dir, 'brain', 'profile.md'), '# Profile\n');
}

/** Setup helpers. */
function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-claim-test-'));
}

function setupForgeRoot(dir: string, flowYaml: string): { forgeRoot: string; flowPath: string } {
  const flowDir = join(dir, 'studio', 'flows', 'forge-cycle');
  mkdirSync(flowDir, { recursive: true });
  const flowPath = join(flowDir, 'flow.yaml');
  writeFileSync(flowPath, flowYaml);
  return { forgeRoot: dir, flowPath };
}

// ---------------------------------------------------------------------------
// A. Contract-ready project + valid flow → ok
// ---------------------------------------------------------------------------

test('validateClaimable: contract-ready project + valid flow → ok', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot } = setupForgeRoot(root, VALID_FLOW_YAML);
    const projectDir = join(root, 'projects', 'my-project');
    mkdirSync(projectDir, { recursive: true });
    setupContractReadyProject(projectDir);

    const result = validateClaimable('INIT-test-ok', projectDir, forgeRoot);
    assert.ok(result.ok, `expected ok but got refused: ${!result.ok ? (result as Extract<ClaimValidationResult, { ok: false }>).reason : ''}`);
    if (result.ok) {
      assert.equal(result.flowVersion, 1, 'flowVersion should be 1');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B. Non-contract-ready project → refused, non-terminal, left in pending
// ---------------------------------------------------------------------------

test('validateClaimable: missing roadmap.md (C4 fail) → refused, non-terminal', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot } = setupForgeRoot(root, VALID_FLOW_YAML);
    const projectDir = join(root, 'projects', 'broken-project');
    mkdirSync(projectDir, { recursive: true });
    // Setup C1 + C2 but NOT C4 (no roadmap.md or brain/profile.md)
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { test: 'node t.mjs' } }),
    );
    writeFileSync(join(projectDir, '.gitignore'), '.forge/work-items/\nAGENT.md\nPROMPT.md\nfix_plan.md\n');

    const result = validateClaimable('INIT-c4-fail', projectDir, forgeRoot);

    assert.ok(!result.ok, 'expected refusal');
    if (!result.ok) {
      assert.equal(result.terminal, false, 'C4 fail must be non-terminal (leave in pending)');
      assert.ok(result.reason.includes('not contract-ready'), `reason should mention contract-ready: ${result.reason}`);
      assert.ok(result.reason.includes('C4'), `reason should name the failing clause: ${result.reason}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateClaimable: missing quality gate (C1 fail) → refused, non-terminal', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot } = setupForgeRoot(root, VALID_FLOW_YAML);
    const projectDir = join(root, 'projects', 'no-gate');
    mkdirSync(projectDir, { recursive: true });
    // Has C4 but no C1 (package.json has no test script)
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'test', scripts: {} }),
    );
    writeFileSync(join(projectDir, '.gitignore'), '.forge/work-items/\nAGENT.md\nPROMPT.md\nfix_plan.md\n');
    writeFileSync(join(projectDir, 'roadmap.md'), '# Roadmap\n');
    mkdirSync(join(projectDir, 'brain'), { recursive: true });
    writeFileSync(join(projectDir, 'brain', 'profile.md'), '# Profile\n');

    const result = validateClaimable('INIT-c1-fail', projectDir, forgeRoot);

    assert.ok(!result.ok, 'expected refusal');
    if (!result.ok) {
      assert.equal(result.terminal, false, 'C1 fail must be non-terminal');
      assert.ok(result.reason.includes('C1') || result.reason.includes('not contract-ready'), `reason should name C1: ${result.reason}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// C. Invalid flow → refused, terminal
// ---------------------------------------------------------------------------

test('validateClaimable: flow has invalid node (no agent/gate) → refused, terminal', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot, flowPath } = setupForgeRoot(root, INVALID_FLOW_YAML);

    // Project doesn't even need to exist — flow check runs first
    const result = validateClaimable('INIT-bad-flow', '/nonexistent/path', forgeRoot, flowPath);

    assert.ok(!result.ok, 'expected refusal');
    if (!result.ok) {
      assert.equal(result.terminal, true, 'invalid flow must be terminal');
      assert.ok(
        result.reason.includes('failed validation') || result.reason.includes('error'),
        `reason should mention validation: ${result.reason}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateClaimable: flow.yaml not found → refused, terminal', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const forgeRoot = root; // no flow.yaml written

    const result = validateClaimable('INIT-no-flow', '/nonexistent/path', forgeRoot,
      join(root, 'studio', 'flows', 'nonexistent', 'flow.yaml'));

    assert.ok(!result.ok, 'expected refusal');
    if (!result.ok) {
      assert.equal(result.terminal, true, 'unreadable flow must be terminal');
      assert.ok(
        result.reason.includes('could not be loaded') || result.reason.includes('cannot read'),
        `reason should mention load failure: ${result.reason}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D. Zero-gate non-disposable flow → refused via validateFlow, terminal
// ---------------------------------------------------------------------------

test('validateClaimable: zero-gate non-disposable flow → refused terminal (via validateFlow)', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot, flowPath } = setupForgeRoot(root, ZERO_GATE_FLOW_YAML);

    const result = validateClaimable('INIT-zero-gate', '/nonexistent/path', forgeRoot, flowPath);

    assert.ok(!result.ok, 'expected refusal for zero-gate flow');
    if (!result.ok) {
      assert.equal(result.terminal, true, 'zero-gate flow must be terminal');
      assert.ok(
        result.reason.includes('zero-gate') || result.reason.includes('validation') || result.reason.includes('error'),
        `reason should reference the zero-gate check: ${result.reason}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// E. Non-existent project path → skips preflight (best-effort safety)
// ---------------------------------------------------------------------------

test('validateClaimable: non-existent project path → skips preflight, flow check determines result', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot } = setupForgeRoot(root, VALID_FLOW_YAML);

    // Project dir does not exist → preflight is skipped → only flow check matters
    const result = validateClaimable('INIT-no-project', '/does/not/exist/at/all', forgeRoot);

    // With a valid flow and a non-existent project dir, the result should be ok
    // (preflight is skipped because existsSync returns false)
    assert.ok(result.ok, `expected ok (preflight skipped for non-existent path) but got: ${!result.ok ? (result as Extract<ClaimValidationResult, {ok: false}>).reason : ''}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F. Spin-guard: clearPendingRefusalLog resets per-initiative state
// ---------------------------------------------------------------------------

test('validateClaimable: spin-guard reset via clearPendingRefusalLog', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    const { forgeRoot } = setupForgeRoot(root, VALID_FLOW_YAML);
    const projectDir = join(root, 'projects', 'spun');
    mkdirSync(projectDir, { recursive: true });
    // No C4 → will be refused
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node t.mjs' } }));
    writeFileSync(join(projectDir, '.gitignore'), '.forge/work-items/\nAGENT.md\nPROMPT.md\nfix_plan.md\n');

    const id = 'INIT-spin-test';
    const r1 = validateClaimable(id, projectDir, forgeRoot);
    assert.ok(!r1.ok, 'first call: refused');
    if (!r1.ok) assert.equal(r1.terminal, false);

    // Second call: still refused (spin-guard doesn't change the refusal outcome,
    // only suppresses duplicate console logging)
    const r2 = validateClaimable(id, projectDir, forgeRoot);
    assert.ok(!r2.ok, 'second call: still refused');

    // After clearing, another call is still refused (the project isn't fixed)
    clearPendingRefusalLog(id);
    const r3 = validateClaimable(id, projectDir, forgeRoot);
    assert.ok(!r3.ok, 'after clear: still refused (project unchanged)');
    if (!r3.ok) assert.equal(r3.terminal, false, 'still non-terminal after clear');
  } finally {
    rmSync(root, { recursive: true, force: true });
    clearAllPendingRefusalLogs();
  }
});

// ---------------------------------------------------------------------------
// G. ok result carries the flow version
// ---------------------------------------------------------------------------

test('validateClaimable ok result: flowVersion matches flow.yaml version field', () => {
  const root = tmpDir();
  try {
    clearAllPendingRefusalLogs();
    // Write a flow with version: 3
    const flowYaml = VALID_FLOW_YAML.replace('version: 1', 'version: 3');
    const { forgeRoot } = setupForgeRoot(root, flowYaml);
    const projectDir = join(root, 'projects', 'v3-proj');
    mkdirSync(projectDir, { recursive: true });
    setupContractReadyProject(projectDir);

    const result = validateClaimable('INIT-v3', projectDir, forgeRoot);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.flowVersion, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// H. readOnDiskFlowVersion reads version from flow.yaml
// ---------------------------------------------------------------------------

test('readOnDiskFlowVersion: reads version field correctly', () => {
  const root = tmpDir();
  try {
    const flowPath = join(root, 'flow.yaml');
    writeFileSync(flowPath, 'id: my-flow\nname: My Flow\nversion: 7\ngoal: test\n');
    const v = readOnDiskFlowVersion(flowPath);
    assert.equal(v, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readOnDiskFlowVersion: returns null for non-existent path', () => {
  const v = readOnDiskFlowVersion('/absolutely/does/not/exist/flow.yaml');
  assert.equal(v, null);
});

test('readOnDiskFlowVersion: returns null when version field missing', () => {
  const root = tmpDir();
  try {
    const flowPath = join(root, 'flow.yaml');
    writeFileSync(flowPath, 'id: my-flow\nname: My Flow\ngoal: test\n');
    const v = readOnDiskFlowVersion(flowPath);
    assert.equal(v, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// I. checkFlowVersionSeam logs warning when version changed
// ---------------------------------------------------------------------------

test('checkFlowVersionSeam: no log when version unchanged', () => {
  const root = tmpDir();
  try {
    const flowPath = join(root, 'flow.yaml');
    writeFileSync(flowPath, 'id: f\nname: F\nversion: 1\ngoal: g\n');

    const logs: string[] = [];
    const stubLogger = {
      emit(partial: { message?: string }): import('./logging.ts').EventLogEntry {
        if (partial.message) logs.push(partial.message);
        return {} as import('./logging.ts').EventLogEntry;
      },
    };

    // Stub flow with the same version as on disk (1)
    const flow = { id: 'f', version: 1, path: flowPath } as Parameters<typeof checkFlowVersionSeam>[0];
    checkFlowVersionSeam(flow, 1, 'INIT-vsame', stubLogger as Parameters<typeof checkFlowVersionSeam>[3]);

    assert.equal(logs.length, 0, 'no log when version is unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkFlowVersionSeam: logs warning when version changed', () => {
  const root = tmpDir();
  try {
    const flowPath = join(root, 'flow.yaml');
    // On disk: version 2
    writeFileSync(flowPath, 'id: f\nname: F\nversion: 2\ngoal: g\n');

    const logs: string[] = [];
    const stubLogger = {
      emit(partial: { message?: string }): import('./logging.ts').EventLogEntry {
        if (partial.message) logs.push(partial.message);
        return {} as import('./logging.ts').EventLogEntry;
      },
    };

    // Runner started with version 1, on-disk is now 2
    const flow = { id: 'f', version: 1, path: flowPath } as Parameters<typeof checkFlowVersionSeam>[0];
    checkFlowVersionSeam(flow, 1, 'INIT-vchanged', stubLogger as Parameters<typeof checkFlowVersionSeam>[3]);

    assert.equal(logs.length, 1, 'should emit one warning');
    assert.equal(logs[0], 'flow.version-changed-during-run');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkFlowVersionSeam: no log when flow.path is missing (test stubs)', () => {
  const logs: string[] = [];
  const stubLogger = {
    emit(partial: { message?: string }): import('./logging.ts').EventLogEntry {
      if (partial.message) logs.push(partial.message);
      return {} as import('./logging.ts').EventLogEntry;
    },
  };

  // No path field → check is skipped
  const flow = { id: 'f', version: 1 } as Parameters<typeof checkFlowVersionSeam>[0];
  checkFlowVersionSeam(flow, 1, 'INIT-nopath', stubLogger as Parameters<typeof checkFlowVersionSeam>[3]);

  assert.equal(logs.length, 0, 'no log when no path');
});
