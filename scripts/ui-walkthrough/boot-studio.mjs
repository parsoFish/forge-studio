// W7-A0 — boot `forge studio` for a CI / idle-host walkthrough run.
//
// Mirrors `scripts/e2e-deadpaths.mjs`'s startWatch: spawn the canonical
// launcher (`forge studio --no-open`, production build + `next start`, both
// harness seams on — `FORGE_ARCHITECT_NO_SPAWN=1` and `FORGE_DRY_BRIDGE=1`, so
// nothing the crawl touches can spawn an agent, hit a git remote, or start the
// daemon), wait for its deterministic `forge-studio-ready {json}` line, and
// hand back the URLs plus a `stop()`.
//
// REFUSES to boot when a healthy forge bridge already answers on the bridge
// port: `forge studio` would attach read-only to it and never emit the ready
// signal, and the operator's live session (with any in-flight cycle) must
// never be taken over by a harness. Crawl the running Studio without `--boot`
// instead.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const READY_RE = /^forge-studio-ready (.+)$/;

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
 * @param {{ bridgeUrl: string, timeoutMs?: number, log?: (s: string) => void }} opts
 * @returns {Promise<{ uiUrl: string, bridgeUrl: string, stop: () => Promise<void> }>}
 */
export async function bootStudio({ bridgeUrl, timeoutMs = 180_000, log = () => {} }) {
  const already = await probeHealthyBridge(bridgeUrl);
  if (already) {
    throw new Error(`a healthy forge bridge (pid ${already.pid}) already answers at ${bridgeUrl} — refusing to --boot over it; run without --boot to crawl the running Studio`);
  }
  log(`[walkthrough --boot] spawning forge studio (cold run pays a one-time production build)…`);
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', '--no-open'],
      { cwd: FORGE_ROOT, env: { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1', FORGE_DRY_BRIDGE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
          if (info.bridgeUrl && info.uiUrl) { settled = true; res({ uiUrl: info.uiUrl, bridgeUrl: info.bridgeUrl, stop }); return; }
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
      rej(new Error(`forge studio not ready in ${timeoutMs / 1000}s; spawned studio killed`));
    }, timeoutMs).unref();
  });
}
