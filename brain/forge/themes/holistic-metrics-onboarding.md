---
title: Holistic project metrics are an onboarding contract clause — without them, agentic ideation is blind
description: The forge↔project contract (C1 fast gate, C2 scratch hygiene, C3 decomposed source, C4 machine-readable arch, C5 honoured locked-core, C6 satisfiable merge model) is necessary but not sufficient for measurement-driven loops. A new clause — C7 holistic metrics, with a measurement command and locked baselines — is the missing piece. Tests verify "did this break"; metrics verify "did this help".
category: decision
keywords: [holistic-metrics, onboarding, contract, C7, eval-driven, locked-baselines, measurement, agentic-ideation, score-delta, project-bootstrap]
created_at: 2026-05-23T00:00:00Z
updated_at: 2026-05-23T00:00:00Z
related_themes: [forge-project-onboarding-contract, eval-driven-development, phase-isolation-benchmarks, parametric-design-search]
---

# Holistic project metrics are a contract clause

The existing forge↔project contract (C1–C6, [forge-project-onboarding-contract](./forge-project-onboarding-contract.md))
ensures forge can **run** a project's quality gate, route work to
isolated worktrees, honour its locked-core mandates, and merge
without stranding initiatives. It does NOT ensure forge can
**evaluate whether a change made the project better**.

The trafficGame collision/elevation arc (PR #57, merged 2026-05-23)
hammered this gap into view. Over 31 + 3 commits the simulation was
rebuilt twice — the FIFO-cell intersection model torn out, the
geometric back-edge walk built, the elevation model iterated three
times (3-level, body-aware footprint, binary). Each iteration was
judged not by tests but by **two scalars** measured by an in-sim
grading harness:

- **throughput in vehicles per simulation-second** on the locked
  crossroads testmap
- **severe-overlap count** (pairs at distinct elevations would short-
  circuit; same-elevation within 20 px is a true crash)

Unit tests said every iteration of the elevation model was correct.
The numbers said only the third was actually better than the second.
Without that pair of holistic scalars there is no way to settle the
question agentically — every prose argument about "this should be
cleaner" loses to "the throughput dropped 30%."

## The missing clause — C7

A complete forge↔project contract for measurement-driven loops needs:

**C7 — Holistic project metrics with a measurement command and
locked baselines.** A project declares at least one holistic outcome
metric, a script or command that produces it, and a baseline file
that records the current locked value. Every initiative on the
project must check the metric and either preserve the baseline within
a declared tolerance or document the regression and update the
baseline deliberately.

What this looks like concretely:

- **A metric command**: like `npm test` for C1, but for holistic
  performance. trafficGame's analogue is the sweep harness
  (`node scripts/grading/sweep-*.mjs`) plus the locked
  `docs/baselines/*.md` files. Each sweep takes ~10 s wall-clock
  with 8 parallel workers — cheap enough to run per-PR.
- **Locked baseline files**: machine-readable (CSV/JSON) and
  human-readable (markdown). The locked numbers are part of the repo,
  so the architect/PM/dev-loop can read them as part of brain
  context.
- **A regression budget**: explicit. trafficGame uses ±1% on the
  roundabout r=300 = 1.921 v/sim-s and grid s=60 = 1.236 v/sim-s
  baselines. Anything outside that is a deliberate trade-off the PR
  must explain.
- **Negative examples**: the screenshot index includes designs that
  scored badly. Without these, an agent only sees what passed and
  can't learn what failure modes to watch for.

## Why tests aren't enough

Tests cover **correctness under specific conditions**: "given input X,
the function returns Y." A passing test suite proves nothing about
overall system performance. trafficGame's 788 traffic + network +
scoring tests passed throughout the three-iteration elevation arc.
The tests did not flag:

- Cars deadlocking on the elevated split-grid at s=120 (0.222 v/sim-s
  in a 60-s sim — observable only in a sweep).
- 18 false-positive severe overlaps from grade-separated cars
  geometrically aligning (observable only by reading the overlap
  events in the sweep raw JSON).
- The entry-jam at the ground stub → elevated H ramp (observable
  only by mid-sim screenshot at the jam time).

A unit test that says "two cars at different elevations don't yield"
is a single assertion. A holistic metric that says "throughput is
3.314 v/sim-s at 0 severe overlaps over 60 sim-s with 12 active
flows" is a system-level claim. Both are needed; the latter is the
one forge currently lacks as a contract clause.

## Implications for the forge architecture

If C7 lands as a contract clause, several downstream changes follow:

1. **The architect skill must consume the locked baselines**, not just
   the brain themes and code. A queryable representation of "the
   current locks" should be part of the project's machine-readable
   architecture context (C4 extended).
2. **The PM skill must produce WIs that include a measurement step**,
   not just unit tests. The acceptance criterion is "metric within
   regression budget" not just "tests pass."
3. **The reviewer must compare against the baseline**, not just
   inspect the diff. This is where eval-driven-development moves from
   principle to enforcement.
4. **A new project-onboarding skill** should walk the operator through
   setting up the holistic metric for a project: what's the outcome,
   what's the command, what are the current baselines, what's the
   regression budget?

## Open question — what makes a good holistic metric

trafficGame's metric (throughput + severe count) is good because:

- It's a **single pair of scalars** — easy to compare.
- It's **physically measurable** in the running sim (not derived).
- It has a **stable testbed** (the crossroads testmap with 12 fixed
  flows is reproducible).
- It produces a **score-delta** every run (not a binary pass/fail).
- Bad scores are **visualizable** (the screenshot index).

Not every project has a metric this clean. A documentation project's
holistic outcome is "is the doc actually useful"; a CLI tool's is
"does the user complete their task." Forge's onboarding skill should
help an operator find the cleanest metric available — even an
imperfect proxy beats no metric, because it converts prose arguments
to score deltas.

## Sources

- [`projects/trafficGame/scripts/grading/runSweep.mjs`](../../../projects/trafficGame/scripts/grading/runSweep.mjs) — the measurement engine.
- [`projects/trafficGame/docs/baselines/`](../../../projects/trafficGame/docs/baselines/) — the locks.
- PR #57 — the arc that demonstrated the gap.

## Related

- [Theme: Forge↔project onboarding contract](./forge-project-onboarding-contract.md) — C1–C6 (C7 extends).
- [Theme: Eval-driven development](./eval-driven-development.md) — the principle this clause enforces.
- [Theme: Parametric design search](./parametric-design-search.md) — the ideation pattern C7 enables.
- [Theme: Phase isolation benchmarks](./phase-isolation-benchmarks.md) — forge's own analogue (benchmarks/<phase>/).
