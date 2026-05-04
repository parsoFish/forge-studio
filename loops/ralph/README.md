# Ralph Loop

> Implementation of the [Ralph loop pattern](https://ghuntley.com/ralph/) over the Claude Agent SDK.

## The pattern

```
loop:
  read PROMPT.md, AGENT.md (institutional memory), specs/, fix_plan.md
  call query() against the worktree
  commit changes (when the agent makes them)
  check stop conditions (quality gates pass | iteration budget | wedged)
  if stop: exit
  else: update fix_plan.md with what's left, repeat
```

The pattern is *brute repetition with institutional memory*. Each iteration:

1. Re-reads `PROMPT.md` (the spec, stamped from the work item).
2. Re-reads `AGENT.md` (what the agent has tried, what worked, what didn't — written by previous iterations).
3. Re-reads `fix_plan.md` (what's still broken — a checklist).
4. Has one shot at making progress.
5. Updates `AGENT.md` with what it learned and `fix_plan.md` with what's left.

"Eventual consistency" via repetition.

## Files

- [`runner.ts`](./runner.ts) — the driver implementing the `LoopInput`/`LoopResult` interface from [`loops/README.md`](../README.md).
- [`stop-conditions.ts`](./stop-conditions.ts) — quality-gates-pass | iteration-budget | wedged-detector.
- [`PROMPT.md.tmpl`](./PROMPT.md.tmpl) — template stamped per work item.
- [`AGENT.md.tmpl`](./AGENT.md.tmpl) — institutional-memory template, populated initially from brain-query results.

## Stop conditions

The loop exits when **any one** condition fires:

- **Quality gates pass.** The orchestrator runs the project's quality gates (e.g. `npm test`, `npm run lint`, `gh pr checks`). The agent's claim of "it works" is not trusted — orchestrator-side verification only.
- **Iteration budget exhausted.** From the initiative manifest's `iteration_budget`. Hard limit.
- **Cost budget exhausted.** From the initiative manifest's `cost_budget_usd`. Hard limit.
- **Wedged.** No progress detected over N consecutive iterations (default 3). "Progress" = files changed + `fix_plan.md` has fewer outstanding items.

## Why Ralph specifically

- **Pattern, not a framework.** ~30 lines of driver code; we own everything that matters.
- **Agent-swappable.** The underlying agent (Claude Agent SDK here) can be replaced with Aider, Hermes, etc., without changing the pattern. Future adapters under `loops/_adapters/`.
- **Spec/PRD shape matches forge.** `PROMPT.md` is exactly the work-item spec the project manager emits.
- **Loggable per iteration.** Each iteration emits one event-log entry — perfect input for the reflector.
- **Battle-tested.** Anthropic, Vercel, Geoffrey Huntley, and the community have shipped reference implementations.

## Status

Skeleton (scaffold). The Claude Agent SDK wiring, real stop conditions, and full per-iteration commit/log discipline land in subsequent sessions per the developer-loop phase doc.
