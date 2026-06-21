/**
 * Unit tests for orchestrator/unifier-invocation.ts.
 *
 * The unifier-invocation contract is the developer-unifier sub-phase's
 * equivalent of `dev-invocation.ts` for per-WI Ralphs: system prompt builder,
 * per-iteration prompt builder, workspace prep. Tests are file-system tests
 * (tmp dir, write/read assertions) — no SDK invocation, no shells.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnifierSystemPrompt,
  prepareUnifierWorkspace,
  renderUnifierUserPrompt,
  UNIFIER_ALLOWED_TOOLS,
  UNIFIER_DISALLOWED_TOOLS,
  UNIFIER_MODEL,
} from './unifier-invocation.ts';

function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-unifier-test-'));
}

test('UNIFIER_ALLOWED_TOOLS includes Bash and Write (needed for tests + commits + PR draft)', () => {
  for (const t of ['Bash', 'Write', 'Read'] as const) {
    assert.ok(UNIFIER_ALLOWED_TOOLS.includes(t), `missing tool: ${t}`);
  }
});

test('UNIFIER_DISALLOWED_TOOLS bans web tools', () => {
  for (const t of ['WebFetch', 'WebSearch'] as const) {
    assert.ok(UNIFIER_DISALLOWED_TOOLS.includes(t), `missing banned tool: ${t}`);
  }
});

test('UNIFIER_MODEL is sonnet (per dev-loop model parity)', () => {
  assert.equal(UNIFIER_MODEL, 'claude-sonnet-4-6');
});

test('buildUnifierSystemPrompt: contains all key invariants', () => {
  const sys = buildUnifierSystemPrompt();

  // Substantive content
  assert.ok(sys.length > 1000, 'system prompt should be substantive');
  // Skill name + scope
  assert.ok(sys.includes('developer-unifier'), 'should mention skill name');
  assert.ok(sys.includes('initiative'), 'should reference initiative scope');
  assert.ok(sys.includes('Ralph'), 'should reference Ralph loop discipline');

  // 4-gate composed-gate awareness (demo_runs_clean removed)
  assert.ok(sys.includes('initiative_gate'), 'must reference initiative_gate');
  assert.ok(sys.includes('pr_self_contained'), 'must reference pr_self_contained');
  assert.ok(sys.includes('branches_in_sync'), 'must reference branches_in_sync');

  // iter-1-skeleton rule (observed 5+ cycle failure mode)
  assert.ok(
    sys.includes('skeleton') || sys.includes('SKELETON'),
    'must reference the iter-1 skeleton rule',
  );
  assert.ok(
    sys.includes('DO NOT spend iteration 1 reading') ||
      sys.includes('DO NOT spend iteration') ||
      sys.includes('skeleton goes in FIRST'),
    'must carry the iter-1 write-first mandate',
  );

  // Demo contract
  assert.ok(
    sys.includes('## Demo') || sys.includes('Demo section'),
    'must reference the no-## Demo-section rule',
  );

  // No-gh-pr-create rule
  assert.ok(
    sys.includes('gh pr create') || sys.includes('gh pr merge'),
    'must carry the no-gh-pr-create/merge rule',
  );

  // No-hallucinated-test-passes rule
  assert.ok(
    sys.includes('hallucinated') || sys.toLowerCase().includes('prove it'),
    'must carry the no-hallucinated-test-passes rule',
  );

  // Integrate-not-develop role
  assert.ok(
    sys.includes('integrate') || sys.includes('NOT to implement WIs'),
    'must carry the unifier integrate-not-develop role',
  );
});

test('renderUnifierUserPrompt: is dynamic-only (no static Ralph discipline repetition)', () => {
  const prompt = renderUnifierUserPrompt({
    initiativeId: 'INIT-test',
    manifestRelPath: '.forge/manifest.md',
    workItemSpecs: ['.forge/work-items/WI-1.md'],
    iteration: 1,
    iterationBudget: 5,
    qualityGateCmd: ['npm', 'test'],
  });
  // The static Ralph discipline header must NOT be duplicated in the user prompt
  // (it now lives only in SKILL.md)
  assert.ok(
    !prompt.includes('Ralph loop discipline'),
    'user prompt must not re-state Ralph loop discipline (it lives in SKILL.md)',
  );
});

test('renderUnifierUserPrompt: initial-prep mode references manifest + WIs', () => {
  const prompt = renderUnifierUserPrompt({
    initiativeId: 'INIT-2026-05-23-test',
    manifestRelPath: '.forge/manifest.md',
    workItemSpecs: ['.forge/work-items/WI-1.md', '.forge/work-items/WI-2.md'],
    iteration: 1,
    iterationBudget: 3,
    qualityGateCmd: ['npm', 'test'],
  });
  for (const s of ['INIT-2026-05-23-test', '.forge/manifest.md', 'WI-1', 'WI-2', 'npm test']) {
    assert.ok(prompt.includes(s), `missing: ${s}`);
  }
  assert.ok(!prompt.includes('send-back'), 'initial-prep mode does not mention send-back');
});

test('renderUnifierUserPrompt: demo instruction references generated demo machinery', () => {
  const prompt = renderUnifierUserPrompt({
    initiativeId: 'X',
    manifestRelPath: '.forge/manifest.md',
    workItemSpecs: [],
    iteration: 1,
    iterationBudget: 3,
    qualityGateCmd: ['true'],
  });
  assert.ok(
    prompt.includes('generated demo machinery') || prompt.includes('skills/demo/SKILL.md'),
    'prompt should reference generated demo machinery or SKILL.md',
  );
});

test('prepareUnifierWorkspace: stamps PROMPT.md / AGENT.md / fix_plan.md', () => {
  const root = newTempDir();
  try {
    mkdirSync(join(root, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(root, '.forge', 'manifest.md'), '# manifest');
    writeFileSync(
      join(root, '.forge', 'work-items', 'WI-1.md'),
      '---\nwork_item_id: WI-1\ninitiative_id: I\nstatus: complete\ndepends_on: []\nfiles_in_scope: ["src/x.ts"]\nestimated_iterations: 1\nquality_gate_cmd: [\'node\', \'--test\']\nacceptance_criteria:\n  - given: g\n    when: w\n    then: t\n---\n# WI-1\n',
    );
    const out = prepareUnifierWorkspace({
      initiativeId: 'INIT-x',
      manifestRelPath: '.forge/manifest.md',
      worktreePath: root,
      iterationBudget: 3,
      qualityGateCmd: ['npm', 'test'],
    });
    assert.ok(existsSync(out.promptPath));
    assert.ok(existsSync(out.agentMdPath));
    assert.ok(existsSync(out.fixPlanPath));
    const prompt = readFileSync(out.promptPath, 'utf8');
    assert.ok(prompt.includes('INIT-x'));
    assert.ok(prompt.includes('WI-1'));
    // No artifactRoot ⇒ legacy demo/<id> dir.
    assert.ok(prompt.includes('demo/INIT-x/'), 'legacy demo dir in the prompt');
    assert.ok(!prompt.includes('history/INIT-x/demo'), 'no artifactRoot path when unset');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareUnifierWorkspace: resolves the artifactRoot-aware demo dir into the prompt', () => {
  const root = newTempDir();
  try {
    mkdirSync(join(root, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(root, '.forge', 'manifest.md'), '# manifest');
    // A worktree carrying artifactRoot: "forge" lands its demo under
    // forge/history/<id>/demo — the prompt must name that exact path so the
    // agent writes where the snapshot + gate + `forge demo render` expect it.
    writeFileSync(
      join(root, '.forge', 'project.json'),
      JSON.stringify({ artifactRoot: 'forge', quality_gate_cmd: ['true'] }),
    );
    const out = prepareUnifierWorkspace({
      initiativeId: 'INIT-x',
      manifestRelPath: '.forge/manifest.md',
      worktreePath: root,
      iterationBudget: 3,
      qualityGateCmd: ['npm', 'test'],
    });
    const prompt = readFileSync(out.promptPath, 'utf8');
    assert.ok(prompt.includes('forge/history/INIT-x/demo'), 'artifactRoot-resolved demo dir in the prompt');
    assert.ok(!prompt.includes('`demo/INIT-x/'), 'no bare legacy demo dir when artifactRoot is set');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderUnifierUserPrompt: includes project demo process when demoProcess provided', () => {
  const prompt = renderUnifierUserPrompt({
    initiativeId: 'INIT-test',
    manifestRelPath: '.forge/manifest.md',
    workItemSpecs: [],
    iteration: 1,
    iterationBudget: 3,
    qualityGateCmd: ['npm', 'test'],
    demoProcess: [
      { kind: 'capture', text: 'Screenshot of live resource' },
      { kind: 'verify', text: 'Project tests green' },
    ],
  });
  assert.ok(prompt.includes('## Project demo process'), 'should include demo process header');
  assert.ok(prompt.includes('[CAPTURE] Screenshot of live resource'), 'should list capture step');
  assert.ok(prompt.includes('[VERIFY] Project tests green'), 'should list verify step');
});

test('renderUnifierUserPrompt: includes project skills when skills provided', () => {
  const prompt = renderUnifierUserPrompt({
    initiativeId: 'INIT-test',
    manifestRelPath: '.forge/manifest.md',
    workItemSpecs: [],
    iteration: 1,
    iterationBudget: 3,
    qualityGateCmd: ['npm', 'test'],
    skills: ['tdd-workflow', 'backend-patterns'],
  });
  assert.ok(prompt.includes('## Project skills'), 'should include skills header');
  assert.ok(prompt.includes('`tdd-workflow`'), 'should include tdd-workflow skill');
  assert.ok(prompt.includes('`backend-patterns`'), 'should include backend-patterns skill');
});

test('renderUnifierUserPrompt: no project demo/skills blocks when fields absent', () => {
  const prompt = renderUnifierUserPrompt({
    initiativeId: 'INIT-test',
    manifestRelPath: '.forge/manifest.md',
    workItemSpecs: [],
    iteration: 1,
    iterationBudget: 3,
    qualityGateCmd: ['npm', 'test'],
  });
  assert.ok(!prompt.includes('## Project demo process'), 'should not include demo process when absent');
  assert.ok(!prompt.includes('## Project skills'), 'should not include skills when absent');
});
