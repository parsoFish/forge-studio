---
title: Tags command — release-cadence subcommand delivery
description: gitpulse tags subcommand (release-cadence table with JSON/CSV/filter support) delivered via 4-WI TDD chain; WI-1+WI-2 in 1 iter each, WI-3+WI-4 absorbed by unifier in 1 iter.
category: pattern
keywords: [tags, release-cadence, subcommand, readTags, computeTagSpans, git-seam, single-iteration, tdd]
related_themes: [2026-07-11-csv-output-flag-delivery, 2026-07-11-exclude-path-filter-single-seam]
created_at: 2026-07-11
updated_at: 2026-07-11
---

## Pattern

`gitpulse tags` adds a second analytics mode. Architecture follows the established gitpulse seam pattern:

- **Git seam** (`src/git.ts`): `readTags(repoPath)` — `git tag -l --sort=-creatordate --format=...` returns tags sorted newest-first with `{ name, date, sha }` for both annotated and lightweight tags. `readCommitsBetweenTags(repoPath, prevSha, currSha, excludePaths?)` — per-span `git log` calls, exclude-path filtering at the file level per commit.
- **Pure analytics** (`src/tags.ts`): `computeTagSpans(tags, commitsPerSpan)` → `TagSpan[]`; `computeMedianGapDays(spans)` → `number | null`.
- **Rendering** (`src/format.ts`): `renderTags(spans, medianGapDays)` (text table, right-aligned columns), `tagsToJson(spans, medianGapDays)`, `tagsToCSV(spans, medianGapDays)`.
- **CLI dispatch** (`src/cli.ts`): positional-arg subcommand router; `tags` subcommand calls git seam → analytics → renderer → stdout.

WI-1 (git seam): gate.expected-fail iter 0 → 13 tests, gate.pass iter 1.
WI-2 (analytics): gate.expected-fail iter 0 → 17 tests, gate.pass iter 1 (second attempt after merge-conflict requeue).
WI-3 (format.ts rendering) + WI-4 (CLI + acceptance fixture): absorbed by unifier UWI-1 in 1 iteration, all gate sub-checks PASS.

Final delivery: 11 files, +1481 −4 lines, 7 commits.

## Design decisions

- Per-span `git log` calls (N git invocations, one per tag gap) preferred over full-history-in-memory for correctness with exclude-path filtering.
- Day arithmetic via Unix-epoch floor-divide on YYYY-MM-DD strings — zero new runtime deps.
- Positional-arg subcommand router in `runCli()` — first positional = subcommand or legacy path; backward-compatible.

## Sources

- `_logs/2026-07-11T16-18-59_INIT-2026-07-11-init-2026-07-12-tags-command/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-07-11T16-18-59_INIT-2026-07-11-init-2026-07-12-tags-command.md`

## See also

- [[2026-07-11-csv-output-flag-delivery]] — tags reuses the CSV renderer family (tagsToCSV)
- [[2026-07-11-exclude-path-filter-single-seam]] — tags reuses the exclude-path filtering per commit
