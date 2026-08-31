import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDemoAgentSystemPrompt,
  renderDemoAgentUserPrompt,
  FIX_PROPOSALS_FILENAME,
  type DemoAgentUserPromptInput,
} from './demo-agent-binding.ts';
import type { DemoElementDefinition, DemoStep } from '@forge/contracts/studio/types.ts';

function el(id: string, phase: DemoElementDefinition['phase'], body = `generator body for ${id}`): DemoElementDefinition {
  return { id, name: id.toUpperCase(), phase, description: `${id} desc`, configHint: '', body, path: `/x/${id}.md` };
}

function baseInput(): DemoAgentUserPromptInput {
  return {
    initiativeId: 'INIT-2026-07-24-x',
    acceptanceCriteria: ['AC-1: the CLI prints usage', 'AC-2: exit code 0 on --help'],
    workItems: [
      { id: 'WI-1', title: 'usage printer', status: 'complete' },
      { id: 'WI-2', title: 'help flag', status: 'complete' },
    ],
    qualityGateCmd: ['npm', 'test'],
    diffStat: '3 files changed, 40 insertions(+), 2 deletions(-)',
    headSha: 'abc1234',
    demoDir: 'demo/INIT-2026-07-24-x',
  };
}

test('system prompt inlines both the demo-agent skill and the demo contract skill, byte-stable', () => {
  const a = buildDemoAgentSystemPrompt();
  const b = buildDemoAgentSystemPrompt();
  assert.equal(a, b); // cacheable — no per-call dynamic content
  assert.ok(a.includes('name: demo-agent'), 'demo-agent SKILL.md inlined');
  assert.ok(a.includes('name: demo\n'), 'skills/demo contract inlined');
});

test('user prompt carries the dynamic run context: id, ACs, WIs, injected diffStat, demoDir', () => {
  const p = renderDemoAgentUserPrompt(baseInput());
  assert.ok(p.includes('INIT-2026-07-24-x'));
  assert.ok(p.includes('AC-1: the CLI prints usage'));
  assert.ok(p.includes('AC-2: exit code 0 on --help'));
  assert.ok(p.includes('WI-1'));
  assert.ok(p.includes('3 files changed, 40 insertions(+), 2 deletions(-)'));
  assert.ok(p.includes('abc1234'));
  assert.ok(p.includes('demo/INIT-2026-07-24-x/demo.json'));
  assert.ok(p.includes('npm test'));
});

test('user prompt states the verdict vocabulary and the fix-proposals contract', () => {
  const p = renderDemoAgentUserPrompt(baseInput());
  assert.ok(/met.*partial.*missed/s.test(p), 'acEvaluations vocabulary stated');
  assert.ok(p.includes(`demo/INIT-2026-07-24-x/${FIX_PROPOSALS_FILENAME}`), 'fix-proposals path stated');
  assert.ok(/testEvidence.*ARRAY/i.test(p) || /testEvidence.*array/.test(p), 'testEvidence array rule stated');
  assert.ok(/beforeOutput/.test(p) && /orchestrat/i.test(p), 'capture-is-orchestrator-owned rule stated');
});

test('element-bearing demoProcess renders the composition block in step order with generator bodies', () => {
  const steps: DemoStep[] = [
    { kind: 'capture', text: 'record CLI before/after', element: 'cli-capture' },
    { kind: 'verify', text: 'gate result', element: 'test-evidence' },
    { kind: 'present', text: 'one-line essence', element: 'narrative' },
  ];
  const elements = [el('cli-capture', 'capture'), el('test-evidence', 'verify'), el('narrative', 'present')];
  const p = renderDemoAgentUserPrompt({ ...baseInput(), demoProcess: steps, elements });
  const iCli = p.indexOf('cli-capture');
  const iTe = p.indexOf('test-evidence');
  const iNa = p.indexOf('narrative');
  assert.ok(iCli !== -1 && iTe !== -1 && iNa !== -1);
  assert.ok(iCli < iTe && iTe < iNa, 'elements listed in demoProcess step order');
  assert.ok(p.includes('generator body for cli-capture'), 'element generator body inlined');
});

test('a step naming an unresolved element id renders an explicit UNRESOLVED note, never silence', () => {
  const steps: DemoStep[] = [
    { kind: 'capture', text: 'record it', element: 'cli-capture' },
    { kind: 'verify', text: 'assert it', element: 'not-a-real-element' },
  ];
  const p = renderDemoAgentUserPrompt({ ...baseInput(), demoProcess: steps, elements: [el('cli-capture', 'capture')] });
  assert.ok(p.includes('not-a-real-element'), 'unresolved id still named');
  assert.ok(/UNRESOLVED/.test(p), 'explicit unresolved marker rendered');
});

test('element-less demoProcess falls back to the library index with kind guidance', () => {
  const steps: DemoStep[] = [
    { kind: 'capture', text: 'record the API response' },
    { kind: 'verify', text: 'assert the suite passes' },
  ];
  const library = [
    el('api-verify', 'verify'),
    el('cli-capture', 'capture'),
    el('code-diff', 'present'),
    el('narrative', 'present'),
    el('screenshot', 'capture'),
    el('test-evidence', 'verify'),
  ];
  const p = renderDemoAgentUserPrompt({ ...baseInput(), demoProcess: steps, elements: library });
  for (const e of library) assert.ok(p.includes(e.id), `library element ${e.id} indexed`);
  assert.ok(!p.includes('generator body for api-verify'), 'index only — full generator bodies not inlined in fallback');
  assert.ok(p.includes('record the API response'), 'typed steps still rendered');
});

test('prompts prohibit the agent from running render or capture itself', () => {
  const p = renderDemoAgentUserPrompt(baseInput());
  assert.ok(/never run `forge demo render`/i.test(p), 'render prohibition stated (orchestrator-owned)');
  assert.ok(/`forge demo capture`/.test(p), 'capture named in the prohibition');
  assert.ok(!/^\s*\d+\..*run `forge demo (render|capture)`/im.test(p), 'no numbered step instructs running render/capture');
});
