# Benchmarks — Developer Loop

> Runs the Ralph loop against each fixture. Scores completion, iteration efficiency, cost discipline, file-scope respect, and regression safety.

## Cases

Five fixtures, one per managed project (mirrors the project-manager bench projects). Each fixture is a self-contained mini-project layered with a failing acceptance test:

| Fixture | Language | Loop behaviour exercised |
|---|---|---|
| `env-optimiser-redact-argv` | Python (pytest) | single-file change; add a function adjacent to existing code |
| `trafficGame-decay-flow` | TypeScript (node:test) | implement a function from a clear spec; output validation |
| `simplarr-dry-run` | bash (bats) | non-TS quality gate; modify an existing script |
| `GitWeave-multipart-stub` | TypeScript (node:test) | new file creation; multiple acceptance criteria |
| `healarr-quickstart-readme` | Markdown (grep gate) | doc-only WI; tests scope discipline |

Each fixture under `fixtures/<id>/` ships:
- `<seed-tree>` — minimal worktree layout (source files + tests).
- `.forge/work-items/WI-1.md` — the WI spec in ADR-015 format.
- A failing acceptance test invoked via the fixture's `quality_gate_cmd`.
- A pre-existing test (regression guard) invoked via `pre_existing_tests_cmd`.

The catalogue in [`cases.json`](./cases.json) wires all five.

## Scoring

Pass threshold: **0.7** (matches brain + architect + project-manager benches). Gate: **`terminated_cleanly`** — `run()` returned a `LoopResult` without throwing.

| Criterion | Weight | What it measures |
|---|---|---|
| `loop_completed` | 0.35 | `result.status === 'complete'` (quality gate passed before any budget exhausted) |
| `iteration_budget_respected` | 0.20 | `result.iterations ≤ expected.max_iterations` |
| `files_in_scope_respected` | 0.20 | every file the agent modified ∈ `WorkItem.files_in_scope ∪ expected.files_in_scope_extra` |
| `cost_budget_respected` | 0.15 | `result.cost_usd ≤ expected.max_cost_usd` |
| `no_regression` | 0.10 | the fixture's pre-existing tests still pass after the run |

Pure scoring functions live in [`scoring.ts`](./scoring.ts); the runner is [`score.ts`](./score.ts); the per-fixture SDK invocation is [`sdk.ts`](./sdk.ts). All three share types with the project-manager bench's contract layer
([`orchestrator/dev-invocation.ts`](../../orchestrator/dev-invocation.ts)).

The rubric is **provisional**. After one or two iteration passes, if the dimensions stabilise, it graduates to a new ADR. Until then it lives here so it can move quickly.

## Budgets

- **Per fixture:** max 3 iterations / $0.30 (the doc-only healarr fixture is tighter: 2 iterations / $0.20).
- **Per session:** $2 cap across all five (early-aborts the bench if exceeded).
- **Concurrency:** 2 (each fixture is more expensive than PM).

Realistic envelope: ~$1.50 per bench run. The session cap allows ~30% headroom for retries / regressions.

## Prerequisites

The bench host must have these installed and on `$PATH`:

- **Node.js ≥ 20** (for the SDK + fixture tests via `node --test --experimental-strip-types`).
- **Python 3** with **pytest** (`pip install pytest`).
- **bats-core** (`apt install bats`, `brew install bats-core`, or [from source](https://github.com/bats-core/bats-core)).

If a runner is missing, the affected fixture's quality gate fails (the runner exits non-zero) and the loop reports `iteration-budget` as the stop reason. The result JSON makes this visible.

## Running

```sh
# unit tests (no Claude calls; fast)
node --test --experimental-strip-types benchmarks/developer-loop/scoring.test.ts
node --test --experimental-strip-types benchmarks/developer-loop/sdk.test.ts

# end-to-end bench (real Claude; ~$1.50)
npm run bench:developer-loop
```

Results land in `results/<iso>.json`. Console output mirrors PM: per-criterion pass rates, accuracy, cost, p95 iterations.
