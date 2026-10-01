/**
 * Demo runtime — build + serve helpers for `forge demo capture`.
 *
 * The Playwright spec-runner helpers (runSpec, demoPlaywrightConfig,
 * findExampleSpec, firstExisting, harvestVideos) were removed in the REV-2
 * cull. What remains is the "make the app runnable" pair: buildTree +
 * startServer. The thin capture path in demo.ts calls these to get a live
 * server URL, then records each checkpoint label via demo-capture.ts.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { type DemoBuildStatus } from '@forge/stations/demo-types.ts';

function sh(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): { ok: boolean; tail: string } {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
    });
    return { ok: true, tail: out.slice(-800) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const tail = (e.stderr || e.stdout || e.message || 'unknown error').toString().slice(-800);
    return { ok: false, tail };
  }
}

/**
 * Install deps then optionally build. Fallback chain:
 *   1. npm ci                       (fast, exact, when lockfile is in sync)
 *   2. npm ci --legacy-peer-deps    (peer-dep conflicts only)
 *   3. npm install --legacy-peer-deps (lockfile drift / no lockfile)
 */
function installDeps(treePath: string): { ok: boolean; how: string; tail: string } {
  const hasLock = existsSync(join(treePath, 'package-lock.json'));
  const attempts: Array<{ how: string; args: string[] }> = hasLock
    ? [
        { how: 'npm ci', args: ['ci', '--no-audit', '--no-fund'] },
        { how: 'npm ci --legacy-peer-deps', args: ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'] },
        { how: 'npm install --legacy-peer-deps', args: ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'] },
      ]
    : [
        { how: 'npm install', args: ['install', '--no-audit', '--no-fund'] },
        { how: 'npm install --legacy-peer-deps', args: ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'] },
      ];
  let lastTail = '';
  for (const a of attempts) {
    const r = sh('npm', a.args, treePath, 600_000);
    if (r.ok) return { ok: true, how: a.how, tail: r.tail };
    lastTail = r.tail;
  }
  return { ok: false, how: attempts[attempts.length - 1].how, tail: lastTail };
}

type PkgJson = { scripts?: Record<string, string> };
function readPackageJson(treePath: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(treePath, 'package.json'), 'utf8')) as PkgJson;
  } catch {
    return null;
  }
}

/** Install deps + optional build. Returns a build status. */
export function buildTree(treePath: string, runBuild: boolean): DemoBuildStatus {
  const install = installDeps(treePath);
  if (!install.ok) return { ok: false, detail: `dependency install failed (last: ${install.how}): ${install.tail}` };
  if (runBuild) {
    const pkg = readPackageJson(treePath);
    if (pkg?.scripts?.build) {
      const b = sh('npm', ['run', 'build'], treePath, 600_000);
      if (!b.ok) return { ok: false, detail: `npm run build failed: ${b.tail}` };
      return { ok: true, detail: `${install.how} + build ok` };
    }
  }
  return { ok: true, detail: `${install.how} ok` };
}

const CANDIDATE_URLS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:5174',
];

async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/** Candidate ports already answering BEFORE we spawn our server. */
async function ambientUrls(): Promise<Set<string>> {
  const live = await Promise.all(
    CANDIDATE_URLS.map(async (u) => ((await probe(u, 500)) ? u : null)),
  );
  return new Set(live.filter((u): u is string => u !== null));
}

/**
 * Poll for OUR server. `exclude` is the set of ports already occupied before
 * we spawned — never latch onto those (a stray server on :3000 would
 * otherwise capture screenshots of the wrong app silently).
 */
async function waitForServer(timeoutMs: number, exclude: Set<string>): Promise<string | null> {
  // performance.now(), not Date.now() (forge-8vfn.7.6.50): Date.now() is not
  // monotonic on this host, so a deadline built from its difference can move
  // mid-wait.
  const start = performance.now();
  const targets = CANDIDATE_URLS.filter((u) => !exclude.has(u));
  while (performance.now() - start < timeoutMs) {
    for (const url of targets) {
      if (await probe(url, 2000)) return url;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

// ── Stale dev-server record (forge-8vfn.8.5.6) ──────────────────────────────
//
// `startServer` spawns the dev/preview server `detached: true` so its stop()
// can SIGTERM the whole process group. The normal path always reaches that
// stop(); a HARD crash mid-capture does not, leaving a live process group
// nothing sweeps. The fix: record the group's pid + its start time (so a
// later *different* process recycled onto the same pid is never mistaken for
// it — §6.13 "kill only what you recorded, re-verified by start time") next
// to the bundle, and sweep it at the start of the NEXT capture.

export type ServerRecord = { pid: number; starttime: string };

export function serverRecordPath(bundleDir: string): string {
  return join(bundleDir, '_trees', 'server.pid');
}

/** Persist the spawned group's pid + its current `/proc` start time. Called
 *  right after spawn, with THIS process's own freshly-read start time — never
 *  a guess. Exported so tests can write a record through the exact same path
 *  `startServer` does, rather than duplicating the write. */
export function writeServerRecord(bundleDir: string, record: ServerRecord): void {
  const recordPath = serverRecordPath(bundleDir);
  mkdirSync(join(bundleDir, '_trees'), { recursive: true });
  writeFileSync(recordPath, JSON.stringify(record));
}

export type ProcStartTime =
  | { kind: 'ok'; starttime: string }
  | { kind: 'gone' }
  | { kind: 'unknown'; error: unknown };

/**
 * Field 22 of `/proc/<pid>/stat` (start time, in clock ticks since boot) —
 * stable across the process's whole lifetime, so an equal value proves it's
 * the SAME process we recorded, not a recycled pid. `comm` (field 2) is
 * parenthesised and may itself contain spaces/parens/digits, so this splits
 * on the LAST `)` rather than counting space-separated tokens from the start.
 * Exported so tests can independently read a real process's start time to
 * build a correct (or deliberately wrong) fixture record.
 */
export function readProcStartTime(pid: number): ProcStartTime {
  const statPath = `/proc/${pid}/stat`;
  if (!existsSync(statPath)) return { kind: 'gone' };
  try {
    const raw = readFileSync(statPath, 'utf8');
    const afterComm = raw.slice(raw.lastIndexOf(')') + 2);
    const fields = afterComm.trim().split(/\s+/);
    // fields[0] is overall field 3 (state); field 22 is index (22 - 3) = 19.
    const starttime = fields[19];
    if (!starttime) return { kind: 'unknown', error: new Error(`could not parse starttime from ${statPath}`) };
    return { kind: 'ok', starttime };
  } catch (err) {
    return { kind: 'unknown', error: err };
  }
}

/**
 * Run BEFORE anything else in a capture: if a stale server record exists from
 * a crashed prior run, kill the recorded process group ONLY when `/proc` still
 * shows a live process at that pid AND its start time still matches the
 * recorded one. A pid that no longer exists, or whose start time has moved on
 * (recycled by an unrelated process), is never killed — the record is simply
 * cleared either way, since the process we recorded is gone regardless. An
 * UNREADABLE `/proc` read is treated as UNKNOWN, never a safe-looking
 * default (M7-COMMON §6.15): it is logged and the record is left in place for
 * the next sweep to re-evaluate.
 */
export function sweepStaleServer(bundleDir: string): void {
  const recordPath = serverRecordPath(bundleDir);
  if (!existsSync(recordPath)) return;

  let record: ServerRecord;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8')) as ServerRecord;
  } catch (err) {
    process.stderr.write(
      `[demo] stale server record at ${recordPath} is unreadable — leaving it: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return;
  }

  const check = readProcStartTime(record.pid);
  if (check.kind === 'unknown') {
    process.stderr.write(
      `[demo] cannot verify stale server record (pid ${record.pid}) via /proc — leaving it: ${
        check.error instanceof Error ? check.error.message : String(check.error)
      }\n`,
    );
    return;
  }
  if (check.kind === 'ok' && check.starttime === record.starttime) {
    try {
      process.kill(-record.pid, 'SIGTERM');
    } catch (err) {
      process.stderr.write(
        `[demo] failed to signal stale server group (pid ${record.pid}): ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }
  // 'gone', or an 'ok' whose starttime no longer matches (a recycled pid) —
  // either way the process we recorded is not there to kill, so the record
  // itself is stale and is cleared.
  rmSync(recordPath, { force: true });
}

export type ServerHandle = { url: string; stop: () => Promise<void> };

/**
 * Start the project's server (prefer `preview` when a build output exists,
 * else `dev`) detached, poll for it to answer (excluding ambient servers),
 * return its URL + an async stop() that signals the process group and waits
 * a short drain so the next sequential run can rebind the same port.
 */
export async function startServer(treePath: string, bundleDir: string): Promise<ServerHandle | null> {
  const pkg = readPackageJson(treePath);
  const hasBuildOutput = ['dist', 'build', '.output', 'out'].some((d) =>
    existsSync(join(treePath, d)),
  );
  const script =
    hasBuildOutput && pkg?.scripts?.preview
      ? 'preview'
      : pkg?.scripts?.dev
        ? 'dev'
        : pkg?.scripts?.preview
          ? 'preview'
          : null;
  if (!script) return null;
  const exclude = await ambientUrls();
  const child = spawn('npm', ['run', script], {
    cwd: treePath,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, BROWSER: 'none' },
  });
  child.on('error', () => {});
  child.unref();
  if (child.pid) {
    // THIS process's own freshly-read start time, not a guess — if /proc
    // can't be read right after our own spawn (a race or sandboxing), skip
    // the record rather than writing one we can't trust; the crash this
    // guards against is best-effort recovery, not a hard guarantee.
    const self = readProcStartTime(child.pid);
    if (self.kind === 'ok') writeServerRecord(bundleDir, { pid: child.pid, starttime: self.starttime });
  }
  const stop = async (): Promise<void> => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already dead */
      }
    }
    rmSync(serverRecordPath(bundleDir), { force: true });
    await new Promise((r) => setTimeout(r, 2500));
  };
  const url = await waitForServer(60_000, exclude);
  if (!url) {
    await stop();
    return null;
  }
  return { url, stop };
}
