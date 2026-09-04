/**
 * bridge.mjs — which bridge a story run is allowed to drive.
 *
 * The defect this closes, verbatim from 1.0.md §3.1: "today `verify-cycle.mjs`
 * reuses any healthy bridge and the journey harness force-takes-over — both
 * would test the wrong tree."
 *
 * A gate driving a bridge that serves a different worktree returns a green
 * verdict about code it never loaded. So the runner boots its own bridge from
 * the tree it runs in ONLY when the port is free, reuses one only when it can
 * prove the holder is this same tree, and otherwise REFUSES — it never takes
 * a healthy bridge over. `--force-takeover` is deliberately not ported: it
 * SIGKILLs the holder, which can hard-reset another lane's in-flight cycle.
 *
 * The identity probe itself is NOT re-implemented here — `probeBridgeIdentity`
 * in `apps/forge/forge-watch.ts` already does it and is unit-tested.
 */
import { readlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';

/** How long to wait for our own bridge to report ready. */
const BOOT_TIMEOUT_MS = 120_000;

/**
 * @param {{service: string, pid: number, startedAt: string} | null} identity
 *        the result of `probeBridgeIdentity` on the bridge health URL
 * @param {{ownRoot: string, cwdOf: (pid: number) => string | null}} opts
 * @returns {'boot' | 'reuse' | 'refuse'}
 */
export function decideStoryBridge(identity, { ownRoot, cwdOf }) {
  // Nothing of ours is listening — a free port, a foreign server, a pre-identity
  // bridge, a non-2xx, malformed JSON. All of them mean "bind our own".
  if (identity === null || identity.service !== 'forge-bridge') return 'boot';

  // Something of ours IS listening. Reuse it only if we can prove it serves
  // this tree. An unreadable /proc entry is unknown provenance, and unknown
  // provenance is not our provenance.
  const cwd = cwdOf(identity.pid);
  return cwd !== null && cwd === ownRoot ? 'reuse' : 'refuse';
}

/** Read a process's cwd, or null when it cannot be read. */
export function readProcCwd(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/**
 * The error a refusal raises. It names the foreign pid, its tree and ours, so
 * the operator is told which process to stop rather than left guessing.
 */
export function refusalError(identity, cwd, ownRoot) {
  return new Error(
    `refusing to run stories against a foreign bridge on 4123: pid ${identity.pid} ` +
      `serves ${cwd ?? '<unreadable cwd>'}, this lane is ${ownRoot}. ` +
      'A story run against another tree proves nothing. Stop that bridge, or run from its tree. ' +
      'This runner never takes a healthy bridge over.',
  );
}

/**
 * Boot our own `forge studio` from `root` — deliberately WITHOUT
 * `--force-takeover`, so it can only ever bind a genuinely free port.
 * Resolves on the launcher's `forge-studio-ready {json}` stdout line.
 */
export function bootOwnBridge(root) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'apps/forge/cli.ts', 'studio', '--no-open'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    let buf = '';
    let settled = false;
    const onData = (chunk) => {
      if (settled) return;
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^forge-studio-ready (.+)$/);
        if (!m) continue;
        try {
          const { bridgeUrl, uiUrl } = JSON.parse(m[1]);
          if (bridgeUrl && uiUrl) {
            settled = true;
            resolve({ proc, bridgeUrl, uiUrl });
            return;
          }
        } catch {
          /* not the signal line */
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    setTimeout(() => {
      if (settled) return;
      // Kill the whole process group — `detached: true` made it its own group
      // leader. Without this a boot-timeout leaves a half-started studio
      // holding 4123/4124 with nothing to reap it.
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
      reject(new Error(`forge studio not ready in ${BOOT_TIMEOUT_MS}ms; spawned bridge killed`));
    }, BOOT_TIMEOUT_MS);
  });
}
