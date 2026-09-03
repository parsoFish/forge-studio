/**
 * `createClaudeAgent`'s callback sidecars — the machinery wired AROUND the
 * query loop rather than inside it.
 *
 * Three clusters, each with its own banner below:
 *   - **S7 / C13** the `agent_heartbeat` timer, driven by a mocked clock so
 *     the firing is deterministic, plus the idle tail that emits one final
 *     heartbeat when the interval never fired.
 *   - **Change B** `onUsageDelta`: once per unique `message.id`, once on the
 *     id-less path, never when usage is absent, and a throwing consumer must
 *     not break the loop.
 *   - **R2-03-F4** the external (wedge-kill) signal chaining into the
 *     iteration's abort controller, including the already-aborted case and the
 *     listener-accumulation check across iterations.
 *
 * SPLIT FROM `ralph/claude-agent.test.ts` (846 lines) at the seam that file
 * declared. The core SDK-glue contract stayed in
 * `integration/claude-agent.test.ts`; these three share the mocked-timer and
 * event-listener machinery and nothing else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClaudeAgent, type QueryFn } from '../../ralph/claude-agent.ts';

/** The sibling suite's fake `query`, duplicated rather than exported — the
 *  precedent `integration/claude-agent.reasoning.test.ts` already set in this
 *  package: a `.test.ts` that exports a helper becomes an import target for
 *  other tests and starts constraining what it may assert. */
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

// ---------------------------------------------------------------------------
// Change B — onUsageDelta: per-turn token-usage signal.
// ---------------------------------------------------------------------------

test('createClaudeAgent: onUsageDelta fires once per unique message.id in the assistant stream', async () => {
  // Verifies that:
  //   (a) the callback fires when message.usage is present, and
  //   (b) duplicate message.id blocks (parallel tool-use pattern) are deduped
  //       so the callback fires exactly once per logical assistant turn.
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-usage-delta-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const deltas: Array<{
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }> = [];

    // Two distinct assistant messages (id: 'msg-1', 'msg-2'). msg-1 is
    // yielded twice — simulating the SDK replaying the same message for a
    // second parallel tool-use block. The adapter must deduplicate so the
    // callback fires for msg-1 only once.
    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [
          {
            type: 'assistant',
            message: {
              id: 'msg-1',
              content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
              usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 },
            },
          },
          // Same id as above — duplicate; must be suppressed.
          {
            type: 'assistant',
            message: {
              id: 'msg-1',
              content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } }],
              usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 },
            },
          },
          // Second distinct message — must fire.
          {
            type: 'assistant',
            message: {
              id: 'msg-2',
              content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/tmp/y', content: 'x' } }],
              usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            },
          },
          { type: 'result', subtype: 'success', total_cost_usd: 0.05, num_turns: 3 },
        ],
        captured,
      ),
      onUsageDelta: (u) => deltas.push(u),
    });

    await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(deltas.length, 2, 'two unique message ids → two delta callbacks');
    assert.deepEqual(deltas[0], { inputTokens: 100, outputTokens: 20, cacheReadTokens: 500, cacheCreationTokens: 50 });
    assert.deepEqual(deltas[1], { inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: onUsageDelta fires once when message has no id (id-less dedup path)', async () => {
  // When message.id is absent (future SDK shape or test stub), the adapter
  // must still call the callback if usage is present — but it cannot deduplicate
  // across id-less messages, so each such message fires independently.
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-usage-noid-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const deltas: Array<{ inputTokens: number }> = [];
    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [
          {
            type: 'assistant',
            message: {
              // no `id` field
              content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pwd' } }],
              usage: { input_tokens: 77 },
            },
          },
          { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 },
        ],
        captured,
      ),
      onUsageDelta: (u) => deltas.push({ inputTokens: u.inputTokens }),
    });

    await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(deltas.length, 1, 'id-less message with usage fires once');
    assert.equal(deltas[0]!.inputTokens, 77);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: onUsageDelta not called when usage is absent from assistant message', async () => {
  // No usage block → callback must not fire even if a message.id is present.
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-usage-absent-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    let fired = 0;
    const captured: CapturedCall[] = [];
    const agent = createClaudeAgent({
      queryFn: fakeQuery(
        [
          {
            type: 'assistant',
            message: {
              id: 'msg-no-usage',
              content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
              // no `usage` field
            },
          },
          { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 },
        ],
        captured,
      ),
      onUsageDelta: () => { fired += 1; },
    });

    await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(fired, 0, 'onUsageDelta must not fire when usage is absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: a throwing onUsageDelta consumer does not break the agent loop', async () => {
  // The adapter must swallow exceptions from the callback so misbehaving
  // consumers cannot kill the SDK stream.
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-usage-throw-'));
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
              id: 'msg-x',
              content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } }],
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          },
          { type: 'result', subtype: 'success', total_cost_usd: 0.02, num_turns: 1 },
        ],
        captured,
      ),
      onUsageDelta: () => { throw new Error('consumer exploded'); },
    });

    // Must not throw despite the callback throwing.
    const result = await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(result.costUsd, 0.02, 'cost still captured after throwing consumer');
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

test('createClaudeAgent: R2-03-F4 — externalSignal (wedge-kill) chains into the iteration abort controller', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-kill-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');

    const ext = new AbortController();
    let captured: AbortController | undefined;
    // A generator that yields once, then pauses until the iteration controller
    // aborts — so the test can fire the external signal mid-flight and observe
    // the chain propagate before the invocation settles.
    const queryFn = ((params: { options?: Record<string, unknown> }) => {
      captured = params.options?.abortController as AbortController;
      async function* gen() {
        yield { type: 'assistant', message: { content: [] } };
        await new Promise<void>((res) => {
          const sig = captured!.signal;
          if (sig.aborted) res();
          else sig.addEventListener('abort', () => res(), { once: true });
        });
        yield { type: 'result', subtype: 'error', total_cost_usd: 0 };
      }
      return gen() as never;
    }) as unknown as QueryFn;

    const agent = createClaudeAgent({ externalSignal: ext.signal, queryFn });
    const p = agent({ promptPath, agentMdPath: join(dir, 'AGENT.md'), fixPlanPath: join(dir, 'fix_plan.md'), worktreePath: dir, iteration: 1 });
    await new Promise((r) => setTimeout(r, 10)); // let the generator yield + capture the controller

    assert.ok(captured, 'the query received the per-iteration abortController');
    assert.equal(captured!.signal.aborted, false, 'not aborted before the external wedge-kill fires');
    ext.abort(); // the flow node is wedge-killed
    // The abortController the SDK receives is aborted — the SDK/idle-deadline
    // wiring cancels the CLI subprocess off this same controller.
    assert.equal(captured!.signal.aborted, true, 'external wedge-kill aborts the iteration controller the SDK query received');
    await p.catch(() => {}); // let the invocation settle
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: R2-03-F4 — an already-aborted externalSignal cancels the iteration immediately', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-kill2-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');
    const ext = new AbortController();
    ext.abort(); // already killed before the iteration starts
    let captured: AbortController | undefined;
    const queryFn = ((params: { options?: Record<string, unknown> }) => {
      captured = params.options?.abortController as AbortController;
      async function* gen() { yield { type: 'result', subtype: 'error', total_cost_usd: 0 }; }
      return gen() as never;
    }) as unknown as QueryFn;
    const agent = createClaudeAgent({ externalSignal: ext.signal, queryFn });
    await agent({ promptPath, agentMdPath: join(dir, 'AGENT.md'), fixPlanPath: join(dir, 'fix_plan.md'), worktreePath: dir, iteration: 1 }).catch(() => {});
    assert.equal(captured!.signal.aborted, true, 'a pre-aborted external signal aborts the iteration controller at once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createClaudeAgent: R2-03-F4 — the external-abort listener does not accumulate across iterations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-agent-listener-'));
  try {
    const promptPath = join(dir, 'PROMPT.md');
    writeFileSync(promptPath, 'noop');
    const ext = new AbortController();
    // A queryFn that completes normally (the common case) — the leak the review
    // flagged: {once:true} does NOT self-remove a listener that never fires.
    const queryFn = fakeQuery([{ type: 'result', subtype: 'success', total_cost_usd: 0 }], []);
    const agent = createClaudeAgent({ externalSignal: ext.signal, queryFn });
    for (let i = 0; i < 5; i++) {
      await agent({ promptPath, agentMdPath: join(dir, 'AGENT.md'), fixPlanPath: join(dir, 'fix_plan.md'), worktreePath: dir, iteration: i });
    }
    const listeners = getEventListeners(ext.signal, 'abort');
    assert.ok(listeners.length <= 1, `abort listeners must not accumulate across iterations — saw ${listeners.length} after 5 non-aborted runs`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
