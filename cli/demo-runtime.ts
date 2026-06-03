/**
 * Demo runtime — build + serve helpers for `forge demo capture`.
 *
 * The Playwright spec-runner helpers (runSpec, demoPlaywrightConfig,
 * findExampleSpec, firstExisting, harvestVideos) were removed in the REV-2
 * cull. What remains is the "make the app runnable" pair: buildTree +
 * startServer. The thin capture path in demo.ts calls these to get a live
 * server URL, then screenshots each checkpoint label via demo-capture.ts.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { type DemoBuildStatus } from './demo-html.ts';

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
  const start = Date.now();
  const targets = CANDIDATE_URLS.filter((u) => !exclude.has(u));
  while (Date.now() - start < timeoutMs) {
    for (const url of targets) {
      if (await probe(url, 2000)) return url;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export type ServerHandle = { url: string; stop: () => Promise<void> };

/**
 * Start the project's server (prefer `preview` when a build output exists,
 * else `dev`) detached, poll for it to answer (excluding ambient servers),
 * return its URL + an async stop() that signals the process group and waits
 * a short drain so the next sequential run can rebind the same port.
 */
export async function startServer(treePath: string): Promise<ServerHandle | null> {
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
    await new Promise((r) => setTimeout(r, 2500));
  };
  const url = await waitForServer(60_000, exclude);
  if (!url) {
    await stop();
    return null;
  }
  return { url, stop };
}
