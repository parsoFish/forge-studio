---
title: Quality-gate-cmd must assert NEW work, not just "passive command exits 0"
description: Per-WI quality_gate_cmd patterns like `go test ./pkg/...` or `npm test` can false-pass when the dev-loop adds zero test coverage — the test runner exits 0 with "no tests to run". The gate must include a sanity check that the expected new artefact (test file, coverage delta, or named function) actually landed.
category: antipattern
created_at: 2026-05-23T11:58:00Z
updated_at: 2026-05-23T11:58:00Z
related_themes:
  - file-isolation-constraint-enables-single-iteration
---

# Quality-gate-cmd must assert NEW work

## Sources

6 WIs reported `quality-gates-pass` at $2.62, but `git diff main..HEAD` showed only 57 lines added to one Go file — zero test files, docs, or examples. The unifier's `pr-not-self-contained` gate caught the failure only after the budget was spent.

## What happened

Per-feature gate declared: `go test ./...release/... -run TestReleaseDefinition`. Six WIs inherited it. Each Ralph ran the command, which exited 0 with "no tests to run" — there were no `TestReleaseDefinition*` functions. The gate-evaluator saw exit 0 and marked all 6 WIs as passed. The unifier caught the real failure (`pr-not-self-contained`) only after the budget was spent.

## Why this pattern is dangerous

Passive command-line gates (test runners) exit 0 on "no work to run":
- `go test ./pkg/... -run TestX` → exits 0 when no test matches
- `npm test` → exits 0 when no test files match
- `cargo test`, `bun test`, `bats` → all exit 0 on empty matches

The gate passes structurally while delivering zero new coverage, code, or artifacts — caught only late by the unifier.

## Mitigations

1. **`verification_artifact` existence check** — Require it for passive runners. Pre-flight: `existsSync(verification_artifact)` AND it appears in `git diff`.
2. **Verbose-output assertion** — Filter gate output: `go test -v ... 2>&1 | grep -E '--- PASS:.*TestReleaseDefinition'` — pass only if ≥1 PASS line.
3. **Coverage delta** — Require `cov_delta > 0` since `main`.
4. **The unifier's `pr-not-self-contained` gate** remains the safety net.

## How to apply

Pair per-feature `quality_gate_cmd` with `verification_artifact` path. For each WI, require either `creates: [<file>]` or `verification_artifact: <file>` with a grep filter. Gate-evaluator: if `quality_gate_cmd` is passive AND no `verification_artifact` in the diff, treat the gate as indeterminate.

## See also

- `file-isolation-constraint-enables-single-iteration` — one-file-per-WI pattern that correlates with single-iteration success.
- The unifier's `pr-not-self-contained` gate is the load-bearing late-stage safety net.
- **Open gap:** cycle reports can show the default gate even when a custom `quality_gate_cmd` is declared — same false-confidence failure, surfaced at report time. See `docs/known-gaps.md`.
