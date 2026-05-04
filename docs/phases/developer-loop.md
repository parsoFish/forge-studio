# Phase: Developer Loop

> *Unattended.* Ralph loop pattern over Claude Agent SDK. Iterates per work item until quality gates pass.

## Purpose

Take a work item and drive it to "complete" (quality gates pass + acceptance criteria met) via the Ralph loop pattern. Multiple developer loops run in parallel across worktrees, coordinated by the scheduler.

## Inputs

- `<worktree>/.forge/work-items/<work-item-id>.md` (the work item spec from the PM).
- `loops/ralph/PROMPT.md.tmpl` (template stamped per work item).
- `loops/ralph/AGENT.md.tmpl` (institutional memory template; per-worktree state).
- Brain knowledge (queried at iteration 1 and on demand).

## Outputs

- Commits in the worktree (atomic per acceptance criterion where possible).
- `<worktree>/.forge/work-items/<work-item-id>.md` — frontmatter `status` updated to `complete` or `failed`.
- `<worktree>/AGENT.md` — final institutional memory (what was tried, what worked, what was learned for next time).
- Iteration events in `_logs/<cycle-id>/events.jsonl`.

## Skills

- [`skills/developer-ralph/SKILL.md`](../../skills/developer-ralph/SKILL.md) — the entry point that the orchestrator's `cycle.ts` invokes.

## Loop runtime

- [`loops/ralph/runner.ts`](../../loops/ralph/runner.ts) — driver.
- [`loops/ralph/stop-conditions.ts`](../../loops/ralph/stop-conditions.ts) — quality-gates-pass | iteration-budget | wedged-detector.
- [`loops/_adapters/`](../../loops/_adapters/) — placeholders for hermes/aider/openhands as alternative loop runtimes.

## Success signals

- **Iterations to green:** median iterations per work item ≤ 3 (lower is better).
- **Cost per work item:** ≤ $0.50 (target; surfaced via metrics).
- **Quality gate pass rate:** ≥ 95% on first acceptance-criterion verification.
- **Wedge rate:** ≤ 5% of work items hit `iteration_budget` without completing.
- **Merge success:** initiative-branch quality gates pass after all work items merge.

## Benchmark suite

[`benchmarks/developer-loop/`](../../benchmarks/developer-loop/)
- `work-items/<n>/` — spec + reference implementation + tests.
- `score.ts` — runs the Ralph loop against each fixture, scores iterations / cost / gate pass.

## Known failure modes (to defend against)

- **Wedged loops** — Ralph never converges. `stop-conditions.ts` includes a wedged-detector (no progress for N iterations → abort).
- **Token burn on no-op iterations** — iteration budget caps this; cost budget per initiative caps it harder.
- **Hallucinated test passes** — quality gate verification runs in the orchestrator, not the agent (carried-over v1 lesson).
- **Merge conflicts across parallel loops** — handled by per-work-item branches off the initiative branch + orchestrator-level rebase before declaring a feature complete.

## TODO (post-scaffold)

- [ ] Wire the Claude Agent SDK in `runner.ts` past skeleton.
- [ ] Implement quality-gates-pass stop condition (delegates to per-project `npm test` / `npm run lint` / `gh pr checks`).
- [ ] Implement wedged-detector (no-progress heuristic).
- [ ] Populate `benchmarks/developer-loop/work-items/` with 5-10 reference fixtures of varying difficulty.
