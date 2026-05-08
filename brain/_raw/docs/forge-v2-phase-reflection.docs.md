---
source_type: docs
source_url: docs/phases/reflection.md
source_title: Forge v2 — Phase: Reflection
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 3)
cycle_id: pass-a-bootstrap
---

# Phase: Reflection

> *Human-in-the-loop, then unattended ingest.* Closes the learning loop by feeding cycle outcomes back into the brain.

## Purpose

After an initiative is merged, run a structured retrospective with three scopes:

1. **Agentic self-reflection** — agent reviews its own performance from JSONL event log.
2. **Agent-prompted user questions** — agent asks user only what it can't resolve.
3. **Pure user feedback** — user's free-form observations.

All three feed the brain via `brain-ingest`, which is what makes forge improve cycle-over-cycle.

## Inputs

- `_logs/<cycle-id>/events.jsonl` (full cycle log).
- `_logs/<cycle-id>/brain-gaps.jsonl` (questions the brain couldn't answer during cycle).
- Merged initiative branch + PR + demo script.
- Brain knowledge (prior retros, established patterns).

## Outputs

- `_logs/<cycle-id>/retro.md` — structured retro doc.
- New / updated theme pages in `brain/forge/themes/` and `brain/projects/<name>/themes/`.
- New raw sources in `brain/_raw/cycles/<cycle-id>.md` (cycle log archived).
- Append to `brain/log.md`.
- Initiative manifest moves to `_queue/done/`.

## Success signals

- **Brain-gap closure:** `brain-gaps.jsonl` items from the cycle are addressed (filled or escalated) in the retro.
- **Theme deltas:** retros result in concrete theme-page additions/updates (not just text "we should improve X").
- **Iteration trend:** median iterations / cost / wedge-rate trend down across consecutive cycles.
- **Antipattern capture:** any new antipattern discovered in cycle becomes a `brain/forge/antipatterns.md`-indexed theme page.

## Known failure modes

- **Vague retros** — "we could do better at X." Reflector prompt requires concrete actions or theme-page deltas.
- **Reflection bypassed** — initiative marked done without retro. Orchestrator gates `done/` move on retro.md existence.
- **Brain growth without curation** — `brain-lint` runs at the end of every retro to catch new orphans / conflicts.
