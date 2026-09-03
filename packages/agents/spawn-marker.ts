/**
 * Bead `forge-8vfn.5.50` — the per-run spawn marker: how the runtime keeps
 * hold of what it spawned once every other trace of ownership is gone.
 *
 * THE GAP. The story reaper (`scripts/stories/reap.mjs`, sessions' #322)
 * closes two shapes: a descendant found by walking ppid links snapshotted
 * before any signal, and a stray found by its process group. Both are
 * defeated by one process: a grandchild that BOTH calls `setsid` (leaving
 * our group) AND loses its parent before the snapshot. Its ppid leads to a
 * system reaper and its pgid is its own. The reaper's own header says why the
 * obvious fallback is unavailable: "discovering processes by 'cwd inside
 * ownRoot' is not available here, because `run.mjs` passes the REPO ROOT as
 * `ownRoot`, so such a sweep would signal the story runner itself, the Studio
 * bridge and the operator's own shell."
 *
 * That reasoning is why this module identifies OUR PROCESSES rather than a
 * DIRECTORY. A marker is acquired only by being spawned by a run that minted
 * it, so the negative half of the control — the operator's shell, the Studio
 * bridge, a same-argv stranger — holds by construction rather than by a
 * containment rule someone has to keep getting right.
 *
 * WHY AN ENV VAR AND NOT A SUBREAPER OR A CGROUP (measured 2026-09-03,
 * ruling 68). `PR_SET_CHILD_SUBREAPER` would let orphans re-parent to the run
 * instead of to init, which is the textbook answer — but Node exposes no
 * `prctl`, so it needs a native addon or a helper binary, i.e. a new
 * dependency. cgroup v2 needs cgroup write access, and the supported platform
 * is WSL2. Env costs neither: it is inherited across `fork`/`exec` INCLUDING
 * by a `setsid`'d orphan — exactly the process both walks lose — and
 * `/proc/<pid>/environ` stays readable for same-uid processes after the
 * pid/ppid/pgid evidence is gone.
 *
 * WHY IT IS AN OVERRIDE AND NEVER AN ALLOWLIST ENTRY. `buildChildEnv`
 * (`@forge/kernel/spawn-env.ts`) filters the ambient env to
 * `AGENT_ENV_ALLOWLIST` and layers the caller's own overrides on top.
 * Allowlisting the marker would let an ambient value — one stale token
 * exported in a shell — be inherited by everything forge spawns, and the
 * sweep would then claim processes no run ever minted a token for. As an
 * override it can only ever come from forge's own code (spawn-env.ts's
 * "that premise is the caller's to keep"), which is the premise the negative
 * control rests on.
 *
 * WHAT THE MARKER IS NOT. It is an IDENTIFIER, not an authorisation, and it
 * is not a secret: `/proc/<pid>/environ` is readable by any process of the
 * same uid, so anything running as this user can read a live token and could
 * set it on itself. That costs nothing here — a same-uid process can already
 * signal us directly — but nothing may ever be built on top of this that
 * assumes the token is unforgeable.
 *
 * AND IT IS AN ADDITIONAL RUNG, NEVER A REPLACEMENT. `/proc/<pid>/environ` is
 * the environment as it was at EXEC: a descendant that re-execs with a
 * deliberately scrubbed environment carries no marker and is invisible to this
 * sweep. Such a process is normally still reachable by the reaper's ppid walk
 * or its process-group sweep, which is exactly why all three rungs stay — a
 * reader who trusts the marker alone would wrongly conclude the other two are
 * now redundant.
 *
 * WHY THE TOKEN IS PER RUN AND NOT A CONSTANT. A constant would let a LATER
 * run sweep an EARLIER run's still-live process — the reaper's `sinceMs` rule
 * ("a session dir older than the run belongs to a previous run and is not
 * ours to kill") through a different door. The token leads with the runId so
 * a leaked process names its own run under `grep -z FORGE_AGENT_RUN_MARKER
 * /proc/<pid>/environ`, and carries a UUID so two runs of the same id cannot
 * collide.
 *
 * THE SCOPE, STATED EXACTLY. The marker is applied by `runAgent` — so it
 * covers the standalone dispatch path (`agent-dispatch.ts`) and the phase
 * pipelines that call `runAgent` with `lifecycle: 'caller'`. It does NOT cover
 * code that reaches `pinnedSdkQuery` directly without going through
 * `runAgent`: the session runners (`packages/sessions/*-runner.ts`), the dev
 * loop's own Ralph, and `release-finalize`. Those spawn unmarked today, and
 * saying "every agent child forge spawns carries a token" would be false.
 * `packages/agents/run-query-marker.enforce.test.ts` locks the part that IS
 * covered; the rest is recorded as handoffs, not implied away.
 *
 * AND IT IS COOPERATIVE, NOT ENFORCED. A process that actively evades — one
 * that re-execs under `env -u FORGE_AGENT_RUN_MARKER`, or deletes its run's
 * marker file — is invisible to this rung. Nothing at this seam can prevent
 * that: the mechanism addresses an agent that WANDERED (the S3 shape), not one
 * working to hide, and a same-uid process determined to escape observation has
 * simpler options than defeating a marker.
 *
 * Controls both ways live in `./spawn-marker.test.ts`, on real processes.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { isSafeRunId } from '@forge/kernel/log-cycles.ts';

/**
 * The env var every agent child this runtime spawns carries. Read by
 * `processesCarryingMarker`; NEVER a member of `AGENT_ENV_ALLOWLIST` (see the
 * module doc).
 */
export const AGENT_RUN_MARKER_ENV = 'FORGE_AGENT_RUN_MARKER';

/**
 * The file a run records its token in, inside its own `_logs/<runId>/` dir —
 * the sibling of `turn.pid`, and for the same reason: a reaper can only sweep
 * by a token some artifact of the run tells it.
 */
export const AGENT_RUN_MARKER_FILE = 'agent-run.marker';

/**
 * Mint this run's token. Distinct per CALL, not merely per runId: two runs
 * that somehow share an id must not share a token, or the later one sweeps
 * the earlier one's processes.
 *
 * The runId leads only when it is a safe one — the token is written into a
 * file inside the run dir and read back out again, and an id carrying `..`
 * has no business in either. The UUID makes tokens DISTINCT, not secret (see
 * the module doc): it exists so two runs cannot collide, not so a third party
 * cannot guess one.
 *
 * An UNSAFE runId yields a bare nonce, which `tokenBelongsToRunDir` can never
 * attribute to a directory — so such a token rides on the child but is not
 * sweepable. That is the correct outcome and it is not reachable in practice:
 * `runAgent` refuses an unsafe runId before it spawns anything, and
 * `recordRunMarker` refuses to write one. The fallback exists so this function
 * has no throwing path of its own, not as a supported shape.
 */
export function mintRunMarker(runId: string): string {
  const nonce = randomUUID();
  return isSafeRunId(runId) ? `${runId}:${nonce}` : nonce;
}

/** The one-key override every spawn layers over the allowlist-filtered env. */
export function markerEnvOverlay(token: string): Record<string, string> {
  return { [AGENT_RUN_MARKER_ENV]: token };
}

/**
 * Record this run's token beside its event log, so a reaper enumerating run
 * dirs can sweep by it.
 *
 * Takes `logsRoot` + `runId` rather than a pre-joined directory, and re-checks
 * `runId` itself. COMMON §15.19: a function that trusts the root it is handed
 * makes every caller's path derivation part of the containment boundary — and
 * this one WRITES. `runAgent` already refuses an unsafe runId well before
 * here, so the check is defence in depth, not the only guard; it costs one
 * line and removes the caller from the boundary.
 *
 * Refuses an empty token rather than writing a file that would make every
 * marked process on the host look like this run's: an empty token is a
 * pattern kill through an empty door.
 *
 * Throws on a write failure — the caller decides whether an unrecordable
 * marker is fatal (it is not: `runAgent` reports it as a deviation and runs
 * on, because a run that cannot be swept afterwards is still better than a
 * run that never happened).
 */
export function recordRunMarker(logsRoot: string, runId: string, token: string): void {
  if (token === '') throw new Error('recordRunMarker: refusing to record an empty token');
  if (!isSafeRunId(runId)) {
    throw new Error(`recordRunMarker: unsafe runId (path-traversal risk): ${JSON.stringify(runId)}`);
  }
  const dir = resolve(logsRoot, runId);
  mkdirSync(dir, { recursive: true });
  // APPENDED, one token per line. Several `runAgent` calls legitimately share
  // one run directory — the phase pipelines pass `runId: cycleId`, so a cycle's
  // PM and reflector both record into `_logs/<cycleId>/` — and overwriting
  // would silently retire the earlier phase's token while its children were
  // still alive. Idempotent: re-recording the same token adds nothing, so a
  // retry cannot grow the file.
  const existing = readRunMarkers(dir);
  if (existing.includes(token)) return;
  appendFileSync(join(dir, AGENT_RUN_MARKER_FILE), `${token}\n`, 'utf8');
}

/**
 * Every token recorded in this run directory, oldest first — empty when none
 * were, which is not an error (a directory that predates the marker, or one
 * whose run never spawned).
 *
 * Never throws: it runs inside the story reaper's teardown, where a throw
 * would lose the verdict the run just produced. A read that fails for a REAL
 * reason (a permission error, say) is therefore indistinguishable here from an
 * absent file — the caller that needs to tell them apart must stat the path
 * itself. Same posture, deliberately, as `reap.mjs`'s own `readPidFile`.
 */
export function readRunMarkers(runDir: string): string[] {
  try {
    return readFileSync(join(runDir, AGENT_RUN_MARKER_FILE), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/**
 * Whether `token` was minted for the run directory it was found in.
 *
 * THE ATTACK THIS CLOSES (adversarial containment review, 2026-09-03, HIGH).
 * Nothing about a file's CONTENTS proves which directory it belongs in. An
 * agent that has escaped its worktree — the S3 class this bead exists for — can
 * read another run's live token (same uid, world-readable by design) and drop
 * it into a directory of its own making under `_logs/`. The reaper would then
 * collect that directory, sweep that token, and SIGKILL the OTHER run's healthy
 * processes, with no cwd corroboration to catch it because the marker rung
 * deliberately waives that check. The kill itself is not an escalation — a
 * same-uid process can already signal ours directly — but it would make forge
 * the instrument and would file the result under "reaped by marker", which is a
 * false record of what happened.
 *
 * The bind is structural rather than a new secret: a token minted by
 * `mintRunMarker` leads with its own runId, and a run's directory IS that
 * runId, so a token only counts in the directory whose name it names. Planting
 * run B's token anywhere but run B's own directory now fails; planting it in
 * run B's own directory achieves nothing, because it is already there.
 */
export function tokenBelongsToRunDir(token: string, runDir: string): boolean {
  const dirName = basename(runDir);
  return dirName !== '' && token.startsWith(`${dirName}:`);
}

/** Seams for `processesCarryingMarker`, so the uid + match rules are testable. */
export type MarkerSweepDeps = {
  /** Every pid on the host. Default: the numeric entries of `/proc`. */
  listPids?: () => number[];
  /** The uid owning `pid`. Default: `stat("/proc/<pid>").uid`. */
  ownerUidOf?: (pid: number) => number;
  /** `pid`'s raw environ block (NUL-separated). Default: `/proc/<pid>/environ`. */
  readEnviron?: (pid: number) => string;
};

/**
 * Every process on this host carrying `token` — the sweep the reaper consumes.
 *
 * Membership is `uid == ours` AND a WHOLE `FORGE_AGENT_RUN_MARKER=<token>`
 * entry in the process's own environ. Both halves matter:
 *
 *  - by uid, never by name: a name/argv pattern is the kill COMMON §15.17
 *    exists to prevent, and another user's environ is unreadable anyway, so
 *    matching it would only ever produce a pid we cannot account for;
 *  - by whole entry, never by substring: `<token>-and-more` starts with our
 *    token and belongs to another run, and an unrelated var whose VALUE
 *    quotes the marker is not the marker.
 *
 * Never throws. It runs inside a teardown, and a teardown that throws loses
 * the verdict the run just produced; a pid that exits between the listing and
 * the read is an ordinary race, not an error.
 */
export function processesCarryingMarker(token: string, deps: MarkerSweepDeps = {}): number[] {
  if (token === '') throw new Error('processesCarryingMarker: refusing to sweep on an empty token');
  const listPids =
    deps.listPids ??
    (() =>
      readdirSync('/proc')
        .filter((name) => /^\d+$/.test(name))
        .map((name) => Number.parseInt(name, 10)));
  const ownerUidOf = deps.ownerUidOf ?? ((pid: number) => statSync(`/proc/${pid}`).uid);
  const readEnviron = deps.readEnviron ?? ((pid: number) => readFileSync(`/proc/${pid}/environ`, 'utf8'));

  const selfUid = typeof process.getuid === 'function' ? process.getuid() : -1;
  const entry = `${AGENT_RUN_MARKER_ENV}=${token}`;

  let pids: number[];
  try {
    pids = listPids();
  } catch {
    return [];
  }

  const carrying: number[] = [];
  for (const pid of pids) {
    try {
      if (ownerUidOf(pid) !== selfUid) continue;
      if (readEnviron(pid).split('\0').includes(entry)) carrying.push(pid);
    } catch {
      continue; // exited, or not ours to read — neither is a fault
    }
  }
  return carrying;
}
