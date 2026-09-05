/**
 * `PUT /api/studio/flows/:id` refuses a flow it could not read back — the
 * ROUTE-level half of bead `forge-8vfn.5.12.1` (b). The unit half lives in
 * `packages/flows/studio/validate-flow.test.ts`; this file proves the refusal
 * reaches the wire, with the file left byte-identical.
 *
 * Its own file rather than a case in `bridge-studio-flows.test.ts`, and that is
 * a deliberate consequence of the size gate: that file sits at 1060 lines under
 * an exemption, and `check-file-size` treats an exemption as a CEILING, not a
 * licence — it refused the growth by name. The fixture below is therefore the
 * minimum this one assertion needs (one agent, one flow, the `_queue`/`_logs`
 * stubs `startBridge` requires), not a copy of that file's much larger one.
 * The repo's convention is self-contained test fixtures; no shared bridge
 * fixture module exists.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

/** A loadable flow: every edge labelled, one gate node (satisfies zero-gate). */
const FLOW_YAML = [
  'id: test-flow',
  'name: Test Flow',
  'version: 3',
  'goal: Ship something great.',
  'project: null',
  'kb: null',
  'costCeilingUsd: 2',
  'origin: studio',
  'nodes:',
  '  - id: architect',
  '    agent: test-agent',
  '  - id: review',
  '    gate: human',
  'edges:',
  '  - from: architect',
  '    to: review',
  '    artifact: PLAN.md',
  'triggers: []',
].join('\n');

const AGENT_SKILL_MD = [
  '---',
  'name: Test Agent',
  'description: Minimal agent for flow tests.',
  'phase: architect',
  'purpose: Run tests.',
  'brainAccess: none',
  'interactivity: none',
  'composition:',
  '  skills: [tdd-workflow]',
  '  tools: []',
  '  mcps: []',
  '  guards: [event-log]',
  'runtime:',
  '  sdk: claude-code',
  '  strategy: fixed',
  '  model: claude-sonnet-4-5',
  'allowed-tools: []',
  'disallowed-tools: []',
  'budgets: {}',
  '---',
  '',
  'Test agent process body.',
].join('\n');

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-flows-edge-artifact-'));

  mkdirSync(join(forgeRoot, 'skills', 'test-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-agent', 'SKILL.md'), AGENT_SKILL_MD);

  mkdirSync(join(forgeRoot, 'studio', 'flows', 'test-flow'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml'), FLOW_YAML);

  for (const state of ['pending', 'done', 'ready-for-review', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('PUT /api/studio/flows/test-flow with an UNLABELLED edge → 400 + edge-artifact, YAML unchanged', async () => {
  // The builder sends exactly this shape: `rfEdgesToFlow` maps
  // `artifact: e.data?.artifact`, which is `undefined` for an edge the declared
  // connect handle drew or the picker left unlabelled. Before the check the PUT
  // answered 200, wrote `edges: [{from,to}]`, and the very next read threw in
  // `parseFlowEdge` — `loadAllFlows` caught it and SKIPPED the flow, so the
  // operator was redirected to `data-page="not-found"` for the flow they had
  // just saved successfully. The refusal now happens at save time, where the
  // builder already renders flow-save-findings.
  const flowPath = join(forgeRoot, 'studio', 'flows', 'test-flow', 'flow.yaml');
  const originalYaml = readFileSync(flowPath, 'utf8');

  const res = await fetch(`${bridgeUrl}/api/studio/flows/test-flow`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({
      goal: 'A flow with one unlabelled edge.',
      nodes: [
        { id: 'architect', agent: 'test-agent' },
        { id: 'review', gate: 'human' },
      ],
      edges: [{ from: 'architect', to: 'review' }],
      triggers: [],
    }),
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as {
    error: string;
    findings: Array<{ check: string; level: string; message: string }>;
  };
  assert.equal(body.error, 'validation failed');
  const finding = body.findings.find((f) => f.check === 'edge-artifact');
  assert.ok(finding, `expected edge-artifact finding, got: ${JSON.stringify(body.findings)}`);
  assert.equal(finding.level, 'error');
  assert.ok(finding.message.includes('architect'), finding.message);
  assert.ok(finding.message.includes('review'), finding.message);

  assert.equal(readFileSync(flowPath, 'utf8'), originalYaml, 'flow.yaml must be unchanged after 400');
});
