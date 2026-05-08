---
source_type: docs
source_url: docs/decisions/008-jsonl-event-log.md
source_title: ADR 008 — JSONL event log per cycle
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 2)
cycle_id: pass-a-bootstrap
---

# ADR 008 — JSONL event log per cycle

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

User principle 5: every component must log actions, inputs, outputs; iterations of agentic loops must be tracked; metrics enable monitoring + visualisation. V1 had several logging surfaces (worker logs, agent logs, event log, budget log) that were not unified — reflection had to stitch them together.

## Decision

One JSONL event log per cycle, written to `_logs/<cycle-id>/events.jsonl`. Schema:

```ts
type EventLogEntry = {
  event_id: string;          // ULID
  cycle_id: string;          // shared across all events in one cycle
  initiative_id: string;
  parent_event_id?: string;  // parent in the call tree
  phase: 'architect' | 'project-manager' | 'developer-loop' | 'review-loop' | 'reflection' | 'brain' | 'orchestrator';
  skill: string;
  iteration?: number;        // for loop runners (Ralph)
  event_type: 'start' | 'end' | 'log' | 'error' | 'cost' | 'tool_use';
  input_refs: string[];      // file paths, not contents
  output_refs: string[];
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
  duration_ms?: number;
  started_at: string;        // ISO-8601
  finished_at?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};
```

Only file references logged, never file contents — log stays small; reflection re-reads artifacts. `orchestrator/logging.ts` is the single writer (append-only, line-buffered). Readers: `metrics.ts`, `visualise.ts`, the reflector skill.

## Consequences

- One source of truth for everything that happened during a cycle.
- JSONL is grep-, jq-, awk-, and stream-friendly.
- Replay-able: re-run a cycle from its log + the artifacts it referenced.
- Costs roll up naturally per phase / per skill / per initiative.
- Trade-off: log size grows with cycle complexity. Mitigated by keeping refs not contents, archiving old cycles to `brain/_raw/cycles/`. Event-log writer must be reliable — simple append-only semantics with no batching.

## Alternatives considered

- OpenTelemetry / structured logging library — overkill.
- SQLite for events — query power is nice but adds binary dependency and schema migrations.
- One log file per skill invocation — fragments the data; reflection has to glue them.

## References

- https://jsonlines.org/
- v1's `src/events/event-log.ts` — close to this design; this ADR locks it as canonical
