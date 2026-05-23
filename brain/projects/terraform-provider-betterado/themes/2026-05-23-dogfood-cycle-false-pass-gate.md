---
slug: 2026-05-23-dogfood-cycle-false-pass-gate
project: terraform-provider-betterado
date_added: 2026-05-23T11:58:00.000Z
category: antipattern
related_themes:
  - council-constraints.md
  - release-substrate-context.md
---

# Dogfood cycle (2026-05-23) — `go test -run TestX` false-pass

The first cwc-refined-forge dogfood targeted INIT-01
(`release_definition` test substrate + deployment gates). All 6 WIs
reported `quality-gates-pass` at $2.62 cumulative; in reality only 57
lines of code shipped to one existing Go file (FEAT-2's
`preDeploymentGatesSchema` schema definition — no expand/flatten logic,
no test files, no docs, no examples).

The cycle was abandoned via `forge review --abandon`.

## Sources

- `_logs/2026-05-23T11-43-25_INIT-2026-05-23-release-def-substrate-gates/events.jsonl`
- `_queue/failed/INIT-2026-05-23-release-def-substrate-gates.md`
- The unifier's `fix_plan.md` in the pre-cleanup worktree showed all 18 ACs
  unchecked at iteration-2 abandon time.

## What false-passed

The architect set per-feature
`quality_gate_cmd: [go, test, ./azuredevops/internal/service/release/..., -run, TestReleaseDefinition]`.
The PM kept this for each of the 6 WIs. When each WI's Ralph ran the gate,
`go test` exited 0 because no `TestReleaseDefinition*` functions exist
under `./...release/...`. The dev-loop's gate-evaluator read exit 0 as
`gate.pass`.

This is project-specific because:
- The fork inherits hundreds of existing tests in sibling packages, so the
  agent reasoning "tests are already a thing here" is confounded with the
  fact that THIS package has zero tests.
- The acceptance-test infrastructure (`TF_ACC=1` + live ADO PAT) is
  separate from unit tests; the agent may have confused them.

## Mitigations (project-scoped)

When the architect drafts a substrate initiative for any betterado package:

- **Always pair `quality_gate_cmd` with `verification_artifact`** —
  e.g. `verification_artifact: azuredevops/internal/service/release/resource_release_definition_test.go`.
- **Use `-v` + a PASS-line grep** in the gate command — e.g.
  `go test -v ./... -run TestReleaseDefinition 2>&1 | grep -E '--- PASS:.*TestReleaseDefinition'`.
- **Sanity-check via `git diff --stat main..HEAD`** at WI close — if the
  expected `_test.go` files don't appear in the diff, the gate should
  refuse to pass even on exit-0.

## See also

- Forge-wide pattern: [[quality-gate-cmd-must-assert-new-work]] — the
  general antipattern this is an instance of.
- [[council-constraints]] §"Per-resource test substrate" — the 5-test
  pattern that the dogfood failed to actually implement.
