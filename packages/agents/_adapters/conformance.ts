/**
 * Adapter conformance suite (M6-2, ADR 029).
 *
 * `runAdapterConformance(adapter, opts?)` — defines what EVERY RuntimeAdapter
 * must satisfy. This is the admission gate: a real second SDK adapter (Codex,
 * Gemini, local) must pass this suite BEFORE being registered.
 *
 * Usage in a test file:
 *
 *   import { describe } from 'node:test';
 *   import { runAdapterConformance } from '../conformance.ts';
 *   import { exampleAdapter } from '../example/index.ts';
 *   import { claudeAdapter } from '../claude/index.ts';
 *
 *   describe('example adapter conformance', () => {
 *     runAdapterConformance(exampleAdapter);
 *   });
 *
 *   describe('claude adapter conformance (mock queryFn)', () => {
 *     runAdapterConformance(claudeAdapter, { queryFn: mockQueryFn });
 *   });
 *
 * The `queryFn` opt injects a mock stream into the adapter's createAgent call
 * so no real SDK / API call is made during CI. This is how the Claude adapter
 * is tested: its createAgent wires a real queryFn by default, but when
 * `opts.queryFn` is provided in AdapterAgentOptions, it substitutes that
 * stream — so conformance proves the adapter handles a well-formed stream
 * correctly regardless of which SDK generated it.
 *
 * Structure: flat `test()` blocks so callers can nest inside a `describe()`
 * to get per-adapter grouping in the test report.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RuntimeAdapter, AdapterAgentOptions, QueryFn } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a temp PROMPT.md and return the dir + promptPath. Cleaned up by caller. */
function makeTmpDir(content = '# conformance test prompt'): { dir: string; promptPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-conformance-'));
  writeFileSync(join(dir, 'PROMPT.md'), content);
  return { dir, promptPath: join(dir, 'PROMPT.md') };
}

// ---------------------------------------------------------------------------
// Conformance suite
// ---------------------------------------------------------------------------

export type ConformanceOpts = {
  /**
   * A mock QueryFn injected into createAgent via AdapterAgentOptions.queryFn.
   * When omitted, the example adapter (which needs no real SDK) runs without one;
   * for the Claude adapter, pass a mock to avoid a real API call.
   *
   * Why this works for the Claude adapter: ClaudeAgentOptions (= AdapterAgentOptions)
   * has a `queryFn?` field; createClaudeAgent substitutes it for the real sdkQuery.
   * So passing `queryFn` here proves createAgent HANDLES a well-formed stream —
   * the adapter satisfies the contract under any compliant stream, not just the
   * real Claude SDK's stream.
   */
  queryFn?: QueryFn;
  /** Optional label shown in test names for disambiguation. */
  label?: string;
};

/**
 * Runs node:test assertions defining what every RuntimeAdapter must satisfy.
 *
 * Call inside a `describe()` block for per-adapter grouping:
 *   describe('my adapter', () => runAdapterConformance(myAdapter));
 *
 * Or at the top level for a flat test list.
 */
export function runAdapterConformance(adapter: RuntimeAdapter, opts: ConformanceOpts = {}): void {
  const label = opts.label ? `[${opts.label}] ` : '';

  // -------------------------------------------------------------------------
  // Contract §1: interface shape
  // -------------------------------------------------------------------------

  test(`${label}adapter.id is a non-empty string`, () => {
    assert.equal(typeof adapter.id, 'string', 'id must be a string');
    assert.ok(adapter.id.length > 0, 'id must not be empty');
  });

  test(`${label}adapter.available is a boolean`, () => {
    assert.equal(typeof adapter.available, 'boolean', 'available must be a boolean');
  });

  test(`${label}adapter.createAgent is a function`, () => {
    assert.equal(typeof adapter.createAgent, 'function', 'createAgent must be a function');
  });

  test(`${label}adapter.query is a function`, () => {
    assert.equal(typeof adapter.query, 'function', 'query must be a function');
  });

  // -------------------------------------------------------------------------
  // Contract §2: createAgent returns a callable AgentInvocation
  // -------------------------------------------------------------------------

  test(`${label}createAgent(opts) returns a function (AgentInvocation)`, () => {
    const agentOpts: AdapterAgentOptions = opts.queryFn ? { queryFn: opts.queryFn } : {};
    const invocation = adapter.createAgent(agentOpts);
    assert.equal(typeof invocation, 'function', 'createAgent must return a callable');
  });

  // -------------------------------------------------------------------------
  // Contract §3: AgentInvocation resolves to a well-formed AgentIterationInfo
  // -------------------------------------------------------------------------

  test(`${label}AgentInvocation resolves to a well-formed AgentIterationInfo`, async () => {
    const { dir, promptPath } = makeTmpDir();
    try {
      const agentOpts: AdapterAgentOptions = opts.queryFn
        ? { queryFn: opts.queryFn }
        : {};
      const invocation = adapter.createAgent(agentOpts);
      const result = await invocation({
        promptPath,
        agentMdPath: join(dir, 'AGENT.md'),
        fixPlanPath: join(dir, 'fix_plan.md'),
        worktreePath: dir,
        iteration: 1,
      });

      // filesChanged: string[]
      assert.ok(Array.isArray(result.filesChanged), 'filesChanged must be an array');
      for (const f of result.filesChanged) {
        assert.equal(typeof f, 'string', 'each filesChanged entry must be a string');
      }

      // costUsd: number >= 0
      assert.equal(typeof result.costUsd, 'number', 'costUsd must be a number');
      assert.ok(result.costUsd >= 0, 'costUsd must be >= 0');

      // Optional fields — if present, must be the right type
      if (result.toolsUsed !== undefined) {
        assert.ok(Array.isArray(result.toolsUsed), 'toolsUsed must be an array if present');
      }
      if (result.bashCommands !== undefined) {
        assert.ok(Array.isArray(result.bashCommands), 'bashCommands must be an array if present');
        for (const cmd of result.bashCommands) {
          assert.equal(typeof cmd, 'string', 'each bashCommands entry must be a string');
        }
      }
      if (result.lastAssistantText !== undefined) {
        assert.equal(typeof result.lastAssistantText, 'string', 'lastAssistantText must be a string if present');
      }
      if (result.tokensIn !== undefined) {
        assert.equal(typeof result.tokensIn, 'number', 'tokensIn must be a number if present');
        assert.ok(result.tokensIn >= 0, 'tokensIn must be >= 0');
      }
      if (result.tokensOut !== undefined) {
        assert.equal(typeof result.tokensOut, 'number', 'tokensOut must be a number if present');
        assert.ok(result.tokensOut >= 0, 'tokensOut must be >= 0');
      }
      if (result.cacheReadTokens !== undefined) {
        assert.equal(typeof result.cacheReadTokens, 'number', 'cacheReadTokens must be a number if present');
        assert.ok(result.cacheReadTokens >= 0, 'cacheReadTokens must be >= 0');
      }
      if (result.cacheCreationTokens !== undefined) {
        assert.equal(typeof result.cacheCreationTokens, 'number', 'cacheCreationTokens must be a number if present');
        assert.ok(result.cacheCreationTokens >= 0, 'cacheCreationTokens must be >= 0');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Contract §4: query() returns an AsyncIterable that yields ≥1 message
  // -------------------------------------------------------------------------

  test(`${label}adapter.query returns an AsyncIterable (yields at least one message)`, async () => {
    const queryFnToUse = opts.queryFn ?? adapter.query;
    const stream = queryFnToUse({ prompt: 'conformance test prompt' });

    assert.ok(
      stream !== null && typeof stream === 'object' && Symbol.asyncIterator in stream,
      'query() must return an AsyncIterable',
    );

    let count = 0;
    let hasTerminal = false;
    for await (const msg of stream) {
      count += 1;
      const m = msg as { type?: string };
      if (m.type === 'result') hasTerminal = true;
    }

    assert.ok(count > 0, 'query stream must yield at least one message');
    assert.ok(hasTerminal, 'query stream must yield a result-type terminal message');
  });
}
