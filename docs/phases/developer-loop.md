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

[`benchmarks/developer-loop/`](../../benchmarks/developer-loop/) — five fixtures, one per managed project.
- `fixtures/<id>/` — seed worktree (source files + tests) plus `.forge/work-items/WI-1.md` (the WI spec) plus a failing acceptance test.
- `cases.json` — catalogue with per-fixture `quality_gate_cmd` + `pre_existing_tests_cmd` + budgets.
- `scoring.ts` — pure rubric (gate `terminated_cleanly`; weighted criteria for `loop_completed`, `iteration_budget_respected`, `cost_budget_respected`, `files_in_scope_respected`, `no_regression`; pass threshold 0.7).
- `sdk.ts` — per-fixture tempdir + runDevLoop entrypoint (shared with the live cycle via `orchestrator/dev-invocation.ts`).
- `score.ts` — runs the Ralph loop against each fixture, scores, writes `results/<iso>.json`.

## Known failure modes (to defend against)

- **Wedged loops** — Ralph never converges. `stop-conditions.ts` includes a wedged-detector (no progress for N iterations → abort).
- **Token burn on no-op iterations** — iteration budget caps this; cost budget per initiative caps it harder.
- **Hallucinated test passes** — quality gate verification runs in the orchestrator, not the agent (carried-over v1 lesson).
- **Merge conflicts across parallel loops** — handled by per-work-item branches off the initiative branch + orchestrator-level rebase before declaring a feature complete.

## TODO (post-scaffold)

- [x] Wire the Claude Agent SDK in `runner.ts` past skeleton — done via [`loops/ralph/claude-agent.ts`](../../loops/ralph/claude-agent.ts) (`createClaudeAgent` factory). The runner's `AgentInvocation` parameter accepts either the stub (default, for tests) or the SDK-backed agent.
- [x] Implement wedged-detector (no-progress heuristic) — done in [`loops/ralph/stop-conditions.ts`](../../loops/ralph/stop-conditions.ts) (default 3 iterations no-progress).
- [x] Implement quality-gates-pass stop condition with per-fixture commands — done. `LoopInput.qualityGate` is now injectable; the bench harness wires per-fixture commands (pytest / bats / node:test / grep). Live cycle still defaults to `npm test --silent` until per-project quality-gate config lands.
- [x] Per-iteration commit discipline + JSONL event emission — done. `orchestrator/cycle.ts:runDeveloperLoop` walks WIs in topological order, emits `ralph.start` / `ralph.end` per WI plus a phase-level summary.
- [x] Populate `benchmarks/developer-loop/fixtures/` with reference fixtures — five fixtures landed, one per managed project (env-optimiser, trafficGame, simplarr, GitWeave, healarr). Catalogue in [`benchmarks/developer-loop/cases.json`](../../benchmarks/developer-loop/cases.json).
