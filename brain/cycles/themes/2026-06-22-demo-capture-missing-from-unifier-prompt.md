---
title: Unifier prompt omits `forge demo capture`; `captureCheckpoints` silently skips on build failure
description: >-
  The unifier-invocation prompt only says `forge demo render` — never `forge
  demo capture`. A secondary bug causes captureCheckpoints to skip ALL capture
  when the fresh-worktree build is non-zero, so demos fall back to prose
  beforeNote/afterNote instead of real CLI output.
category: antipattern
keywords:
  - unifier
  - forge-demo-capture
  - captureCheckpoints
  - demo-capture
  - silent-skip
  - wiring-gap
created_at: 2026-06-22T00:00:00.000Z
updated_at: 2026-06-22T00:00:00.000Z
---

# Unifier prompt omits `forge demo capture`; `captureCheckpoints` silently skips on build failure

## Pattern observed

In the compare-ref-analytics-delta cycle the demo artifact contained `beforeNote`/`afterNote` prose descriptions rather than captured CLI output. Operator confirmed: "The demo artifact in this run did not generate the actual before after/visual artifacts — it reverted to generating the text descriptions of visual changes."

Two forge gaps combined:

1. **`forge demo capture` absent from unifier prompt.** `orchestrator/unifier-invocation.ts` and `skills/developer-unifier/SKILL.md` instruct the unifier to run `forge demo render` — never `forge demo capture`. Without an explicit capture step, every checkpoint falls back to prose `beforeNote`/`afterNote`.

2. **`captureCheckpoints` silently skips on non-zero build.** `cli/demo.ts:captureCheckpoints` did `if (!status.ok) continue`, so a fresh-worktree `npm run build` failure zeroed ALL capture — even though the committed `dist/` in the worktree runs fine. CLI-output capture should run independently of the build result.

## Why it matters

`forge demo capture` is the ONLY path to real CLI before/after stdout side-by-side in the review page. Without it, every demo is prose-only and provides no visual evidence of the change. This has happened at least once per unifier-using initiative since demo capture was introduced.

## Fix

- Add `forge demo capture <init-id>` (run from the worktree root) as a mandatory step in `skills/developer-unifier/SKILL.md` and `orchestrator/unifier-invocation.ts`, before `forge demo render`.
- Fix `captureCheckpoints` to run CLI-output capture regardless of `npm run build` exit code — use the committed `dist/` when the build fails.
- For flags that are NEW on HEAD (like `--compare`), the "before" run legitimately errors — that error IS the honest before evidence; do not suppress it.

## Sources

- `_logs/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta/user-feedback.md` — operator note: "The demo artifact in this run did not generate the actual before after/visual artifacts"
- `/home/parso/forge/brain/cycles/_raw/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta.md`
- Prior related: `brain/cycles/themes/2026-06-21-unifier-demo-render-discovery.md` — adjacent unifier/demo wiring gap
