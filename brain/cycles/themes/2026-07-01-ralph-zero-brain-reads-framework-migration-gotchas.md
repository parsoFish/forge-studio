---
title: Ralph zero-brain-reads on framework-migration WIs — documented gotchas re-derived each time
description: Across 6 ralph sessions in a framework-migration cycle, brainReads=0 in every session; all three live-acc failures (duplicate resource type, nil-Meta, 1000-project cap) were re-derived from scratch via 20-108 bash/read calls despite being in profile.md.
category: antipattern
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions` (terraform-provider-betterado, framework migration).

All ralph sessions: `brainReads: 0` (WI-1 run1: 108 bash calls; WI-1 run2: 62; WI-2: 79+31; WI-3: 90; WI-4).

Three live-acc gate failures that consumed multiple iterations each:

| Failure | Brain document | Re-derivation cost |
|---|---|---|
| `Duplicate resource type` (SDKv2 deregister omitted) | `profile.md` mandatory checklist clause 1 | 5 iterations, ~$3.8 |
| `nil-Meta` panic in `checkDestroyed`/`captureEvidence` | `2026-06-20-framework-configure-stub-mux-timebomb` | 2+ iterations |
| 1000-project org cap in test fixture | `2026-06-20-ado-org-project-limit-blocks-test-creates` | 1 iteration per WI |

All were re-discovered by grepping source files, reading test helpers, and reasoning from first principles — knowledge already in the brain.

## Why this matters

Per-WI cost: estimated 30-60 extra tool calls per WI vs reading the brain. Across 6 sessions, the re-derivation overhead likely exceeded $5. More importantly: the first blocker (duplicate resource type) caused a 5-iteration budget exhaustion in run 1 and a forced second run — the entire first dev-loop run was discarded.

## The lever is PM, not ralph (per brain-read-policy)

`brain-read-policy` ADR: dev-loop MUST NOT read the brain. The fix point is the **PM**: embed relevant gotcha excerpts from `profile.md` directly into the WI spec for any WI touching the framework migration. Specifically:
- For any framework-resource WI: embed profile.md "Framework migration checklist" (clauses 1-3) verbatim as acceptance criteria.
- For any acceptance-test WI in this project: embed the 1000-project-cap rule as a mandatory AC.

The checklist content is short enough (~15 lines) to fit in a WI spec without inflating context.

## Prior occurrence

`2026-06-20-ralph-zero-brain-reads-on-documented-gotchas` (same project, prior cycle) documented the identical pattern. Two cycles later: unchanged. This is structural — PM must change, not ralph.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions/events.jsonl` (multiple ralph.end events with `brainReads:0` metadata)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions.md`
