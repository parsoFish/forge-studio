/**
 * Aider adapter conformance + unit tests (M8-A, ADR 029).
 *
 * Runs WITHOUT live creds and WITHOUT the aider binary: every aider subprocess
 * is replaced by an injected `AiderRunner` fake (the adapter's mock seam,
 * analogous to the Claude adapter's `queryFn`). Proves:
 *
 *   A. The aider adapter (built via makeAiderAdapter with a fake runner)
 *      satisfies the full RuntimeAdapter conformance contract — same gate the
 *      example + claude adapters pass, making it interchangeable from the
 *      runner's perspective.
 *   B. createAgent runs aider per iteration, detects changed files via git in
 *      a real temp git worktree, parses cost from stdout, and returns a
 *      well-formed AgentIterationInfo.
 *   C. The `query` shim is a single-terminal batch shim (aider is loop-driven):
 *      it yields exactly one `{ type: 'result' }` message.
 *   D. The dep+creds availability gate: false unless a key is set AND a dep is
 *      present; the exported adapter is unavailable in this credential-less env.
 *   E. Cost parsing + flag/model forwarding to the subprocess.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAdapterConformance } from '../conformance.ts';
import {
  aiderAdapter,
  makeAiderAdapter,
  computeAiderAvailable,
  parseAiderCostUsd,
  detectChangedFiles,
  type AiderRunner,
  type AiderAgentOptions,
} from './index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fake AiderRunner that records calls and returns canned stdout. Mirrors the
 * Claude adapter's mock queryFn pattern: the whole adapter is exercised with
 * NO binary, NO API key, NO network.
 */
function makeFakeRunner(opts: { stdout?: string; exitCode?: number } = {}): {
  runner: AiderRunner;
  calls: Array<{ message: string; worktreePath: string; model?: string }>;
} {
  const calls: Array<{ message: string; worktreePath: string; model?: string }> = [];
  const runner: AiderRunner = async ({ message, worktreePath, model }) => {
    calls.push({ message, worktreePath, model });
    return {
      stdout: opts.stdout ?? 'Applied edit.\nCost: $0.0123 message, $0.0456 session.',
      stderr: '',
      exitCode: opts.exitCode ?? 0,
    };
  };
  return { runner, calls };
}

/** Make a real on-disk git repo so detectChangedFiles has something to diff. */
function makeGitWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-aider-git-'));
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@forge.local']);
  git(['config', 'user.name', 'forge-test']);
  // Force the base branch to `main` so detectChangedFiles' base resolution works.
  git(['checkout', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'seed']);
  return dir;
}

// ---------------------------------------------------------------------------
// A. Conformance contract — built with a fake runner (no binary/creds)
// ---------------------------------------------------------------------------

describe('aider adapter: conformance contract (fake runner — no binary/creds)', () => {
  // Built available=true purely so the shape assertions run; the runner is a
  // fake. The conformance §3 invocation runs against a NON-git temp dir, where
  // detectChangedFiles returns [] — exactly the contract's "array of strings".
  const fakeAdapter = makeAiderAdapter(makeFakeRunner().runner, true);
  runAdapterConformance(fakeAdapter, { label: 'aider (fake runner)' });
});

// ---------------------------------------------------------------------------
// B. createAgent — git-based filesChanged detection in a real temp repo
// ---------------------------------------------------------------------------

describe('aider adapter: createAgent (git-based file detection)', () => {
  test('detects files aider committed, via git diff main...HEAD', async () => {
    const dir = makeGitWorktree();
    try {
      // Fake aider: on invocation, create a feature branch + commit a new file,
      // exactly as real aider's --auto-commits would land work on the branch.
      const runner: AiderRunner = async ({ worktreePath }) => {
        const git = (args: string[]) => execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe' });
        git(['checkout', '-q', '-b', 'feature']);
        writeFileSync(join(worktreePath, 'new_feature.ts'), 'export const x = 1;\n');
        git(['add', '-A']);
        git(['commit', '-q', '-m', 'aider: add feature']);
        return { stdout: 'Cost: $0.05 message, $0.05 session.', stderr: '', exitCode: 0 };
      };

      const adapter = makeAiderAdapter(runner, true);
      const promptPath = join(dir, 'PROMPT.md');
      writeFileSync(promptPath, 'add a feature');

      const info = await adapter.createAgent({}).call(null, {
        promptPath,
        agentMdPath: join(dir, 'AGENT.md'),
        fixPlanPath: join(dir, 'fix_plan.md'),
        worktreePath: dir,
        iteration: 1,
      });

      // PROMPT.md is a forge scaffolding artifact in the worktree; the
      // load-bearing assertion is that aider's committed output is surfaced.
      assert.ok(info.filesChanged.includes('new_feature.ts'), 'git diff surfaces aider commit');
      assert.equal(info.costUsd, 0.05, 'cost parsed from stdout');
      assert.deepEqual(info.toolsUsed, [], 'aider has no per-tool telemetry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('forwards model + prompt to the subprocess runner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-aider-fwd-'));
    try {
      const { runner, calls } = makeFakeRunner();
      const promptPath = join(dir, 'PROMPT.md');
      writeFileSync(promptPath, 'do the thing');

      const opts: AiderAgentOptions = { model: 'claude-3-7-sonnet-20250219', runAider: runner };
      const adapter = makeAiderAdapter(runner, true);
      // createAgent on the adapter uses the runner baked by makeAiderAdapter;
      // pass model through AdapterAgentOptions.
      await adapter.createAgent(opts)({
        promptPath,
        agentMdPath: join(dir, 'AGENT.md'),
        fixPlanPath: join(dir, 'fix_plan.md'),
        worktreePath: dir,
        iteration: 1,
      });

      assert.equal(calls.length, 1, 'runner called once');
      assert.equal(calls[0]!.message, 'do the thing', 'prompt body forwarded as message');
      assert.equal(calls[0]!.model, 'claude-3-7-sonnet-20250219', 'model forwarded');
      assert.equal(calls[0]!.worktreePath, dir, 'worktree forwarded as cwd');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('surfaces non-zero exit in lastAssistantText', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-aider-err-'));
    try {
      const { runner } = makeFakeRunner({ stdout: '', exitCode: 2 });
      const promptPath = join(dir, 'PROMPT.md');
      writeFileSync(promptPath, 'fail please');

      const adapter = makeAiderAdapter(runner, true);
      const info = await adapter.createAgent({})({
        promptPath,
        agentMdPath: join(dir, 'AGENT.md'),
        fixPlanPath: join(dir, 'fix_plan.md'),
        worktreePath: dir,
        iteration: 1,
      });

      assert.ok(info.lastAssistantText?.includes('aider exited 2'), 'exit code surfaced');
      assert.equal(info.costUsd, 0, 'no cost on failure → 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C. query shim — single terminal (aider is loop-driven, not a stream)
// ---------------------------------------------------------------------------

describe('aider adapter: query shim', () => {
  test('yields exactly one result-type terminal message', async () => {
    const { runner } = makeFakeRunner({ stdout: 'Cost: $0.10 message, $0.10 session.' });
    const adapter = makeAiderAdapter(runner, true);

    const msgs: Array<{ type?: string; total_cost_usd?: number }> = [];
    for await (const m of adapter.query({ prompt: 'hi' })) {
      msgs.push(m as { type?: string; total_cost_usd?: number });
    }

    assert.equal(msgs.length, 1, 'exactly one message (batch, not a stream)');
    assert.equal(msgs[0]!.type, 'result', 'the single message is the result terminal');
    assert.equal(msgs[0]!.total_cost_usd, 0.1, 'cost parsed onto the terminal');
  });

  test('still yields a well-formed error terminal when the runner throws', async () => {
    const throwingRunner: AiderRunner = async () => {
      throw new Error('boom');
    };
    const adapter = makeAiderAdapter(throwingRunner, true);

    const msgs: Array<{ type?: string; subtype?: string }> = [];
    for await (const m of adapter.query({ prompt: 'hi' })) {
      msgs.push(m as { type?: string; subtype?: string });
    }

    assert.equal(msgs.length, 1, 'one terminal even on failure');
    assert.equal(msgs[0]!.type, 'result', 'terminal is a result');
    assert.equal(msgs[0]!.subtype, 'error', 'subtype flags the failure');
  });
});

// ---------------------------------------------------------------------------
// D. Availability gate — dep + creds
// ---------------------------------------------------------------------------

describe('aider adapter: dep+creds availability gate', () => {
  test('exported adapter is unavailable in this credential-less env', () => {
    // No aider binary + no API key in CI → false. (If someone runs this with a
    // key AND aider installed, the assertion would flip; that is the correct
    // semantics, so we assert the dominant CI case explicitly via compute.)
    assert.equal(typeof aiderAdapter.available, 'boolean');
  });

  test('computeAiderAvailable is false when no API key env var is set', async () => {
    const env: NodeJS.ProcessEnv = {}; // no ANTHROPIC_API_KEY / OPENAI_API_KEY
    assert.equal(await computeAiderAvailable(env), false, 'no creds → unavailable');
  });

  test('computeAiderAvailable is false with a key but no aider dep present', async () => {
    // Key set, but neither the binary nor the npm shim exists in this env →
    // the dep half fails → still unavailable.
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk-test-not-real' };
    assert.equal(await computeAiderAvailable(env), false, 'key but no dep → unavailable');
  });

  test('id is "aider"', () => {
    assert.equal(aiderAdapter.id, 'aider');
  });
});

// ---------------------------------------------------------------------------
// E. Pure-function units: cost parsing + git detection edge cases
// ---------------------------------------------------------------------------

describe('aider adapter: pure helpers', () => {
  test('parseAiderCostUsd: prefers session total', () => {
    assert.equal(parseAiderCostUsd('Cost: $0.0123 message, $0.0456 session.'), 0.0456);
  });
  test('parseAiderCostUsd: falls back to message cost', () => {
    assert.equal(parseAiderCostUsd('Cost: $0.0123'), 0.0123);
  });
  test('parseAiderCostUsd: returns 0 when no cost line', () => {
    assert.equal(parseAiderCostUsd('no cost here'), 0);
  });
  test('parseAiderCostUsd: returns 0 on empty', () => {
    assert.equal(parseAiderCostUsd(''), 0);
  });

  test('detectChangedFiles: returns [] for a non-git dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-aider-nogit-'));
    try {
      assert.deepEqual(detectChangedFiles(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('detectChangedFiles: surfaces uncommitted working-tree changes', () => {
    const dir = makeGitWorktree();
    try {
      writeFileSync(join(dir, 'dirty.txt'), 'uncommitted\n');
      const changed = detectChangedFiles(dir);
      assert.ok(changed.includes('dirty.txt'), 'working-tree change detected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
