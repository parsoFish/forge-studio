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
import { spawn, execFileSync } from 'node:child_process';

/**
 * The GitHub identity the bridge acts as, named rather than implied — the same
 * account `packages/flows/gh-pinned.ts` pins every outward `gh` call to (#611),
 * and the one `packages/projects/project-create.ts` already names as
 * `REMOTE_ACCOUNT`. Derived here by NAME rather than from the git remote
 * because this runner is plain `.mjs` and cannot import the TS that does the
 * derivation without pulling a strip-types flag into every caller.
 */
export const STORY_BRIDGE_GH_USER = 'parsoFish';

/** The env name the community refresh reads, and the ONLY credential this
 *  module places into any child environment. */
const GH_TOKEN_ENV = 'GH_TOKEN';

/**
 * Read the operator's GitHub token for {@link STORY_BRIDGE_GH_USER}, or `null`.
 *
 * ABSENCE IS A RESULT, NOT AN ERROR: a host with no `gh` login must still be
 * able to run stories, and S8 beat 4's refusal is a real, honest outcome on
 * such a host. So a failed read returns `null` and the caller SAYS so.
 *
 * The error is deliberately not re-thrown and not logged. `gh` writes
 * credential state into its own stderr, and this module's whole job with
 * respect to that value is to move it from the keyring into one child's
 * environment without it appearing anywhere else — a log line included.
 * `stdio` discards the child's stderr for the same reason.
 */
export function bridgeGhToken({ exec = defaultGhTokenExec } = {}) {
  try {
    const out = exec();
    const token = typeof out === 'string' ? out.trim() : '';
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function defaultGhTokenExec() {
  return execFileSync('gh', ['auth', 'token', '--user', STORY_BRIDGE_GH_USER], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * The command, argv and options `bootOwnBridge` spawns with — separated out so
 * the credential path is testable through a REAL spawn without booting a real
 * studio, and so what is in `env` versus what is in `args` is inspectable.
 *
 * The token goes in `env` and NOWHERE else: argv is world-readable through
 * `/proc/<pid>/cmdline`, so a credential passed as a flag is a credential
 * published to every process on the host.
 */
export function bridgeSpawnOptions(root, { readToken = bridgeGhToken } = {}) {
  const token = readToken();
  const env = { ...process.env };
  if (token !== null) env[GH_TOKEN_ENV] = token;
  return {
    command: process.execPath,
    args: ['--experimental-strip-types', 'apps/forge/cli.ts', 'studio', '--no-open'],
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env,
    note:
      token !== null
        ? `bridge env carries GH_TOKEN for ${STORY_BRIDGE_GH_USER} — the community refresh can reach its declared sources`
        : `no GH_TOKEN available for ${STORY_BRIDGE_GH_USER} — the bridge still boots and a community refresh will honestly refuse`,
  };
}

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
export function bootOwnBridge(root, opts = bridgeSpawnOptions(root)) {
  return new Promise((resolve, reject) => {
    const proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      stdio: opts.stdio,
      detached: opts.detached,
      env: opts.env,
    });
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
