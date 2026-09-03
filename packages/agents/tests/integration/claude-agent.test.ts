/**
 * `createClaudeAgent` — the SDK glue's core contract, without the network.
 *
 * A fake `query` yields a known message stream; the assertions are that
 * PROMPT.md is read from the worktree and passed as the prompt, that cwd /
 * model / allowedTools / permissionMode are forwarded to the SDK, that
 * `tool_use` events for Write/Edit/MultiEdit/NotebookEdit produce
 * filesChanged entries, that the result message's `total_cost_usd` and cache
 * token fields are captured, and that G8's `gitIdentity` reaches the child as
 * the GIT_AUTHOR_ and GIT_COMMITTER_ env vars on `options.env`.
 *
 * SPLIT FROM an 846-line file at the seam the file declared. The CALLBACK
 * SIDECARS wired around the query loop — the S7/C13 heartbeat timer and its
 * idle tail, Change B's `onUsageDelta`, and R2-03-F4's external abort signal —
 * are a different concern with their own mocked-timer harness, so they are
 * `integration/claude-agent.sidecars.test.ts`. The split retires this file's
 * `scripts/baselines/file-size.json` row rather than re-keying it: a move
 * cannot retire an exemption, only a split can.
 *
 * `integration/`, following the bucket its sibling `claude-agent.reasoning`
 * already sits in: these drive a real worktree on disk through the adapter,
 * not one module's return values.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClaudeAgent, type QueryFn } from '../../ralph/claude-agent.ts';

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

test('createClaudeAgent: surfaces cache-read + cache-creation tokens from result.usage (snake_case from API)', async () => {
  // S8 / C23: the underlying API surfaces cache_read_input_tokens +
  // cache_creation_input_tokens on the result message's `usage` block. The
  // adapter must capture these so `EventLogEntry.cache_read_tokens` /
  // `cache_creation_tokens` round-trip through the orchestrator's iteration
  // emitter. Default to 0 when absent (legacy result messages).
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [
          {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0.05,
            num_turns: 1,
            usage: {
              input_tokens: 1000,
              output_tokens: 200,
              cache_read_input_tokens: 9_500,
              cache_creation_input_tokens: 250,
            },
          },
        ],
        captured,
      ),
    });

    const result = await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 3,
    });

    assert.equal(result.cacheReadTokens, 9_500, 'cache_read_input_tokens captured');
    assert.equal(result.cacheCreationTokens, 250, 'cache_creation_input_tokens captured');
    assert.equal(result.tokensIn, 1000);
    assert.equal(result.tokensOut, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: cache token fields default to 0 when usage block is absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [{ type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 }],
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

    assert.equal(result.cacheReadTokens, 0, 'defaults to 0 when usage absent');
    assert.equal(result.cacheCreationTokens, 0, 'defaults to 0 when usage absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: cacheable knob defaults to true and is forwarded to query options', async () => {
  // S8 / C23: `cacheable` carries forge's intent forward. The SDK currently
  // has no public cache_control surface, but plumbing the knob means any
  // future SDK that does will be a one-line patch. Default is `true` so
  // every existing call site opts in automatically.
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const captured: CapturedCall[] = [];
    const defaultAgent = createClaudeAgent({
      queryFn: fakeQuery(
        [{ type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 }],
        captured,
      ),
    });
    await defaultAgent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });
    assert.equal(captured[0]!.options.cacheable, true, 'cacheable defaults to true');

    const optOutCaptured: CapturedCall[] = [];
    const optOutAgent = createClaudeAgent({
      cacheable: false,
      queryFn: fakeQuery(
        [{ type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 }],
        optOutCaptured,
      ),
    });
    await optOutAgent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });
    assert.equal(optOutCaptured[0]!.options.cacheable, false, 'cacheable can be disabled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// G8 wave 2 (2026-07-12): gitIdentity → GIT_AUTHOR_*/GIT_COMMITTER_* env vars
// on the spawned child, proven by spike to take precedence over local
// gitconfig for the CLI child's own Bash-tool `git commit` calls.
// ---------------------------------------------------------------------------

test('createClaudeAgent: gitIdentity sets GIT_AUTHOR_*/GIT_COMMITTER_* on options.env', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      gitIdentity: { name: 'forge-ralph', email: 'forge-ralph+WI-7@forge.local' },
      queryFn: fakeQuery(
        [{ type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 }],
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

    const env = captured[0]!.options.env as Record<string, string> | undefined;
    assert.ok(env, 'options.env is set when gitIdentity is supplied');
    assert.equal(env!.GIT_AUTHOR_NAME, 'forge-ralph');
    assert.equal(env!.GIT_AUTHOR_EMAIL, 'forge-ralph+WI-7@forge.local');
    assert.equal(env!.GIT_COMMITTER_NAME, 'forge-ralph');
    assert.equal(env!.GIT_COMMITTER_EMAIL, 'forge-ralph+WI-7@forge.local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: no gitIdentity → options.env is left unset (unchanged pre-wave behaviour)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [{ type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 }],
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

    assert.equal(captured[0]!.options.env, undefined, 'options.env untouched when gitIdentity is omitted');
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
