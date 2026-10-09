/**
 * git-residue-guard-core.mjs — the pure half of a test-run residue guard: any
 * TRACKED file `npm test` leaves dirty is exactly the class `ground-hash.mjs`
 * exists to catch for a story run (it hashes `projects/` before and after to
 * prove a run's ground did not drift), and a full suite has no fence of its
 * own for the WHOLE repo. M7-D handoff, T1's "cheap fence" ask.
 *
 * `git status --porcelain -uno` lists only non-clean TRACKED paths (`-uno`
 * hides untracked files, a different, much noisier class this guard is not
 * for) — a clean checkout reports nothing, so this needs no allowlist and
 * never nags an operator's own pre-existing dirty tree: only a line that is
 * NEW between the before- and after-snapshot is residue.
 *
 * PURE ON PURPOSE, same shape as `logs-residue-guard-core.mjs`: no
 * import-time I/O and no reference to this repo's own root — a caller hands
 * in `cwd` explicitly, so a unit test can drive it against a throwaway repo
 * without ever touching this checkout's real tree. The actual preload wiring
 * (snapshot-at-import + fail-at-exit, git invoked against THIS repo) lives in
 * the sibling `git-residue-guard.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every non-clean TRACKED path `git status --porcelain -uno` reports under
 * `cwd`, as a `Set` of full porcelain lines (the two-character status code
 * plus the path). The status code is part of the line on purpose: a path
 * that goes from `' M'` to `'MM'` between snapshots is a real state change
 * and must count as new, not be masked by matching on the path alone.
 *
 * Never swallows a `git` failure — an unreadable tree is a louder problem
 * than a false-clean residue check, so a spawn failure propagates as an
 * uncaught throw, the same discipline this audit set for every guard in
 * `scripts/stories/`.
 */
export function trackedPorcelainLines(cwd) {
  const out = execFileSync('git', ['status', '--porcelain', '-uno'], { cwd, encoding: 'utf8' });
  return new Set(
    out
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0),
  );
}

/**
 * The lines present in `after` but absent from `before`, sorted for a
 * deterministic report — the same "only appearances are reported" rule as
 * `newInitDirs`: a line already dirty before the suite ran is the operator's
 * own pre-existing state, not something this run caused.
 */
export function newTrackedChanges(before, after) {
  return [...after].filter((line) => !before.has(line)).sort();
}

/**
 * Is a live forge run writing into `root`? The signal is the one the daemon
 * itself keeps: `forge studio` supervises `forge serve`, which records its pid
 * in `<root>/_logs/daemon/forge.pid` (`daemonPaths`, `packages/flows/daemon.ts`)
 * for as long as it runs — a real cycle's reflector writes TRACKED `brain/`
 * files only under that daemon. Re-derived here rather than imported because
 * this preload is plain `.mjs` and must stay import-light.
 *
 * Three-valued on purpose (fail closed): `{ state: 'none' }` only when there is
 * no pid file, or it names a dead pid; `{ state: 'live', pid }` when the pid is
 * alive; `{ state: 'unknown', pidFile, reason }` when the file exists but cannot
 * be read/parsed, or `isPidAlive` throws. An unreadable signal is never read as
 * "no live run" (and never as "live run") — the report says it was inconclusive.
 *
 * `isPidAlive` is injected so a unit test needs no real daemon; the preload
 * passes a `process.kill(pid, 0)` probe.
 */
export function liveRunVerdict(root, isPidAlive) {
  const pidFile = join(root, '_logs', 'daemon', 'forge.pid');
  let raw;
  try {
    raw = readFileSync(pidFile, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { state: 'none' };
    return { state: 'unknown', pidFile, reason: `unreadable: ${err?.message ?? err}` };
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { state: 'unknown', pidFile, reason: `unparseable content ${JSON.stringify(raw.trim().slice(0, 40))}` };
  }
  try {
    return isPidAlive(pid) ? { state: 'live', pid } : { state: 'none' };
  } catch (err) {
    return { state: 'unknown', pidFile, reason: `liveness probe failed for pid ${pid}: ${err?.message ?? err}` };
  }
}

/**
 * The stderr report for a finished test file, or `null` when nothing new is
 * dirty. A new tracked change while a forge run is live is that run's write,
 * not the test's, so the message names the live writer instead of telling the
 * reader to restore files the test never touched. The file still FAILS either
 * way (the caller sets `exitCode = 1`): a suite whose tree changed under it is
 * not clean evidence.
 */
export function residueReport({ root, before, after, isPidAlive }) {
  const changed = newTrackedChanges(before, after);
  if (changed.length === 0) return null;
  const files = changed.join(', ');
  const verdict = liveRunVerdict(root, isPidAlive);
  if (verdict.state === 'live') {
    return (
      `\ngit-residue-guard: a live forge run is writing ${files}; stop forge studio before npm test ` +
      `(daemon pid ${verdict.pid} is alive in ${root}). This file's tree changed under it, so its result is not clean evidence.\n`
    );
  }
  if (verdict.state === 'unknown') {
    return (
      `\ngit-residue-guard: ${changed.length} tracked file(s) changed (${files}) and the live-run probe was ` +
      `inconclusive (${verdict.reason}; pid file ${verdict.pidFile}). Cannot tell a test's write from a ` +
      "running forge's — stop forge studio and fix or remove the pid file before npm test.\n"
    );
  }
  return (
    `\ngit-residue-guard: this test run left ${changed.length} tracked file(s) dirty in the ` +
    `REPO ROOT (${root}) that were clean when it started:\n` +
    changed.map((line) => `  ${line}`).join('\n') +
    '\nA test that writes into a real tracked path (rather than a caller-owned tmp dir) must ' +
    'restore it — `git status --short` must be empty when a test file exits.\n'
  );
}
