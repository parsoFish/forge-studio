---
title: PM must embed framework-migration checklist as explicit ACs — operator-confirmed direction
description: Operator confirmed via feedback that PM-level AC embedding (not ralph brain reads) is the right fix for repeated framework-migration gotcha failures; the brain already contains all gotchas but PM does not propagate them into WI specs.
category: antipattern
created_at: 2026-07-01T00:00:00.000Z
updated_at: 2026-07-01T00:00:00.000Z
---

## Pattern

The `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas` theme documents that ralph sessions have `brainReads:0` (by design per `brain-read-policy`). The fix lever is the PM — it reads the brain and writes WI specs. But PM consistently fails to propagate the three high-ROI checklist items into per-WI ACs:

1. **SDKv2 deregister + delete in same WI** (profile.md clause 1/3b)
2. **Configure wires real `*client.AggregatedClient`** (profile.md clause 2)
3. **1000-project org cap → use SharedFixture** (profile.md gotchas)

Result: each WI encounters these as novel failures, spending 1–5 iterations re-deriving the fix.

## Operator-confirmed fix direction

Operator feedback (2026-07-01 initiative, question 3): **"Add SDKv2-deregister as a mandatory AC in every framework-migration WI template (PM constraint)"**.

The three checklist items above are ~10 lines total and fit in a WI spec without inflating ralph context. The PM MUST include them verbatim in the `acceptance_criteria` block of every WI that migrates a resource or data-source to the framework.

## Why PM-not-ralph

`brain-read-policy` ADR: dev-loop agents MUST NOT read the brain — their context is the WI spec. The PM reads 3–10 brain pages per cycle. The PM-to-WI-spec boundary is the correct propagation point for persistent project knowledge.

## Evidence trail (three consecutive cycles)

| Cycle | Failure | WIs burned |
|---|---|---|
| `2026-06-20` (`ralph-zero-brain-reads-on-documented-gotchas`) | duplicate resource type, nil-Meta | multiple |
| `2026-07-01` release-folder-permissions | duplicate resource type, nil-Meta, 1000-project cap | WI-1 run1 (5 iter), WI-2, WI-3 |
| `2026-07-05` workitemtrackingprocess | duplicate resource type, nil-AggregatedClient | WI-2,3,4,5 |

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions/events.jsonl` (multiple ralph.end brainReads:0; gate.fail messages: "Duplicate resource type", "nil" panic)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions.md`
- `brain/cycles/themes/2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas.md`
- `brain/projects/terraform-provider-betterado/themes/2026-07-05-framework-migration-checklist-not-in-wi-specs.md`
