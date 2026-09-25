/**
 * developer-loop.merge-conflict-requeue.cleanup.ts — the fixture-teardown
 * race handling for `developer-loop.merge-conflict-requeue.test.ts`, split
 * out here purely to keep that file under its 800-line cap (`node
 * scripts/check-file-size.mjs`); every export here is consumed by exactly
 * that one test file.
 *
 * `rmSync(root, {recursive:true,force:true})`'s `force` suppresses ENOENT
 * (already gone) — never ENOTEMPTY. A git subprocess the fixture's own
 * `push` may have left running against `origin.git` (a receive-pack-
 * triggered auto-gc deciding to detach — `gc.autoDetach`'s own default,
 * disabled at the fixture's `setup()` as the primary fix) can still be
 * writing into it a beat after the fixture's own `git` calls already
 * returned, racing teardown's walk — reproduced deterministically with a
 * controlled concurrent writer (bd forge-8vfn.5.55, known-flakes #9).
 *
 * The retry is scoped to this ONE error code, never a blind "retry until it
 * works": by the time a test reaches teardown its own assertions have
 * already run, so a straggler that finishes within a bounded window should
 * not flip an already-passing test to failed (COMMON §15.74's second
 * remedy shape) — but anything OTHER than ENOTEMPTY, or a straggler that
 * has not finished after the budget, still throws.
 *
 * A fixed `delayMs` sleep-and-hope is not honest under load: at proof-suite
 * load 8 an injected straggler (its own 400ms wall-clock write budget)
 * outlived the 5×100ms retry window and threw ENOTEMPTY at 1.8s (bd
 * forge-8vfn.5.55, known-flakes #9, load-8 recurrence). When the caller
 * knows exactly which child process is still writing (`knownWriters` — the
 * straggler test in the sibling file spawns its own), teardown kills that
 * child outright before retrying — the disposable fixture is about to be
 * deleted anyway, so ending its writer is safe.
 *
 * M7-C last-flakes #3 (known-flakes.md
 * `packages/factory/tests/integration/developer-loop.merge-conflict-requeue.test.ts:686`,
 * moved to `packages/stations/` — same file): the OTHER three tests in the
 * sibling file call plain `f.cleanup()` with NO known writer — a real,
 * unidentified git straggler from production `mergeAndPublish`/
 * `createWiWorktree` calls, not a test's own injected one.
 *
 * A FIRST attempt at "no known writer" generalized `knownWriters` by
 * scanning `/proc/<pid>/fd/*` for any process with an open descriptor under
 * `root`, on the theory that a straggler's held-open fd is the direct
 * evidence. Measured wrong: a writer that does short, repeated
 * open→write→close calls (git's own pack-file writes, and this file's own
 * deterministic straggler fixture) is caught with its fd open only in a
 * narrow window, and scanning every pid's fd table under `/proc` is not
 * instant — 2 of 3 unloaded local runs still ENOTEMPTY'd with that fd scan
 * in place. `waitForQuietDir()` replaces it with the thing ENOTEMPTY is
 * actually about: rmSync's error names the exact directory it found
 * non-empty (`err.path`) — poll THAT listing until it stops changing across
 * a couple of consecutive reads, then retry the removal. This needs no
 * writer identity at all, known or discovered, and does not care whether
 * the writer holds its fd open or not — only whether the directory it is
 * touching is still changing.
 */
import type { ChildProcess } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';

export type CleanupOpts = { knownWriters?: ChildProcess[]; attempts?: number; delayMs?: number };

export async function cleanupFixtureRoot(root: string, opts: CleanupOpts = {}): Promise<void> {
  const { knownWriters = [], attempts = 5, delayMs = 100 } = opts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // Scoped to this ONE named teardown error, after this test's own assertions already passed — never a blind retry.
      if (e.code !== 'ENOTEMPTY' || attempt === attempts) throw err;
      if (knownWriters.length > 0) {
        await Promise.all(knownWriters.map(killAndAwaitExit));
      }
      if (e.path) {
        await waitForQuietDir(e.path);
      } else {
        await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
      }
    }
  }
}

/** Stop a known writer outright and wait for it to actually be gone —
 *  bounded by the OS actually delivering the exit, not by a wall-clock
 *  guess. Already-exited children (checked via `exitCode`/`signalCode`)
 *  resolve immediately; a `kill()` racing a child that exits on its own
 *  between the check and the signal still resolves via the `exit` event. */
function killAndAwaitExit(child: ChildProcess): Promise<void> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit();
      return;
    }
    child.once('exit', () => resolveExit());
    try {
      child.kill('SIGKILL');
    } catch {
      resolveExit();
    }
  });
}

/**
 * Poll `dirPath`'s own listing until it reports the SAME entries across
 * `quietChecks` consecutive reads (default 2, ~30ms apart) — the directory
 * has gone quiet, whoever was writing into it (named or not) has stopped —
 * or until `ceilingMs` elapses, whichever comes first. A directory that has
 * vanished entirely (the straggler's own work, or a sibling cleanup) counts
 * as quiet: there is nothing left to race. This needs no writer identity:
 * it reads the exact evidence ENOTEMPTY is about, the directory's own
 * contents, rather than inferring a process from `/proc`.
 */
async function waitForQuietDir(dirPath: string, opts: { quietChecks?: number; pollMs?: number; ceilingMs?: number } = {}): Promise<void> {
  const { quietChecks = 2, pollMs = 30, ceilingMs = 4000 } = opts;
  const deadline = Date.now() + ceilingMs;
  let previous: string | null = null;
  let stableStreak = 0;
  while (Date.now() < deadline) {
    let listing: string;
    try {
      listing = readdirSync(dirPath).sort().join('\0');
    } catch {
      return; // gone entirely — nothing left to race
    }
    if (previous !== null && listing === previous) {
      stableStreak += 1;
      if (stableStreak >= quietChecks) return;
    } else {
      stableStreak = 0;
    }
    previous = listing;
    await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
  }
}
