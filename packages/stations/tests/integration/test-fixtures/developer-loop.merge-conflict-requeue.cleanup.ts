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
 * straggler test in the sibling file spawns its own), teardown stops
 * guessing at timing entirely: it kills that child and awaits its actual
 * exit before retrying the removal, so the wait is bounded by "is it dead
 * yet", not by a wall-clock budget that starves along with everything else.
 * Callers with no known writer (a real, unidentified git straggler) still
 * fall back to the scoped delay retry.
 */
import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';

export type CleanupOpts = { knownWriters?: ChildProcess[]; attempts?: number; delayMs?: number };

export async function cleanupFixtureRoot(root: string, opts: CleanupOpts = {}): Promise<void> {
  const { knownWriters = [], attempts = 5, delayMs = 100 } = opts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Scoped to this ONE named teardown error, after this test's own assertions already passed — never a blind retry.
      if (code !== 'ENOTEMPTY' || attempt === attempts) throw err;
      if (knownWriters.length > 0) {
        await Promise.all(knownWriters.map(killAndAwaitExit));
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
