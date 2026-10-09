/**
 * The claim gate refuses EXACTLY what Studio shows as not-ready (SPEC §6,
 * bead forge-8vfn.30.4, T1 constraint): both call `projectReadiness`, so a
 * project Studio marks ready stays claimable and each Face-A field that
 * Studio shows unticked is a named, non-terminal refusal here.
 *
 * `validateClaimable` returns a verdict and spawns nothing; every project is a
 * tmp dir and nothing touches the network (M7 §6.16).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateClaimable,
  isNonTerminalRefused,
  clearAllPendingRefusalLogs,
  type ClaimValidationResult,
} from '../../claim-validator.ts';
import {
  plantPreflightPassingGround,
  plantStudioReadyProject,
  type DefinitionOverrides,
} from '../test-fixtures/claim-project.ts';

const FLOW_YAML = `id: test-cycle
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

type Refused = Extract<ClaimValidationResult, { ok: false }>;

/** Run `validateClaimable` against a project planted by `plant` under a fresh forge root. */
function claim(id: string, plant: (projectDir: string) => void, projectName = 'my-project'): ClaimValidationResult {
  const root = mkdtempSync(join(tmpdir(), 'forge-claim-ready-'));
  try {
    clearAllPendingRefusalLogs();
    const flowDir = join(root, 'studio', 'flows', 'test-cycle');
    mkdirSync(flowDir, { recursive: true });
    writeFileSync(join(flowDir, 'flow.yaml'), FLOW_YAML);
    const projectDir = join(root, 'projects', projectName);
    mkdirSync(projectDir, { recursive: true });
    plant(projectDir);
    return validateClaimable(id, projectDir, root, 'code', join(flowDir, 'flow.yaml'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a Studio-ready project (five Face-A fields + preflight-passing ground) is claimable', () => {
  const result = claim('INIT-ready', (d) => plantStudioReadyProject(d));
  assert.ok(result.ok, `expected ok but got: ${result.ok ? '' : (result as Refused).reason}`);
  assert.equal(isNonTerminalRefused('INIT-ready'), false);
});

// (An over-140-char north star never reaches this check: the config parser rejects it, so preflight
// C1 refuses first. The 140 boundary is held by the projectReadiness unit test.)
const NOT_READY: Array<[string, string, DefinitionOverrides]> = [
  ['north star empty', 'north-star', { northStar: '' }],
  ['instructions absent', 'instructions', { instructions: null }],
  ['demo has no verify step', 'demo', { demoProcess: [{ kind: 'capture', text: 'node demo.mjs' }] }],
  ['no skill bound', 'skills', { skills: [] }],
  ['no knowledge base bound', 'kb', { kb: null }],
];

for (const [label, id, overrides] of NOT_READY) {
  test(`Studio shows "${label}" unticked → claim refused, non-terminal, naming "${id}"`, () => {
    const initiativeId = `INIT-not-ready-${id}`;
    const result = claim(initiativeId, (d) => plantStudioReadyProject(d, overrides));
    assert.ok(!result.ok, 'expected a refusal');
    const refused = result as Refused;
    assert.equal(refused.terminal, false, 'a not-ready project is the operator\'s to fix: non-terminal');
    assert.equal(refused.blockedClauses, id, 'blockedClauses names exactly the failing field');
    assert.ok(refused.reason.includes('is not ready'), refused.reason);
    assert.ok(refused.reason.includes(`(failing: ${id})`), refused.reason);
    assert.equal(isNonTerminalRefused(initiativeId), true, 'recorded in the skip-set like any non-terminal refusal');
  });
}

test('several fields not ready → every failing id is named, comma-joined', () => {
  const result = claim('INIT-many', (d) => plantStudioReadyProject(d, { skills: [], kb: null }));
  assert.ok(!result.ok);
  assert.equal((result as Refused).blockedClauses, 'skills,kb');
});

test('a malformed .forge/project.json is never ready — refused non-terminal (preflight C1 names it first)', () => {
  const result = claim('INIT-bad-json', (d) => {
    plantPreflightPassingGround(d);
    mkdirSync(join(d, '.forge'), { recursive: true });
    writeFileSync(join(d, '.forge', 'project.json'), '{ not json');
  });
  assert.ok(!result.ok);
  assert.equal((result as Refused).terminal, false);
});

test('a project the roster cannot serve to Studio → refused by name, never treated as ready', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-claim-ready-'));
  try {
    clearAllPendingRefusalLogs();
    const flowDir = join(root, 'studio', 'flows', 'test-cycle');
    mkdirSync(flowDir, { recursive: true });
    writeFileSync(join(flowDir, 'flow.yaml'), FLOW_YAML);
    // Outside <forgeRoot>/projects — Studio's roster does not list it.
    const projectDir = join(root, 'elsewhere', 'stray-project');
    mkdirSync(projectDir, { recursive: true });
    plantStudioReadyProject(projectDir);
    const result = validateClaimable('INIT-stray', projectDir, root, 'code', join(flowDir, 'flow.yaml'));
    assert.ok(!result.ok);
    const refused = result as Refused;
    assert.equal(refused.terminal, false);
    assert.ok(refused.reason.includes('readiness unreadable'), refused.reason);
    assert.ok(refused.reason.includes('stray-project'), refused.reason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('FORGE_SKIP_CONTRACT_CHECK=1 still bypasses the whole contract block, readiness included', () => {
  const prev = process.env.FORGE_SKIP_CONTRACT_CHECK;
  process.env.FORGE_SKIP_CONTRACT_CHECK = '1';
  try {
    const result = claim('INIT-skip', (d) => plantStudioReadyProject(d, { skills: [] }));
    assert.ok(result.ok, 'the harness opt-out is unchanged');
  } finally {
    if (prev === undefined) delete process.env.FORGE_SKIP_CONTRACT_CHECK;
    else process.env.FORGE_SKIP_CONTRACT_CHECK = prev;
  }
});

test('a project directory that does not exist still skips the contract block', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-claim-ready-'));
  try {
    const flowDir = join(root, 'studio', 'flows', 'test-cycle');
    mkdirSync(flowDir, { recursive: true });
    writeFileSync(join(flowDir, 'flow.yaml'), FLOW_YAML);
    const result = validateClaimable('INIT-nodir', join(root, 'projects', 'absent'), root, 'code', join(flowDir, 'flow.yaml'));
    assert.ok(result.ok);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
