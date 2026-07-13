---
title: PR fan-in absorbs adjacent broken merge — cross-initiative contamination
description: When an upstream initiative's squash-merge ships broken code to main (conflict markers, non-compiling files), the next initiative's PR fan-in must absorb the repair — contaminating its diff and review with work that doesn't belong to it.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity` (terraform-provider-betterado, graph+identity migration, PR #51).

PR #50 (feed package migration, different initiative) was squash-merged to main with a conflict marker and non-compiling code. PR #51 (this initiative) was the next to merge. Its unifier fan-in had to absorb the repair of PR #50's breakage — the fix appeared in PR #51's diff as unexplained changes to the feed package.

Operator: "this same PR's fan-in had to absorb a repair of a *different* initiative's broken main." Also documented in the betterado 2026-07 run-friction report (git history): "merge integrity — the feed (#50) squash-merge shipped a broken main."

## Why this matters

1. PR #51's diff includes changes to `azuredevops/internal/service/build/` (feed package) — not in its scope — which makes review harder and creates false attribution.
2. CI gate run under PR #51's context validates the feed fix too — if it fails, it's unclear which initiative broke CI.
3. The cycle-level gate on PR #51 passes not because #51's code is correct but because #51's fan-in includes a patch for #50's broken merge.

## The structural gap

The reviewer phase does not validate that `main` is green before opening a PR. If a prior initiative broke main and the current initiative's branch builds clean against that broken main, the CI gate on the new branch is green — but the merge produces a broken main again if the branch doesn't include the fix.

## Fix direction

- The unifier's pre-fanin step should run `git merge origin/main` and assert `make test` passes on the merged state before the PR is opened.
- The squash-merge antipattern (`squash-merge-stacked-prs`) is the root cause — enforce merge commits for stacked PRs in this project.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity/events.jsonl`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity.md`
