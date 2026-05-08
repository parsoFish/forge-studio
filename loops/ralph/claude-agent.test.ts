/**
 * Unit tests for createClaudeAgent — verifies the SDK glue without hitting the
 * network. We inject a fake `query` that yields a known message stream, then
 * assert that:
 *   - PROMPT.md is read from the worktree and passed as the prompt.
 *   - cwd / model / allowedTools / permissionMode are forwarded to the SDK.
 *   - tool_use events for Write/Edit/MultiEdit/NotebookEdit produce filesChanged entries.
 *   - the final result message's total_cost_usd is captured as costUsd.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClaudeAgent, type QueryFn } from './claude-agent.ts';

type CapturedCall = { prompt: string; options: Record<string, unknown> };

/** Build a fake SDK `query` that records its inputs and yields a fixed message stream. */
function fakeQuery(messages: unknown[], captured: CapturedCall[]): QueryFn {
  return ((params: { prompt: string | AsyncIterable<unknown>; options?: Record<string, unknown> }) => {
    captured.push({
      prompt: typeof params.prompt === 'string' ? params.prompt : '<async-iterable>',
      options: params.options ?? {},
    });
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen() as never;
  }) as unknown as QueryFn;
}

test('createClaudeAgent: passes PROMPT.md content + options through to query()', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, '# Work item — WI-7\n\nDo the thing.');

    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      model: 'claude-sonnet-4-6',
      allowedTools: ['Read', 'Write'],
      maxTurnsPerIteration: 5,
      maxBudgetUsdPerIteration: 0.25,
      queryFn: fakeQuery(
        [
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.12,
            num_turns: 3,
          },
        ],
        captured,
      ),
    });

    await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(captured.length, 1, 'query() called once');
    assert.equal(captured[0]!.prompt, '# Work item — WI-7\n\nDo the thing.');
    assert.equal(captured[0]!.options.cwd, dir);
    assert.equal(captured[0]!.options.model, 'claude-sonnet-4-6');
    assert.deepEqual(captured[0]!.options.allowedTools, ['Read', 'Write']);
    assert.equal(captured[0]!.options.maxTurns, 5);
    assert.equal(captured[0]!.options.maxBudgetUsd, 0.25);
    assert.equal(captured[0]!.options.permissionMode, 'acceptEdits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: extracts filesChanged from tool_use events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: "I'll edit two files." },
                { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/a.ts', content: 'x' } },
                { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/b.ts', old_string: 'a', new_string: 'b' } },
                { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }, // not a file-modifying tool
                { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/a.ts', content: 'y' } }, // duplicate
              ],
            },
          },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  name: 'NotebookEdit',
                  input: { notebook_path: '/tmp/n.ipynb', new_source: 'print(1)' },
                },
                { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/c.ts' } }, // read isn't a modify
              ],
            },
          },
          { type: 'result', subtype: 'success', total_cost_usd: 0.05, num_turns: 2 },
        ],
        captured,
      ),
    });

    const result = await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 2,
    });

    assert.deepEqual(
      [...result.filesChanged].sort(),
      ['/tmp/a.ts', '/tmp/b.ts', '/tmp/n.ipynb'],
      'unique paths from Write/Edit/NotebookEdit only',
    );
    assert.equal(result.costUsd, 0.05, 'cost from result message');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: zero cost when result message is missing or errored', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [
          { type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.03, num_turns: 10 },
        ],
        captured,
      ),
    });

    const result = await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    // Even an error result should surface its cost so the budget tracker is honest.
    assert.equal(result.costUsd, 0.03);
    assert.deepEqual(result.filesChanged, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
