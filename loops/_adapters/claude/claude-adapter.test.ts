/**
 * Tests for the Claude reference adapter (M6-1, ADR 029).
 *
 * Verifies:
 *   1. claudeAdapter satisfies the RuntimeAdapter interface (id, available,
 *      createAgent, query are present and the right types).
 *   2. claudeAdapter.createAgent is a transparent wrapper around
 *      createClaudeAgent — calling it with a mock queryFn produces the same
 *      AgentInvocation shape as calling createClaudeAgent directly.
 *   3. AdapterAgentOptions / RuntimeAdapter types exported from types.ts are
 *      consistent (type-level — checked at compile time, exercised at runtime
 *      by the instanceof + shape checks).
 *
 * No real SDK calls — all network traffic is replaced by a mock queryFn.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claudeAdapter } from './index.ts';
import { createClaudeAgent, type QueryFn } from '../../ralph/claude-agent.ts';
import type { RuntimeAdapter, AdapterAgentOptions } from '../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock queryFn that yields a single result message. */
function minimalQueryFn(): QueryFn {
  return (() => {
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 };
    }
    return gen();
  }) as unknown as QueryFn;
}

/** Write a temp PROMPT.md and return the dir + promptPath. */
function makeTmpDir(content = '# test prompt'): { dir: string; promptPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-adapter-claude-'));
  const promptPath = join(dir, 'PROMPT.md');
  writeFileSync(promptPath, content);
  return { dir, promptPath };
}

// ---------------------------------------------------------------------------
// Suite 1: interface shape
// ---------------------------------------------------------------------------

test('claudeAdapter: satisfies RuntimeAdapter — id is "claude"', () => {
  assert.equal(claudeAdapter.id, 'claude');
});

test('claudeAdapter: satisfies RuntimeAdapter — available is true', () => {
  assert.equal(claudeAdapter.available, true);
});

test('claudeAdapter: satisfies RuntimeAdapter — createAgent is a function', () => {
  assert.equal(typeof claudeAdapter.createAgent, 'function');
});

test('claudeAdapter: satisfies RuntimeAdapter — query is a function', () => {
  assert.equal(typeof claudeAdapter.query, 'function');
});

// Type-level: confirm claudeAdapter is assignable to RuntimeAdapter.
// This test body is trivial; the value is the compile-time check.
test('claudeAdapter: is assignable to RuntimeAdapter type (compile-time check via assignment)', () => {
  const adapter: RuntimeAdapter = claudeAdapter;
  assert.equal(adapter.id, 'claude');
});

// ---------------------------------------------------------------------------
// Suite 2: createAgent is a transparent wrapper around createClaudeAgent
// ---------------------------------------------------------------------------

test('claudeAdapter.createAgent: returns an AgentInvocation (callable)', () => {
  const opts: AdapterAgentOptions = { queryFn: minimalQueryFn() };
  const agentViaAdapter = claudeAdapter.createAgent(opts);
  assert.equal(typeof agentViaAdapter, 'function', 'createAgent must return a function');
});

test('claudeAdapter.createAgent: produces same AgentIterationInfo shape as createClaudeAgent directly', async () => {
  const { dir, promptPath } = makeTmpDir();
  try {
    const opts: AdapterAgentOptions = { queryFn: minimalQueryFn() };

    // Via adapter
    const agentViaAdapter = claudeAdapter.createAgent(opts);
    const resultViaAdapter = await agentViaAdapter({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    // Directly via createClaudeAgent (same opts, fresh mock)
    const agentDirect = createClaudeAgent({ queryFn: minimalQueryFn() });
    const resultDirect = await agentDirect({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    // Shape must be identical: both return AgentIterationInfo
    assert.deepEqual(
      Object.keys(resultViaAdapter).sort(),
      Object.keys(resultDirect).sort(),
      'adapter result has same keys as direct result',
    );

    // Core values from the mock message
    assert.equal(resultViaAdapter.costUsd, 0.01, 'costUsd from mock result');
    assert.deepEqual(resultViaAdapter.filesChanged, [], 'no files changed (mock had no tool_use)');
    assert.equal(resultDirect.costUsd, 0.01, 'direct costUsd matches');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claudeAdapter.createAgent: forwards options to createClaudeAgent (model, allowedTools)', async () => {
  const { dir, promptPath } = makeTmpDir('# hello');
  try {
    const captured: Array<{ options: Record<string, unknown> }> = [];
    const captureQuery: QueryFn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
      captured.push({ options: params.options ?? {} });
      async function* gen() {
        yield { type: 'result', subtype: 'success', total_cost_usd: 0, num_turns: 1 };
      }
      return gen();
    }) as unknown as QueryFn;

    const opts: AdapterAgentOptions = {
      model: 'claude-sonnet-4-6',
      allowedTools: ['Read', 'Write'],
      queryFn: captureQuery,
    };

    const agent = claudeAdapter.createAgent(opts);
    await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.equal(captured.length, 1, 'query called once');
    assert.equal(captured[0]!.options.model, 'claude-sonnet-4-6', 'model forwarded');
    assert.deepEqual(captured[0]!.options.allowedTools, ['Read', 'Write'], 'allowedTools forwarded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
