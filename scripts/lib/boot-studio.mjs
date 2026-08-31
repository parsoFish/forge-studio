// boot-studio — the ONE `forge studio` boot for the harnesses (W7-C3,
// A0-deferred dedupe). Three scripts each hand-rolled the same core: spawn
// the canonical launcher (`forge studio --no-open`, production build + `next
// start`), wait for its deterministic `forge-studio-ready {json}` stdout
// line, and kill the whole detached process GROUP on timeout (a half-booted
// studio holds ports 4123/4124; rejecting without killing strands a zombie
// that blocks every subsequent run — 2026-07-11 R3).
//
//   - `spawnStudioReady` is that shared core. Policy stays with each caller:
//       scripts/ui-walkthrough  → `bootStudio` below (REFUSES a healthy
//                                 bridge + forces both harness seams on)
//       scripts/e2e-deadpaths   → no-spawn seam, 120s budget
//       scripts/verify-cycle    → reuse-existing probe first, real spawn env
//                                 (it drives REAL cycles), 150s budget, its
//                                 own post-ready output tee
//   - Timeout budgets are the callers' own measured numbers (W6-P3 review
//     finding #4: readiness includes a one-time cold `next build`, measured
//     18.06s + 50% margin ≈ 30s on top of each harness's pre-existing
//     bridge/bind budget). This module imposes no default policy beyond a
//     generous ceiling.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const READY_RE = /^forge-studio-ready (.+)$/;

/** `GET /api/health` identity probe — a healthy forge bridge answers
 *  `{service:'forge-bridge',pid,...}`; anything else (down, foreign) → null. */
export async function probeHealthyBridge(bridgeUrl) {
  try {
    const r = await fetch(`${bridgeUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.service === 'forge-bridge' ? j : null;
  } catch {
    return null;
  }
}

/**
 * Spawn `forge studio --no-open` and resolve when it prints its ready line.
 *
 * @param {{ env?: Record<string,string>, fullEnv?: Record<string,string|undefined>,
 *           timeoutMs?: number, log?: (s: string) => void,
 *           onSpawn?: (proc: import('node:child_process').ChildProcess) => void }} opts
 *   `env` is merged over process.env (harness seams like
 *   FORGE_ARCHITECT_NO_SPAWN / FORGE_DRY_BRIDGE go here). `fullEnv` is used
 *   VERBATIM instead — for callers whose env prep DELETES keys (verify-cycle's
 *   forgeSpawnEnv strips the headroom proxy vars; a merge over process.env
 *   would silently reinstate them). `log` receives every output chunk,
 *   before AND after ready. `onSpawn` fires SYNCHRONOUSLY with the child, so
 *   a caller's own fatal/SIGINT handler can reap a studio that is still
 *   booting — awaiting this promise would only hand it over at ready, and a
 *   half-booted studio already holds ports 4123/4124.
 * @returns {Promise<{ proc: import('node:child_process').ChildProcess,
 *           uiUrl: string, bridgeUrl: string, stop: () => Promise<void> }>}
 */
export function spawnStudioReady({ env = {}, fullEnv, timeoutMs = 300_000, log = () => {}, onSpawn } = {}) {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath,
      ['--experimental-strip-types', 'apps/forge/cli.ts', 'studio', '--no-open'],
      { cwd: FORGE_ROOT, env: fullEnv ?? { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    onSpawn?.(proc);
    let buf = '';
    let settled = false;
    const killGroup = (sig) => { try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch { /* gone */ } } };
    const stop = async () => {
      killGroup('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      killGroup('SIGKILL');
    };
    const onData = (chunk) => {
      const text = chunk.toString();
      log(text.trimEnd());
      if (settled) return;
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(READY_RE);
        if (!m) continue;
        try {
          const info = JSON.parse(m[1]);
          if (info.bridgeUrl && info.uiUrl) { settled = true; res({ proc, uiUrl: info.uiUrl, bridgeUrl: info.bridgeUrl, stop }); return; }
        } catch { /* not the signal line */ }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => { if (!settled) { settled = true; rej(e); } });
    proc.on('exit', (code) => { if (!settled) { settled = true; rej(new Error(`forge studio exited before ready (code ${code})`)); } });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      killGroup('SIGKILL');
      rej(new Error(`forge studio not ready in ${timeoutMs / 1000}s; spawned studio killed. Last output:\n${buf.slice(-2000)}`));
    }, timeoutMs).unref();
  });
}

/**
 * The walkthrough/CI flavour (W7-A0): boot for an idle-host crawl with both
 * harness seams ON — `FORGE_ARCHITECT_NO_SPAWN=1` and `FORGE_DRY_BRIDGE=1`,
 * so nothing the crawl touches can spawn an agent, hit a git remote, or
 * start the daemon.
 *
 * REFUSES to boot when a healthy forge bridge already answers on the bridge
 * port: `forge studio` would attach read-only to it and never emit the ready
 * signal, and the operator's live session (with any in-flight cycle) must
 * never be taken over by a harness. Crawl the running Studio without
 * `--boot` instead.
 *
 * @param {{ bridgeUrl: string, timeoutMs?: number, log?: (s: string) => void }} opts
 * @returns {Promise<{ uiUrl: string, bridgeUrl: string, stop: () => Promise<void> }>}
 */
export async function bootStudio({ bridgeUrl, timeoutMs = 300_000, log = () => {} }) {
  const already = await probeHealthyBridge(bridgeUrl);
  if (already) {
    throw new Error(`a healthy forge bridge (pid ${already.pid}) already answers at ${bridgeUrl} — refusing to --boot over it; run without --boot to crawl the running Studio`);
  }
  log(`[walkthrough --boot] spawning forge studio (cold run pays a one-time production build)…`);
  return spawnStudioReady({
    env: { FORGE_ARCHITECT_NO_SPAWN: '1', FORGE_DRY_BRIDGE: '1' },
    timeoutMs,
    log,
  });
}
