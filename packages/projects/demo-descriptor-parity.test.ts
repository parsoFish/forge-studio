/**
 * R4-07-F3 descriptor parity — the typed `demoProcess: DemoStep[]` (project.json,
 * R1-03) is the ONE shared demo descriptor. Three consumers must agree on it:
 *
 *   (a) the preflight DEMO clause (accepts it as contract-green),
 *   (b) the demo-builder's composition (`demoTaskLines`, Face B — HTML deliverable),
 *   (c) the demo-agent briefing (`renderDemoAgentUserPrompt`, Face A — executed demo).
 *
 * One fixture, three consumers — descriptor drift breaks this test. The
 * deliverables intentionally differ (contract doc §DEMO, "two faces"); the
 * descriptor and its element ORDER may not.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { checkDemo } from '../cli/preflight.ts';
import { demoTaskLines, type DemoBuilderStatus } from './demo-builder-runner.ts';
import { renderDemoAgentUserPrompt } from './phases/demo-agent-binding.ts';
import { listDemoElements } from './studio/registry.ts';
import type { DemoStep } from './studio/types.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');

/** The ONE shared fixture: element-bearing capture/verify/present steps, deliberately
 * NOT in the library's alphabetical order so order-preservation is actually asserted. */
const FIXTURE_STEPS: Array<DemoStep & { element: string }> = [
  { kind: 'capture', text: 'record the CLI before/after', element: 'cli-capture' },
  { kind: 'verify', text: 'encode the gate result', element: 'test-evidence' },
  { kind: 'present', text: 'one-line essence', element: 'narrative' },
];

function positionsOf(haystack: string, ids: string[]): number[] {
  return ids.map((id) => {
    const i = haystack.indexOf(id);
    assert.ok(i !== -1, `expected "${id}" to appear`);
    return i;
  });
}

function assertAscending(positions: number[], label: string): void {
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i]! > positions[i - 1]!, `${label}: element order must follow demoProcess step order`);
  }
}

test('consumer (a): the preflight DEMO clause accepts the shared fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'descriptor-parity-'));
  try {
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['echo', 'ok'] } }, demoProcess: FIXTURE_STEPS }),
    );
    const result = checkDemo(dir);
    assert.equal(result.pass, true, result.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('consumers (b)+(c): builder composition and demo-agent briefing list the same elements in the same order', () => {
  const library = listDemoElements(FORGE_ROOT);
  assert.ok(library.length >= 6, 'the studio demo-element library must be present');
  const byId = new Map(library.map((e) => [e.id, e]));
  for (const s of FIXTURE_STEPS) assert.ok(byId.has(s.element), `fixture element ${s.element} must exist in the library`);

  // (b) demo-builder composed branch (Face B).
  const builderText = demoTaskLines({
    status: { project_repo_path: '/unused' } as unknown as DemoBuilderStatus,
    composed: true,
    elementSteps: FIXTURE_STEPS,
    byId,
  }).join('\n');

  // (c) demo-agent briefing (Face A).
  const agentPrompt = renderDemoAgentUserPrompt({
    initiativeId: 'INIT-parity',
    acceptanceCriteria: ['AC-1'],
    workItems: [],
    qualityGateCmd: ['echo', 'ok'],
    diffStat: '1 file changed',
    headSha: 'abc',
    demoDir: 'demo/INIT-parity',
    demoProcess: FIXTURE_STEPS,
    elements: FIXTURE_STEPS.map((s) => byId.get(s.element)!),
  });

  const ids = FIXTURE_STEPS.map((s) => s.element);
  assertAscending(positionsOf(builderText, ids), 'demo-builder');
  assertAscending(positionsOf(agentPrompt, ids), 'demo-agent');

  // Both consumers surface each element's generator body/kind, not just the id.
  for (const s of FIXTURE_STEPS) {
    const el = byId.get(s.element)!;
    assert.ok(builderText.includes(el.name), `builder inlines ${s.element} generator header`);
    assert.ok(agentPrompt.includes(el.name), `agent briefing inlines ${s.element} generator header`);
  }
});
