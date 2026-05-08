---
title: Review-fix loop spinning — SHA-guard missing
description: One v1 Cycle 1 merge produced 70+ review-fix cycles overnight. 40-60% of $451 Cycle 1 spend wasted. SHA-change guard + worktree isolation + chain consolidation are the fix.
category: antipattern
keywords: [review-fix-loop, sha-guard, infinite-loop, cycle-1, $200-waste, progress-verification]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: [wedged-loop-detector, quality-gates-orchestrator-verified, gh-cli-and-worktrees]
---

# Review-fix loop spinning — SHA-guard missing

In v1 Cycle 1, one merge produced **70+ review-fix cycles overnight**. The same fix attempt reran, the same review rejected it. **Review-fix waste accounted for 40–60% of the total $451 Cycle 1 spend** ($200+ on a single merge).

Three missing safeguards:

1. **No SHA-change guard** — verify each fix attempt actually changed code before re-reviewing.
2. **No progress verification** — detect that the loop is stuck (no diff between iterations).
3. **No chain consolidation** — collapse multiple fix rounds into a single PR rather than stacking review-fix-review-fix commits.

Fix required four separate changes:

- **Worktree isolation** (so SHA-comparison is meaningful — no shared dev state).
- **SHA guard** — verify `git rev-parse HEAD` differs between fix attempts; if not, the fix produced no commit, abort.
- **Chain consolidation** — squash accumulated fix commits into the original PR.
- **Progress verification** — detect no-progress loops after N turns and escalate to human triage.

Core lesson: **every automated loop needs a termination condition based on objective evidence of progress, not just "the agent says it's done."**

In v2 the fix is structural: Ralph's wedged-loop detector + orchestrator-verified quality gates + worktree-per-claim from the unattended scheduler — all three together close this hole.

## Sources

- [`v1-themes-failure-modes.cycle.md`](../../_raw/v1-wiki/v1-themes-failure-modes.cycle.md) — full design + Cycle 1 numbers.

## Related

- [Theme: Wedged loop detector](./wedged-loop-detector.md) — the structural fix in v2.
- [Theme: Quality gates orchestrator-verified](./quality-gates-orchestrator-verified.md) — the trust-model fix.
- [Theme: gh CLI + worktrees](./gh-cli-and-worktrees.md) — the isolation that makes SHA-guard work.
