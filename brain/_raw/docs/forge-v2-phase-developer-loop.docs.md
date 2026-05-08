---
source_type: docs
source_url: docs/phases/developer-loop.md
source_title: Forge v2 — Phase: Developer Loop
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 3)
cycle_id: pass-a-bootstrap
---

# Phase: Developer Loop

> *Unattended.* Ralph loop pattern over Claude Agent SDK. Iterates per work item until quality gates pass.

## Purpose

Take a work item and drive it to "complete" (quality gates pass + acceptance criteria met) via Ralph loop pattern. Multiple developer loops run in parallel across worktrees, coordinated by the scheduler.

## Inputs

- `<worktree>/.forge/work-items/<work-item-id>.md` (work item spec from PM).
- `loops/ralph/PROMPT.md.tmpl` (template stamped per work item).
- `loops/ralph/AGENT.md.tmpl` (institutional memory template; per-worktree state).
- Brain knowledge (queried at iteration 1 and on demand).

## Outputs

- Commits in worktree (atomic per acceptance criterion where possible).
- `<worktree>/.forge/work-items/<work-item-id>.md` — frontmatter `status` updated to `complete` or `failed`.
- `<worktree>/AGENT.md` — final institutional memory.
- Iteration events in `_logs/<cycle-id>/events.jsonl`.

## Loop runtime

- `loops/ralph/runner.ts` — driver.
- `loops/ralph/stop-conditions.ts` — quality-gates-pass | iteration-budget | wedged-detector.
- `loops/_adapters/` — placeholders for hermes/aider/openhands as alternative loop runtimes.

## Success signals

- **Iterations to green:** median iterations per work item ≤ 3.
- **Cost per work item:** ≤ $0.50 (target).
- **Quality gate pass rate:** ≥ 95% on first acceptance-criterion verification.
- **Wedge rate:** ≤ 5% of work items hit `iteration_budget` without completing.
- **Merge success:** initiative-branch quality gates pass after all work items merge.

## Known failure modes

- **Wedged loops** — Ralph never converges. `stop-conditions.ts` includes a wedged-detector (no progress for N iterations → abort).
- **Token burn on no-op iterations** — iteration budget caps; cost budget per initiative caps harder.
- **Hallucinated test passes** — quality gate verification runs in orchestrator, not agent (carried-over v1 lesson).
- **Merge conflicts across parallel loops** — handled by per-work-item branches off initiative branch + orchestrator-level rebase.
