---
title: Adversarial review crashes with spawnSync git ENOBUFS when cumulative initiative diff is large
description: When the initiative diff reaches ~70 files / 1500 lines the adversarial review's git derivation step crashes with ENOBUFS on the unattributed chunk; no findings artifact is produced.
category: antipattern
keywords: [adversarial-review, enobufs, git-derivation, large-diff, spawnSync, review-loop, crash, unattributed-chunk, no-findings]
created_at: 2026-10-13T00:00:00Z
updated_at: 2026-10-13T00:00:00Z
related_themes: [2026-10-10-adversarial-review-stale-findings-after-send-back]
---

## What happened

I3a ended with a 69-file, 1473-insertion diff (3 dev-loop runs + 2 send-backs accumulated changes). At the adversarial review phase (11:40), the pipeline emitted:

```
derive-failed: git derivation error for chunk unattributed: spawnSync git ENOBUFS
```

`ENOBUFS` means the `spawnSync` buffer allocated for `git diff` output was exceeded. The chunk labelled "unattributed" (diff lines not attributable to a specific WI) is passed to `spawnSync` as a single string argument or piped through a fixed-size buffer. When the cumulative diff is large enough, the buffer overflows.

Result: no adversarial review findings artifact was produced; the verdict gate proceeded without a review.

## What this means

Large send-back initiatives (3+ rounds, 50+ files) are exactly where adversarial review is most valuable — and exactly where it crashes. The crash is silent from the operator's perspective: the verdict gate proceeds with zero findings, which looks like "review found nothing" rather than "review did not run."

The event log records `review.input.derive-error` + a second error event with the full message. The `report.md` or closure summary must note the missing review.

## Fix direction

- Chunk the git diff into smaller pieces before spawning (per-WI attribution already does this; the unattributed pass needs the same treatment).
- Or use `exec` (async with stream) instead of `spawnSync` (sync with fixed buffer) for large diffs.
- Surface `derive-failed` as a distinct verdict-gate outcome — not as "review found nothing."

## Operator answers

Confirmed: the I3a round-3 verdict was taken without adversarial review because of this ENOBUFS crash; independent verification stood in for it. Bead `nk1y.39` tracks the fix. (Free-form feedback, 2026-10-13.)

## See also

- [[2026-10-10-adversarial-review-stale-findings-after-send-back]] — companion forge-machinery gap in the adversarial review phase

## Sources

- `_logs/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path/events.jsonl` (error events at 2026-10-12T11:40:44)
- `brain/cycles/_raw/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path.md`
