/**
 * Tests for orchestrator/pinned-sdk-query.ts (G8 env-pin seam, R5-02
 * allowlist hardening).
 *
 * `createPinnedSdkQuery` is the DI seam: production code uses the default
 * export `pinnedSdkQuery` (bound to the real SDK `query`), tests bind a fake
 * `queryImpl` so we can assert the env-pinning behaviour without spawning a
 * real Claude Agent SDK child.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPinnedSdkQuery, pinnedSdkQuery } from './pinned-sdk-query.ts';

type FakeCall = { prompt: unknown; options?: Record<string, unknown> };

function makeFakeQuery(): { fakeQuery: (params: FakeCall) => unknown; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fakeQuery = (params: FakeCall) => {
    calls.push(params);
    return 'fake-query-result';
  };
  return { fakeQuery, calls };
}

test('createPinnedSdkQuery: F1 AC — a deliberately polluted process.env (ANTHROPIC_BASE_URL + a canary var) never reaches the child, allowlisted vars do', () => {
  const canary = 'FORGE_TEST_ENV_PIN_CANARY_XYZ';
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const savedCanary = process.env[canary];
  const savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = 'https://evil.example.com';
  process.env[canary] = 'leak-me-if-you-can';
  process.env.ANTHROPIC_API_KEY = 'sk-real-key';
  try {
    const { fakeQuery, calls } = makeFakeQuery();
    const wrapped = createPinnedSdkQuery(fakeQuery as never);
    wrapped({ prompt: 'hello' } as never);

    assert.equal(calls.length, 1);
    const env = calls[0]!.options?.env as Record<string, string | undefined>;
    assert.equal(env.ANTHROPIC_BASE_URL, undefined, 'the ambient host var is stripped at the seam');
    assert.equal(env[canary], undefined, 'an arbitrary unlisted ambient var is stripped too');
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-real-key', 'the one documented auth var passes through');
  } finally {
    if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
    if (savedCanary === undefined) delete process.env[canary]; else process.env[canary] = savedCanary;
    if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedApiKey;
  }
});

test('createPinnedSdkQuery: options.env is treated as deliberate override deltas (git-identity overlay), not an alternate ambient source to filter', () => {
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = 'https://evil.example.com';
  try {
    const { fakeQuery, calls } = makeFakeQuery();
    const wrapped = createPinnedSdkQuery(fakeQuery as never);
    wrapped({
      prompt: 'hello',
      options: { env: { GIT_AUTHOR_NAME: 'forge-ralph', GIT_AUTHOR_EMAIL: 'forge-ralph+WI-7@forge.local' }, model: 'claude-sonnet-4-6' },
    } as never);

    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.options?.model, 'claude-sonnet-4-6', 'unrelated options pass through unchanged');
    const env = call.options?.env as Record<string, string | undefined>;
    assert.equal(env.GIT_AUTHOR_NAME, 'forge-ralph', 'a caller-supplied override reaches the child even though GIT_* is not allowlisted');
    assert.equal(env.GIT_AUTHOR_EMAIL, 'forge-ralph+WI-7@forge.local');
    assert.equal(env.ANTHROPIC_BASE_URL, undefined, 'the override channel does not reopen ambient-env leakage for unrelated keys');
  } finally {
    if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
  }
});

test('createPinnedSdkQuery: pins options.env even when the caller passes no options at all', () => {
  const { fakeQuery, calls } = makeFakeQuery();
  const wrapped = createPinnedSdkQuery(fakeQuery as never);
  wrapped({ prompt: 'no options here' } as never);

  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.options?.env, 'env is always populated, even with no caller-supplied options');
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
