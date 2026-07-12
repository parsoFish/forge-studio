---
title: Operator dead-code sweep after 24-initiative framework migration
description: After the 24-initiative roadmap merged to 2.0.0, 113 orphaned SDKv2 files and a bloated commons.go required a manual operator sweep the dev-loop fleet couldn't execute due to weekly usage limits; no dev-loop iteration ever cleaned the entire package in one pass.
category: antipattern
keywords: [dead-code-sweep, sdkv2-orphan-files, cross-wi-residue, go-vet, commons-go, operator-cleanup]
related_themes: [provider-registration-dedup-index, build-tooling-index]
created_at: 2026-07-10T00:00:00.000Z
updated_at: 2026-07-10T00:00:00.000Z
---

## Pattern

After the 24-initiative framework-migration roadmap merged and `betterado` main was cut to 2.0.0, the operator found ~113 orphaned/dead SDKv2 source files that the sub-agent fleet had not deleted. The sub-agent fleet hit the weekly usage limit before completing the sweep. The operator:

1. Ran a build-proof iteration to identify symbols still referenced from dead files.
2. Deleted the 113 files manually, restoring live helpers where needed.
3. Reduced `commons.go` from a large file to its 2 surviving enums by hand.

The dev-loop's checklist item "dedup = deregister AND delete" (profile.md §3b) was applied per-WI but didn't cover cross-WI accumulation: each WI deleted only the files it migrated; no WI was responsible for the residue left by earlier passes.

## Root cause

- Each migration WI deleted SDKv2 files it owned but left shared helpers that multiple resources had referenced — once all referrers migrated away, the helpers became dead but no WI owned their deletion.
- `go vet -tags all ./azuredevops/...` was the mechanical verification, but no single WI ran it over the entire serviceendpoint package end-to-end before the unifier committed.
- The `go test -tags all` (untagged) gate was insufficient: dead `_test.go` files with build-tag-gated symbols compiled clean without tags but failed with `-tags all`.

## Signal

`docs/investigations/2026-07-betterado-run-friction.md` (2026-07-10 entry): operator executed a dead-code sweep of 113 files outside the dev-loop, noting the weekly usage limit as the ceiling that prevented the fleet from completing it. CHANGELOG INTERNAL bullets were also flagged stale.

## Implication

A "dedup" WI at the close of a large multi-WI migration should run `go vet -tags all ./...` over the entire affected package, not just the package under the individual WI, and delete every file the vet identifies as orphaned. This is a stronger form of the standing checklist item — it covers cross-WI residue that per-WI deletion misses.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover/user-feedback.md` — operator free-form Q4 response
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover.md` — cycle archive
