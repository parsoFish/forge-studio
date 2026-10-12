---
title: Plan engine must implement all three state branches (create / unchanged / delete)
description: First implementation of plan.py missed the delete branch for snapshot-only resources; gate failed 8× before the gap was diagnosed and fixed.
category: antipattern
keywords: [plan, plan-engine, delete, state-diff, snapshot, create, unchanged, gitweave/plan.py, test_plan.py]
created_at: 2026-10-12T00:00:00Z
updated_at: 2026-10-12T00:00:00Z
related_themes: [2026-10-11-acceptance-tests-require-live-credentials, sharp-edges]
---

## What happened

WI-6 implemented `gitweave/plan.py` — the plan engine that compares a snapshot (org-empty.json or live state) against the config declaration and emits a `PlanResult` with per-resource actions. The first implementation covered `create` (declared, not in snapshot) and `unchanged` (declared and in snapshot, identical). It omitted `delete` (in snapshot, not in declaration).

`test_plan_extra_snapshot_resource_is_delete` asserted `assert actions[("team", "ghost-team")] == "delete"` — `KeyError: ('team', 'ghost-team')` on every gate run. The ralph agent read `.forge/last-gate-failure.md` as stale each iteration, ran `pytest test_plan.py` locally and saw other tests pass, and declared WI-6 done. This repeated 5 times in dev-loop run 1 (WI-6 discarded) and 3 more times in dev-loop run 2 before the actual missing branch was diagnosed.

Total: 8 `gate.fail` events for a single WI. Cost: ~$2.4 in wasted iterations.

## Prevention

For any state-diff / reconciliation engine, PM must embed an explicit AC for **each state branch**: create, unchanged, AND delete (or equivalent remove/retire). A single gate that passes for 2 of 3 branches silently misses the third.

Add to `gitweave/plan.py` spec: "Given a resource present in snapshot but absent from declaration — action is `delete`."

## See also

- [[2026-10-11-acceptance-tests-require-live-credentials]] — the other WI that failed in this cycle

## Sources

- `_logs/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired/events.jsonl` (WI-6 gate.fail events 08:41–09:49)
- `brain/cycles/_raw/2026-10-11T02-16-05_INIT-2026-10-11-i2-apply-engine-terraform-retired.md`
