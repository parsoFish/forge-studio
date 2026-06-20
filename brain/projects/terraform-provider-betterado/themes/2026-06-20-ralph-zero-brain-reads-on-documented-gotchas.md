---
title: Ralph zero brain reads — documented gotchas re-derived from scratch
description: Ralph read brainReads=0 across all WIs despite project brain profile.md encoding the exact patterns needed (stale-revision retry, artifact key filtering); knowledge was re-derived via 60+ bash calls.
category: antipattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

# Ralph zero brain reads — documented gotchas re-derived from scratch

## What happened

Cycle INIT-2026-06-19-framework-release-definition. 6 ralph sessions. Every session: `brainReads: 0`.

`profile.md` Gotchas section encodes exactly what WI-3 and WI-4 needed:
- WI-3: artifact `definition_reference` extra keys (e.g. `artifactSourceDefinitionUrl`) must be stripped; flattenArtifacts filters to user-set keys — **already in profile.md**.
- WI-4: stale revision returns HTTP 400 with `typeKey: InvalidRequestException` and "old copy"; retry pattern is described — **already in profile.md**.

WI-3 re-derived artifact filtering via grep + reading `resource_release_definition.go` line by line (~20 Read calls). WI-4 re-derived the retry shape by reading the SDKv2 resource. Both patterns were already documented.

## Cost

WI-3: 60 bash calls, 40 reads, $3.77. WI-4: 23 bash calls, $0.91. Combined excess re-derivation: estimated 30+ tool calls that would have been unnecessary with brain consultation.

## What this means

- Dev specs should cite the relevant `profile.md` sections directly when work touches known-gotcha areas.
- Alternatively, ralph's context injection could include a summary of `profile.md##Gotchas` for the specific package under change.
- Per `brain-read-policy` ADR: dev-loop MUST NOT read the brain — but the planner/PM CAN embed gotcha excerpts in work item specs. That's the lever.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-release-definition/events.jsonl` lines 985 (`ralph.end` WI-3, brainReads=0), 1123 (WI-4, brainReads=0)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-release-definition.md`
- `projects/terraform-provider-betterado/forge/brain/profile.md` — `## Gotchas` section
