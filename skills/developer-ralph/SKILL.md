---
name: developer-ralph
description: Launch the Ralph loop runner for a single work item; iterate until quality gates pass, iteration budget is exhausted, or the loop is detected as wedged.
phase: developer-loop
surface: unattended
model: claude-sonnet-4-6
---

# Developer — Ralph

## Single responsibility

Drive a single work item to completion via the Ralph loop pattern ([ADR 002](../../docs/decisions/002-ralph-loop-pattern.md)). The skill is a thin wrapper that prepares the loop's input artifacts (`PROMPT.md`, `AGENT.md`, `fix_plan.md`) and invokes [`loops/ralph/runner.ts`](../../loops/ralph/runner.ts).

## Required first action

Invoke `brain-query` with:

- "What patterns apply to <work-item-type>?"
- "What antipatterns should be avoided based on <files_in_scope>?"
- "Has the brain seen a similar work item before? If so, what was learned?"

The brain query result becomes part of the initial `AGENT.md` content (institutional memory the loop carries across iterations).

## Inputs

- `<worktree>/.forge/work-items/WI-<n>.md` — the work-item spec.
- `loops/ralph/PROMPT.md.tmpl` — template for the per-iteration prompt.
- `loops/ralph/AGENT.md.tmpl` — template for institutional memory.
- The worktree itself (the developer loop runs in the worktree).

## Outputs

- Commits in the worktree (one per acceptance criterion where possible).
- `<worktree>/AGENT.md` — final institutional memory (loop bookkeeping; the agent updates this each iteration).
- `<worktree>/fix_plan.md` — checklist showing remaining work if the loop didn't complete (loop bookkeeping; the agent ticks items each iteration).
- Iteration events to the event log.

> **Status frontmatter is owned by the orchestrator, not the agent.** Do not edit `<worktree>/.forge/work-items/WI-<n>.md` — the orchestrator writes `status: complete | failed` after `run()` returns. The agent's job is the code change, not the bookkeeping.

## Event-log entries to emit

- `ralph.start` — loop initiated for a work item.
- `ralph.iteration` — one event per iteration with iteration number, cost, duration, files touched.
- `ralph.brain-query` — every brain query within the loop.
- `ralph.stop-condition` — when the loop exits, which condition fired.
- `ralph.end` — loop complete.

## Benchmark suite

[`benchmarks/developer-loop/`](../../benchmarks/developer-loop/) — `work-items/<n>/` fixtures + `score.ts`.

## Process

1. **Brain query first** — populate initial `AGENT.md` with relevant patterns/antipatterns.
2. Read the work item spec.
3. Stamp `loops/ralph/PROMPT.md.tmpl` with the work-item content + acceptance criteria → `<worktree>/PROMPT.md`.
4. Stamp `loops/ralph/AGENT.md.tmpl` with the brain-query results → `<worktree>/AGENT.md`.
5. Initialise `<worktree>/fix_plan.md` with the acceptance criteria as a checklist.
6. Invoke `loops/ralph/runner.ts` with the worktree path and stop-condition config (from initiative manifest's `iteration_budget` and `cost_budget_usd`).
7. The runner returns: `{ status: 'complete' | 'failed' | 'wedged', iterations: n, cost: usd }`. The orchestrator writes `status` back to the WI spec — the skill does not.

## Constraints

- **Quality gates verified by the orchestrator, not the agent.** The runner runs `npm test` / `npm run lint` / etc. itself; the agent's claim of "tests pass" is not trusted (carried-over v1 lesson).
- **Iteration budget is hard.** The runner stops at `iteration_budget` regardless of progress.
- **Wedged-detector** — see [`loops/ralph/stop-conditions.ts`](../../loops/ralph/stop-conditions.ts).
