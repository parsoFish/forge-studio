---
title: Exploration initiatives differ structurally from implementation initiatives
description: >-
  The trafficGame collision/elevation arc (PR #57) was scientific exploration —
  "find the best measurable outcome", not "build feature X" — and the forge
  pipeline has no shape for it. Captures the exploration-cycle shape: a
  metric/parameter/hypothesis manifest, sweep-batch WIs, a dev-loop that runs the
  harness instead of writing code, and a score-delta reviewer.
category: decision
keywords:
  - exploration
  - implementation
  - initiative-types
  - autonomy
  - score-delta-completion
  - measurement-driven
  - ideation-fanout
created_at: 2026-05-23T00:00:00.000Z
updated_at: 2026-05-23T00:00:00.000Z
related_themes:
  - holistic-metrics-onboarding
  - parametric-design-search
  - human-directed-work-as-initiatives
  - forge-current-architecture-as-built
---

# Exploration vs implementation initiatives

The forge pipeline is shaped for **implementation initiatives**: manifest → file-scoped WIs → code passes ACs → diff matches spec. The trafficGame arc (PR #57) was **scientific exploration**: "find a map design that hits highest throughput" — discovery IS the AC. The pipeline has no shape for it.

## How exploration initiatives differ

| Dimension | Implementation | Exploration |
|---|---|---|
| Goal | Build feature X | Find the best value of a measurable outcome |
| Acceptance criterion | Tests + spec checks pass | Score-delta improves; locked baselines preserved |
| Decomposition | Features → WIs by file scope | Parameter space → sweep batches |
| Dev-loop output | Code that satisfies the spec | A new locked baseline + screenshots |
| Reviewer focus | Diff matches spec | Score-delta vs locks; visual confirmation |
| Reflection | What went wrong with spec / code | What the deltas suggest for next ideation |

Implementation initiatives are **closed**; exploration initiatives are **open** ("done" when no obvious improvement remains at current budget).

## What a forge exploration cycle would look like

- **Architect** emits `type: exploration` manifest: `metric_command`, `locked_baselines`, `parameter_space`, `hypothesis`, budget.
- **PM** decomposes parameter space into sweep-batch WIs: coarse → fine sweep → regression check → screenshots.
- **Dev-loop** runs the sweep command (no code writing). Metric is the gate.
- **Reviewer** compares score-deltas vs baselines, eyeballs screenshots, approves iff champion-improved AND baselines-held.

(The concrete manifest + WI-list shapes live in the cycle archive cited below.)

## Operator load vs what a cycle would automate

Operator's load-bearing work: **hypothesis-formation, naming failure modes, pivoting theories**. Automatable: 30+ sweeps, regression checks, screenshots, doc updates. A cycle reduces operator load to **hypothesis + approval**.

## When this isn't yet ready

Requires: C7 holistic metrics ([holistic-metrics-onboarding](./holistic-metrics-onboarding.md)), parametric-design-search harness ([parametric-design-search](../../cycles/themes/parametric-design-search.md)), architect reading brain themes, PM accepting `type: exploration`, reviewer accepting score-delta verdicts.

## Why this matters

Real engineering includes exploration — tuning, A/B searches, calibration. Without a dedicated cycle, exploration arcs run as operator-driven conversations that pollute the autonomy signal. Distinguishing modes structurally (via [human-directed-work-as-initiatives](../../cycles/themes/human-directed-work-as-initiatives.md)'s `origin` tag) and building the pipeline shape closes the gap.

## Sources

- PR #57 (merged 2026-05-23) — the arc that ran as exploration with no forge shape.
- [`brain/cycles/_raw/2026-05-23_trafficgame-elevation-grading-arc.md`](../../cycles/_raw/2026-05-23_trafficgame-elevation-grading-arc.md) — the cycle archive (full manifest + WI shapes).

## See also

- [[holistic-metrics-onboarding]] — C7, the contract clause this builds on.
- [[parametric-design-search]] — the harness pattern.
- [[human-directed-work-as-initiatives]] — the `origin` tag distinguishing hand-directed from autonomous.
