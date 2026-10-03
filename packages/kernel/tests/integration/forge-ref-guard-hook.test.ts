/**
 * Tests for `forge-ref-guard-hook.ts` — row 211, bead `forge-8vfn.8.5.47`.
 *
 * REAL git, REAL temp repos throughout: the whole point of this design is
 * "ask git's own mechanism", so a test that stubs `child_process` would prove
 * nothing about whether git itself actually honours the hook. Every repo here
 * is a fresh `mkdtemp` — never `/home/parso/forge` or this worktree's own
 * `.git` (its common dir IS `/home/parso/forge/.git`), per this task's own
 * standing rule.
 *
 * Door (a): a temp FORGE repo + a linked worktree of it — the exact shape row
 * 208's bug lived in (an operator's own checkout is a worktree of the SAME
 * repo as any story tree), proving the guard fires from either side.
 *
 * Door (b): a SEPARATE temp PROJECT repo — no forge ref guard ever installed
 * in it — proving the run-7 commit (misparsed by row 208's retired
 * PreToolUse fence) now succeeds unconditionally, because this file's design
 * never inspects the command at all.
 *
 * Door (c): the installer's five outcomes.
 */
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { EventLogEntry, EventLogger } from '../../logging.ts';
import {
  FORGE_REF_GUARD_HOOK_NAME,
  FORGE_REF_GUARD_MARKER_PREFIX,
  forgeRefGuardHookScript,
  installForgeRefGuardHook,
} from '../../forge-ref-guard-hook.ts';

/** A logger that records every emitted event instead of writing to disk — the
 *  installer's only contract with its caller is `EventLogger`'s shape. */
function capturingLogger(): { logger: EventLogger; events: EventLogEntry[] } {
  const events: EventLogEntry[] = [];
  const logger: EventLogger = {
    cycleId: 'test-cycle',
    logFilePath: '/dev/null',
    emit: (partial) => {
      const entry = { event_id: 'EV_test', cycle_id: 'test-cycle', started_at: new Date().toISOString(), ...partial } as EventLogEntry;
      events.push(entry);
      return entry;
    },
  };
  return { logger, events };
}

function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/** Run `args` and report success/failure instead of throwing — the DENIED
 *  shape is the thing under test, not an exceptional case to avoid. */
function tryGit(args: string[], cwd: string, env: NodeJS.ProcessEnv): { ok: boolean; stderr: string } {
  try {
    execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stderr: '' };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? String(err);
    return { ok: false, stderr };
  }
}

function tryBash(command: string, cwd: string, env: NodeJS.ProcessEnv): { ok: boolean; stderr: string } {
  try {
    execFileSync('bash', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stderr: '' };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? String(err);
    return { ok: false, stderr };
  }
}

/** A fresh temp repo with one commit on `main`, forge's own identity config
 *  set locally (never the operator's global config) so commits need no
 *  per-call `-c user.*`. */
function makeTempRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.invalid'], dir);
  git(['config', 'user.name', 'Test'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);
  return dir;
}

/** The env a marked/unmarked git invocation runs under — ambient
 *  `process.env` with exactly one override, mirroring how little the hook
 *  actually looks at. */
function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Door (a): a temp forge repo + a linked worktree.
// ---------------------------------------------------------------------------

test('door (a): FORGE_AGENT_SPAWN=1 refuses commit, update-ref AND branch from a LINKED WORKTREE, and every ref is unchanged', () => {
  const repo = makeTempRepo('ref-guard-forge-');
  const wt = join(repo, '..', `${repo.split('/').pop()}-wt-spawn`);
  try {
    const { logger } = capturingLogger();
    assert.equal(installForgeRefGuardHook(repo, logger), 'installed');

    git(['worktree', 'add', '-q', wt, '-b', 'spawn-branch'], repo);
    const mainBefore = git(['rev-parse', 'refs/heads/main'], repo).trim();
    const branchesBefore = git(['branch', '--list'], repo);

    const env = envWith({ FORGE_AGENT_SPAWN: '1' });

    // commit
    writeFileSync(join(wt, 'f.txt'), 'change\n');
    git(['add', 'f.txt'], wt);
    const commitResult = tryGit(['commit', '-q', '-m', 'agent commit'], wt, env);
    assert.equal(commitResult.ok, false, 'a marked commit must be refused');
    assert.match(commitResult.stderr, /aborted by hook|forge-agent-ref-guard/);

    // update-ref — move main to a DIFFERENT value than it holds now, so a
    // ref left "unchanged" below is evidence of a real refusal, not a no-op.
    writeFileSync(join(wt, 'g.txt'), 'another change\n');
    git(['add', 'g.txt'], wt);
    git(['commit', '-q', '-m', 'advance spawn-branch'], wt); // unmarked — produces a sha distinct from main
    const distinctSha = git(['rev-parse', 'spawn-branch'], wt).trim();
    assert.notEqual(distinctSha, mainBefore);
    const updateRefResult = tryGit(['update-ref', 'refs/heads/main', distinctSha], wt, env);
    assert.equal(updateRefResult.ok, false, 'a marked update-ref must be refused');

    // branch
    const branchResult = tryGit(['branch', 'new-from-spawn'], wt, env);
    assert.equal(branchResult.ok, false, 'a marked branch create must be refused');

    assert.equal(git(['rev-parse', 'refs/heads/main'], repo).trim(), mainBefore, 'main must be byte-unchanged');
    assert.equal(git(['branch', '--list'], repo), branchesBefore, 'no new branch may have been created');
  } finally {
    rmSync(wt, { recursive: true, force: true });
    try { git(['worktree', 'prune'], repo); } catch { /* best-effort cleanup */ }
    rmSync(repo, { recursive: true, force: true });
  }
});

test('door (a): FORGE_AGENT_RUN_MARKER=tok refuses the same three verbs from a linked worktree', () => {
  const repo = makeTempRepo('ref-guard-forge-');
  const wt = join(repo, '..', `${repo.split('/').pop()}-wt-marker`);
  try {
    const { logger } = capturingLogger();
    assert.equal(installForgeRefGuardHook(repo, logger), 'installed');

    git(['worktree', 'add', '-q', wt, '-b', 'marker-branch'], repo);
    const mainBefore = git(['rev-parse', 'refs/heads/main'], repo).trim();

    const env = envWith({ FORGE_AGENT_RUN_MARKER: 'tok', FORGE_AGENT_SPAWN: undefined });

    writeFileSync(join(wt, 'f.txt'), 'change\n');
    git(['add', 'f.txt'], wt);
    assert.equal(tryGit(['commit', '-q', '-m', 'agent commit'], wt, env).ok, false);
    assert.equal(tryGit(['update-ref', 'refs/heads/main', mainBefore], wt, env).ok, false);
    assert.equal(tryGit(['branch', 'new-from-marker'], wt, env).ok, false);

    assert.equal(git(['rev-parse', 'refs/heads/main'], repo).trim(), mainBefore, 'main must be byte-unchanged');
  } finally {
    rmSync(wt, { recursive: true, force: true });
    try { git(['worktree', 'prune'], repo); } catch { /* best-effort cleanup */ }
    rmSync(repo, { recursive: true, force: true });
  }
});

test('door (a): with NEITHER env var set, commit, update-ref AND branch all succeed from the same linked worktree', () => {
  const repo = makeTempRepo('ref-guard-forge-');
  const wt = join(repo, '..', `${repo.split('/').pop()}-wt-plain`);
  try {
    const { logger } = capturingLogger();
    assert.equal(installForgeRefGuardHook(repo, logger), 'installed');

    git(['worktree', 'add', '-q', wt, '-b', 'plain-branch'], repo);
    const mainBefore = git(['rev-parse', 'refs/heads/main'], repo).trim();

    const env = envWith({ FORGE_AGENT_SPAWN: undefined, FORGE_AGENT_RUN_MARKER: undefined });

    writeFileSync(join(wt, 'f.txt'), 'change\n');
    git(['add', 'f.txt'], wt);
    assert.equal(tryGit(['commit', '-q', '-m', 'human commit'], wt, env).ok, true, 'an unmarked commit must succeed');
    assert.equal(tryGit(['update-ref', 'refs/heads/main', mainBefore], wt, env).ok, true, 'an unmarked update-ref must succeed');
    assert.equal(tryGit(['branch', 'new-from-plain'], wt, env).ok, true, 'an unmarked branch create must succeed');
  } finally {
    rmSync(wt, { recursive: true, force: true });
    try { git(['worktree', 'prune'], repo); } catch { /* best-effort cleanup */ }
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Door (b): a SEPARATE temp PROJECT repo, never touched by the forge ref
// guard — proving the run-7 commit (row 208's false refusal) now succeeds.
// ---------------------------------------------------------------------------

test('door (b): the run-7 heredoc commit succeeds under FORGE_AGENT_SPAWN=1 in a PROJECT worktree with no forge ref guard installed', () => {
  const project = makeTempRepo('ref-guard-project-');
  const wt = join(project, '..', `${project.split('/').pop()}-wi-wt`);
  try {
    // Deliberately NEVER calling installForgeRefGuardHook on this repo — a
    // project repo has its own, separate .git and this design never reaches
    // it at all. If this test needed to install anything here to pass, the
    // design would not be "never even sees it".
    git(['worktree', 'add', '-q', wt, '-b', 'wi-branch'], project);

    writeFileSync(join(wt, 'author-filter.ts'), '// new content\n');
    git(['add', 'author-filter.ts'], wt);

    const env = envWith({ FORGE_AGENT_SPAWN: '1' });
    const heredocCommand = [
      'git commit -m "$(cat <<\'EOF\'',
      'feat: add filterExcludedAuthors to author-filter with unit tests',
      '',
      'Inverse of filterAuthorCommits — keeps commits matching NO pattern.',
      'EOF',
      ')"',
    ].join('\n');

    const result = tryBash(heredocCommand, wt, env);
    assert.equal(result.ok, true, `the run-7 heredoc commit must succeed in a project worktree: ${result.stderr}`);
    const subject = git(['log', '-1', '--format=%s'], wt).trim();
    assert.equal(subject, 'feat: add filterExcludedAuthors to author-filter with unit tests');
  } finally {
    rmSync(wt, { recursive: true, force: true });
    try { git(['worktree', 'prune'], project); } catch { /* best-effort cleanup */ }
    rmSync(project, { recursive: true, force: true });
  }
});

test('door (b): a plain quoted commit message also succeeds under FORGE_AGENT_SPAWN=1 in the project worktree', () => {
  const project = makeTempRepo('ref-guard-project-');
  const wt = join(project, '..', `${project.split('/').pop()}-wi-wt2`);
  try {
    git(['worktree', 'add', '-q', wt, '-b', 'wi-branch-2'], project);
    writeFileSync(join(wt, 'git-log-parse.ts'), '// change\n');
    git(['add', 'git-log-parse.ts'], wt);

    const env = envWith({ FORGE_AGENT_SPAWN: '1' });
    const result = tryBash('git commit -m "fix: parse git log and git branch output"', wt, env);
    assert.equal(result.ok, true, `expected success, got: ${result.stderr}`);
    assert.equal(git(['log', '-1', '--format=%s'], wt).trim(), 'fix: parse git log and git branch output');
  } finally {
    rmSync(wt, { recursive: true, force: true });
    try { git(['worktree', 'prune'], project); } catch { /* best-effort cleanup */ }
    rmSync(project, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Door (c): the installer's five outcomes.
// ---------------------------------------------------------------------------

test('installer: absent -> installed, mode 0755, script matches forgeRefGuardHookScript()', () => {
  const repo = makeTempRepo('ref-guard-install-');
  try {
    const { logger, events } = capturingLogger();
    const outcome = installForgeRefGuardHook(repo, logger);
    assert.equal(outcome, 'installed');

    const hookPath = join(repo, '.git', 'hooks', FORGE_REF_GUARD_HOOK_NAME);
    assert.equal(existsSync(hookPath), true);
    assert.equal(readFileSync(hookPath, 'utf8'), forgeRefGuardHookScript());
    assert.equal(statSync(hookPath).mode & 0o777, 0o755);

    assert.equal(events.length, 1);
    assert.equal(events[0]!.message, 'forge-ref-guard.installed');
    assert.equal(events[0]!.event_type, 'log');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('installer: present + identical -> already-present, no-op, byte-identical file', () => {
  const repo = makeTempRepo('ref-guard-install-');
  try {
    const { logger: l1 } = capturingLogger();
    installForgeRefGuardHook(repo, l1);
    const hookPath = join(repo, '.git', 'hooks', FORGE_REF_GUARD_HOOK_NAME);
    const before = readFileSync(hookPath, 'utf8');

    const { logger: l2, events } = capturingLogger();
    const outcome = installForgeRefGuardHook(repo, l2);
    assert.equal(outcome, 'already-present');
    assert.equal(readFileSync(hookPath, 'utf8'), before);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.message, 'forge-ref-guard.already-present');
    assert.equal(events[0]!.event_type, 'log');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('installer: present with OUR marker but different content -> updated, rewritten to the current script', () => {
  const repo = makeTempRepo('ref-guard-install-');
  try {
    const hooksDir = join(repo, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, FORGE_REF_GUARD_HOOK_NAME);
    const stale = `#!/bin/sh\n${FORGE_REF_GUARD_MARKER_PREFIX} v0\n# a stale body from before a script change\nexit 0\n`;
    writeFileSync(hookPath, stale, { mode: 0o755 });
    chmodSync(hookPath, 0o755);

    const { logger, events } = capturingLogger();
    const outcome = installForgeRefGuardHook(repo, logger);
    assert.equal(outcome, 'updated');
    assert.equal(readFileSync(hookPath, 'utf8'), forgeRefGuardHookScript());
    assert.equal(events.length, 1);
    assert.equal(events[0]!.message, 'forge-ref-guard.updated');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('installer: present WITHOUT our marker (a foreign hook) -> refused-foreign, left byte-identical', () => {
  const repo = makeTempRepo('ref-guard-install-');
  try {
    const hooksDir = join(repo, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, FORGE_REF_GUARD_HOOK_NAME);
    const foreign = '#!/bin/sh\n# an operator-authored hook, not forge\'s\nexit 0\n';
    writeFileSync(hookPath, foreign, { mode: 0o755 });
    chmodSync(hookPath, 0o755);

    const { logger, events } = capturingLogger();
    const outcome = installForgeRefGuardHook(repo, logger);
    assert.equal(outcome, 'refused-foreign');
    assert.equal(readFileSync(hookPath, 'utf8'), foreign, 'a foreign hook must be left byte-identical');
    assert.equal(events.length, 1);
    assert.equal(events[0]!.message, 'forge-ref-guard.refused-foreign');
    assert.equal(events[0]!.event_type, 'error', 'a refusal is the one outcome worth flagging as an error');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('installer: forgeRoot is not a git repo at all -> skipped-not-a-repo, nothing written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ref-guard-not-a-repo-'));
  try {
    const { logger, events } = capturingLogger();
    const outcome = installForgeRefGuardHook(dir, logger);
    assert.equal(outcome, 'skipped-not-a-repo');
    assert.equal(existsSync(join(dir, '.git')), false);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.message, 'forge-ref-guard.skipped-not-a-repo');
    assert.equal(events[0]!.event_type, 'log');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
