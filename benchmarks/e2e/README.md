# benchmarks/e2e/ — End-to-End Integration Bench

Drives the full autonomous-loop cycle (PM → developer-loop → review-Ralph → merge) against a sample initiative, with a **human-simulator agent** providing the verdict at each review round.

This is the integration test layer that sits above the per-phase benches. The per-phase benches (`benchmarks/{architect,project-manager,developer-loop,review-loop}/`) verify each agent does its job in isolation; this bench verifies the orchestration glue end-to-end and exercises stage 2 of the review-loop authentically.

## Layout

```
benchmarks/e2e/
├── score.ts                      # runner — invokes runCycle once per fixture
├── scoring.ts                    # pure rubric (gate + 5 weighted criteria)
├── sdk.ts                        # tempdir setup, real git init, gh PR shim
├── simulator.ts                  # human-simulator agent (SDK call)
├── *.test.ts                     # unit tests
├── cases.json                    # fixture entries
├── fixtures/<id>/
│   ├── branch-state/             # seed worktree (initial main branch)
│   ├── manifest.md               # initiative manifest (PM input)
│   └── target-spec.json          # simulator's evaluation criteria
└── results/                      # per-run output (gitignored)
```

## Rubric

Gate: `cycle_completed` — `runCycle` returned without throwing.

Weighted (sum = 1.0; pass threshold 0.7):

| Criterion | Weight | Check |
|---|---|---|
| `merged` | 0.40 | `gh` shim recorded `pr merge` success (initiative branch fast-forwarded into `main`) |
| `converged_within_budget` | 0.25 | Review-Ralph rounds ≤ `expected.max_rounds` (default 2) |
| `spec_satisfied` | 0.20 | Every target-spec check passes against the merged worktree |
| `cost_within_budget` | 0.10 | Total cycle cost ≤ `expected.max_cost_usd` |
| `no_regression` | 0.05 | `expected.pre_existing_tests_cmd` exits 0 post-merge (default true) |

## How a fixture is run

1. **Setup**: tempdir gets the standard symlinks (`brain/`, `skills/`, `docs/`, `orchestrator/`, `loops/`), the seed tree is `cpSync`'d into `projects/<name>/`, `git init`'d, committed to `main`, then a fresh `initiative-<id>` branch is checked out.
2. **Manifest** is dropped into `_queue/in-flight/<initiative-id>.md`.
3. **PATH shims** are written to `<tempdir>/bin/`: `gh` (smart — handles `pr create` + `pr merge` locally via `_pr-metadata.json` + a `git merge --ff-only`), `vhs`, and `npx playwright`. Real GitHub is never touched.
4. **`runCycle`** is invoked with `getVerdict` injected to call the simulator. The cycle runs PM → dev-loop → review-Ralph; the review-Ralph's quality-gate function calls the simulator for a verdict each round.
5. **Post-merge spec checks** run against the merged worktree (orchestrator-verified ground truth, independent of the simulator's verdict).
6. **Scoring** combines the cycle outcome, round count, cost, and spec results.

## Cost budget

Single fixture = 1 full cycle ≈ $5–10 with up to 2 send-back rounds. Session budget is set to $25 to give 2–3 attempts at the same fixture per run during prompt iteration.

## Adding fixtures

Drop a new `fixtures/<id>/` directory with `branch-state/` (seed), `manifest.md`, `target-spec.json`. Add an entry to `cases.json`. The `target-spec.json` shape matches `simulator.ts:TargetSpec`.

## What this bench does NOT cover

- **Architect phase**: out of scope. The architect bench produces validated manifests; e2e fixtures consume one. Architect bench output → e2e fixture manifest piping is future work.
- **Reflection phase**: out of scope until reflection lands.
- **Production CLI** (`forge review <id>` for human-driven verdicts): the orchestrator-side verdict-provider abstraction supports it; the CLI adapter is future work.
- **Real GitHub integration**: every `gh` call is locally shimmed. Real `gh` integration is a separate test path (manual, not in CI/bench).
