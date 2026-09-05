---
title: "_opts-prefixed parameter silently discards tagRange in renderSummaryMarkdown (RF-1 major)"
description: >-
  renderSummaryMarkdown accepted _opts?: { tagRange? } but never read it; runCli passed { tagRange }
  at the call site when --since-tag/--until-tag were active; silently discarded. No AC required the
  combined flag path; no unit test exercised non-null tagRange. The _opts underscore prefix made the
  gap invisible to compiler and linter.
category: antipattern
keywords:
  - renderSummaryMarkdown
  - tagRange
  - _opts
  - silent-discard
  - unused-parameter
  - format.ts
  - acceptance-gap
  - combined-flags
  - review-finding
  - rf-1
related_themes: [2026-09-05-markdown-output-flag-delivery, 2026-08-31-author-filter-compare-coverage-gap, 2026-09-04-compare-path-gap-pre-empted-by-explicit-ac]
created_at: 2026-09-05T02:00:00.000Z
updated_at: 2026-09-05T02:00:00.000Z
---

# `_opts`-unused parameter: silent tagRange discard (RF-1 major)

## What happened

`renderSummaryMarkdown(s: Summary, _opts?: { tagRange?: TagRangeAnnotation })` was implemented with the second parameter prefixed `_opts` — TypeScript/ESLint convention for "declared but intentionally unused". The function body never reads the parameter.

`runCli` at `src/cli.ts:1109` calls `renderSummaryMarkdown(summary, { tagRange })` when `--since-tag`/`--until-tag` are active. The tag-range context is silently dropped. Markdown output omits the `(range sinceTag..untilTag)` annotation that the plain-text, JSON, and CSV renderers all append.

A user running `gitpulse repo --since-tag v1.0.0 --markdown` sees a GFM table with no indication of which date range the data covers — inconsistent with every other output format and potentially misleading.

## Why it was invisible

1. **TypeScript compiler is silent** — `_`-prefixed params suppress the "declared but unused variable" lint rule. The declaration looks intentional.
2. **No AC for combined flags** — the manifest spec for `renderSummaryMarkdown` only required the pure rendering behaviour; no AC required `--since-tag --markdown` combined. The gap was a missing spec, not just a missing test.
3. **Acceptance gate covered only the common path** — `test/acceptance/run.ts` ran `--markdown` on a plain snapshot. No test passed a non-null `tagRange`.

## Class

Same structural class as the `--author` compare-branch gap (RF-1 major, `2026-08-31-author-filter-compare-coverage-gap.md`): a "applies to all paths" invariant was violated by a sub-path that looked covered at the function-signature level but wasn't wired at the body level.

## Prevention

When adding an output-flag renderer that accepts an `opts` struct from the call site, ACs must include:
- A unit test passing every meaningful `opts` field and asserting the output reflects it.
- An acceptance-tier assertion for any combined flag path (e.g. `--since-tag --markdown`).

The `_opts` prefix is a red flag in PR review: if the parameter is a pass-through from the call site, it should be `opts`, not `_opts`, and should be read. Review should flag `_opts` on any parameter that the call site actually populates.

## Sources

- `_logs/INIT-2026-09-05-init-2026-09-05-markdown-output-flag/artifacts/review-findings.json` — RF-1 major detail
- `_logs/2026-09-05T01-20-18_INIT-2026-09-05-init-2026-09-05-markdown-output-flag/events.jsonl` — `review.findings.authored` (1 major)
- `/home/parso/forge-m5-a/brain/cycles/_raw/2026-09-05T01-20-18_INIT-2026-09-05-init-2026-09-05-markdown-output-flag.md`

## See also

- [[2026-09-05-markdown-output-flag-delivery]] — the initiative where RF-1 was found
- [[2026-08-31-author-filter-compare-coverage-gap]] — prior same-class gap (compare branch silently skipped)
- [[2026-09-04-compare-path-gap-pre-empted-by-explicit-ac]] — how explicit ACs prevented recurrence of the compare-branch class in the next cycle; same prevention strategy needed here
