# Phase: Brain

> The brain is the system's persistent memory. Every other phase queries it first; reflection writes to it.

## Purpose

Hold the durable, queryable knowledge that lets every other phase make better decisions than its base model would. Three layers: immutable raw sources, navigable theme pages, category indexes — see [ADR 004](../decisions/004-obsidian-wiki.md).

## Inputs

- **Raw research** — web fetches, doc downloads, paper PDFs, code from reference projects.
- **Cycle artifacts** — completed initiative manifests, retros, work-item specs, PR descriptions.
- **Reflection output** — `_logs/<cycle-id>/retro.md` and `brain-gaps.jsonl` after each cycle.

## Outputs

- `brain/_raw/<source>.md` — appended raw source.
- `brain/forge/themes/<theme>.md` — new or updated theme page.
- `brain/projects/<name>/themes/<theme>.md` — project-specific theme page.
- Updated category indexes (`patterns.md`, `antipatterns.md`, `decisions.md`, `operations.md`, per-project `profile.md`).
- Append to `brain/log.md` for significant operations.

## Skills

- [`skills/brain-ingest/SKILL.md`](../../skills/brain-ingest/SKILL.md) — appends to `_raw/`, creates new theme pages.
- [`skills/brain-lint/SKILL.md`](../../skills/brain-lint/SKILL.md) — orphan detection, conflict surfacing, structural integrity.
- [`skills/brain-query/SKILL.md`](../../skills/brain-query/SKILL.md) — efficient lookup; mandated as the first action of every other skill.

## Success signals

- **Recall:** `benchmarks/brain/questions.json` accuracy ≥80% with correct source-page citations.
- **Coverage:** `brain-gaps.jsonl` rate-of-new-gaps decreases over consecutive cycles.
- **Integrity:** `brain-lint` reports zero structural issues (orphans, malformed frontmatter, duplicate themes).
- **Latency:** `brain-query` p95 response time under 5s with the default model (Haiku).

## Benchmark suite

[`benchmarks/brain/`](../../benchmarks/brain/)
- `questions.json` — Q→expected-source-pages
- `score.ts` — runs queries, scores accuracy + latency + source-correctness

## Known failure modes (to defend against)

- **Episodic learning** — repeating insights every session because nothing's persisted. The brain exists to fix this; mandatory `brain-query` enforces it.
- **Wiki bloat** — `_raw/` grows unbounded. `brain-lint` flags this; periodic archival is part of operations.
- **Stale themes** — content carried from earlier cycles no longer matches reality. `brain-lint` surfaces; `brain-ingest` re-themes.

## TODO (post-scaffold)

- [ ] Run brain seeding Pass A (general best practices) — see [`docs/seeding-plan.md`](../seeding-plan.md).
- [ ] Run brain seeding Pass B (v1 wiki + existing projects).
- [ ] Populate `benchmarks/brain/questions.json` with Pass A success-signal questions.
- [ ] Wire Obsidian vault config (per-user, gitignored).
