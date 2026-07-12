---
title: golangci-lint only in ci_gate_cmd — not in per-WI quality_gate_cmd — antipattern
description: 'Lint errors introduced by the agent survive all per-WI dev-loop gates and are caught only at the post-dev-close CI gate, forcing a full terminal re-run. Operator-confirmed fix for this project: include golangci-lint in WI acceptance criteria.'
category: antipattern
created_at: 2026-06-08T00:00:00.000Z
updated_at: 2026-06-08T00:00:00.000Z
---

# golangci-lint only in ci_gate_cmd — antipattern

## What happened

Run 1 of `INIT-2026-06-08-release-data-sources-completion` (2026-06-08):

- WI-1/2/3 quality gates: `go test -tags all -run <TestName> ./azuredevops/internal/service/release/` — unit test only, no lint.
- All three passed iteration 1 gate.
- Unifier ran, CI gate ran: `golangci-lint run ./...` — FAILED.

Error:
```
azuredevops/internal/service/release/doc_audit_test.go:56:8: Error return value of
`filepath.Rel` is not checked (errcheck)
    rel, _ := filepath.Rel(repoRoot, docPath)
         ^
```

The `errcheck` lint rule flags unhandled errors from functions that return `(value, error)`. `filepath.Rel` is one such function. The agent assigned `_` to the error return; this pattern is invisible to `go test` but flagged by `golangci-lint`.

Cycle classified terminal (`failure_kind: terminal`, `recoverable: false`). Full second run required.

## Cost

- Run 1 sunk: ~$3.4 (PM + 4-WI dev-loop + unifier).
- Run 2: ~$2.62 (PM re-decompose + 2-WI dev-loop + unifier).
- Total initiative cost: ~$6.0 vs ~$2.62 if lint had been caught at the dev-loop gate.

## Operator-confirmed fix

From `user-feedback.md`:
> "Add it as a WI acceptance criterion. The run-1 abort ($3.4 sunk) is the direct cost of catching this at CI instead of at the dev-loop gate."

**The PM must include `golangci-lint run ./...` (or a file-scoped variant) as an acceptance criterion in every WI for this project.**

Scoped form for performance: `golangci-lint run --new-from-rev=main ./azuredevops/...` (only new/changed lines).

## Why this is project-specific

`golangci-lint` is in this project's `ci_gate_cmd` but NOT injected automatically into the per-WI `quality_gate_cmd` (which is set per-WI by the PM). The project profile.md `two-gate testing model` references `golangci-lint run ./...` as part of CI-equivalent, but the PM does not embed this into WI ACs by default — it sets only the unit-test run command as `quality_gate_cmd`.

## Recurrence signal

If `golangci-lint` is absent from WI acceptance criteria on any future WI for this project, flag it in planning review.

## Sources

- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion/events.jsonl` (gate.errored WI-4, ci-gate FAILED event, failure_classification terminal)
- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion/user-feedback.md`
- `brain/cycles/_raw/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion.md`
