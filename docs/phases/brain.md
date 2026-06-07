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

> Note (2026-05-25): the `benchmarks/` harnesses were removed; the deterministic-metric / LLM-judge thresholds below are **historical**. Phase quality is now judged on real merged cycles.

**Current success signals** (as-built):

- **`brain-lint` zero findings** — `forge brain lint` exits non-zero on structural errors (orphans, malformed frontmatter, duplicate themes). This is the standing integrity gate.
- **`brain-gaps.jsonl` trend** — rate of new gaps decreases over consecutive cycles. The gap-flagging rule in [`skills/brain-query/SKILL.md`](../../skills/brain-query/SKILL.md) is load-bearing: answers that name an absence MUST set `gap: true`.
- **Reflector themes cite ≥1 source path** — theme pages produced by the reflector must reference at least one `_raw/` or cycle artifact path (no floating assertions).

**Historical signals** (benchmarks removed 2026-05-25):

- Recall ≥80% under `0.4 × source_recall + 0.6 × keyword_match` rubric (`benchmarks/brain/questions.json`).
- Hallucination rate ≤5% (no cited path absent from disk).
- Gap detection pass rate ≥80% (`benchmarks/brain/negatives.json`).
- LLM-judge (Opus) agreement ≥85%; judge pass rate ≥90%.
- `brain-query` p95 ≤15s (Haiku).

**Coverage signal:**

- `brain-gaps.jsonl` rate-of-new-gaps decreases over consecutive cycles. The gap-flagging rule in [`skills/brain-query/SKILL.md`](../../skills/brain-query/SKILL.md) is load-bearing here — answers that name an absence MUST set `gap: true`.

## Benchmark suite

> Note (2026-05-25): the `benchmarks/` harnesses were removed; this section is historical. Phase quality is now judged on real merged cycles.

`benchmarks/brain/` (removed)
- `questions.json` — Q→expected-source-pages (primary recall suite, 18 cases)
- `negatives.json` — gap-detection suite (out-of-scope / forge-adjacent-bait / partial-match, 10 cases)
- `score.ts` — primary runner (recall + keyword + hallucination check)
- `score-negatives.ts` — gap-detection runner
- `score-judged.ts` — Opus LLM-judge over the latest primary result (validates the deterministic metric)
- `judge.ts` — judge invocation logic (reusable for other phases)
- Run via: `npm run bench:brain`, `npm run bench:brain:negatives`, `npm run bench:brain:judge`

## Known failure modes (to defend against)

- **Episodic learning** — repeating insights every session because nothing's persisted. The brain exists to fix this; mandatory `brain-query` enforces it.
- **Wiki bloat** — `_raw/` grows unbounded. `brain-lint` flags this; periodic archival is part of operations.
- **Stale themes** — content carried from earlier cycles no longer matches reality. `brain-lint` surfaces; `brain-ingest` re-themes.

## TODO (post-scaffold)

- [x] Run brain seeding Pass A (general best practices) — complete.
- [x] Run brain seeding Pass B (v1 wiki + existing projects) — complete.
- ~~Populate `benchmarks/brain/questions.json`~~ — benchmarks removed 2026-05-25; superseded by real-cycle quality signal.
- [ ] Wire Obsidian vault config (per-user, gitignored).
