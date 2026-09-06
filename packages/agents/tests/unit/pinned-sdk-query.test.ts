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

import { createPinnedSdkQuery, pinnedSdkQuery } from '../../pinned-sdk-query.ts';

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

// ---------------------------------------------------------------------------
// Bead `forge-8vfn.6.11.40` (P1, T1 ruling 352) — a child that dies must name
// its own cause.
//
// Measured, S2 run 7: the architect's SDK child exited code 1 three seconds in
// and the session's `stderr.log` held only the PARENT's throw
// (`Error: Claude Code process exited with code 1`, thrown at
// `ProcessTransport.getProcessExitError`). The child's own stderr appeared
// nowhere — because it was never piped: `sdk.mjs:7605` reads
// `const stderrMode = env.DEBUG_CLAUDE_AGENT_SDK || this.options.stderr ? "pipe" : "ignore"`,
// and forge passed no `stderr` option on any query. The bytes were discarded by
// the OS, not merely unlogged, so no amount of reading the archive afterwards
// could recover them.
//
// The sink is installed HERE, at the one seam every production `query()` goes
// through, for the same reason `env` is: a per-call-site sink is a sink some
// call site will be missing on the day it matters. It writes to this process's
// OWN stderr, which every spawner already routes to the session's
// `stderr.log` (`openSync(join(logDir, 'stderr.log'), 'a')` as the child's
// stdio[2]) — so there is no path to resolve, no file handle to own, and it is
// correct for every session kind at once.
// ---------------------------------------------------------------------------

/** Capture what this process writes to stderr while `fn` runs. */
function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let seen = '';
  (process.stderr as { write: unknown }).write = (chunk: unknown): boolean => {
    seen += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as { write: unknown }).write = original;
  }
  return seen;
}

test('6.11.40: every query is handed an `stderr` sink — without one the SDK sets stderrMode "ignore" and the child\'s output is discarded by the OS', () => {
  const { fakeQuery, calls } = makeFakeQuery();
  createPinnedSdkQuery(fakeQuery as never)({ prompt: 'p', options: {} } as never);

  const opts = calls[0]!.options as Record<string, unknown>;
  assert.equal(typeof opts['stderr'], 'function', 'the SDK only pipes the child\'s stderr when this option is present');
});

test('6.11.40: the sink writes the child\'s line to this process\'s stderr, which is the session\'s own stderr.log', () => {
  const { fakeQuery, calls } = makeFakeQuery();
  createPinnedSdkQuery(fakeQuery as never)({ prompt: 'p', options: {} } as never);
  const sink = (calls[0]!.options as { stderr: (m: string) => void }).stderr;

  const seen = captureStderr(() => sink('Error: ENOENT: no such file or directory'));

  assert.match(seen, /ENOENT: no such file or directory/, 'the child\'s own words must reach the log');
  assert.match(seen, /sdk-child/, 'and be attributable to the child rather than read as forge\'s own error');
});

test('6.11.40: a multi-line chunk is marked line by line, and blank lines add no noise', () => {
  const { fakeQuery, calls } = makeFakeQuery();
  createPinnedSdkQuery(fakeQuery as never)({ prompt: 'p', options: {} } as never);
  const sink = (calls[0]!.options as { stderr: (m: string) => void }).stderr;

  const seen = captureStderr(() => sink('first line\n\nsecond line\n'));
  const marked = seen.split('\n').filter((l) => l.includes('sdk-child'));

  assert.equal(marked.length, 2, `one marked line per non-empty line, got: ${JSON.stringify(seen)}`);
  assert.match(marked[0]!, /first line$/);
  assert.match(marked[1]!, /second line$/);
});

test('6.11.40: a caller\'s own stderr sink is COMPOSED, never silently dropped — symmetric with how options.env is merged', () => {
  const { fakeQuery, calls } = makeFakeQuery();
  const callerSaw: string[] = [];
  createPinnedSdkQuery(fakeQuery as never)({
    prompt: 'p',
    options: { stderr: (m: string) => callerSaw.push(m) },
  } as never);
  const sink = (calls[0]!.options as { stderr: (m: string) => void }).stderr;

  const seen = captureStderr(() => sink('a line'));

  assert.deepEqual(callerSaw, ['a line'], 'the caller\'s sink still receives the raw chunk');
  assert.match(seen, /sdk-child.*a line/, 'and the log still gets it');
});

test('6.11.40: a sink that throws never takes the turn down — diagnosis is not load-bearing', () => {
  const { fakeQuery, calls } = makeFakeQuery();
  createPinnedSdkQuery(fakeQuery as never)({
    prompt: 'p',
    options: { stderr: () => { throw new Error('a bad caller sink'); } },
  } as never);
  const sink = (calls[0]!.options as { stderr: (m: string) => void }).stderr;

  assert.doesNotThrow(() => captureStderr(() => sink('still logged')));
});
