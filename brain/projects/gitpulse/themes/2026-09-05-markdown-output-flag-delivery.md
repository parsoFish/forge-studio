---
title: "--markdown flag: GFM table renderers in format.ts; 3-WI TDD chain, 1 iter each"
description: >-
  The --markdown flag follows the symmetric renderer-pair pattern: 6 new exports in format.ts
  (markdownEscape, gfmTable private, 4 renderers), all 4 CLI code paths wired, mutual exclusion
  with --json/--csv. 3 WIs, all iter=1. RF-1 major: renderSummaryMarkdown silently discards tagRange.
category: pattern
keywords:
  - markdown-output
  - markdownEscape
  - gfmTable
  - renderSummaryMarkdown
  - format.ts
  - cli.ts
  - renderer-pair
  - acceptance-gate
  - single-iteration
  - tdd
related_themes: [2026-06-21-json-output-flag-delivery, 2026-07-11-csv-output-flag-delivery, 2026-09-05-unused-opts-param-silent-tagrange-discard, 2026-09-04-include-path-filter-delivery]
created_at: 2026-09-05T02:00:00.000Z
updated_at: 2026-09-05T02:00:00.000Z
---

# `--markdown` flag: delivery pattern

## What was built

- `src/format.ts`: `markdownEscape(field): string` — replaces `|` → `\|`, no RFC-4180 wrapping (distinct from `csvEscape`). `gfmTable(headers, aligns, rows)` private helper (header row, delimiter row using `---`/`---:` per alignment, data rows). Four public renderers: `renderSummaryMarkdown`, `renderDeltaMarkdown`, `renderTagsMarkdown`, `renderCouplingMarkdown`.
- `src/cli.ts`: `--markdown` flag added to all 3 argv parsers (`runCli`, `runTagsCli`, `runCouplingCli`). Mutual-exclusion guard: `--markdown --json` or `--markdown --csv` → exit non-zero, stderr names both flags. Same dispatch pattern as `--json`/`--csv`.
- `test/format-markdown.test.ts` (new): 43 unit tests — `markdownEscape`, header/delimiter structure, alignment, empty-input, pipe-escape.
- `test/cli-markdown.test.ts` (new): 30 CLI unit tests — all 4 paths, 3 mutual-exclusion combinations, `--help`.
- `test/acceptance/run.ts`: 5 new end-to-end assertions — delimiter row at index 1, Ada Lovelace in `|`-delimited cell, pipe-char file path escaped as `\|`, column-count consistency, compare-branch GFM output.

## WI decomposition

| WI | Scope | Iter | Files | +/- |
|---|---|---|---|---|
| WI-1 | format.ts renderers + format-markdown.test.ts | 1 | 3 | +690/-0 |
| WI-2 | cli.ts wiring + cli-markdown.test.ts | 1 | 2 | +407/-1 |
| WI-3 | acceptance assertions + README + CHANGELOG | 1 | 4 | +156/-18 |
| **Total** | | | **7** | **+1235/-1** |

## Compare-path coverage

AC3 explicitly required `--compare --markdown` wiring (citing prior `--author` compare-branch gap). WI-2 wired it. WI-3 acceptance AC-5 verified it. No review send-back on compare path. Lesson-to-spec propagation held again.

## Review findings

- **RF-1 (major):** `renderSummaryMarkdown` accepts `_opts?: { tagRange? }` but never reads it. `runCli` passes `{ tagRange }` at line 1109 when `--since-tag`/`--until-tag` are active — silently discarded. Markdown mode omits range annotation; plain/JSON/CSV all emit it. No AC required `--since-tag --markdown` combined; no test exercised non-null tagRange. Needs a follow-up WI.
- **RF-2 (minor):** Acceptance has no e2e assertions for `tags --markdown` or `coupling --markdown` against the real built binary.
- **RF-3 (info):** `_opts` underscore prefix convention mismatch.

Review: 0 blockers, review.agent-pass. PR #16 merged; CI green (v0.15.0).

## Sources

- `_logs/2026-09-05T01-20-18_INIT-2026-09-05-init-2026-09-05-markdown-output-flag/events.jsonl`
- `/home/parso/forge-m5-a/brain/cycles/_raw/2026-09-05T01-20-18_INIT-2026-09-05-init-2026-09-05-markdown-output-flag.md`

## See also

- [[2026-06-21-json-output-flag-delivery]] — `--json` symmetric renderer-pair, the pattern `--markdown` follows
- [[2026-07-11-csv-output-flag-delivery]] — `--csv` extends the same pair
- [[2026-09-05-unused-opts-param-silent-tagrange-discard]] — RF-1: the `_opts`-unused antipattern from this delivery
- [[2026-09-04-include-path-filter-delivery]] — prior cycle structural twin; also 3-WI TDD, all iter=1
