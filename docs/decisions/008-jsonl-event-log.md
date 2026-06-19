# ADR 008 — JSONL event log per cycle

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

User principle 5: every component must log actions, inputs, outputs; iterations of agentic loops must be tracked; metrics enable monitoring + visualisation. V1 had several logging surfaces (worker logs, agent logs, event log, budget log) that were not unified — reflection had to stitch them together.

## Decision

**One JSONL event log per cycle**, written to `_logs/<cycle-id>/events.jsonl`. Schema:

```ts
type EventLogEntry = {
  event_id: string;          // ULID
  cycle_id: string;          // shared across all events in one cycle
  initiative_id: string;     // which initiative this event belongs to
  parent_event_id?: string;  // parent in the call tree (skill A invoked skill B)
  phase: 'architect' | 'project-manager' | 'developer-loop' | 'review-loop' | 'reflection' | 'brain' | 'orchestrator';
  skill: string;             // e.g. 'brain-query', 'developer-ralph', 'reviewer'
  iteration?: number;        // for loop runners (Ralph), the iteration count
  event_type: 'start' | 'end' | 'log' | 'error' | 'cost' | 'tool_use';
  input_refs: string[];      // file paths, not contents
  output_refs: string[];     // file paths written
  cost_usd?: number;         // SDK usage event passthrough
  tokens_in?: number;
  tokens_out?: number;
  duration_ms?: number;
  started_at: string;        // ISO-8601
  finished_at?: string;
  message?: string;          // free-form, optional
  metadata?: Record<string, unknown>;
};
```

Only file references are logged, never file contents — the log stays small; reflection re-reads the artifacts.

Writers:
- [`orchestrator/logging.ts`](../../orchestrator/logging.ts) is the single writer (append-only, line-buffered).
- Every skill invocation goes through it via the `developer-ralph` runner or `cycle.ts`.

Readers:
- `orchestrator/metrics.ts` — aggregates cost, iterations, durations.
- **forge-ui** — consumes events via the daemon bridge (SSE stream, [ADR 031](./031-studio-consolidation.md), which carries the sole-operator-surface decision) for the live phase/WI hex view and cost panel. The former `orchestrator/visualise.ts` CLI tail was removed when the UI became the sole operator surface.
- The reflector skill — reads the full log to write retros.

## Consequences

**Positive:**
- One source of truth for everything that happened during a cycle.
- JSONL is grep-, jq-, awk-, and stream-friendly.
- Replay-able: re-run a cycle from its log + the artifacts it referenced.
- Costs roll up naturally per phase / per skill / per initiative.

**Negative / accepted trade-offs:**
- Log size grows with cycle complexity. Mitigated by keeping refs not contents, and by archiving old cycles to `brain/_raw/cycles/`.
- Event-log writer must be reliable — if it crashes we lose visibility. Mitigated by simple append-only semantics with no batching.

## Alternatives considered

- **OpenTelemetry / structured logging library** — overkill; the schema above fits in one file.
- **SQLite for events** — query power is nice but adds a binary dependency and schema migrations.
- **One log file per skill invocation** — fragments the data; reflection has to glue them.

## References

- [JSON Lines spec](https://jsonlines.org/)
- v1's `src/events/event-log.ts` — close to this design; this ADR locks it as canonical
