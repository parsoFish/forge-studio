/**
 * The SDK spawn names its Claude Code binary, and REFUSES rather than guess —
 * `forge-8vfn.7.6.116`, T1 1066.
 *
 * THE BUG THESE DOORS EXIST FOR. The pinned SDK spawns its own bundled CLI
 * (2.0.77), whose October 2025 Consumer Terms gate began exiting 1 before any
 * turn. Every real-spawn story run on this box died at its first agent turn;
 * S9 run 1 stopped at beat 8 having spent $0 of $25. The operator cannot clear
 * it — their installed CLI is 2.1.274 and has no such prompt.
 *
 * WHY EVERY REFUSAL IS ITS OWN CASE. A fallback to the bundled binary would
 * restore the bug SILENTLY, on a box where nothing looks misconfigured. So the
 * absence of a usable value must fail loudly, and each way of being unusable
 * gets its own sentence — "it did not work" sends the reader looking, "it is
 * not executable" does not.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveClaudeCliPath, ClaudeCliPathError, CLAUDE_CLI_ENV } from '../../claude-cli-path.ts';
import { AGENT_ENV_ALLOWLIST } from '../../spawn-env.ts';

describe('7.6.116 — the spawn names its CLI or refuses', () => {
  test('an absolute, executable file is returned verbatim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-path-'));
    try {
      const bin = join(dir, 'claude');
      writeFileSync(bin, '#!/bin/sh\nexit 0\n');
      chmodSync(bin, 0o755);
      assert.equal(resolveClaudeCliPath({ [CLAUDE_CLI_ENV]: bin } as NodeJS.ProcessEnv), bin);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('UNSET refuses, naming the variable AND why there is no fallback', () => {
    // T1 1066's door. The sentence has to carry the reason, because the next
    // person to hit this will be staring at a box that looks fine.
    assert.throws(
      () => resolveClaudeCliPath({} as NodeJS.ProcessEnv),
      (err: Error) => {
        assert.ok(err instanceof ClaudeCliPathError);
        assert.match(err.message, /FORGE_CLAUDE_CLI is not set/);
        assert.match(err.message, /2\.0\.77/, 'names the binary that would otherwise be used');
        assert.match(err.message, /no fallback/i, 'and says the absence of one is deliberate');
        return true;
      },
    );
  });

  test('an EMPTY value is unset, not a path', () => {
    assert.throws(() => resolveClaudeCliPath({ [CLAUDE_CLI_ENV]: '   ' } as NodeJS.ProcessEnv),
      /is not set/);
  });

  test('a RELATIVE path refuses — it resolves against an inherited cwd nobody chose', () => {
    assert.throws(() => resolveClaudeCliPath({ [CLAUDE_CLI_ENV]: 'bin/claude' } as NodeJS.ProcessEnv),
      /not an ABSOLUTE path/);
  });

  test('a path that is NOT ON DISK refuses, naming it', () => {
    assert.throws(() => resolveClaudeCliPath({ [CLAUDE_CLI_ENV]: '/nonexistent/claude' } as NodeJS.ProcessEnv),
      /"\/nonexistent\/claude", which is not on disk/);
  });

  test('a DIRECTORY refuses — exists is not the same as is a program', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-path-dir-'));
    try {
      const sub = join(dir, 'claude');
      mkdirSync(sub);
      assert.throws(() => resolveClaudeCliPath({ [CLAUDE_CLI_ENV]: sub } as NodeJS.ProcessEnv),
        /exists but is not a file/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a NON-EXECUTABLE file refuses — present is not the same as runnable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-path-nox-'));
    try {
      const bin = join(dir, 'claude');
      writeFileSync(bin, '#!/bin/sh\nexit 0\n');
      chmodSync(bin, 0o644);
      assert.throws(() => resolveClaudeCliPath({ [CLAUDE_CLI_ENV]: bin } as NodeJS.ProcessEnv),
        /is not EXECUTABLE by this user/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('the variable is in AGENT_ENV_ALLOWLIST, or the child never receives it', () => {
    // The resolver runs in the PARENT. A child that must obey the same decision
    // reads it from its own env, and `buildChildEnv` drops anything unlisted —
    // so omitting it here would make this work in-process and fail in a spawn.
    assert.ok(AGENT_ENV_ALLOWLIST.includes(CLAUDE_CLI_ENV),
      `${CLAUDE_CLI_ENV} must be carried to children like the lock variables are`);
  });
});
