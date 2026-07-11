/**
 * Tests for orchestrator/pinned-sdk-query.ts (G8 env-pin seam).
 *
 * `createPinnedSdkQuery` is the DI seam: production code uses the default
 * export `pinnedSdkQuery` (bound to the real SDK `query`), tests bind a fake
 * `queryImpl` so we can assert the env-pinning behaviour without spawning a
 * real Claude Agent SDK child.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPinnedSdkQuery, pinnedSdkQuery } from './pinned-sdk-query.ts';

test('createPinnedSdkQuery: pins options.env on every call, using pinnedAgentEnv scrubbing', () => {
  const calls: Array<{ prompt: unknown; options?: Record<string, unknown> }> = [];
  const fakeQuery = (params: { prompt: unknown; options?: Record<string, unknown> }) => {
    calls.push(params);
    return 'fake-query-result' as unknown as ReturnType<typeof pinnedSdkQuery>;
  };

  const wrapped = createPinnedSdkQuery(fakeQuery as never);
  wrapped({
    prompt: 'hello',
    options: {
      env: { ANTHROPIC_BASE_URL: 'https://evil.example.com', ANTHROPIC_API_KEY: 'sk-keep' },
      model: 'claude-sonnet-4-6',
    },
  } as never);

  assert.equal(calls.length, 1, 'delegates to the wrapped query exactly once');
  const call = calls[0];
  assert.equal(call.prompt, 'hello', 'prompt passes through unchanged');
  assert.equal(call.options?.model, 'claude-sonnet-4-6', 'unrelated options pass through unchanged');

  const env = call.options?.env as Record<string, string | undefined>;
  assert.equal(env.ANTHROPIC_BASE_URL, undefined, 'ANTHROPIC_BASE_URL is scrubbed before the real query is called');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-keep', 'unrelated env vars pass through');
});

test('createPinnedSdkQuery: pins options.env even when the caller passes no options at all', () => {
  const calls: Array<{ prompt: unknown; options?: Record<string, unknown> }> = [];
  const fakeQuery = (params: { prompt: unknown; options?: Record<string, unknown> }) => {
    calls.push(params);
    return 'fake-query-result' as unknown as ReturnType<typeof pinnedSdkQuery>;
  };

  const wrapped = createPinnedSdkQuery(fakeQuery as never);
  wrapped({ prompt: 'no options here' } as never);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].options?.env, 'env is always populated, even with no caller-supplied options');
});

test('createPinnedSdkQuery: returns whatever the wrapped query returns (pass-through, not a new Query)', () => {
  const sentinel = Symbol('sentinel-query-result');
  const fakeQuery = () => sentinel as unknown as ReturnType<typeof pinnedSdkQuery>;
  const wrapped = createPinnedSdkQuery(fakeQuery as never);
  const result = wrapped({ prompt: 'x' } as never);
  assert.equal(result as unknown as symbol, sentinel);
});

test('pinnedSdkQuery: exported as a query-compatible callable bound to the real SDK query', () => {
  assert.equal(typeof pinnedSdkQuery, 'function');
});
