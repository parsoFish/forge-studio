---
title: Manifest re-grounding annotation as operator override surface
description: An operator-written "Re-grounding — READ FIRST" prose block in the manifest is an effective override surface; PM reads it on retry and produces correct decomposition. Requeue is the recovery path when the first run ignores it.
category: pattern
created_at: 2026-06-12T12:47:08Z
updated_at: 2026-06-12T12:47:08Z
---

# Manifest re-grounding annotation as operator override surface

## Pattern

When a manifest becomes stale (repo has moved; prior ACs already satisfied; wrong gate targets), the operator can append a `## Re-grounding (YYYY-MM-DD, operator) — READ FIRST` prose block to the manifest before requeueing. The PM reads the full manifest including this block and adjusts decomposition accordingly.

Observed in INIT-2026-06-08-release-acceptance-test-fixes:

- Run 1: annotation present but PM ignored it → gate-too-loose, 0/3 WIs, total failure.
- Requeue (no manifest change needed): run 2 → PM produced correct decomposition with new test names; 3/3 WIs completed 1 iteration each.

## Why it works

The annotation is in the same markdown file the PM reads. On retry the PM is fresh-context; the annotation is the first signal about what has changed since the manifest was authored. If the annotation is explicit ("do NOT use X as gate") the PM follows it.

## Limits

- Does not guarantee compliance on the first run (as this cycle shows).
- Prose annotations can be ignored if the PM weights formal YAML fields more heavily.
- If the annotation is ignored again on retry, a second requeue may be needed.

## When to apply

Any time:
1. The manifest was authored days before the run.
2. The repo has advanced (earlier ACs already satisfied, tests already passing).
3. The PM is likely to pick stale targets without guidance.

## Sources

- `_logs/2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes/events.jsonl` — cycle.start run 2 at 12:26:14, pm.work-item-emitted ×3 at 12:29:08 (correct decomposition)
- `brain/cycles/_raw/2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes.md`
