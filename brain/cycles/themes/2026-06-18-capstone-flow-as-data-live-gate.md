---
title: Capstone — a flow authored as data, gated by live truth
description: >-
  The betterado capstone proved forge can author a flow as Studio data and run
  real live work to merged PRs; the live-acceptance gate is the load-bearing
  quality mechanism; gap-bugs cluster at API-shape boundaries.
category: pattern
keywords:
  - capstone
  - release-refine
  - live-acceptance-gate
  - configmodeattr
  - flow-as-data
  - review-catches-what-offline-cannot
created_at: 2026-06-18T00:00:00.000Z
updated_at: 2026-06-18T00:00:00.000Z
---

# Capstone — a flow authored as data, gated by live truth

What the capstone (betterado release/task-group refinement) proved + cost.

## What held
- **Flow-as-data works.** `release-refine` (pm→dev→unifier→review) was authored as
  pure `flow.yaml` and ran real, live, merged work with ZERO new executor code —
  once the scheduler was fixed to run the flow the manifest *names* (`flow_id`),
  not a hardcoded `forge-cycle`. That one fix was the keystone.
- **The live-acceptance gate is load-bearing.** Every real bug was unit-green +
  CI-green but live-broken — only the `TF_ACC` apply→read→destroy caught it. An
  offline gate cannot gate a live-resource provider. Forcing `acceptance_gate.
  required:true` + gating the proving WI on the live command is the mechanism.
- **Review is where offline gates end.** The flow produced the work; the human/
  operator review (running the full live suite) caught what the per-WI gates
  missed — notably that a live-acc WI gating only ONE test lets sibling tests'
  live bugs through.

## Gap-bug patterns (recurring)
- JSON numbers unmarshal as `float64`, not `int` — `x.(int)` on an API response is
  a silent round-trip-to-0.
- Wrong SDK type shape in expand (modelled containerImage trigger like an
  artifactSource trigger) → API rejects. Ground every field in `models.go`.
- Stale symbol after a rename (test fixture used the old `environment` block).
- The CI gate FALSE-PASSED on a cached `go test` — clear `-testcache` at the gate.

## The design pivot (validate UX against the GOAL)
Arrays via SDKv2 `ConfigMode:Attr` compiled + unit-passed but forced consumers to
null-fill EVERY nested attribute at every level — strictly *worse* readability,
the opposite of the stated goal. Lesson: judge a refactor against its intent, not
"it builds." Reverted to blocks; clean array+optional needs a plugin-framework
migration (deferred, holistic).

## Forge hardening surfaced (open)
Long live-WI SDK crash at ~55min; the per-WI live iteration cap; the flow should
DRIVE PR approval+merge via the bridge verdict (these were merged locally then
reconciled), not park at ready-for-review. Next forge targets.
