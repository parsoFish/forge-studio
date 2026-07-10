---
title: Dev-loop zero brain reads — 8th consecutive cycle with brainReads=0 across all WIs
description: All 7 ralph sessions in the pipelinesapproval initiative had brainReads=0; acceptance test conventions, TF_ACC skip semantics, and client field names were re-derived via Bash/Read rather than from the profile or brain.
category: antipattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

## Observation

In INIT-2026-07-01-new-api-pipelinesapproval (pipelinesapproval), all 7 dev-loop ralph sessions showed `brainReads: 0` in their terminal `ralph.end` events. This is the 8th+ consecutive cycle where this has been observed across betterado initiatives.

Specific re-derivations in this cycle:

| Fact re-derived | Tool calls used | Where it lives |
|---|---|---|
| `resource.ParallelTest` SKIP = gate pass without TF_ACC | 5 log entries (WI-6) | Not in profile.md |
| `GetMuxProviderFactories` spelling (not `GetMuxedProviderFactories`) | 1 Bash grep (WI-6) | Could be in profile |
| `clients.Ctx` field exists on `AggregatedClient` | 1 Bash read (WI-6) | Could be in profile |
| `PreCheck` placement inside `resource.ParallelTest`, not outside | experimental (WI-6) | Not in profile |

## Impact

- WI-6: 36 tool calls for 1 iteration that delivered a single test file. ~5 of those calls were re-deriving TF_ACC / skip semantics that should be known from project context.
- Total: unmeasured but consistent overhead per WI across every initiative.

## Root cause

The dev-loop skill (`skills/developer-ralph/SKILL.md`) does NOT instruct agents to consult the brain. Per `brain-read-policy` (forge ADR), the dev-loop is intentionally brain-excluded — context is the work item spec. But project-specific conventions (TestAcc structure, hollow-gate semantics, `PreCheck` placement) belong in the WI spec or in `profile.md` — they are not reaching the agent from either source.

## Direction

Two mitigations, not mutually exclusive:
1. **Add profile.md gotchas** for known re-derived facts (acceptance test hollow gate, PreCheck placement, GetMuxProviderFactories spelling). Architect/PM reads profile.md and can embed these in WI spec.
2. **WI spec enrichment** — PM should copy relevant profile.md gotchas into the WI spec for any WI touching acceptance tests. The PM had brainReads=5 and read the profile; the gotcha was not present, so it couldn't be propagated.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval/events.jsonl` — WI-1 through WI-7 ralph.end metadata (`brainReads: 0`)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval.md`
- Related prior themes: `brain/projects/terraform-provider-betterado/themes/2026-06-08-dev-loop-zero-brain-reads-persistent.md`, `2026-07-03-wiki-api-shape-bugs-re-derived-zero-brain-reads.md`, `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas.md`
