/**
 * createClaudeAgent + declared project skills (ADR 024 item 90) — the
 * dev-loop builder. `worktreePath` (an explicit, call-time AgentInvocation
 * parameter — never guessed from `process.cwd()`) IS the project directory
 * for a per-WI Ralph iteration, so this closure resolves the SAME
 * `.forge/project.json` `skills[]` `checkSkills`/`loadDeclaredSkills` do and
 * folds their SKILL.md text into `options.systemPrompt`.
 *
 * Mirrors `claude-agent.reasoning.test.ts`'s fakeQuery/DI pattern.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClaudeAgent, type QueryFn } from '../../ralph/claude-agent.ts';

function fakeQuery(captured: { options: Record<string, unknown> | null }): QueryFn {
  return ((params: { prompt: string; options?: Record<string, unknown> }) => {
    captured.options = params.options ?? null;
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 };
    }
    return gen() as never;
  }) as unknown as QueryFn;
}

function declareProjectWithSkill(dir: string, skillId: string, skillText: string): void {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, skills: [skillId] }));
  mkdirSync(join(dir, '.forge', 'skills', skillId), { recursive: true });
  writeFileSync(join(dir, '.forge', 'skills', skillId, 'SKILL.md'), skillText);
}

test('createClaudeAgent: a project worktree declaring a skill folds its SKILL.md text into systemPrompt and fires onProjectSkillsLoaded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-project-skills-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');
    declareProjectWithSkill(dir, 'y', '# y\n\nDo the y thing.');

    const captured: { options: Record<string, unknown> | null } = { options: null };
    const loadedIds: string[][] = [];
    const agent = createClaudeAgent({
      systemPrompt: 'DEV BASE PROMPT',
      queryFn: fakeQuery(captured),
      onProjectSkillsLoaded: (ids) => { loadedIds.push(ids); },
    });

    await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    const systemPrompt = captured.options!.systemPrompt as string;
    assert.ok(systemPrompt.startsWith('DEV BASE PROMPT'));
    assert.match(systemPrompt, /## Project skills \(declared in \.forge\/project\.json\)/);
    assert.match(systemPrompt, /### y/);
    assert.match(systemPrompt, /Do the y thing\./);
    assert.deepEqual(loadedIds, [['y']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: a worktree with NO declared skills leaves systemPrompt byte-identical and never fires onProjectSkillsLoaded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-project-skills-none-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');

    const captured: { options: Record<string, unknown> | null } = { options: null };
    let fired = false;
    const agent = createClaudeAgent({
      systemPrompt: 'DEV BASE PROMPT',
      queryFn: fakeQuery(captured),
      onProjectSkillsLoaded: () => { fired = true; },
    });

    await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(captured.options!.systemPrompt, 'DEV BASE PROMPT');
    assert.equal(fired, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: a declared skill that does not resolve THROWS — fail fast, no silent skip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-project-skills-missing-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, skills: ['ghost-skill'] }));

    const captured: { options: Record<string, unknown> | null } = { options: null };
    const agent = createClaudeAgent({ queryFn: fakeQuery(captured) });

    await assert.rejects(
      agent({
        promptPath: join(dir, 'PROMPT.md'),
        agentMdPath: join(dir, 'AGENT.md'),
        fixPlanPath: join(dir, 'fix_plan.md'),
        worktreePath: dir,
        iteration: 1,
      }),
      /ghost-skill/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// PRESENTATION_ONLY_SKILL_IDS (bead forge-mfv5.2.2 / forge-mfv5.2.8):
// `demo-design` is Studio-presentation guidance, never a cycle input, so it
// must never reach an agent's systemPrompt even when declared and present.
test('createClaudeAgent: a project declaring ["demo-design", "x"] folds ONLY x into systemPrompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-project-skills-presentation-only-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, skills: ['demo-design', 'x'] }),
    );
    mkdirSync(join(dir, '.forge', 'skills', 'demo-design'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'demo-design', 'SKILL.md'), '# demo-design\n\nCompose the presentation.');
    mkdirSync(join(dir, '.forge', 'skills', 'x'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'x', 'SKILL.md'), '# x\n\nDo the x thing.');

    const captured: { options: Record<string, unknown> | null } = { options: null };
    const loadedIds: string[][] = [];
    const agent = createClaudeAgent({
      systemPrompt: 'DEV BASE PROMPT',
      queryFn: fakeQuery(captured),
      onProjectSkillsLoaded: (ids) => { loadedIds.push(ids); },
    });

    await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    const systemPrompt = captured.options!.systemPrompt as string;
    assert.match(systemPrompt, /### x/);
    assert.match(systemPrompt, /Do the x thing\./);
    assert.doesNotMatch(systemPrompt, /### demo-design/);
    assert.doesNotMatch(systemPrompt, /Compose the presentation\./);
    assert.deepEqual(loadedIds, [['x']], 'the loaded-ids event must also exclude the presentation-only id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
