/**
 * The pinned query PASSES the chosen executable to the SDK — `forge-8vfn.7.6.116`.
 *
 * WHY THIS DOOR IS HERE AND NOT IN A SPAWN-CAPTURE GOLDEN, which is where T1
 * 1066 asked for it. The five goldens capture the PHASE's own option bag, and
 * they do it through `resolveRunQuery`, which returns an injected stub
 * UNWRAPPED — that is precisely what keeps them byte-identical across runtime
 * changes, and `pinned-sdk-query.ts` says so in its own comment. So a golden
 * structurally CANNOT see an option the runtime wrapper adds; making it visible
 * there would mean moving `pathToClaudeCodeExecutable` into every phase's bag
 * and re-pinning five fixtures, spreading a spawn-runtime concern across five
 * call sites to satisfy a test. The equivalent assertion, at the seam that
 * actually adds it, is this file. Reported to T1 rather than quietly swapped.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPinnedSdkQuery } from '../../pinned-sdk-query.ts';
import { CLAUDE_CLI_ENV } from '@forge/kernel/claude-cli-path.ts';

function withCliEnv<T>(bin: string | undefined, fn: () => T): T {
  const had = Object.hasOwn(process.env, CLAUDE_CLI_ENV);
  const prev = process.env[CLAUDE_CLI_ENV];
  if (bin === undefined) delete process.env[CLAUDE_CLI_ENV];
  else process.env[CLAUDE_CLI_ENV] = bin;
  try { return fn(); } finally {
    if (had) process.env[CLAUDE_CLI_ENV] = prev; else delete process.env[CLAUDE_CLI_ENV];
  }
}

describe('7.6.116 — the pinned query names the binary', () => {
  test('the resolved executable reaches the SDK options bag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinned-cli-'));
    try {
      const bin = join(dir, 'claude');
      writeFileSync(bin, '#!/bin/sh\nexit 0\n');
      chmodSync(bin, 0o755);

      let seen: Record<string, unknown> | undefined;
      const q = createPinnedSdkQuery(((params: { options?: Record<string, unknown> }) => {
        seen = params.options; return {} as never;
      }) as never);

      withCliEnv(bin, () => q({ prompt: 'p', options: { model: 'claude-sonnet-5' } } as never));
      assert.equal(seen?.['pathToClaudeCodeExecutable'], bin,
        'the SDK must be told WHICH binary; left unset it spawns its bundled 2.0.77 and dies on a terms gate');
      assert.equal(seen?.['model'], 'claude-sonnet-5', 'and the caller\'s own options survive');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an unset variable REFUSES at the seam — not inside a child that exits 1', () => {
    const q = createPinnedSdkQuery((() => ({}) as never) as never);
    withCliEnv(undefined, () => {
      assert.throws(() => q({ prompt: 'p' } as never), /FORGE_CLAUDE_CLI is not set/,
        'failing here costs nothing; failing in the child costs a staged run and reads as a product fault');
    });
  });
});
