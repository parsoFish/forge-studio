/**
 * forge-mfv5.1.47 (P0, D-06 + D-11) — a boot only CLASSIFIES a stranded
 * in-flight manifest; it never re-dispatches it and never touches its branch,
 * worktree or `.forge/` scratch.
 *
 * Measured shape (capstone I3b, 2026-10-16 09:36:43Z): serve SIGKILLed mid
 * dev-loop left `_queue/in-flight/<id>.md` + a stale `.heartbeat` + a `.stop`
 * flag. The boot's recovery sweep moved it back to `pending/`, its cleanup ran
 * `git worktree remove --force` + `git branch -D forge/<id>`, and the re-claim
 * recreated the branch from main. These tests drive the real boot door
 * (`serve({ mode: 'once' })`) on a tmp forge root: the manifest must land in
 * `failed/` with a `recovery.stranded-classified` event naming the reason, the
 * stop flag and the last cycle event — and the branch sha, the worktree and its
 * untracked scratch must be byte-identical afterwards. The phase wiring is
 * empty and the project is a tmp repo with no remote, so even a broken
 * classifier cannot reach a funded or networked run (M7-COMMON §6.16).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getPaths } from '../../queue.ts';
import { serve } from '../../scheduler.ts';
import { operatorStopPath } from '../../operator-stop.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';

const ID = 'INIT-2026-10-16-boot-stranded';
const CYCLE = `2026-10-16T09-00-00_${ID}`;
const WIRING = {} as unknown as PhaseWiring;
const QUIET = { desktop: false, webhook_url: null };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

type Fixture = { dir: string; paths: ReturnType<typeof getPaths>; repo: string; wt: string; logsRoot: string; branchSha: string };

/** A tmp forge root with a stranded in-flight manifest whose branch + worktree + scratch exist. */
function strandedFixture(opts: { stale: boolean; stopFlag: boolean; worktreePresent: boolean }): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'forge-boot-stranded-'));
  const paths = getPaths(join(dir, '_queue'));
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) mkdirSync(p, { recursive: true });
  const repo = join(dir, 'projects', 'p');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base']);
  git(repo, ['branch', `forge/${ID}`]);
  const wt = join(dir, '_worktrees', ID);
  if (opts.worktreePresent) {
    git(repo, ['worktree', 'add', '-q', wt, `forge/${ID}`]);
    git(wt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'wi(WI-1): merge']);
    mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(wt, '.forge', 'work-items', 'WI-1.md'), '---\nwork_item_id: WI-1\n---\nscratch\n');
  }
  const branchSha = git(repo, ['rev-parse', `forge/${ID}`]);
  const filename = `${ID}.md`;
  writeFileSync(
    join(paths.inFlight, filename),
    [
      '---',
      `initiative_id: ${ID}`,
      'project: p',
      `project_repo_path: ${repo}`,
      "created_at: '2026-10-16T00:00:00Z'",
      'iteration_budget: 10',
      'cost_budget_usd: 5',
      'class: code',
      `worktree_path: ${wt}`,
      `cycle_id: ${CYCLE}`,
      'resume_from: develop',
      '---',
      'body',
      '',
    ].join('\n'),
  );
  const hb = join(paths.inFlight, `${filename}.heartbeat`);
  writeFileSync(hb, new Date().toISOString());
  if (opts.stale) {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(hb, past, past);
  }
  if (opts.stopFlag) writeFileSync(operatorStopPath(paths.inFlight, ID), '{"reason":"operator-stop"}');
  const logsRoot = join(dir, '_logs');
  mkdirSync(join(logsRoot, CYCLE), { recursive: true });
  writeFileSync(
    join(logsRoot, CYCLE, 'events.jsonl'),
    JSON.stringify({ initiative_id: ID, phase: 'developer-loop', event_type: 'log', message: 'developer-loop.iteration', started_at: '2026-10-16T09:12:20.000Z' }) + '\n',
  );
  return { dir, paths, repo, wt, logsRoot, branchSha };
}

function events(f: Fixture): Array<{ message: string; event_type?: string; metadata?: Record<string, unknown> }> {
  const out: Array<{ message: string; event_type?: string; metadata?: Record<string, unknown> }> = [];
  for (const d of readdirSync(f.logsRoot)) {
    const p = join(f.logsRoot, d, 'events.jsonl');
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n').filter(Boolean)) out.push(JSON.parse(line));
  }
  return out;
}

/** Every event the boot itself wrote (the fixture seeds exactly one, `developer-loop.iteration`). */
function bootEmitted(all: Array<{ message: string }>): string[] {
  return all.map((e) => e.message).filter((m) => m !== 'developer-loop.iteration');
}

async function boot(f: Fixture): Promise<void> {
  const log = console.log;
  const err = console.error;
  const warn = console.warn;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  try {
    await serve({ mode: 'once', phaseWiring: WIRING, queueRoot: f.paths.root, worktreesRoot: join(f.dir, '_worktrees'), logsRoot: f.logsRoot, notify: QUIET });
  } finally {
    console.log = log;
    console.error = err;
    console.warn = warn;
  }
}

test('boot: a stale, .stop-flagged in-flight manifest is classified into failed/ — never pending, never a cycle, branch + worktree + scratch untouched', async () => {
  const f = strandedFixture({ stale: true, stopFlag: true, worktreePresent: true });
  try {
    await boot(f);
    assert.ok(existsSync(join(f.paths.failed, `${ID}.md`)), 'the stranded manifest is parked in failed/');
    assert.deepEqual(readdirSync(f.paths.pending), [], 'never back in pending/ (no re-dispatch)');
    assert.deepEqual(readdirSync(f.paths.inFlight), [], 'nothing left in in-flight/ (heartbeat + stop flag cleared by the move)');
    assert.equal(git(f.repo, ['rev-parse', `forge/${ID}`]), f.branchSha, 'the local branch is never deleted or recreated');
    assert.ok(existsSync(join(f.wt, '.forge', 'work-items', 'WI-1.md')), 'the worktree and its untracked .forge scratch survive');
    assert.equal(git(f.wt, ['rev-parse', 'HEAD']), f.branchSha, 'the worktree is still on the branch tip');

    const all = events(f);
    assert.equal(all.filter((e) => e.message === 'cycle.start').length, 0, 'zero cycle.start — nothing runs from a boot');
    assert.deepEqual(bootEmitted(all), ['recovery.stranded-classified', 'failure_classification'], 'the boot classifies and does nothing else: no claim, no worktree step');
    const fc = all.find((e) => e.message === 'failure_classification')?.metadata ?? {};
    assert.equal(fc.cleanBoundaryHalt, true, 'forge-mfv5.1.54: the stop flag is a clean-boundary halt in the reader\'s own shape');
    assert.equal(fc.environment, false);
    assert.equal(fc.recoverable, false, 'never auto-retryable: the boot only classifies (D-06)');
    const c = all.filter((e) => e.message === 'recovery.stranded-classified');
    assert.equal(c.length, 1, 'exactly one classification event');
    const m = c[0]!.metadata ?? {};
    assert.equal(m.reason, 'stale-heartbeat');
    assert.equal(m.stop_flag, true, 'the operator stop is recorded, not lost with the flag file');
    assert.equal(m.needs, 'operator');
    assert.equal(m.resume_from, 'develop');
    assert.deepEqual(m.last_event, { message: 'developer-loop.iteration', phase: 'developer-loop', at: '2026-10-16T09:12:20.000Z' });
    assert.equal(typeof m.heartbeat_age_ms, 'number');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('boot: an in-flight manifest whose worktree is missing (no .stop) is classified missing-worktree into failed/ and its branch is kept', async () => {
  const f = strandedFixture({ stale: false, stopFlag: false, worktreePresent: false });
  try {
    await boot(f);
    assert.ok(existsSync(join(f.paths.failed, `${ID}.md`)), 'parked in failed/');
    assert.deepEqual(readdirSync(f.paths.pending), [], 'never back in pending/');
    assert.equal(git(f.repo, ['rev-parse', `forge/${ID}`]), f.branchSha, 'the branch is kept');
    const c = events(f).filter((e) => e.message === 'recovery.stranded-classified');
    assert.equal(c.length, 1);
    assert.equal(c[0]!.metadata?.reason, 'missing-worktree');
    assert.equal(c[0]!.metadata?.stop_flag, false);
    assert.deepEqual(bootEmitted(events(f)), ['recovery.stranded-classified', 'failure_classification'], 'no claim, no cycle');
    assert.equal(events(f).find((e) => e.message === 'failure_classification')?.metadata?.environment, true, 'forge-mfv5.1.54: killed without a stop flag = environment');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
