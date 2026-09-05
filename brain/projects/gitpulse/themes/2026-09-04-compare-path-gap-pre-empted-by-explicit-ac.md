---
title: "Adversarial review finding embedded as explicit AC prevents compare-path silent-discard from recurring"
description: >-
  Prior cycle's RF-1 major (--author silently discarded on --compare path) was converted to an explicit
  acceptance criterion (AC-2.2) and acceptance assertion (AC-5) in this cycle's manifest. No review
  send-back. Lesson-to-spec propagation via brain → PM → WI ACs is the effective prevention path.
category: pattern
keywords:
  - compare-path
  - explicit-ac
  - silent-discard
  - acceptance-coverage
  - review-finding
  - prevention
  - ac-enumeration
  - all-code-paths
  - filter-flag
  - spec-discipline
related_themes: [2026-08-31-author-filter-compare-coverage-gap, 2026-09-04-include-path-filter-delivery, 2026-06-21-acceptance-gate-covers-only-headline-output, 2026-08-31-author-filter-flag-delivery]
created_at: 2026-09-04T16:06:03.000Z
updated_at: 2026-09-04T16:06:03.000Z
---

# Compare-path gap pre-empted by explicit AC

## What happened

Prior cycle (`INIT-2026-08-31-author-filter-flag`): `filterAuthorCommits()` was wired into 3 of 4 CLI code paths. The compare branch (`if (compare !== null)`) was skipped. Adversarial review caught it as RF-1 major. Theme page `2026-08-31-author-filter-compare-coverage-gap.md` indexed the lesson.

This cycle (`INIT-2026-09-04-include-path-filter-flag`): the manifest embedded the prior finding as:

- **AC-2.2**: "Compare path (`if (compare !== null)`): include filter applied to BOTH `headCommits` and `baseCommits` before `summarize()`. This path caused the `--author` compare-branch gap (RF-1 major); explicit AC prevents recurrence." (with citation to the prior theme page)
- **Acceptance AC-5**: `--compare <base> --include 'src/**'` → delta report reflects only `src/` files; assert compare output differs from unfiltered compare.

Result: WI-2 wired `applyInclusions` in the compare branch. WI-3 acceptance test verified it. No review send-back. Clean merge.

## Prevention chain

1. **Adversarial review finds gap** → review finding documented in retro
2. **Reflector writes theme page** (`2026-08-31-author-filter-compare-coverage-gap.md`) with prevention guidance: "enumerate every distinct code path when a new filter/flag is added"
3. **PM reads brain** (brain context table in manifest cites the theme) → embeds specific compare-path AC with RF-1 citation
4. **WI-2 AC** mandates compare-path wiring → ralph implements it
5. **WI-3 acceptance assertion** (AC-5) verifies it under the quality gate
6. **No review send-back** — gap doesn't recur

## Generalisation

When adding any flag that "applies to all code paths" in `src/cli.ts`, the manifest should enumerate every **distinct aggregation pipeline** as a named AC sub-item:
1. Single-snapshot path (`runCli`)
2. Compare path (`if (compare !== null)` block within `runCli`)
3. Tags subcommand (`runTagsCli`)
4. Coupling subcommand (`runCouplingCli`)

The compare path is the recurring gap because it is a sub-path of `runCli`, not a separate top-level function, and is easy to treat as "covered" by the general "runCli wired" AC.

## Sources

- `_logs/2026-09-04T15-35-29_INIT-2026-09-04-include-path-filter-flag/events.jsonl` — `review.agent-pass`, `reviewer.pr-opened` (PR #15, no send-back)
- `_queue/merged/INIT-2026-09-04-include-path-filter-flag.md` — AC-2.2 and AC-5 with RF-1 citation
- `/home/parso/forge-m5-a/brain/cycles/_raw/2026-09-04T15-35-29_INIT-2026-09-04-include-path-filter-flag.md`

## See also

- [[2026-08-31-author-filter-compare-coverage-gap]] — the gap this AC prevented from recurring
- [[2026-09-04-include-path-filter-delivery]] — the initiative this prevention occurred in
- [[2026-06-21-acceptance-gate-covers-only-headline-output]] — original pattern: acceptance covering only the headline path
- [[2026-08-31-author-filter-flag-delivery]] — the prior cycle where the gap first appeared
