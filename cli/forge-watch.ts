/**
 * `forge watch` — foreground subcommand that brings up the operator UI.
 *
 * Spawns two children:
 *   1. The forge-ui bridge (cli/ui-bridge.ts) — WebSocket + HTTP API.
 *   2. The forge-ui Next.js dev server (forge-ui workspace) — the browser.
 *
 * Opens the operator's default browser at the Next.js URL once the dev
 * server reports ready. On SIGINT (Ctrl-C) it tears both children down
 * and exits 0.
 *
 * Stage M2-A scope: read-only viewing. Verdict POST handlers come in M2-C.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { startBridge } from './ui-bridge.ts';

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
};

export async function runWatch(opts: WatchOptions): Promise<void> {
  const { forgeRoot } = opts;
  const uiDir = resolve(forgeRoot, 'forge-ui');
  const bridgePort = opts.bridgePort ?? DEFAULT_BRIDGE_PORT;
  const uiPort = opts.uiPort ?? DEFAULT_UI_PORT;

  // 1. Take over the bridge port (kills any previous forge process on
  //    it) and start. Fixed ports + takeover let the operator keep a
  //    browser tab pinned at http://localhost:4124 across re-runs and
  //    have it auto-reconnect via the bridge-client backoff.
  takeoverPort(bridgePort, 'bridge');
  const bridge = await startBridge({ forgeRoot, port: bridgePort });
  console.log(`[forge watch] bridge at ${bridge.url}`);

  // 2. Start Next.js dev (unless --bridge-only or forge-ui not installed).
  let uiProc: ChildProcess | null = null;
  if (!opts.bridgeOnly) {
    if (!existsSync(resolve(uiDir, 'package.json'))) {
      console.log('[forge watch] forge-ui workspace not present yet (forge-ui/package.json missing).');
      console.log('[forge watch] running bridge-only — install the workspace then re-run.');
    } else {
      takeoverPort(uiPort, 'ui');
      console.log(`[forge watch] ui at http://localhost:${uiPort} (starting next dev…)`);

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
      uiProc.on('error', (err) => {
        console.error(`[forge watch] forge-ui dev server failed to start: ${err.message}`);
      });
    }
  }

  // 3. Wait briefly, then open the browser.
  if (uiProc && !opts.noOpen) {
    setTimeout(() => {
      const url = `http://localhost:${uiPort}`;
      openBrowser(url).catch((err) => {
        console.error(`[forge watch] could not open browser: ${err.message}`);
        console.log(`[forge watch] open ${url} manually.`);
      });
    }, 2000); // give Next.js a couple of seconds to bind the port
  }

  // 4. Clean up on Ctrl-C.
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[forge watch] shutting down...');
    if (uiProc && !uiProc.killed) {
      try { uiProc.kill('SIGTERM'); } catch { /* already dead */ }
    }
    try { await bridge.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  // 5. Block forever (children own the foreground).
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
export function takeoverPort(port: number, label: string): void {
  const pids = findListenerPids(port);
  if (pids.length === 0) return;
  console.log(`[forge watch] ${label}: taking over port ${port} from ${pids.length} existing process(es)`);

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
  console.warn(`[forge watch] ${label}: port ${port} still occupied after 3s; the bind below may EADDRINUSE`);
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
