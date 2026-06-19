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
- `brain/forge-dev/themes/<theme>.md` — forge-engineering theme page (Brain 1).
- `brain/cycles/themes/<theme>.md` — cross-cycle pattern theme page (Brain 2).
- `<project-repo>/brain/themes/<theme>.md` — project-specific theme page (Brain 3, lives in each project's own repo).
- Updated category indexes (`patterns.md`, `antipatterns.md`, `decisions.md`, `operations.md`, per-project `profile.md`).
- Append to `brain/log.md` for significant operations.

## Skills

- [`skills/brain-ingest/SKILL.md`](../../skills/brain-ingest/SKILL.md) — appends to `_raw/`, creates new theme pages.
- [`skills/brain-lint/SKILL.md`](../../skills/brain-lint/SKILL.md) — orphan detection, conflict surfacing, structural integrity.
- [`skills/brain-query/SKILL.md`](../../skills/brain-query/SKILL.md) — efficient lookup; mandated as the first action of every other skill.

## Success signals

Brain quality is judged on real merged cycles (the brain themes accumulate the evidence), backed by these standing as-built signals:

- **`brain-lint` zero findings** — `forge brain lint` exits non-zero on structural errors (orphans, malformed frontmatter, duplicate themes). This is the standing integrity gate.
- **`brain-gaps.jsonl` trend** — rate of new gaps decreases over consecutive cycles. The gap-flagging rule in [`skills/brain-query/SKILL.md`](../../skills/brain-query/SKILL.md) is load-bearing: answers that name an absence MUST set `gap: true`.
- **Reflector themes cite ≥1 source path** — theme pages produced by the reflector must reference at least one `_raw/` or cycle artifact path (no floating assertions).

## Known failure modes (to defend against)

- **Episodic learning** — repeating insights every session because nothing's persisted. The brain exists to fix this; mandatory `brain-query` enforces it.
- **Wiki bloat** — `_raw/` grows unbounded. `brain-lint` flags this; periodic archival is part of operations.
- **Stale themes** — content carried from earlier cycles no longer matches reality. `brain-lint` surfaces; `brain-ingest` re-themes.

## TODO (post-scaffold)

- [ ] Wire Obsidian vault config (per-user, gitignored).
