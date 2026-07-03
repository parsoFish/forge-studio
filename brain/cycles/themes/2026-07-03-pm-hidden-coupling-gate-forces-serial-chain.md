---
title: PM hidden-coupling gate correctly rejects parallel WIs sharing provider registration files
description: When multiple WIs each edit framework_provider.go + provider.go + provider_test.go, the orchestrator's hidden-coupling checker rejects the decomposition; PM must re-run with a strict serial dependency chain (each WI → next). The gate works but doubles PM cost.
category: pattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## What happened

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git`

First PM run (L41) produced 6 WIs with WI-3, WI-4, WI-5 listed in the `files_in_scope` as each independently editing:
- `azuredevops/internal/provider/framework_provider.go`
- `azuredevops/provider.go`
- `azuredevops/provider_test.go`

Orchestrator hidden-coupling checker flagged 3 pairs (WI-3↔WI-4, WI-3↔WI-5, WI-4↔WI-5) and rejected the decomposition (L42):

```
project-manager phase failed: 3 hidden-coupling pair(s): WI-3↔WI-4 share
azuredevops/internal/provider/framework_provider.go, ...
```

Second PM run (L95) produced the same 6 WIs with the serial chain WI-3→WI-4→WI-5, eliminating the coupling pairs. Zero `hidden_coupling_violations`. PM cost doubled (~$2 → ~$4 for the full PM phase).

## Why this is correct behaviour

Framework-migration WIs all write to the same three provider files (each WI adds one entry to `Resources()` or `DataSources()` and removes one from `provider.go`). These files CANNOT be parallelised — merge conflicts are guaranteed. The serial chain WI-2→3→4→5→6 is the correct structure for this class of migration.

## The PM should produce the serial chain on the first attempt

The pattern is documented in `profile.md` (framework migration checklist) and follows directly from clause 3b (deregister AND delete in the same WI). The PM read 5 brain pages but apparently did not pick up on the provider-file coupling.

**Improvement:** add an explicit note to the project's AGENT.md or `profile.md` that any WI in a framework-migration batch editing `framework_provider.go` MUST be serialised (each WI depends on the prior), because all of them write the same provider files.

## Broader lesson (forge machinery)

The hidden-coupling gate prevents merge conflicts but cannot prevent the PM from producing a coupling-violating decomposition in the first place. The gate is a correct safety net, but the PM doubling its cost (two full runs) is avoidable if the coupling constraint is front-loaded as an explicit PM instruction for this project/migration type.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git/events.jsonl` (L41: first PM end with 3 coupling violations; L42: orchestrator rejection; L95: second PM end with 0 violations)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git.md`
