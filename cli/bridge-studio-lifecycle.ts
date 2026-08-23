/**
 * W7-A2 — the DERIVED session lifecycle: what an interactive session is
 * doing RIGHT NOW, computed at read time from (a) the phase row's own
 * declared shape (`awaits:` / `step:` — studio/session-kinds.yaml, or the
 * two legacy tables in cli/bridge-studio.ts for architect/project-brain) and
 * (b) on-disk liveness facts under `_logs/_<kind>-<sid>/` (stderr.log,
 * .heartbeat, events.jsonl, turn.pid) plus status.json's own mtime.
 *
 * Nothing here is ever STORED on status.json — a `crashed`/`stalled` verdict
 * is re-derived on every read from the newest facts (derive-don't-store: the
 * wave-5/6 campaigns' dominant defect class was a parsed+surfaced field
 * enforced nowhere, and the constructive fix is to give the object no field
 * to hold a stale copy in). The operator's real stuck sessions
 * (community-refresh 2026-08-18T12-54-32, kb-cleanup 12-36-59 and
 * 2026-08-14T15-07-02) are the fixtures: each threw
 * `InteractiveRunnerError` into stderr.log AFTER its last status.json write,
 * left no live turn, and read as a calm "needs you / no operator action"
 * on every Studio surface.
 *
 * Findings: home-sessions-05/08/09/15, sessions-kinds-11/15/33,
 * community-02/15, knowledge-16.
 *
 * Every filesystem read is routed through cli/studio-path-guard.ts
 * (`resolveGuardedPath` / `guardedReadFile`) with request-derived ids as
 * their OWN segments under the trusted roots — this module is auto-linted by
 * scripts/check-raw-fs-guarded.mjs via the `cli/bridge-studio*.ts` glob.
 */

import { statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { basename } from 'node:path';

import { LEGACY_SESSION_AWAITS_PHASES, LEGACY_SESSION_WORKING_PHASES } from './bridge-studio.ts';
import { resolveGuardedPath, guardedReadFile } from './studio-path-guard.ts';
import type { SessionKindDescriptor } from '../orchestrator/studio/session-kinds.ts';

// ---------------------------------------------------------------------------
// Vocabulary + types
// ---------------------------------------------------------------------------

export const SESSION_LIFECYCLE_STATES = Object.freeze(['working', 'awaiting-operator', 'crashed', 'stalled', 'terminal'] as const);
export type SessionLifecycleState = (typeof SESSION_LIFECYCLE_STATES)[number];

export type SessionLifecycle = {
  state: SessionLifecycleState;
  /** True iff the operator has something to do here: an operator gate is
   *  open (awaiting-operator), or the runner died/stalled and needs a human
   *  decision (crashed/stalled). An agent that is merely working is NOT
   *  "needs you" — the inversion the walkthrough measured on /sessions. */
  needsYou: boolean;
  /** The runner's own crash message (the last non-stack line of stderr.log,
   *  capped) — only for `crashed`; `null` otherwise. */
  error: string | null;
  /** ms since the last on-disk sign of life, or `null` when the session has
   *  no log dir at all (no liveness signal — honest unknown, never guessed). */
  idleMs: number | null;
  /** True iff the generic cancel route would accept a cancel (i.e. not
   *  terminal). */
  cancellable: boolean;
};

export type SessionLifecycleInputs = {
  terminal: boolean;
  awaits: 'questions' | 'verdict' | null;
  working: boolean;
  statusMtimeMs: number | null;
  stderr: { text: string; mtimeMs: number } | null;
  lastActivityMs: number | null;
  turnAlive: boolean;
  /** W7-FIX-A2 (W7A2-01): true iff the session log dir carries a LIVENESS
   *  CHANNEL — a `.heartbeat` or `events.jsonl` the runner writes to while
   *  it works. A turn tracked ONLY by `turn.pid` (the `forge agent dispatch
   *  --session-dir` kinds, whose events/stderr live under `_logs/<runId>/`)
   *  has nothing to be silent on, so a live pid with no channel is never
   *  `stalled` — the same honest-unknown rule as "no log dir at all". */
  hasChannel: boolean;
  nowMs: number;
  stallCeilingMs: number;
};

// ---------------------------------------------------------------------------
// Stall ceilings — per kind, one default
// ---------------------------------------------------------------------------

/** How long a WORKING session may be silent (no heartbeat/event/status
 *  write) before it reads `stalled`. Generous by design: a single WebFetch
 *  or a long tool call can legitimately produce no message for a minute or
 *  two; the heartbeat writer (`makeHeartbeatWriter`, 2 s cadence while
 *  messages flow) keeps a healthy turn well inside this. */
export const DEFAULT_STALL_CEILING_MS = 180_000;
/** Per-kind overrides. architect matches the UI's own long-standing
 *  `STALE_THRESHOLD_MS` (forge-ui/lib/architect-hex.ts) so the bespoke
 *  architect panel and the generic lifecycle never disagree about a stall. */
export const STALL_CEILING_MS_BY_KIND: Readonly<Record<string, number>> = Object.freeze({
  architect: 120_000,
});
export function stallCeilingForKind(kind: string): number {
  return STALL_CEILING_MS_BY_KIND[kind] ?? DEFAULT_STALL_CEILING_MS;
}

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

const ERROR_MESSAGE_CAP = 600;

/** The runner's own message out of a stderr.log: the LAST line that is
 *  non-empty and not a stack frame (`    at …`), trimmed and capped. Falls
 *  back to the trailing text when nothing matches. */
export function extractErrorMessage(stderrText: string): string {
  const lines = stderrText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (/^\s+at\s/.test(line)) continue;
    return cap(line.trim());
  }
  return cap(stderrText.trim().slice(-ERROR_MESSAGE_CAP));
}

function cap(s: string): string {
  return s.length > ERROR_MESSAGE_CAP ? `${s.slice(0, ERROR_MESSAGE_CAP)}…` : s;
}

/**
 * Rules, in order (the first that matches wins):
 *   1. terminal                                            → terminal
 *   2. no live turn, non-empty stderr NEWER than status    → crashed
 *   3. an operator gate is open (awaits)                   → awaiting-operator
 *   4. working, has a liveness signal, silent > ceiling    → stalled
 *   5. otherwise                                           → working
 * A crash NEWER than the last successful phase write is the operator's
 * fact even at an operator gate (rule 2 before 3); a crash OLDER than it
 * (a prior turn failed, a later one advanced the phase) is history, not
 * state. A live tracked turn (rule 2's `!turnAlive`) means a re-run is in
 * flight — never `crashed` on the previous attempt's stderr. No log dir at
 * all (`lastActivityMs === null`) can never be `stalled`: there is no
 * liveness signal to be silent on, so the honest answer is "working
 * (unknown)", never a guess. W7-FIX-A2: likewise a LIVE tracked pid whose
 * log dir has no heartbeat/events channel at all (`turn.pid` only) is
 * `working`, not `stalled` — see SessionLifecycleInputs.hasChannel.
 */
export function deriveSessionLifecycle(i: SessionLifecycleInputs): SessionLifecycle {
  const idleMs = i.lastActivityMs !== null ? Math.max(0, i.nowMs - i.lastActivityMs) : null;
  if (i.terminal) {
    return { state: 'terminal', needsYou: false, error: null, idleMs, cancellable: false };
  }
  const crashed = !i.turnAlive && i.stderr !== null && (i.statusMtimeMs === null || i.stderr.mtimeMs >= i.statusMtimeMs);
  if (crashed) {
    return { state: 'crashed', needsYou: true, error: extractErrorMessage(i.stderr!.text), idleMs, cancellable: true };
  }
  if (i.awaits !== null) {
    return { state: 'awaiting-operator', needsYou: true, error: null, idleMs, cancellable: true };
  }
  // W7-FIX-A2 (W7A2-01): a LIVE tracked pid with NO liveness channel (turn.pid
  // only — the dispatch-spawned kinds) has nothing to be silent on: working,
  // never stalled. A live pid WITH a channel that went quiet past the
  // ceiling (the hung-SDK shape) and a dead pid silent past the ceiling are
  // both still stalled.
  if (i.working && idleMs !== null && idleMs > i.stallCeilingMs && !(i.turnAlive && !i.hasChannel)) {
    return { state: 'stalled', needsYou: true, error: null, idleMs, cancellable: true };
  }
  return { state: 'working', needsYou: false, error: null, idleMs, cancellable: true };
}

// ---------------------------------------------------------------------------
// Phase-row shape → (awaits, working), from the descriptor's own table or the
// legacy tables for the two kinds that carry none.
// ---------------------------------------------------------------------------

export function phaseShapeFor(descriptor: SessionKindDescriptor, phase: string): { awaits: 'questions' | 'verdict' | null; working: boolean } {
  const phases = descriptor.turnSpec?.phases ?? descriptor.panel?.phases;
  if (phases !== undefined) {
    const row = phases.find((p) => p.phase === phase);
    if (row === undefined) return { awaits: null, working: false };
    if (row.step === 'noop') {
      const awaits = row.awaits === 'questions' || row.awaits === 'verdict' ? row.awaits : null;
      return { awaits, working: false };
    }
    return { awaits: null, working: row.step === 'agent' || row.step === 'finalize' };
  }
  const awaits = LEGACY_SESSION_AWAITS_PHASES[descriptor.id]?.[phase] ?? null;
  const working = LEGACY_SESSION_WORKING_PHASES[descriptor.id]?.has(phase) ?? false;
  return { awaits, working };
}

// ---------------------------------------------------------------------------
// On-disk facts (guarded reads only)
// ---------------------------------------------------------------------------

export type SessionLifecycleFacts = {
  statusMtimeMs: number | null;
  stderr: { text: string; mtimeMs: number } | null;
  lastActivityMs: number | null;
  turnAlive: boolean;
  /** The tracked turn pid when a `turn.pid` file names one, else null. */
  turnPid: number | null;
  /** W7-FIX-A2: a `.heartbeat` or `events.jsonl` exists in the log dir. */
  hasChannel: boolean;
};

/** `_logs/_<kind>-<sessionId>` — the SAME directory template
 *  `spawnAgentTurn` (cli/ui-bridge.ts) writes stderr.log/turn.pid into and
 *  `runInteractiveTurn` (orchestrator/interactive-runner.ts) writes
 *  events.jsonl/.heartbeat into (`SPAWN_AGENT_SPECS[..].logPrefix ===
 *  descriptor.id`, pinned by cli/session-tail-kind-parity.test.ts). */
export function sessionLogDirName(kind: string, sessionId: string): string {
  return `_${kind}-${sessionId}`;
}

/**
 * W8-A2 (ON-7) — the session's own `.heartbeat` mtime, guarded, or null when
 * absent. Exposed because the bespoke per-kind session panels need the
 * HEARTBEAT specifically, not `SessionLifecycle.idleMs`: idleMs folds in
 * `status.json`'s mtime, and the runner rewrites status.json on every phase
 * transition, so a dead runner whose file was merely touched reads fresh.
 * The heartbeat is written only while a runner is genuinely alive.
 */
export function sessionHeartbeatMtimeMs(logsRoot: string, kind: string, sessionId: string): number | null {
  return guardedMtime(logsRoot, [sessionLogDirName(kind, sessionId), '.heartbeat']);
}

function guardedMtime(root: string, segments: readonly string[]): number | null {
  const guarded = resolveGuardedPath(root, segments);
  if (!guarded.ok || !guarded.exists) return null;
  try {
    // guard-terminal: `guarded.realPath` IS the guard's own output.
    return statSync(guarded.realPath).mtimeMs;
  } catch {
    return null;
  }
}

/** True iff `pid` is alive AND provably ours: its argv (Linux `/proc/<pid>/
 *  cmdline`, NUL-separated) carries this session id as a WHOLE argv element
 *  — `spawnAgentTurn` always passes the session id as its own argv element
 *  (`... <verb> <sessionId> --project <p>`). Fails CLOSED: an unreadable
 *  /proc, a recycled pid running something else, a substring-only match (a
 *  short session id inside some unrelated argument), the bridge's own pid or
 *  its parent, all read `false` — the cancel route can never signal a
 *  stranger's process, and never itself. */
export function isTurnAlive(pid: number, sessionId: string): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (pid === process.pid || pid === process.ppid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    // `/proc/<pid>/cmdline` — pid is a validated integer read off a
    // guarded file, never a request string; this is a kernel pseudo-file,
    // not a project/request-derived path.
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return argv.some((arg) => isSessionOwnershipMark(arg, sessionId));
  } catch {
    return false;
  }
}

/** W7-FIX-A2 (W7A2-01): the TWO argv shapes our own spawners stamp a turn
 *  with — `spawnAgentTurn`'s bare `<sessionId>` element and
 *  `spawnAgentDispatch`'s `--session-dir <…/_<kind>/<sessionId>>` value
 *  (whose BASENAME is the session id). Both are whole-element matches: a
 *  bare prefix of the id, an intermediate path segment (`_onboarding`, the
 *  project) or the id buried inside some unrelated argument never count. */
export function isSessionOwnershipMark(argvElement: string, sessionId: string): boolean {
  if (argvElement === sessionId) return true;
  return argvElement.includes('/') && basename(argvElement) === sessionId;
}

export function readSessionLifecycleFacts(args: {
  projectsRoot: string;
  logsRoot: string;
  project: string;
  kind: string;
  sessionId: string;
}): SessionLifecycleFacts {
  const { projectsRoot, logsRoot, project, kind, sessionId } = args;
  const statusMtimeMs = guardedMtime(projectsRoot, [project, `_${kind}`, sessionId, 'status.json']);
  const logDir = sessionLogDirName(kind, sessionId);
  const logDirGuard = resolveGuardedPath(logsRoot, [logDir]);
  if (!logDirGuard.ok || !logDirGuard.exists) {
    return { statusMtimeMs, stderr: null, lastActivityMs: null, turnAlive: false, turnPid: null, hasChannel: false };
  }
  // W7A2-08: only the TAIL of stderr.log is read — `extractErrorMessage`
  // wants the last non-stack line, never the whole file (a long-running
  // runner's stderr can be large, and this runs per row per index poll).
  const stderrText = guardedReadFileTail(logsRoot, [logDir, 'stderr.log'], STDERR_TAIL_BYTES);
  const stderrMtime = guardedMtime(logsRoot, [logDir, 'stderr.log']);
  const stderr = stderrText !== null && stderrText.trim().length > 0 && stderrMtime !== null ? { text: stderrText, mtimeMs: stderrMtime } : null;

  const heartbeatMtime = guardedMtime(logsRoot, [logDir, '.heartbeat']);
  const eventsMtime = guardedMtime(logsRoot, [logDir, 'events.jsonl']);
  const candidates = [
    statusMtimeMs,
    stderrMtime,
    heartbeatMtime,
    eventsMtime,
    guardedMtime(logsRoot, [logDir, 'turn.pid']),
  ].filter((m): m is number => m !== null);
  const lastActivityMs = candidates.length > 0 ? Math.max(...candidates) : null;

  const pidRaw = guardedReadFile(logsRoot, [logDir, 'turn.pid']);
  const turnPid = pidRaw !== null && /^\d+\s*$/.test(pidRaw.trim()) ? Number.parseInt(pidRaw.trim(), 10) : null;
  const turnAlive = turnPid !== null && isTurnAlive(turnPid, sessionId);
  return { statusMtimeMs, stderr, lastActivityMs, turnAlive, turnPid, hasChannel: heartbeatMtime !== null || eventsMtime !== null };
}

/** W7A2-08 — how much of stderr.log's tail the lifecycle reads. Generous
 *  next to ERROR_MESSAGE_CAP (600 chars): a stack trace's frames follow the
 *  message line, and `extractErrorMessage` walks back past them. */
export const STDERR_TAIL_BYTES = 16 * 1024;

/** Guarded read of the LAST `maxBytes` of a file (or the whole file when
 *  smaller) — the same guard as `guardedReadFile`, then a bounded
 *  positional read off the guard's own realPath. `null` on rejection/absence. */
function guardedReadFileTail(root: string, segments: readonly string[], maxBytes: number): string | null {
  const guarded = resolveGuardedPath(root, segments);
  if (!guarded.ok || !guarded.exists) return null;
  let fd: number | null = null;
  try {
    // guard-terminal: `guarded.realPath` IS the guard's own output.
    const size = statSync(guarded.realPath).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length === 0) return '';
    // guard-terminal: same realPath, bounded positional read.
    fd = openSync(guarded.realPath, 'r');
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/** Glue: descriptor + phase + on-disk facts → lifecycle. `terminal` is
 *  supplied by the caller (its own `isTerminalPhase` derivation,
 *  cli/bridge-studio-sessions.ts) so this module never imports the route
 *  module that imports it. */
export function deriveSessionLifecycleFor(args: {
  descriptor: SessionKindDescriptor;
  phase: string;
  terminal: boolean;
  project: string;
  sessionId: string;
  projectsRoot: string;
  logsRoot: string;
  nowMs?: number;
}): SessionLifecycle {
  const { descriptor, phase, terminal, project, sessionId, projectsRoot, logsRoot } = args;
  // W7A2-08: a terminal phase's verdict is fixed by rule 1 — no on-disk fact
  // can change it, so none is read (the index derives one lifecycle per row
  // on every poll, BEFORE the 200-row cap; terminal history dominates it).
  // `idleMs` is honestly null: it was not computed, and no surface renders
  // it for a terminal row.
  if (terminal) {
    return { state: 'terminal', needsYou: false, error: null, idleMs: null, cancellable: false };
  }
  const shape = phaseShapeFor(descriptor, phase);
  const facts = readSessionLifecycleFacts({ projectsRoot, logsRoot, project, kind: descriptor.id, sessionId });
  return deriveSessionLifecycle({
    terminal,
    awaits: shape.awaits,
    working: shape.working,
    statusMtimeMs: facts.statusMtimeMs,
    stderr: facts.stderr,
    lastActivityMs: facts.lastActivityMs,
    turnAlive: facts.turnAlive,
    hasChannel: facts.hasChannel,
    nowMs: args.nowMs ?? Date.now(),
    stallCeilingMs: stallCeilingForKind(descriptor.id),
  });
}

// ---------------------------------------------------------------------------
// Turn kill — used by the cancel route
// ---------------------------------------------------------------------------

/** Signal the session's tracked turn (SIGTERM to its process GROUP first —
 *  `spawnAgentTurn` spawns `detached: true`, so the runner leads its own
 *  group and the SDK's `claude` child dies with it — then the pid itself).
 *  Returns true iff at least one signal was delivered to a process
 *  `isTurnAlive` proved ours; a dead/unowned/absent pid is a no-op `false`. */
export function killTrackedTurn(logsRoot: string, kind: string, sessionId: string): boolean {
  return killTrackedPidFile(logsRoot, sessionLogDirName(kind, sessionId), sessionId);
}

/**
 * W7-B5 (agents-30): the standalone-run sibling — a generic agent dispatch's
 * pid lives at `_logs/<runId>/turn.pid` (written by `spawnAgentDispatch`,
 * cli/ui-bridge.ts) and its ownership mark is the runId itself, which the
 * child's argv carries as a whole element (`forge agent dispatch <slug>
 * --run-id <runId>`). Same fail-closed ownership proof as the session path.
 */
export function killTrackedRun(logsRoot: string, runId: string): boolean {
  return killTrackedPidFile(logsRoot, runId, runId);
}

/** Shared core of the two kill entry points above: read `<logDirName>/
 *  turn.pid` (guarded), prove ownership via `ownershipMark` in the pid's own
 *  argv, then SIGTERM group-then-pid. */
function killTrackedPidFile(logsRoot: string, logDirName: string, ownershipMark: string): boolean {
  const pidRaw = guardedReadFile(logsRoot, [logDirName, 'turn.pid']);
  if (pidRaw === null || !/^\d+\s*$/.test(pidRaw.trim())) return false;
  const pid = Number.parseInt(pidRaw.trim(), 10);
  if (!isTurnAlive(pid, ownershipMark)) return false;
  let delivered = false;
  try {
    process.kill(-pid, 'SIGTERM');
    delivered = true;
  } catch {
    /* not a group leader (or already gone) — fall through to the pid itself */
  }
  try {
    process.kill(pid, 'SIGTERM');
    delivered = true;
  } catch {
    /* already exited between the liveness check and here */
  }
  return delivered;
}
