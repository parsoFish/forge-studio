---
source_type: cycle
cycle_id: 2026-05-23T11-43-25_INIT-2026-05-23-release-def-substrate-gates
initiative_id: INIT-2026-05-23-release-def-substrate-gates
project: terraform-provider-betterado
ingested_at: 2026-05-23T11:58:00Z
ingested_by: operator
outcome: abandoned
---

# Dogfood arc — INIT-01 release_definition substrate, ABANDONED

First end-to-end dogfood of the cwc-refined forge. Architect human moment
worked cleanly (interview + PLAN.md + PLAN.html + council inline + commit).
Cycle ran PM + dev-loop end-to-end but the dev-loop's per-WI quality gates
false-passed, leaving the unifier with nothing real to demo. Unifier
correctly caught it via `pr-not-self-contained`; cycle abandoned.

## Arc summary

| Phase | Outcome | Cost / time |
|---|---|---|
| Architect (operator session) | clean — interview + council + PLAN.md/html + manifest | — |
| `forge architect commit` | manifest landed in `_queue/pending/` | — |
| Daemon claim (`forge serve --once`) | clean — worktree created | — |
| PM (Sonnet) | 6 WIs from 4 features, valid graph | ~$0.20 / 3m49s |
| Dev-loop WI-1..6 (Ralph each) | all 6 `quality-gates-pass · iters=1` | $2.62 / ~10min |
| Unifier sub-phase | iter-1 `pr-not-self-contained` fail; iter-2 same; classified `unifier.failed` | ~$0.30 / 1m30s |
| Review surface | no PR opened; `reviewer.pr-open-failed` | — |
| Abandon | `forge review --abandon` → `_queue/failed/`, worktree + branch cleaned | — |

Cumulative: ~$3.12, ~16 minutes, zero merged work.

## What the dev-loop actually wrote (git diff main..HEAD before cleanup)

```
azuredevops/internal/service/release/resource_release_definition.go | +57 lines (FEAT-2 schema only — no expand/flatten, no tests)
AGENT.md                                                            | +11 lines (forge scratch)
PROMPT.md                                                           | +30 lines (forge scratch)
fix_plan.md                                                         | +22 lines (unifier output)
```

Zero `_test.go` files. Zero `post_deployment_gates`. Zero docs. Zero
examples. The unifier's `fix_plan.md` listed 18 acceptance criteria from
the manifest; all 18 were unchecked at abandon time.

## Root cause

Per-feature `quality_gate_cmd: [go, test, ./azuredevops/internal/service/release/..., -run, TestReleaseDefinition]`.
`go test` exits 0 when no test functions match the `-run` pattern. The
dev-loop's gate evaluator treats exit 0 as `gate.pass` without verifying
that NEW tests were actually added.

Details + mitigation options in:
[[quality-gate-cmd-must-assert-new-work]] (forge-wide antipattern) and
[[2026-05-23-dogfood-cycle-false-pass-gate]] (project-scoped instance).

## What WORKED in the refined cycle

- **cwc Amendment 1 (architect interview)** — `AskUserQuestion` rounds
  surfaced scope-edge / demo-shape / docs-scope cleanly, in seconds.
- **cwc Amendment 2 (PLAN.html)** — operator viewed in browser, approved
  by editing PLAN.md verdict.
- **`forge architect commit`** — single-command promotion path worked.
- **PM phase** — emitted valid 6-WI graph against the C5 schema with
  per-WI `quality_gate_cmd` (just inheriting the architect's false-pass
  pattern).
- **Dev-loop iteration cap** — single-iteration per WI matches the
  "good cycle" pattern from prior logs.
- **Unifier `pr-not-self-contained` gate** — load-bearing late-stage
  catch. Without it, the cycle would have opened a PR with no
  acceptance criteria met.
- **`forge review --abandon`** — clean teardown (manifest → failed,
  worktree + branch wiped).

## What's needed before retry

Per operator decision (2026-05-23): refine the dev-loop's gate-evaluator
to assert NEW work before declaring `gate.pass`. The smallest possible
fix:

1. **Pre-flight**: if the WI has `creates: [<file>]` or
   `verification_artifact: <file>`, check `git diff --name-only main..HEAD`
   includes that file. If not, gate is `indeterminate` (not pass).
2. **Verbose runner**: for `go test`, `npm test`, `pytest` patterns, append
   `-v 2>&1 | grep '\bPASS\b'` to the gate command (or wrap in a
   gate-runner that asserts ≥1 PASS line in the output).

Once that lands as a small forge refinement, re-architect a fresh INIT-01
(probably the same shape) and re-dogfood.

## Cycle log

Full events.jsonl archived at
`brain/_raw/cycles/2026-05-23_betterado-init01-dogfood-abandoned-arc.jsonl`.

## See also

- [[quality-gate-cmd-must-assert-new-work]]
- [[2026-05-23-dogfood-cycle-false-pass-gate]]
- [[council-constraints]] — the test-substrate pattern the dogfood
  failed to materialise.
