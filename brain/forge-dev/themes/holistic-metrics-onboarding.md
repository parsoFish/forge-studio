---
title: >-
  Holistic project metrics are an onboarding contract clause — without them,
  agentic ideation is blind
description: >-
  The forge↔project contract (C1–C6) is necessary but not sufficient for
  measurement-driven loops. A new clause — C7 holistic metrics, with a
  measurement command and locked baselines — is the missing piece. Tests verify
  "did this break"; metrics verify "did this help".
category: decision
keywords:
  - holistic-metrics
  - onboarding
  - contract
  - C7
  - eval-driven
  - locked-baselines
  - measurement
  - agentic-ideation
  - score-delta
  - project-bootstrap
created_at: 2026-05-23T00:00:00.000Z
updated_at: 2026-05-23T00:00:00.000Z
related_themes:
  - forge-project-onboarding-contract
  - eval-driven-development
  - parametric-design-search
---

# Holistic project metrics are a contract clause

The existing forge↔project contract (C1–C6, [forge-project-onboarding-contract](./forge-project-onboarding-contract.md))
ensures forge can **run** a project's gate, route work to isolated worktrees, honour
locked-core mandates, and merge without stranding — NOT **evaluate whether a change made the project better**.

The trafficGame PR #57 illustrated this gap: across 34 commits, the 788-test
suite passed throughout, but only the third iteration was actually *better* by
the metrics (throughput and overlap count). Tests prove correctness; metrics
prove improvement. Without them, you cannot settle design trade-offs agentically.

## The missing clause — C7

**C7 — Holistic project metrics with a measurement command and locked
baselines.** A project declares at least one holistic outcome metric, a
command that produces it, and a baseline file recording the current locked
value. Every initiative must check the metric and either preserve the baseline
within a declared tolerance or document + deliberately update it. Concretely:

- **A metric command** — like `npm test` for C1 but for holistic performance
  (trafficGame's is the sweep harness + locked baseline files under
  `docs/baselines/`; ~10 s with 8 workers, cheap enough to run per-PR).
- **Locked baseline files** — machine- and human-readable, committed to the repo
  so architect/PM/dev-loop read them as brain context.
- **A regression budget** — explicit (trafficGame uses ±1% on its locks);
  anything outside is a trade-off the PR must explain.
- **Negative examples** — the screenshot index includes designs that scored
  badly, so an agent learns the failure modes, not just what passed.

**Clause-id collision (noted 2026-07-17, R5-07-F6):** `docs/forge-project-contract.md`
already has a **different**, landed **C7 — External-resource model** clause
(creds-free in-loop gate + isolated self-cleaning live confirmation) — see
[[forge-project-onboarding-contract]]. This theme's C7 was never landed, so the
numbering collides; [R1-D1](../../../docs/roadmaps/R1-contract-componentry.md)
resolves it on pick-up — this clause takes the next free id (e.g. C11), never C7.

## Why tests aren't enough

Tests cover correctness under specific conditions; a green suite proves nothing
about system performance. trafficGame's tests missed deadlocks, false positives,
and bottlenecks observable only in full sweeps. A unit test is a single
assertion; a holistic metric is a system-level claim. Both are needed; forge
lacks the latter as a contract clause.

## Implications if C7 lands

The architect consumes locked baselines (C4 extended), the PM writes WIs with AC "metric within budget" not just "tests pass", and the reviewer compares against baseline. A project-onboarding skill should guide metric, command, and budget selection. Not every project has a metric as clean as trafficGame's; the skill helps find the cleanest proxy available, since even an imperfect one beats none — it converts prose to deltas.

## Sources

- `projects/trafficGame/scripts/grading/runSweep.mjs` (managed-project checkout, machine-local) — the measurement engine.
- `projects/trafficGame/docs/baselines/` (managed-project checkout, machine-local) — the locks.
- PR #57 — the arc that demonstrated the gap.

## See also

- [[forge-project-onboarding-contract]] — C1–C6 (C7 extends).
- [[eval-driven-development]] — the principle this clause enforces.
- [[parametric-design-search]] — the ideation pattern C7 enables.
