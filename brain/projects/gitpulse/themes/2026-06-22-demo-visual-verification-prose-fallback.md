---
title: Demo reverted to prose descriptions instead of real before/after visual verification
description: >-
  Operator note on the --compare cycle: the demo artifact described the visual
  changes in prose ("before/after notes") instead of capturing the actual CLI
  before/after output. Root cause was a forge wiring gap, now fixed.
category: antipattern
keywords:
  - demo
  - visual-verification
  - before-after
  - forge-demo-capture
  - cli-diff
related_themes: [git-truth-and-pure-aggregation]
created_at: 2026-06-22T00:00:00.000Z
updated_at: 2026-06-23T00:00:00.000Z
---

# Demo must show REAL captured before/after output, not prose

## Operator note (recovered)

From the `--compare` cycle reflection (`user-feedback.md`), the operator flagged:

> "The demo artifact in this run did not generate the actual before after/visual
> artifacts — it reverted to generating the text descriptions of visual changes."

The note landed after the reflector had already closed, so it was not distilled
into a theme at the time — it is recovered here.

## Root cause (forge, not gitpulse)

The demo had no `command`-bearing checkpoints, so every checkpoint fell back to
the prose `beforeNote`/`afterNote`. Two forge gaps combined:

1. **The unifier was never told to capture.** Its iteration prompt
   (`orchestrator/unifier-invocation.ts`) and `skills/developer-unifier/SKILL.md`
   said only `forge demo render` — never `forge demo capture` nor the checkpoint
   `command` field. `skills/demo/SKILL.md` documented capture correctly, but the
   composed skill alone was not reliably reached.
2. **Capture was silently skipped on an imperfect build.** `captureCheckpoints`
   (`cli/demo.ts`) did `if (!status.ok) continue`, so a fresh-worktree `npm run
   build` failure zeroed ALL capture — even though gitpulse's committed `dist/`
   runs fine. CLI-output capture now runs independently of the build result.

## Fix + the gitpulse-side discipline

- Set `command` on every behavioural checkpoint to the exact argv whose stdout IS
  the evidence (the built CLI invocation), leave `beforeOutput`/`afterOutput`
  empty, and let `forge demo capture` back-fill the real before(main)/after(HEAD)
  terminal output the review page renders side-by-side. Prose notes are a caption
  of last resort, never the visual verification.
- For a NEW flag the "before" run legitimately errors (`unknown option
  "--compare"`) — that error IS the honest before evidence.
- gitpulse hygiene gap: the project is missing `@types/node` as a devDep, so a
  hermetic `npm ci && npm run build` in a fresh worktree fails type-checking
  (the committed `dist/` still runs). Add `@types/node` so the build is hermetic.

See [[2026-06-22-single-iteration-tdd-with-4-wi-chain]] for this cycle's build,
and [[git-truth-and-pure-aggregation]] for the analytics contract the demo proves.

## Sources

- `_logs/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta/user-feedback.md` — operator note: "demo artifact reverted to prose descriptions instead of real before/after visual artifacts"
- `/home/parso/forge/brain/cycles/_raw/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta.md`

## See also

- [[git-truth-and-pure-aggregation]] — the analytics contract the demo is meant to prove
