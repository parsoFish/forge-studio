/**
 * JSONL event-log writer. One log file per cycle: _logs/<cycle-id>/events.jsonl.
 * Append-only, line-buffered. The single source of truth for everything that
 * happened during a cycle (per ADR 008).
 */

import { appendFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { guardedFile } from './path-guard.ts';
import { join, resolve } from 'node:path';

export type Phase =
  | 'orchestrator'
  | 'brain'
  | 'architect'
  | 'project-manager'
  | 'developer-loop'
  | 'unifier'
  | 'review-loop'
  | 'closure'
  | 'release-finalize'
  | 'reflection'
  // W7-C3 (sessions-kinds-25/26) + the W7-C3 review (A-M9): interactive
  // session KINDS log under their OWN phase names, all three of them.
  // instructions-runner copy-pasted `architect`, demo-builder-runner
  // inherited the retired `unifier`, and the project-brain kind files
  // under `reflection` — the OOTB reflector's cycle-spine phase — so those
  // sessions' cost and activity were billed to phases that never ran them.
  // Each value matches the session KIND id (studio/session-kinds.yaml) and
  // the skill's own SKILL.md frontmatter phase, which ADR-024 makes the
  // single source of intent. The cycle spine ignores these; session logs are
  // per-session, not cycle logs.
  | 'instructions'
  | 'demo'
  | 'project-brain';

export type EventType =
  | 'start'
  | 'end'
  | 'log'
  | 'error'
  | 'tool_use'
  | 'iteration'
  /**
   * S7 / plan 07a — file mutated by the agent's tool-use stream
   * (Edit / Write / MultiEdit / NotebookEdit). Emit site:
   * `orchestrator/file-change-emit.ts` consuming Ralph's tool-use
   * stream. Metadata: `{ path, op: 'add'|'modify'|'delete',
   * size_bytes, work_item_id? }`.
   */
  | 'file_change'
  /**
   * S7 / plan 07a — heuristic-detected test-runner invocation
   * (`npm test` / `pytest` / `go test`). Emit site:
   * `orchestrator/test-run-emit.ts`. Metadata: `{ command,
   * exit_code?, duration_ms?, pass_count?, fail_count?,
   * stdout_tail?, work_item_id? }`.
   */
  | 'test_run'
  /**
   * S7 / plan 07a — orchestrator phase boundary
   * (`runProjectManager` → `runDeveloperLoop` → …). Emit site:
   * `orchestrator/phase-transition-emit.ts`, called from
   * `cycle.ts`. Metadata: `{ from, to, reason }`.
   */
  | 'phase_transition'
  /**
   * S7 / C13 — sidecar liveness pulse during a silent SDK call.
   * Emit site: `loops/ralph/claude-agent.ts` (NOT the runner).
   * Cadence: default 15s, configurable per-project via
   * `.forge/project.json` `logging.heartbeat_seconds`. Tail-emit
   * on idle > 30s. Metadata: `{ tool_use_count, last_tool,
   * since_ms }`.
   */
  | 'agent_heartbeat'
  /**
   * Emitted when a planner phase (architect/PM) queries the brain index.
   * Metadata: `{ session_id?, project? }`.
   */
  | 'brain-query';

export type EventLogEntry = {
  event_id: string;
  cycle_id: string;
  initiative_id: string;
  parent_event_id?: string;
  phase: Phase;
  skill: string;
  iteration?: number;
  event_type: EventType;
  input_refs: string[];
  output_refs: string[];
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
  /**
   * S8 / C23 — prompt-cache read hits on this event's API call. Sourced
   * from the SDK result message's `usage.cache_read_input_tokens`.
   * Optional; absent on non-SDK events (orchestrator-internal `log` /
   * `start` / `end` rows, stub-agent test runs).
   */
  cache_read_tokens?: number;
  /**
   * S8 / C23 — prompt-cache write tokens (cache MISSES that populated the
   * cache for future calls). Sourced from
   * `usage.cache_creation_input_tokens`. Optional.
   */
  cache_creation_tokens?: number;
  duration_ms?: number;
  started_at: string;
  finished_at?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type EventLogger = {
  emit: (entry: Omit<EventLogEntry, 'event_id' | 'cycle_id' | 'started_at'> & {
    event_id?: string;
    started_at?: string;
  }) => EventLogEntry;
  cycleId: string;
  logFilePath: string;
};

export type LoggerOptions = {
  /**
   * Optional sink invoked synchronously after each `emit()` with the entry that
   * was just written to disk. Used by the scheduler to render live progress to
   * stdout. Throws are swallowed so a misbehaving tee can't break logging.
   */
  tee?: (entry: EventLogEntry) => void;
};

export function createLogger(
  cycleId: string,
  /**
   * An ABSOLUTE logs root. Required, and deliberately without a default
   * (T1 ruling 101, bead forge-8vfn.5.53): it used to default to `'_logs'`,
   * which `resolve(logsDir, cycleId)` below anchors on `process.cwd()` — so a
   * caller that omitted it silently wrote its events wherever the process
   * happened to start. That is not a hypothetical: it is exactly how four
   * flows tests came to be KNOWN RED outside the repo-root cwd, and in
   * production it means a run started from another directory logs where
   * nobody reads. Measured before removal: ZERO callers repo-wide omitted the
   * argument and, after 5.53, zero passed a relative one — so the default was
   * dead code whose only remaining effect was to make the next cwd-anchored
   * caller a silent mis-write instead of a compile error.
   */
  logsDir: string,
  opts: LoggerOptions = {},
): EventLogger {
  const dir = resolve(logsDir, cycleId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logFilePath = join(dir, 'events.jsonl');

  return {
    cycleId,
    logFilePath,
    emit: (partial) => {
      const entry: EventLogEntry = {
        event_id: partial.event_id ?? newEventId(),
        cycle_id: cycleId,
        started_at: partial.started_at ?? new Date().toISOString(),
        ...partial,
      } as EventLogEntry;
      appendFileSync(logFilePath, JSON.stringify(entry) + '\n');
      if (opts.tee) {
        try {
          opts.tee(entry);
        } catch {
          /* tee is best-effort — never break logging */
        }
      }
      return entry;
    },
  };
}

/** Tiny ULID-ish ID: timestamp + random. Not a real ULID, but monotonic-ish and unique enough. */
function newEventId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return `EV_${ts}_${rnd}`;
}

/**
 * Bead `forge-qm4d` (T1 ruling 673(ii)) — PROVENANCE FOR THE BRIDGE'S OWN
 * WRITES.
 *
 * A session says what it wrote: `makeToolEventSink` emits a durable
 * `file_change` for every tool mutation. The BRIDGE says nothing. Measured on
 * S1 run 5, five files landed in `projects/gitweave` that no session wrote —
 * `.forge/agent-run/PROMPT.md`, `.forge/contract-compliance-report.json`,
 * `.gitignore`, `roadmap.md`, `brain/profile.md` — so a containment check built
 * on session logs could not account for them, and the story failed for the
 * product working.
 *
 * These three helpers live HERE, not beside `makeToolEventSink`, because the
 * writers span three packages — `packages/agents`, `packages/projects` and
 * `apps/forge` — and the kernel is the only layer all three already stand on.
 * One event vocabulary for session and bridge writes alike; a reader should not
 * have to know which half of the product made a file.
 */

/** A run id for writes that belong to no session: the bridge's own. */
function bridgeCycleId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `_bridge-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One durable `file_change` per written path, in a `_bridge-<stamp>` run of its
 * own — never one summary event, because a summary cannot be attributed path by
 * path, which is the only question a containment check (or an operator) asks.
 *
 * `relPaths` is what was ACTUALLY written, not what might be: every scaffold
 * write site is `existsSync`-guarded, so the candidate list and the outcome
 * genuinely differ, and `scaffoldContractArtifacts` already returns the
 * outcome. An EMPTY list opens no run and creates no directory — "the operator
 * already had every file" is the scaffold's ordinary result, and a run
 * directory per no-op would bury the real ones.
 *
 * `cause` is the request or command that did the writing, and it is required:
 * "forge wrote this file" without "why" is half an answer, and the operator
 * asking what forge put in their project is asking the second half.
 *
 * @returns the logger it opened, or `null` when there was nothing to say.
 */
export function emitGroundFileChanges(args: {
  forgeRoot: string;
  cause: string;
  projectRoot: string;
  relPaths: readonly string[];
  op?: 'write' | 'modify';
  logger?: EventLogger;
}): EventLogger | null {
  if (args.relPaths.length === 0) return null;
  const op = args.op ?? 'write';
  const logger = args.logger ?? createLogger(bridgeCycleId(), join(args.forgeRoot, '_logs'));
  for (const rel of args.relPaths) {
    const abs = join(args.projectRoot, rel);
    logger.emit({
      initiative_id: logger.cycleId,
      phase: 'orchestrator',
      skill: 'bridge',
      event_type: 'file_change',
      input_refs: [],
      output_refs: [abs],
      message: `file.${op}`,
      metadata: { path: abs, op, cause: args.cause },
    });
  }
  return logger;
}

/**
 * Write one file into a project ground AND emit its provenance, in one call.
 *
 * The point is that a caller cannot do one without the other. A helper that
 * only emits is a convention, and this bead exists because a convention was not
 * kept at five separate write sites.
 */
export function writeProjectGroundFile(args: {
  projectRoot: string;
  /** Path segments beneath `projectRoot` — never a joined string. */
  segments: readonly string[];
  body: string;
  forgeRoot: string;
  cause: string;
}): void {
  // GUARDED, because `projectRoot` is request-derived at the bridge call sites
  // and the segments come from the caller. `guardedFile(root, segments,
  // 'write')` contains the leaf too and creates the parent chain beneath the
  // root; folding either into a bare `join` is the request-path-sink shape
  // `check-request-path-sinks` exists to catch, and it caught this on its
  // first gate.
  const target = guardedFile(args.projectRoot, args.segments, 'write');
  if (target === null) {
    throw new Error(`writeProjectGroundFile: ${args.segments.join('/')} does not resolve beneath ${args.projectRoot}`);
  }
  writeFileSync(target, args.body);
  emitGroundFileChanges({
    forgeRoot: args.forgeRoot, cause: args.cause,
    projectRoot: args.projectRoot, relPaths: [args.segments.join('/')],
  });
}
