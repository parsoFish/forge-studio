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

import { statSync, readFileSync } from 'node:fs';

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
 * (unknown)", never a guess.
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
  if (i.working && idleMs !== null && idleMs > i.stallCeilingMs) {
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
};

/** `_logs/_<kind>-<sessionId>` — the SAME directory template
 *  `spawnAgentTurn` (cli/ui-bridge.ts) writes stderr.log/turn.pid into and
 *  `runInteractiveTurn` (orchestrator/interactive-runner.ts) writes
 *  events.jsonl/.heartbeat into (`SPAWN_AGENT_SPECS[..].logPrefix ===
 *  descriptor.id`, pinned by cli/session-tail-kind-parity.test.ts). */
export function sessionLogDirName(kind: string, sessionId: string): string {
  return `_${kind}-${sessionId}`;
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
    return argv.includes(sessionId);
  } catch {
    return false;
  }
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
    return { statusMtimeMs, stderr: null, lastActivityMs: null, turnAlive: false, turnPid: null };
  }
  const stderrText = guardedReadFile(logsRoot, [logDir, 'stderr.log']);
  const stderrMtime = guardedMtime(logsRoot, [logDir, 'stderr.log']);
  const stderr = stderrText !== null && stderrText.trim().length > 0 && stderrMtime !== null ? { text: stderrText, mtimeMs: stderrMtime } : null;

  const candidates = [
    statusMtimeMs,
    stderrMtime,
    guardedMtime(logsRoot, [logDir, '.heartbeat']),
    guardedMtime(logsRoot, [logDir, 'events.jsonl']),
    guardedMtime(logsRoot, [logDir, 'turn.pid']),
  ].filter((m): m is number => m !== null);
  const lastActivityMs = candidates.length > 0 ? Math.max(...candidates) : null;

  const pidRaw = guardedReadFile(logsRoot, [logDir, 'turn.pid']);
  const turnPid = pidRaw !== null && /^\d+\s*$/.test(pidRaw.trim()) ? Number.parseInt(pidRaw.trim(), 10) : null;
  const turnAlive = turnPid !== null && isTurnAlive(turnPid, sessionId);
  return { statusMtimeMs, stderr, lastActivityMs, turnAlive, turnPid };
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
  const pidRaw = guardedReadFile(logsRoot, [sessionLogDirName(kind, sessionId), 'turn.pid']);
  if (pidRaw === null || !/^\d+\s*$/.test(pidRaw.trim())) return false;
  const pid = Number.parseInt(pidRaw.trim(), 10);
  if (!isTurnAlive(pid, sessionId)) return false;
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
