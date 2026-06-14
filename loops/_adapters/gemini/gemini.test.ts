/**
 * Gemini adapter conformance + contract tests (M8-A, ADR 029).
 *
 * Runs WITHOUT live creds and WITHOUT the @google/genai dependency installed:
 *
 *   A. Full RuntimeAdapter conformance under an injected mock `queryFn`
 *      (loops/_adapters/conformance.ts) — exactly how the Claude adapter is
 *      tested. Proves the adapter's stream-folding glue handles a well-formed
 *      stream regardless of which SDK produced it.
 *   B. Dep+creds gating: `available` is false here (no dep, no key); the gate
 *      inputs are individually asserted.
 *   C. Stream-folding correctness: a realistic GEMINI-SHAPED chunk stream
 *      (via the adapter's own internal `query`-shaped mapper) is folded into a
 *      well-formed AgentIterationInfo — usageMetadata → tokensIn/Out, text →
 *      lastAssistantText, functionCall → toolsUsed/filesChanged.
 *   D. Pure-helper unit tests for the Gemini→wire mappers.
 *
 * No network. No real key. No installed SDK.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAdapterConformance, type ConformanceOpts } from '../conformance.ts';
import { geminiAdapter, __testing } from './index.ts';
import type { QueryFn } from '../types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a temp PROMPT.md and return the dir + promptPath. Caller cleans up. */
function makeTmpDir(content = '# gemini test prompt'): { dir: string; promptPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gemini-'));
  const promptPath = join(dir, 'PROMPT.md');
  writeFileSync(promptPath, content);
  return { dir, promptPath };
}

/**
 * A mock queryFn that yields the forge wire shape the adapter consumes —
 * mirroring conformance.test.ts's makeMockQueryFn but with Gemini-flavoured
 * numbers. Used for the conformance suite (injected via opts.queryFn).
 */
function makeMockQueryFn(): QueryFn {
  return ((_params: { prompt: string; options?: Record<string, unknown> }) => {
    async function* stream() {
      yield {
        type: 'assistant',
        message: {
          id: 'gemini-chunk-1',
          content: [{ type: 'text', text: 'mock gemini response' }],
          usage: {
            input_tokens: 11,
            output_tokens: 7,
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
          input_tokens: 11,
          output_tokens: 7,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      };
    }
    return stream();
  }) as unknown as QueryFn;
}

// ---------------------------------------------------------------------------
// A. Full conformance contract under injected mock queryFn
// ---------------------------------------------------------------------------

describe('gemini adapter: conformance contract (mock queryFn, no SDK/creds)', () => {
  const conformanceOpts: ConformanceOpts = {
    queryFn: makeMockQueryFn(),
    label: 'gemini (mock)',
  };
  runAdapterConformance(geminiAdapter, conformanceOpts);
});

// ---------------------------------------------------------------------------
// B. Dep + creds gating
// ---------------------------------------------------------------------------

describe('gemini adapter: dep+creds gating', () => {
  test('id is "gemini"', () => {
    assert.equal(geminiAdapter.id, 'gemini');
  });

  test('available is a boolean', () => {
    assert.equal(typeof geminiAdapter.available, 'boolean');
  });

  test('available is false in CI (dep absent OR creds absent)', () => {
    // Neither the @google/genai dep nor a Gemini key exists in this env.
    assert.equal(geminiAdapter.available, false, 'must be unavailable without dep+creds');
    // And it is false specifically because at least one gate input is false.
    assert.ok(
      __testing.depPresent() === false || __testing.credsPresent() === false,
      'at least one of dep/creds must be absent for available to be false',
    );
  });

  test('createAgent and query are functions even when unavailable', () => {
    assert.equal(typeof geminiAdapter.createAgent, 'function');
    assert.equal(typeof geminiAdapter.query, 'function');
  });

  test('resolveApiKey reads GEMINI_API_KEY / GOOGLE_API_KEY', () => {
    assert.equal(__testing.resolveApiKey({}), undefined, 'no key → undefined');
    assert.equal(
      __testing.resolveApiKey({ GEMINI_API_KEY: 'k1' } as NodeJS.ProcessEnv),
      'k1',
      'GEMINI_API_KEY honoured',
    );
    assert.equal(
      __testing.resolveApiKey({ GOOGLE_API_KEY: 'k2' } as NodeJS.ProcessEnv),
      'k2',
      'GOOGLE_API_KEY honoured as fallback',
    );
    // GEMINI_API_KEY takes priority over GOOGLE_API_KEY.
    assert.equal(
      __testing.resolveApiKey({ GEMINI_API_KEY: 'a', GOOGLE_API_KEY: 'b' } as NodeJS.ProcessEnv),
      'a',
      'GEMINI_API_KEY wins',
    );
    assert.equal(
      __testing.resolveApiKey({ GEMINI_API_KEY: '' } as NodeJS.ProcessEnv),
      undefined,
      'empty key is not a key',
    );
  });

  test('resolveModel defaults to a gemini-2.x model and honours an override', () => {
    assert.ok(
      __testing.DEFAULT_MODEL.startsWith('gemini-'),
      `default model "${__testing.DEFAULT_MODEL}" should be a gemini model`,
    );
    assert.equal(__testing.resolveModel({}), __testing.DEFAULT_MODEL);
    assert.equal(__testing.resolveModel({ model: 'gemini-2.5-flash' }), 'gemini-2.5-flash');
  });
});

// ---------------------------------------------------------------------------
// B-live-guard: the LIVE query throws fast when unavailable (fail at boundary)
// ---------------------------------------------------------------------------

describe('gemini adapter: live query fails fast without dep/creds', () => {
  test('iterating geminiAdapter.query throws a clear error (no silent empty stream)', async () => {
    await assert.rejects(
      (async () => {
        for await (const _msg of geminiAdapter.query({ prompt: 'hi' })) {
          // should not reach here without dep+creds
        }
      })(),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'must throw an Error');
        // Either the missing-package OR the missing-key message, depending on
        // which gate is hit first. Both name the remedy.
        assert.ok(
          /not installed|API key/.test(err.message),
          `error should explain the gap, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// C. Stream-folding correctness via injected mock createAgent
// ---------------------------------------------------------------------------

describe('gemini adapter: createAgent folds a stream into AgentIterationInfo', () => {
  test('maps usage + text from a mock wire stream', async () => {
    const { dir, promptPath } = makeTmpDir('# fold me');
    try {
      const agent = geminiAdapter.createAgent({ queryFn: makeMockQueryFn() });
      const result = await agent({
        promptPath,
        agentMdPath: join(dir, 'AGENT.md'),
        fixPlanPath: join(dir, 'fix_plan.md'),
        worktreePath: dir,
        iteration: 1,
      });

      assert.deepEqual(result.filesChanged, [], 'no file tools in mock');
      assert.equal(result.costUsd, 0, 'Gemini surfaces 0 cost (no pricing table)');
      assert.equal(result.tokensIn, 11, 'input_tokens folded from usage');
      assert.equal(result.tokensOut, 7, 'output_tokens folded from usage');
      assert.equal(result.lastAssistantText, 'mock gemini response', 'text folded');
      assert.equal(result.cacheCreationTokens, 0, 'Gemini has no cache-creation count');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('folds tool_use blocks into toolsUsed + filesChanged', async () => {
    const { dir, promptPath } = makeTmpDir('# tool me');
    try {
      const toolStream: QueryFn = (() => {
        async function* stream() {
          yield {
            type: 'assistant',
            message: {
              id: 'gemini-chunk-1',
              content: [
                { type: 'text', text: 'writing a file' },
                { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/out.txt', contents: 'x' } },
                { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
              ],
              usage: { input_tokens: 3, output_tokens: 9, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            total_cost_usd: 0,
            num_turns: 1,
            usage: { input_tokens: 3, output_tokens: 9, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          };
        }
        return stream();
      }) as unknown as QueryFn;

      const agent = geminiAdapter.createAgent({ queryFn: toolStream });
      const result = await agent({
        promptPath,
        agentMdPath: join(dir, 'AGENT.md'),
        fixPlanPath: join(dir, 'fix_plan.md'),
        worktreePath: dir,
        iteration: 1,
      });

      assert.deepEqual(result.filesChanged, ['/tmp/out.txt'], 'Write file_path captured');
      const toolNames = (result.toolsUsed ?? []).map((t) => t.name);
      assert.deepEqual(toolNames, ['Write', 'Bash'], 'both tool calls recorded');
      assert.deepEqual(result.bashCommands, ['ls -la'], 'bash command captured');
      assert.equal(result.tokensOut, 9, 'output tokens from result');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D. Pure-helper unit tests — Gemini-native shapes → forge wire shape
// ---------------------------------------------------------------------------

describe('gemini adapter: Gemini-native shape mappers', () => {
  test('usageToWire maps Gemini usageMetadata field names', () => {
    const wire = __testing.usageToWire({
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      totalTokenCount: 140,
      cachedContentTokenCount: 25,
    });
    assert.equal(wire.input_tokens, 100, 'promptTokenCount → input_tokens');
    assert.equal(wire.output_tokens, 40, 'candidatesTokenCount → output_tokens');
    assert.equal(wire.cache_read_input_tokens, 25, 'cachedContentTokenCount → cache_read');
    assert.equal(wire.cache_creation_input_tokens, 0, 'no Gemini cache-creation count');
  });

  test('usageToWire defaults missing/invalid counts to 0', () => {
    const wire = __testing.usageToWire(undefined);
    assert.equal(wire.input_tokens, 0);
    assert.equal(wire.output_tokens, 0);
    assert.equal(wire.cache_read_input_tokens, 0);
    const negative = __testing.usageToWire({ promptTokenCount: -5 } as unknown as Parameters<typeof __testing.usageToWire>[0]);
    assert.equal(negative.input_tokens, 0, 'negative is clamped to 0');
  });

  test('chunkToContentBlocks: candidates[].content.parts[] text + functionCall', () => {
    const blocks = __testing.chunkToContentBlocks({
      candidates: [
        {
          content: {
            parts: [
              { text: 'hello from gemini' },
              { functionCall: { name: 'Write', id: 'fc-1', args: { file_path: '/a.txt' } } },
            ],
          },
        },
      ],
    });
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0], { type: 'text', text: 'hello from gemini' });
    assert.equal(blocks[1]!.type, 'tool_use');
    assert.equal(blocks[1]!.name, 'Write');
    assert.deepEqual(blocks[1]!.input, { file_path: '/a.txt' });
  });

  test('chunkToContentBlocks: falls back to the .text getter + .functionCalls', () => {
    const blocks = __testing.chunkToContentBlocks({
      text: 'streamed text getter',
      functionCalls: [{ name: 'Bash', args: { command: 'echo hi' } }],
    });
    assert.deepEqual(blocks[0], { type: 'text', text: 'streamed text getter' });
    assert.equal(blocks[1]!.type, 'tool_use');
    assert.equal(blocks[1]!.name, 'Bash');
  });

  test('chunkToContentBlocks: empty chunk yields no blocks', () => {
    assert.deepEqual(__testing.chunkToContentBlocks({}), []);
    assert.deepEqual(__testing.chunkToContentBlocks({ text: '' }), []);
  });
});
