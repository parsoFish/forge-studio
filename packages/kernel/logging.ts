/**
 * JSONL event-log writer. One log file per cycle: _logs/<cycle-id>/events.jsonl.
 * Append-only, line-buffered. The single source of truth for everything that
 * happened during a cycle (per ADR 008).
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
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
