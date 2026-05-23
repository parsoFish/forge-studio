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
 * Kill any process listening on the given TCP port (Linux/macOS via
 * lsof). Logs how many it killed. Lets `forge watch` re-runs replace
 * a previously-running bridge / dev server on a fixed port so the
 * operator's pinned browser tab auto-reconnects.
 *
 * If lsof isn't installed or the port is free, this is a no-op — the
 * later bind will surface any unexpected conflict via EADDRINUSE.
 */
export function takeoverPort(port: number, label: string): void {
  // 1. Find any listener on the port.
  let pids: string[];
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    pids = out.trim().split('\n').filter(Boolean);
  } catch {
    return; // lsof exits non-zero when no match — port is free.
  }
  if (pids.length === 0) return;
  console.log(`[forge watch] ${label}: taking over port ${port} from ${pids.length} existing process(es)`);

  // 2. SIGTERM all listeners. Many use Node which traps SIGTERM and exits
  //    cleanly, releasing the socket.
  for (const pid of pids) {
    try { process.kill(Number(pid), 'SIGTERM'); } catch { /* */ }
  }

  // 3. Wait for the port to actually become listenable, escalating to
  //    SIGKILL after 1.5s if listeners are still alive. Then keep
  //    waiting (up to ~3s total) for the kernel to release the socket.
  const overallDeadline = Date.now() + 3000;
  let escalated = false;
  while (Date.now() < overallDeadline) {
    const stillListening = (() => {
      try {
        const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
        return out.trim().split('\n').filter(Boolean).length > 0;
      } catch { return false; }
    })();
    if (!stillListening) return;
    if (!escalated && Date.now() > overallDeadline - 1500) {
      escalated = true;
      for (const pid of pids) {
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
