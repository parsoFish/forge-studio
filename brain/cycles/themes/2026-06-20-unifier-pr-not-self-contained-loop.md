---
title: unifier.gate.pr-not-self-contained repeat-fire — 23 fires, 2 delivery-gate failures, 41% of cycle cost
description: The unifier's pr-not-self-contained gate fired 23 times across two failed unifier runs (demo.json / pr-description absent or incomplete); two delivery gate failures blocked PR opening; third unifier run succeeded in 0 iters. Pattern: missing demo.json or pr-description causes a spin loop capped only by the UWI iteration budget, not by early termination.
category: antipattern
created_at: "2026-06-20"
updated_at: "2026-06-20"
---

## What happened

In cycle `2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group`:

- Unifier run 1: 8 iterations, `unifier.gate.pr-not-self-contained` on demo.json / pr-description. Ended `dev-loop-unifier-gate-failed`.
- Unifier run 2: 15 iterations, same gate. Ended `dev-loop-unifier-gate-failed`.
- Unifier run 3: 0 iterations, `status: complete` (ci-gate passed).

Total `unifier.gate.pr-not-self-contained` fires: **23**. Unifier cost: **$35.29 / ~$86 total = 41%**.

## Root cause pattern

`pr-not-self-contained` is a pre-PR gate that checks demo.json and pr-description exist and are well-formed. When the unifier starts without these artifacts, it attempts to construct them. Each failed sub-check increments the fire counter. When the sub-check loop completes without resolving the artifact, the UWI iteration is consumed but the gate still fails, so the next iteration starts from scratch. Two complete UWI runs (8+15 iters) were consumed this way.

The third unifier invocation succeeded immediately because the artifacts were already in place from a prior partial attempt — not because of a code fix.

## Signal

A high `unifier.gate.sub-check` count (69 fires in this cycle alongside 23 `pr-not-self-contained`) combined with delivery gate failure indicates the unifier is looping on artifact construction, not on CI.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group/events.jsonl` — search `unifier.gate.pr-not-self-contained`
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group.md`
