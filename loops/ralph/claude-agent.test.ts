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

// ---------------------------------------------------------------------------
// S7 / C13 — agent_heartbeat sidecar timer.
// ---------------------------------------------------------------------------

/**
 * Mocked timer harness for the heartbeat test. Records every
 * `setInterval`-driven callback, advances a synthetic clock, and lets the
 * test drive when the heartbeat fires deterministically.
 */
function mockTimers() {
  let now = 0;
  const intervals: Array<{ fn: () => void; ms: number; alive: boolean; nextFireAt: number }> = [];
  return {
    api: {
      setInterval: (fn: () => void, ms: number) => {
        const handle = { fn, ms, alive: true, nextFireAt: now + ms };
        intervals.push(handle);
        return handle;
      },
      clearInterval: (handle: unknown) => {
        const h = handle as { alive: boolean } | null;
        if (h) h.alive = false;
      },
      now: () => now,
    },
    advance(ms: number) {
      const target = now + ms;
      // Fire any intervals whose nextFireAt falls in (now, target].
      // Repeat for multi-interval crossings within one advance call.
      while (true) {
        let earliest: { idx: number; at: number } | null = null;
        for (let i = 0; i < intervals.length; i++) {
          const h = intervals[i]!;
          if (!h.alive) continue;
          if (h.nextFireAt > target) continue;
          if (earliest === null || h.nextFireAt < earliest.at) {
            earliest = { idx: i, at: h.nextFireAt };
          }
        }
        if (earliest === null) break;
        now = earliest.at;
        const h = intervals[earliest.idx]!;
        h.fn();
        h.nextFireAt = now + h.ms;
      }
      now = target;
    },
  };
}

test('createClaudeAgent: emits ≥1 agent_heartbeat during a synthetic 30s SDK call (S7 / C13)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const heartbeats: Array<{ tool_use_count: number; last_tool: string; since_ms: number }> = [];
    const timers = mockTimers();

    // Synthetic SDK that "sleeps" 30s of mocked time before emitting result.
    // We model the sleep by yielding tool_use blocks interleaved with
    // `timers.advance()` calls (so the interval timer fires at virtual
    // 15s + 30s while the for-await loop iterates).
    const captured: CapturedCall[] = [];
    const slowQuery: QueryFn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
      captured.push({ prompt: params.prompt, options: params.options ?? {} });
      async function* gen() {
        // 0s: tool_use Bash
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pytest' } }] },
        };
        timers.advance(20_000);
        // 20s: tool_use Read
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } }] },
        };
        timers.advance(15_000);
        // 35s: result. Interval fires expected at 15_000 and 30_000.
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.05, num_turns: 2 };
      }
      return gen() as never;
    }) as unknown as QueryFn;

    const agent = createClaudeAgent({
      queryFn: slowQuery,
      onHeartbeat: (info) => heartbeats.push(info),
      heartbeatIntervalMs: 15_000,
      heartbeatIdleTailMs: 30_000,
      timers: timers.api,
    });

    await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.ok(
      heartbeats.length >= 1,
      `expected ≥1 heartbeat over a 35s synthetic SDK call, got ${heartbeats.length}`,
    );
    for (const h of heartbeats) {
      assert.equal(typeof h.tool_use_count, 'number');
      assert.equal(typeof h.last_tool, 'string');
      assert.equal(typeof h.since_ms, 'number');
      assert.ok(h.since_ms > 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: no heartbeats when onHeartbeat is unset (default)', async () => {
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
    const r = await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });
    assert.equal(r.costUsd, 0.01);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: idle-tail emits 1 final heartbeat when interval did not fire (S7 / C13)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    // Mocked timers where setInterval registers but is NEVER advanced —
    // simulates a saturated event loop / a mocked SDK that wedges before
    // the timer can fire. The idle-tail invariant should still produce
    // exactly one heartbeat at cleanup time.
    let now = 0;
    const heartbeats: Array<{ since_ms: number }> = [];
    const captured: CapturedCall[] = [];
    const fastResultQuery: QueryFn = ((params: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => {
      captured.push({ prompt: params.prompt, options: params.options ?? {} });
      async function* gen() {
        now += 31_000;
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.02, num_turns: 1 };
      }
      return gen() as never;
    }) as unknown as QueryFn;

    const agent = createClaudeAgent({
      queryFn: fastResultQuery,
      onHeartbeat: (info) => heartbeats.push(info),
      heartbeatIntervalMs: 15_000,
      heartbeatIdleTailMs: 30_000,
      timers: {
        setInterval: () => ({} as unknown),
        clearInterval: () => undefined,
        now: () => now,
      },
    });

    await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    // No interval fires occurred, but elapsed (31s) ≥ idleTailMs (30s)
    // ⇒ exactly one tail heartbeat.
    assert.equal(heartbeats.length, 1, `expected 1 tail heartbeat, got ${heartbeats.length}`);
    assert.ok(heartbeats[0]!.since_ms >= 30_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
