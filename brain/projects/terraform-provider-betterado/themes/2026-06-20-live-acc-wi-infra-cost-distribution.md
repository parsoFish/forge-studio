---
title: Live acceptance test WI can consume 57% of cycle cost on infra-discovery iterations
description: WI-5 (TestAccTaskGroupStateUpgradeSmoke) cost $5.59 of $9.7 total — 57% — entirely in 2 iterations resolving the ADO 1000-project org limit. Spec assumed free project creates; org was at cap. A pre-flight env-audit WI (verify org capacity; confirm project-reuse strategy) could isolate infra-discovery cost and unblock parallelism.
category: pattern
created_at: 2026-06-20
updated_at: 2026-07-10
---

# Live acceptance test WI — infra-discovery cost distribution

## Observation

`INIT-2026-06-19-framework-state-upgraders` cycle total: **$9.7**.

| WI | cost | iterations |
|----|------|------------|
| WI-1 (release upgrader impl) | ~$0.27 | 1 |
| WI-2 (release upgrader tests) | ~$0.14 | 1 |
| WI-3 (task group upgrader wiring) | ~$0.48 | 1 |
| WI-4 (task group upgrader tests) | ~$0.38 | 1 |
| WI-5 (live smoke test) | **~$5.59** | **2** |

WI-5 burned 69 bash calls and 20 test runs debugging the ADO `GetProjects` pagination API after iteration 1 hit the 1000-project org cap. The spec assumed `resource "betterado_project"` creates would work; the org was at capacity.

## What made WI-5 expensive

1. Spec said "create a project" — org blocked it.
2. Ralph had to discover: `stateFilter=deleted` returns 996 soft-deleted projects; no public purge API; only fix is to reuse an existing project.
3. API exploration: `CoreClient.GetProjects(stateFilter=wellFormed, top=1)` found first available project; HCL fixture rewritten to `data "betterado_project"`.

Net: $5.59 for a 5.51s test run.

## Trade-off

**Reactive:** absorb the cost in the live-acc WI (as happened here). Appropriate when the infra state is unknown. On first hit, the learning is worth the cost (and the brain now documents it — see [`2026-06-20-ado-org-project-limit-blocks-test-creates.md`](./2026-06-20-ado-org-project-limit-blocks-test-creates.md)).

**Proactive (possible future pattern):** add a pre-flight "test-env audit" WI before any live-create WI that checks: org project count < 950? shared fixture project exists? TF_ACC env set? This WI costs ~$0.05 (single bash call) but isolates environment risk from the implementation WI and could unblock parallelism.

## Current standing rule

All live acceptance tests against this project MUST use `data "betterado_project"` (see `2026-06-20-ado-org-project-limit-blocks-test-creates.md`). The env-audit concern is now partially moot for project-context tests — but still relevant for other infra limits (build agents, variable groups, release environments).

## Sources

- `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/events.jsonl` (L612 gate.fail WI-5 iter 1, L791 gate.pass WI-5 iter 2)
- `brain/cycles/_raw/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders.md`
- `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/user-feedback.md` (Q1 — operator noted the pre-flight audit option)
