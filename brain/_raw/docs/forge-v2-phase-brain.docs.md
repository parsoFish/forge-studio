---
source_type: docs
source_url: docs/phases/brain.md
source_title: Forge v2 — Phase: Brain
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 3)
cycle_id: pass-a-bootstrap
---

# Phase: Brain

> The brain is the system's persistent memory. Every other phase queries it first; reflection writes to it.

## Purpose

Hold the durable, queryable knowledge that lets every other phase make better decisions than its base model would. Three layers: immutable raw sources, navigable theme pages, category indexes.

## Inputs

- Raw research (web fetches, doc downloads, paper PDFs, code from reference projects).
- Cycle artifacts (completed initiative manifests, retros, work-item specs, PR descriptions).
- Reflection output (`_logs/<cycle-id>/retro.md` and `brain-gaps.jsonl` after each cycle).

## Outputs

- `brain/_raw/<source>.md` — appended raw source.
- `brain/forge/themes/<theme>.md` — new or updated theme page.
- `brain/projects/<name>/themes/<theme>.md` — project-specific theme page.
- Updated category indexes.
- Append to `brain/log.md`.

## Skills

- `skills/brain-ingest/` — appends to `_raw/`, creates new theme pages.
- `skills/brain-lint/` — orphan detection, conflict surfacing, structural integrity.
- `skills/brain-query/` — efficient lookup; mandated as first action of every other skill.

## Success signals

- **Recall:** `benchmarks/brain/questions.json` accuracy ≥80% with correct source-page citations.
- **Coverage:** `brain-gaps.jsonl` rate-of-new-gaps decreases over consecutive cycles.
- **Integrity:** `brain-lint` reports zero structural issues.
- **Latency:** `brain-query` p95 response time under 5s with default model (Haiku).

## Known failure modes

- **Episodic learning** — repeating insights every session because nothing's persisted. The brain exists to fix this; mandatory `brain-query` enforces it.
- **Wiki bloat** — `_raw/` grows unbounded. `brain-lint` flags this; periodic archival is part of operations.
- **Stale themes** — content from earlier cycles no longer matches reality. `brain-lint` surfaces; `brain-ingest` re-themes.
