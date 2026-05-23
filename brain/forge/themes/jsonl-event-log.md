---
title: JSONL event log per cycle
description: >-
  One append-only events.jsonl per cycle records every skill invocation,
  iteration, cost, duration. Source of truth for reflection, metrics, replay.
category: pattern
keywords:
  - jsonl
  - event-log
  - logging
  - observability
  - replay
  - metrics
  - reflection
  - ulid
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - cycle-event-log-replay
  - brain-gap-feedback-loop
  - six-phases-of-forge
---

# JSONL event log per cycle

Forge writes one JSONL event log per cycle to `_logs/<cycle-id>/events.jsonl`. Every skill invocation, every Ralph iteration, every cost event, every error gets a line. Schema fields include `event_id` (ULID), `cycle_id`, `initiative_id`, `parent_event_id`, `phase`, `skill`, `iteration`, `event_type` (start/end/log/error/cost/tool_use), `input_refs` (file paths, *not* contents), `output_refs`, `cost_usd`, `tokens_in/out`, `duration_ms`, `started_at`, `finished_at`.

Only file *references* are logged, never file contents — log stays small; reflection re-reads artifacts. `orchestrator/logging.ts` is the single writer (append-only, line-buffered). Readers: `metrics.ts` (aggregations), `visualise.ts` (live tail), the reflector skill (retro generation).

Trade-off: log size grows with cycle complexity. Mitigated by refs-not-contents and archival of old cycles to `brain/_raw/cycles/`. Writer must be reliable — simple append-only semantics with no batching.

## Sources

- [`adr-008-jsonl-event-log.docs.md`](../../_raw/docs/adr-008-jsonl-event-log.docs.md) — decision record + full schema.

## See also

- [[cycle-event-log-replay]] — what the log enables.
- [[brain-gap-feedback-loop]] — uses `brain-gaps.jsonl` (sibling log).
- [[six-phases-of-forge]] — six phases of forge backed by a brain.
