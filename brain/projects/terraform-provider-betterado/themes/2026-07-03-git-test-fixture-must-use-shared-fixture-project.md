---
title: Git acceptance tests must use SharedFixtureProjectName — never create a betterado_project resource
description: All 6+ git test files originally created a fresh betterado_project resource; the org is at its 1000-project cap so every test failed. WI-2 spent 4 gate-fail iterations (233 bash calls, 24 test runs) re-deriving this before switching to SharedFixtureProjectName.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## What happened

WI-2 (migrate `betterado_git_repository`) used HCL fixtures with `resource "betterado_project" "test"`. Gate fail iterations 2–5 all produced:

```
Error: creating project: Failed to add a project as this organization
already has 1000 projects.
```

Ralph iterated through three approaches before landing on the correct one:
1. Build error fix (`undefined: os` in a `_test.go`)
2. Switch to `data "betterado_project"` with fixture name `betterado-standing-demo` — wrong name; "Project with name betterado-standing-demo or ID  does not exist"
3. Look up the actual fixture name from `shared_fixtures.go` → `SharedFixtureProjectName` → correct

Total iteration cost on WI-2: 6 iterations (estimated ~$4–6 of the $25.82 dev-loop spend), 233 bash calls.

## Root cause

The knowledge is in `profile.md` (gotchas section) and in the cycle theme `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas.md`. brainReads=0 on WI-2. Ralph re-derived from source inspection.

## Standing rule for git tests

Every acceptance test fixture that needs an ADO project MUST import `SharedFixtureProjectName` from `shared_fixtures.go` via `data "betterado_project"`. Never use `resource "betterado_project"`. This is the same rule as for release/* tests; git tests must follow the same pattern.

## How to check

```
grep -r 'resource "betterado_project"' azuredevops/internal/acceptancetests/
```

Should return zero matches in git test files.

## Prevention

PM must embed this rule verbatim in the AC of any git-test WI:
> "Fixtures MUST use `data "betterado_project" "test" { name = SharedFixtureProjectName }` — never `resource "betterado_project"` (org at 1000-project cap)."

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git/events.jsonl` (L554, L664, L828, L1013: WI-2 gate.fail iterations 2–5)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git.md`
