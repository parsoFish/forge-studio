/**
 * `forge studio` (canonical) / `forge watch` (deprecated alias) — the
 * foreground launcher that brings up the operator UI (ADR-031, M7-6).
 *
 * Spawns two children:
 *   1. The forge-ui bridge (cli/ui-bridge.ts) — WebSocket + HTTP API.
 *   2. The forge-ui Next.js dev server (forge-ui workspace) — the browser.
 *
 * Readiness is DETERMINISTIC, not stdout-scraped: the launcher awaits the
 * bridge's bound-port promise, then polls the bridge `GET /api/health` until
 * 200, then polls the UI port `GET http://localhost:<uiPort>/` until it
 * responds, and ONLY THEN opens the browser and emits a single machine-
 * readable ready signal — both a `forge-studio-ready {json}` stdout line and
 * (when `--ready-file <path>` is passed) an atomically-written JSON file. No
 * dependency on Next.js's "Ready in" log wording.
 *
 * On SIGINT (Ctrl-C) it tears both children down and exits 0.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

import { startBridge } from './ui-bridge.ts';

/** The deterministic ready signal forge studio emits on stdout once both the
 *  bridge and the UI have answered a health probe. Consumers grep for this
 *  prefix instead of scraping Next.js log wording. */
export const READY_SIGNAL_PREFIX = 'forge-studio-ready';

export type ReadyInfo = { bridgeUrl: string; uiUrl: string };

/** Format the single-line stdout ready signal. Pure — unit-tested. */
export function formatReadySignal(info: ReadyInfo): string {
  return `${READY_SIGNAL_PREFIX} ${JSON.stringify(info)}`;
}

/** Parse a stdout line into the ready info, or null if it is not the signal.
 *  Pure — unit-tested. Tolerant of leading/trailing whitespace so a line
 *  arriving mid-chunk still matches once isolated. */
export function parseReadySignal(line: string): ReadyInfo | null {
  const m = line.trim().match(new RegExp(`^${READY_SIGNAL_PREFIX} (.+)$`));
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as Partial<ReadyInfo>;
    if (typeof parsed.bridgeUrl === 'string' && typeof parsed.uiUrl === 'string') {
      return { bridgeUrl: parsed.bridgeUrl, uiUrl: parsed.uiUrl };
    }
    return null;
  } catch {
    return null;
  }
}

/** Atomically write the ready info to a file (write to `.tmp`, then rename) so
 *  a file-watching consumer never observes partial JSON. */
export function writeReadyFile(path: string, info: ReadyInfo): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(info));
  renameSync(tmp, path);
}

/** True when `raw` parses to a valid TCP port (integer 1-65535). Pure — used
 *  by the CLI's `--bridge-port`/`--ui-port` flag guard so a missing value
 *  (`--bridge-port --no-open` → `Number('--no-open')` = NaN) or out-of-range
 *  number is rejected before it ever reaches a bind/takeover. Unit-tested. */
export function isValidPort(raw: string | undefined): raw is string {
  if (raw === undefined || raw.startsWith('-')) return false;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A fetch-like probe: returns true when the URL answers (status considered
 *  ready), false on any error/timeout. Injectable for tests. */
export type ProbeFetch = (url: string) => Promise<boolean>;

/** Default HTTP probe used by the launcher: a short-timeout GET that treats
 *  ANY HTTP response (even a non-2xx) as "the server is up and answering".
 *  Next.js dev can return a redirect/HTML before it is fully warm — what we
 *  need is proof the port is bound and the process responds. */
async function defaultProbe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // Drain the body so the socket frees promptly.
    try { await res.arrayBuffer(); } catch { /* ignore */ }
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll a URL until {@link probe} reports ready, or the timeout elapses.
 * Pure control-flow with an injectable probe + clock so the loop is unit-
 * tested without a real server. Resolves true when ready, false on timeout.
 */
export async function pollUntilReady(
  url: string,
  opts: {
    probe?: ProbeFetch;
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const probe = opts.probe ?? defaultProbe;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 100;
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? sleep;
  const deadline = now() + timeoutMs;
  // First attempt fires immediately; subsequent attempts back off by interval.
  for (;;) {
    if (await probe(url)) return true;
    if (now() >= deadline) return false;
    await wait(intervalMs);
  }
}

/**
 * Fixed default ports so the operator can pin one browser tab open at
 * `http://localhost:4124` and let it auto-reconnect across `forge watch`
 * / `forge-ui:demo` re-runs. If a previous forge process is still
 * listening on these ports, we take it over (kill + bind) on startup.
 *
 * Why these specific numbers: outside common dev-server defaults (3000,
 * 5173, 8080) to avoid colliding with the operator's other projects.
 */
const DEFAULT_BRIDGE_PORT = 4123;
const DEFAULT_UI_PORT = 4124;

export type WatchOptions = {
  forgeRoot: string;
  /** Override the bridge's HTTP port. Default 4123 (takes over if in use). */
  bridgePort?: number;
  /** Override the Next.js dev port. Default 4124 (takes over if in use). */
  uiPort?: number;
  /** Skip the browser open (useful for headless CI). */
  noOpen?: boolean;
  /** Skip launching the UI dev server (bridge only). Lets the operator
   *  point a pre-built static export at the bridge by hand. */
  bridgeOnly?: boolean;
  /** When set, atomically write the ready info JSON to this path once both
   *  the bridge and UI answer a health probe (M7-6). A consumer can wait on
   *  the file appearing instead of parsing stdout. */
  readyFile?: string;
  /** Log prefix — `[forge studio]` (canonical) or `[forge watch]`
   *  (deprecated alias). Defaults to `[forge studio]`. */
  logLabel?: string;
};

export async function runWatch(opts: WatchOptions): Promise<void> {
  const { forgeRoot } = opts;
  const label = opts.logLabel ?? '[forge studio]';
  const uiDir = resolve(forgeRoot, 'forge-ui');
  const bridgePort = opts.bridgePort ?? DEFAULT_BRIDGE_PORT;
  const uiPort = opts.uiPort ?? DEFAULT_UI_PORT;
  const uiUrl = `http://localhost:${uiPort}`;

  // 1. Take over the bridge port (kills any previous forge process on
  //    it) and start. Fixed ports + takeover let the operator keep a
  //    browser tab pinned at http://localhost:4124 across re-runs and
  //    have it auto-reconnect via the bridge-client backoff.
  takeoverPort(bridgePort, 'bridge', label);
  const bridge = await startBridge({ forgeRoot, port: bridgePort });
  console.log(`${label} bridge at ${bridge.url}`);

  // 2. Start Next.js dev (unless --bridge-only or forge-ui not installed).
  let uiProc: ChildProcess | null = null;
  let uiLaunched = false;
  if (!opts.bridgeOnly) {
    if (!existsSync(resolve(uiDir, 'package.json'))) {
      console.log(`${label} forge-ui workspace not present yet (forge-ui/package.json missing).`);
      console.log(`${label} running bridge-only — install the workspace then re-run.`);
    } else {
      takeoverPort(uiPort, 'ui', label);
      console.log(`${label} ui at ${uiUrl} (starting next dev…)`);

      uiProc = spawn(
        'npm',
        ['run', 'dev', '--workspace', 'forge-ui', '--', '-p', String(uiPort)],
        {
          cwd: forgeRoot,
          env: {
            ...process.env,
            FORGE_BRIDGE_URL: bridge.url,
          },
          stdio: 'inherit',
        },
      );
      uiLaunched = true;
      uiProc.on('error', (err) => {
        console.error(`${label} forge-ui dev server failed to start: ${err.message}`);
      });
      // If Next.js dies after startup (OOM, build error, port conflict) we must
      // surface it and tear the bridge down — otherwise the launcher blocks
      // forever in the never-resolving Promise below with an orphaned bridge.
      uiProc.on('exit', (code, signal) => {
        if (!shuttingDown) {
          console.error(`${label} forge-ui dev server exited unexpectedly (code=${code ?? signal})`);
          void shutdown();
        }
      });
    }
  }

  // 3. Clean up on Ctrl-C. Wired BEFORE the (awaited) readiness poll so
  //    Ctrl-C during a slow Next.js build still tears the children down.
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${label} shutting down...`);
    if (uiProc && uiProc.exitCode === null && !uiProc.killed) {
      // SIGTERM first (Node traps it and exits cleanly, releasing the port).
      try { uiProc.kill('SIGTERM'); } catch { /* already dead */ }
      // Await the actual exit (up to a 2.5s grace), then escalate to SIGKILL if
      // the sub-shell ignored SIGTERM — the same pattern takeoverPort relies on
      // to reliably free the fixed UI port on WSL2.
      await new Promise<void>((r) => {
        const done = () => r();
        uiProc?.once('exit', done);
        setTimeout(done, 2500);
      });
      if (uiProc.exitCode === null) {
        try { uiProc.kill('SIGKILL'); } catch { /* already dead */ }
      }
    }
    try { await bridge.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  // 4. Deterministic readiness: poll the bridge /api/health, then (when the
  //    UI was launched) the UI port — ONLY THEN open the browser and emit the
  //    ready signal. No dependency on Next.js's "Ready in" log wording.
  const bridgeReady = await pollUntilReady(`${bridge.url}/api/health`, { timeoutMs: 30_000 });
  if (!bridgeReady) {
    console.warn(`${label} bridge did not answer /api/health within 30s — emitting ready signal anyway`);
  }
  if (uiLaunched) {
    const uiReady = await pollUntilReady(`${uiUrl}/`, { timeoutMs: 60_000 });
    if (!uiReady) {
      console.warn(`${label} UI did not answer at ${uiUrl} within 60s — emitting ready signal anyway`);
    }
  }

  const info: ReadyInfo = { bridgeUrl: bridge.url, uiUrl };
  if (opts.readyFile) {
    try { writeReadyFile(opts.readyFile, info); }
    catch (err) { console.error(`${label} could not write ready file ${opts.readyFile}: ${(err as Error).message}`); }
  }
  // The single deterministic, greppable ready line (emitted exactly once).
  console.log(formatReadySignal(info));

  // 5. Open the browser AFTER verified readiness (no blind 2s sleep).
  if (uiLaunched && !opts.noOpen) {
    openBrowser(uiUrl).catch((err) => {
      console.error(`${label} could not open browser: ${err.message}`);
      console.log(`${label} open ${uiUrl} manually.`);
    });
  }

  // 6. Block forever (children own the foreground).
  await new Promise<void>(() => {
    // intentionally never resolves; SIGINT path handles exit.
  });
}

/**
 * Find the PIDs LISTENing on a TCP port, trying multiple tools so the
 * takeover works across environments. `lsof` is tried first (works on most
 * macOS/Linux), but on **WSL2** (and some container / restricted-procfs
 * setups) lsof cannot enumerate network sockets at all — `lsof -tiTCP:<port>`
 * returns empty even when a server is bound — so we fall back to `ss`
 * (netlink-based, reliable on Linux/WSL2) and finally `fuser`.
 *
 * Surfaced 2026-05-31: a stale forge-ui `next-server` held :4124 and every
 * `forge watch` died with EADDRINUSE because the lsof-only takeover found
 * nothing to kill — directly blocking the UI, forge's sole operator surface.
 *
 * Returns a de-duplicated list of PID strings; empty when the port is free
 * (or no available tool can see it).
 */
export function findListenerPids(port: number): string[] {
  const dedupe = (pids: string[]): string[] => [...new Set(pids.map((p) => p.trim()).filter(Boolean))];

  // 1. lsof — first choice on macOS/Linux.
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    const pids = dedupe(out.trim().split('\n'));
    if (pids.length) return pids;
  } catch { /* no match, or lsof is blind to the socket (WSL2) — fall through */ }

  // 2. ss — reads via netlink, sees sockets lsof misses on WSL2. The
  //    `sport = :<port>` filter matches the port exactly (not :<port>0…);
  //    process info renders as `users:(("name",pid=NNN,fd=M))`.
  try {
    const out = execSync(`ss -ltnpH 'sport = :${port}'`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    const pids = dedupe([...out.matchAll(/pid=(\d+)/g)].map((m) => m[1]));
    if (pids.length) return pids;
  } catch { /* ss absent or no match — fall through */ }

  // 3. fuser — last resort; prints space-separated PIDs on stdout.
  try {
    const out = execSync(`fuser ${port}/tcp 2>/dev/null`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    const pids = dedupe(out.trim().split(/\s+/));
    if (pids.length) return pids;
  } catch { /* fuser absent or no match */ }

  return [];
}

/**
 * Kill any process listening on the given TCP port so `forge watch` re-runs
 * can rebind a fixed port and the operator's pinned browser tab
 * auto-reconnects. Discovery is multi-tool (see {@link findListenerPids}) so
 * it works on WSL2 where lsof is blind to sockets.
 *
 * If no available tool can see a listener (port free), this is a no-op — the
 * later bind surfaces any unexpected conflict via EADDRINUSE.
 */
export function takeoverPort(port: number, label: string, logLabel = '[forge studio]'): void {
  const pids = findListenerPids(port);
  if (pids.length === 0) return;
  console.log(`${logLabel} ${label}: taking over port ${port} from ${pids.length} existing process(es)`);

  // SIGTERM all listeners. Node servers trap SIGTERM and exit cleanly,
  // releasing the socket.
  for (const pid of pids) {
    try { process.kill(Number(pid), 'SIGTERM'); } catch { /* */ }
  }

  // Wait for the port to actually become listenable, escalating to SIGKILL
  // after 1.5s if listeners survive. Re-discover before SIGKILL so a
  // respawned listener (new PID) is still caught. Keep waiting (up to ~3s
  // total) for the kernel to release the socket.
  const overallDeadline = Date.now() + 3000;
  let escalated = false;
  while (Date.now() < overallDeadline) {
    if (findListenerPids(port).length === 0) return;
    if (!escalated && Date.now() > overallDeadline - 1500) {
      escalated = true;
      for (const pid of findListenerPids(port)) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch { /* */ }
      }
    }
    try { execSync('sleep 0.1'); } catch { /* */ }
  }
  console.warn(`${logLabel} ${label}: port ${port} still occupied after 3s; the bind below may EADDRINUSE`);
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    cmd = 'open'; args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd'; args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open'; args = [url];
  }
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const proc = spawn(cmd, args, { stdio: 'ignore', detached: true });
    proc.on('error', rejectOpen);
    proc.on('spawn', () => {
      proc.unref();
      resolveOpen();
    });
  });
}
