/**
 * Studio observability sub-gap #2 — unit tests for the onReasoning callback.
 *
 * Verifies that given a mock SDK stream yielding an assistant message with
 * text blocks, `onReasoning` fires once per non-empty text block with the
 * (truncated) text, and does NOT fire for empty/whitespace-only blocks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClaudeAgent, type QueryFn } from './claude-agent.ts';

function fakeQuery(messages: unknown[]): QueryFn {
  return ((_params: { prompt: string; options?: Record<string, unknown> }) => {
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen() as never;
  }) as unknown as QueryFn;
}

test('onReasoning: fires once per non-empty text block', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-agent-reasoning-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');

    const calls: string[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'I will read the file first.' },
              { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x.ts' } },
              { type: 'text', text: 'Now I will write the implementation.' },
            ],
          },
        },
        { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 },
      ]),
      onReasoning: (text) => { calls.push(text); },
    });

    await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(calls.length, 2, 'fires once per non-empty text block');
    assert.equal(calls[0], 'I will read the file first.');
    assert.equal(calls[1], 'Now I will write the implementation.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('onReasoning: skips empty and whitespace-only text blocks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-agent-reasoning-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');

    const calls: string[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: '' },           // empty — skip
              { type: 'text', text: '   \n\t  ' },  // whitespace only — skip
              { type: 'text', text: 'Real reasoning here.' },
            ],
          },
        },
        { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 },
      ]),
      onReasoning: (text) => { calls.push(text); },
    });

    await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(calls.length, 1, 'only the non-empty block fires');
    assert.equal(calls[0], 'Real reasoning here.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('onReasoning: truncates text blocks exceeding 400 chars', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-agent-reasoning-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');

    const longText = 'A'.repeat(500);
    const calls: string[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: longText },
            ],
          },
        },
        { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 },
      ]),
      onReasoning: (text) => { calls.push(text); },
    });

    await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(calls.length, 1);
    // Truncated to 400 chars + ellipsis character
    assert.equal(calls[0]!.length, 401, 'truncated to 400 chars + ellipsis');
    assert.ok(calls[0]!.endsWith('…'), 'ends with ellipsis');
    assert.equal(calls[0]!.slice(0, 400), 'A'.repeat(400));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('onReasoning: not required — agent works without it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-agent-reasoning-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');

    const agent = createClaudeAgent({
      queryFn: fakeQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Some reasoning without a callback.' },
            ],
          },
        },
        { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 },
      ]),
      // onReasoning deliberately omitted
    });

    // Must not throw
    const result = await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(result.lastAssistantText, 'Some reasoning without a callback.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('onReasoning: throwing consumer does not break agent loop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-agent-reasoning-'));
  try {
    writeFileSync(join(dir, 'PROMPT.md'), 'test prompt');

    const agent = createClaudeAgent({
      queryFn: fakeQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Block one.' },
              { type: 'text', text: 'Block two.' },
            ],
          },
        },
        { type: 'result', subtype: 'success', total_cost_usd: 0.02, num_turns: 1 },
      ]),
      onReasoning: (_text) => { throw new Error('consumer exploded'); },
    });

    // Must not throw despite the consumer throwing
    const result = await agent({
      promptPath: join(dir, 'PROMPT.md'),
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(result.costUsd, 0.02, 'result still resolved after consumer throw');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
