/**
 * Conformance + registry tests (M6-2, ADR 029).
 *
 * Proves:
 *   A. The example adapter satisfies the full conformance contract (no SDK).
 *   B. The Claude adapter satisfies the full conformance contract under an
 *      injected mock queryFn (no real API call). This proves the adapter's
 *      createAgent loop handles a well-formed stream correctly — it is the
 *      same contract the example adapter satisfies, making both adapters
 *      interchangeable from the runner's perspective.
 *   C. The registry: getAdapter, listAdapters, registeredSdkIds, isSdkAvailable.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAdapterConformance, type ConformanceOpts } from './conformance.ts';
import { exampleAdapter } from './example/index.ts';
import { claudeAdapter } from './claude/index.ts';
import { getAdapter, listAdapters, registeredSdkIds, isSdkAvailable } from './registry.ts';
import type { QueryFn } from './types.ts';

// ---------------------------------------------------------------------------
// Shared mock queryFn — well-formed stream, no SDK
// ---------------------------------------------------------------------------

function makeMockQueryFn(): QueryFn {
  return ((_params: { prompt: string; options?: Record<string, unknown> }) => {
    async function* stream() {
      yield {
        type: 'assistant',
        message: {
          id: 'test-msg-1',
          content: [{ type: 'text', text: 'mock response' }],
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0,
        num_turns: 1,
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      };
    }
    return stream();
  }) as unknown as QueryFn;
}

// ---------------------------------------------------------------------------
// A. Example adapter conformance (no external dep)
// ---------------------------------------------------------------------------

describe('example adapter: conformance contract', () => {
  runAdapterConformance(exampleAdapter, { label: 'example' });
});

// ---------------------------------------------------------------------------
// B. Claude adapter conformance (mock queryFn — no real API call)
// ---------------------------------------------------------------------------

describe('claude adapter: conformance contract (mock queryFn)', () => {
  // Each test in the suite gets a fresh mock queryFn. The conformance suite
  // passes opts.queryFn through to AdapterAgentOptions so createClaudeAgent
  // substitutes it for the real sdkQuery — proving the adapter handles a
  // well-formed stream, not just the live Claude SDK stream.
  const conformanceOpts: ConformanceOpts = {
    queryFn: makeMockQueryFn(),
    label: 'claude (mock)',
  };
  runAdapterConformance(claudeAdapter, conformanceOpts);
});

// ---------------------------------------------------------------------------
// B-extra: Claude adapter createAgent with mock — verify result field values
// ---------------------------------------------------------------------------

test('claude adapter: createAgent with mock queryFn resolves well-formed AgentIterationInfo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-claude-conformance-'));
  const promptPath = join(dir, 'PROMPT.md');
  writeFileSync(promptPath, '# mock prompt');
  try {
    const agent = claudeAdapter.createAgent({ queryFn: makeMockQueryFn() });
    const result = await agent({
      promptPath,
      agentMdPath: join(dir, 'AGENT.md'),
      fixPlanPath: join(dir, 'fix_plan.md'),
      worktreePath: dir,
      iteration: 1,
    });

    assert.ok(Array.isArray(result.filesChanged), 'filesChanged is an array');
    assert.equal(typeof result.costUsd, 'number', 'costUsd is a number');
    assert.ok(result.costUsd >= 0, 'costUsd >= 0');
    // The mock yields total_cost_usd: 0
    assert.equal(result.costUsd, 0, 'costUsd matches mock result');
    // No tool_use blocks in the mock — no filesChanged
    assert.deepEqual(result.filesChanged, [], 'no filesChanged from mock stream');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// C. Registry tests
// ---------------------------------------------------------------------------

describe('adapter registry', () => {
  test('getAdapter("claude") returns the claude adapter', () => {
    const adapter = getAdapter('claude');
    assert.equal(adapter.id, 'claude');
    assert.equal(typeof adapter.createAgent, 'function');
    assert.equal(typeof adapter.query, 'function');
  });

  test('getAdapter("example") returns the example adapter', () => {
    const adapter = getAdapter('example');
    assert.equal(adapter.id, 'example');
    assert.equal(typeof adapter.createAgent, 'function');
    assert.equal(typeof adapter.query, 'function');
  });

  test('getAdapter("codex") throws with a clear message listing known ids', () => {
    assert.throws(
      () => getAdapter('codex'),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'must throw an Error');
        assert.ok(err.message.includes('codex'), 'error mentions the unknown id');
        assert.ok(err.message.includes('claude'), 'error lists known ids');
        assert.ok(err.message.includes('example'), 'error lists known ids');
        return true;
      },
    );
  });

  test('getAdapter("") throws', () => {
    assert.throws(() => getAdapter(''), (err: unknown) => err instanceof Error);
  });

  test('listAdapters() returns an array containing claude + example adapters', () => {
    const adapters = listAdapters();
    assert.ok(Array.isArray(adapters), 'listAdapters returns an array');
    const ids = adapters.map((a) => a.id);
    assert.ok(ids.includes('claude'), 'list includes claude');
    assert.ok(ids.includes('example'), 'list includes example');
  });

  test('registeredSdkIds() returns the live + flywheel adapters', () => {
    const ids = registeredSdkIds();
    // claude (live) + example (mock) + the M8-A flywheel drop-ins (gemini, aider),
    // which are registered but available:false until dep + creds are provisioned.
    assert.deepEqual(ids.sort(), ['aider', 'claude', 'example', 'gemini'].sort());
  });

  test('isSdkAvailable("claude") is true', () => {
    assert.equal(isSdkAvailable('claude'), true);
  });

  test('isSdkAvailable("example") is true', () => {
    assert.equal(isSdkAvailable('example'), true);
  });

  test('isSdkAvailable("codex") is false (not registered)', () => {
    assert.equal(isSdkAvailable('codex'), false);
  });

  test('isSdkAvailable("gemini") is false (registered but dep/creds absent)', () => {
    assert.equal(isSdkAvailable('gemini'), false);
  });

  test('isSdkAvailable("") is false', () => {
    assert.equal(isSdkAvailable(''), false);
  });
});
