---
title: Cycle event-log replay
description: events.jsonl + referenced artifacts let any cycle be replayed for reflection, debugging, or benchmark fixture creation.
category: pattern
keywords: [replay, event-log, jsonl, reflection, debugging, fixture, archival]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [jsonl-event-log, brain-gap-feedback-loop]
---

# Cycle event-log replay

Because the event log records only `input_refs` and `output_refs` (file paths, not contents), any past cycle can be replayed by:

1. Reading `_logs/<cycle-id>/events.jsonl` line by line.
2. Loading the referenced artifacts (initiative manifest, work item specs, retros) from their referenced paths.
3. Reconstructing the call tree via `parent_event_id` chains.

Three uses:

- **Reflection** — the reflector reads the log + artifacts to write the retro and propose theme-page deltas.
- **Debugging** — when a cycle goes sideways, the log + artifacts are enough to reconstruct what happened.
- **Benchmark fixture creation** — interesting cycles become inputs for `benchmarks/<phase>/cases/`.

Old cycles are archived to `brain/_raw/cycles/<cycle-id>.md` with a frontmatter pointer to the archived event log. This keeps `_logs/` from growing unbounded while preserving replay capability.

## Sources

- [`adr-008-jsonl-event-log.docs.md`](../../_raw/docs/adr-008-jsonl-event-log.docs.md) — log schema and writer/reader split.

## Related

- [Theme: JSONL event log](./jsonl-event-log.md) — the substrate.
- [Theme: Brain-gap feedback loop](./brain-gap-feedback-loop.md) — uses sibling `brain-gaps.jsonl`.
