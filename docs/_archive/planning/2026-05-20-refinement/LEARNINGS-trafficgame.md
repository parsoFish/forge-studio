---
doc: learnings
source: trafficGame post-S0 (2026-05-21 → 2026-05-23)
date: 2026-05-23
status: canonical reference for refinement plans
---

# trafficGame learnings post-S0 — "what good looks like" for refined forge

These are the patterns + outcomes the operator drove through trafficGame
in the two days after S0 (contract lock). They're captured here as
**exemplar outputs** — i.e. when a refined forge phase runs, these are
the shapes it should be able to produce, or learn from when iterating.

Each learning links to the plan(s) it amends. The amendments themselves
live inline in those plans.

## Summary

Between S0 (2026-05-21) and 2026-05-23 the operator drove a single
sprawling arc: PR #57 (commit `69d8552`, 31+3 commits, ~3000 LOC) that
started as scoped backpressure wiring
(`INIT-2026-05-19-trafficgame-backpressure-live`) and grew into a
complete rebuild of intersection-handling, a three-attempt iteration on
elevation, the introduction of a parametric grading harness with locked
baselines, and 14 curated screenshots. The arc was operator-driven
conversationally because forge's current pipeline has no shape for
**scientific exploration** (parameter sweeps measured against a
holistic outcome). The five themes the operator crystallised (two
project, three forge-level) plus the cycle archive at
`brain/_raw/cycles/2026-05-23_trafficgame-elevation-grading-arc.md`
are the explicit forward-looking payload that should land in the
refinement plans.

## Learnings

### L1: Holistic metric + locked baseline is the missing onboarding contract clause

**Surfaced:** Throughout the elevation iterations, 788 unit tests stayed
green while real throughput collapsed (e.g. 0.222 v/sim-s at s=60 from
elevation-blind collision-avoidance) and 18 false-positive severe
overlaps slipped past. *"Tests verify did this break; metrics verify
did this help."*

**Worked:** Two scalars per run — `vehicles per sim-second` and
`severe-overlap count` — measured by `scripts/grading/runSweep.mjs`
against a fixed crossroads testmap, with
`docs/baselines/grading-frontier-{roundabouts,grids,cross-theories}.md`
locking the numbers (`r=300=1.921`, `s=60=1.236`) at ±1% tolerance.
Every commit checked vs the locks.

**Folded into:** **C26** (holistic metrics contract clause —
`.forge/project.json` gains `metric_command` + `baselines_dir`);
plans 02 (architect consumes locks), 03 (PM emits measurement WIs),
05 (reviewer compares vs locks), 04 (`forge.project.json` schema).

**Source:** [`brain/forge/themes/holistic-metrics-onboarding.md`](../../../brain/forge/themes/holistic-metrics-onboarding.md), `projects/trafficGame/docs/baselines/`, PR #57.

### L2: Exploration initiatives are a structurally different initiative type

**Surfaced:** The PR #57 arc had no obvious AC ("find the highest-throughput
design") and ran conversationally over multiple sessions because the
implementation-initiative shape (feature → WI → file scope → AC)
couldn't carry "sweep a parameter space and lock a champion."

**Worked:** A counterfactual `type: exploration` manifest with
`metric_command`, `locked_baselines`, `parameter_space`, `hypothesis`,
`budget` — PM emits sweep-batch WIs (coarse → fine → regression check
→ screenshot+doc) instead of feature-decomposition WIs; dev-loop runs
the harness rather than writing code; reviewer compares score-deltas +
visually inspects screenshots.

**Folded into:** **C27** (exploration vs implementation manifest types —
architect emits a `type:` discriminator); plans 02 (new manifest type),
03 (sweep-batch WI shape), 04 (harness-runner mode), 05 (score-delta
verdict shape), 06 (reflector captures score-trajectory + which
hypotheses worked).

**Source:** [`brain/forge/themes/exploration-vs-implementation-initiatives.md`](../../../brain/forge/themes/exploration-vs-implementation-initiatives.md).

### L3: A 30-line theory + parallel-worker harness collapses ideation cost

**Surfaced:** Hand-running designs at 2-3/hour was the bottleneck on
map-design exploration. With sweeps the agentic rate is ~8/minute.

**Worked:** `scripts/grading/runSweep.mjs` (~250 lines reusable: parallel
worker pool of 8 Playwright contexts + shared queue + dev-server wiring
+ measurement protocol + CSV/MD/JSON output). New theory = ~30 lines
(param range + draw function). One sweep (10 params × 60 sim-s × 20×
time-scale) = ~10s wall-clock. Pattern generalises to any project with
a parameter space + holistic metric + reproducible testbed (web app
cache TTL, compiler inlining, ML LR, scheduler quantum).

**Folded into:** Plan 04 — new project-agnostic `project-sweep` skill
skeleton (forge-provided abstract harness; per-project plug-ins for
start command, draw function, measurement extractor). Sits alongside
`benchmarks/<phase>/` runners but at the project level.

**Source:** [`brain/forge/themes/parametric-design-search.md`](../../../brain/forge/themes/parametric-design-search.md), `projects/trafficGame/scripts/grading/runSweep.mjs`.

### L4: Score-without-visualisation is a false positive

**Surfaced:** The body-aware footprint approach reported
`s=120 = 2.286 v/s` until the screenshot showed 18 grade-separated cars
counted as "severe overlaps." Pure numbers lie.

**Worked:** `docs/baselines/screenshots/INDEX.md` curates mid-sim
screenshots (~20-25 sim-s) tagged with throughput + severe count,
including **negative examples** (polygon-N12=0.414 v/s 14 severes;
elevation-deadlock at s=60). Each new champion gets a screenshot or
the result is provisional.

**Folded into:** Plan 05 (reviewer's verdict shape includes visual
confirmation — non-optional, not afterthought). Plan 04's demo contract:
a sweep harness's "demo" is the screenshot+score pair.

**Source:** [`brain/forge/themes/parametric-design-search.md`](../../../brain/forge/themes/parametric-design-search.md) § "Anti-pattern: don't sweep without visualising", `projects/trafficGame/docs/baselines/screenshots/INDEX.md`.

### L5: Operator load reduces to hypothesis-formation + approval

**Surfaced:** Mapping the trafficGame arc against the proposed exploration
shape: the operator's load-bearing contributions were (a) choosing
architectural direction (FIFO → back-edge walk → binary model), (b)
naming failure modes from screenshots ("cars flickering up/down",
"yielding across levels"), (c) pivoting between theories when one
failed. The 30+ sweep runs, regression checks, capture-notable
invocations, doc updates, and PR description writes were all
automatable.

**Worked:** Operator-as-hypothesis-generator interleaved with autonomous
parametric exploration; the brain themes encode the hypotheses and
prior negative results so the architect can propose new ones.

**Folded into:** Plan 02's plan-doc operator artefact (the hypothesis
handoff structure); plan 06 (reflector captures score-delta trajectory
+ which hypotheses worked).

**Source:** [`brain/_raw/cycles/2026-05-23_trafficgame-elevation-grading-arc.md`](../../../brain/_raw/cycles/2026-05-23_trafficgame-elevation-grading-arc.md) § "Decision points / Automatable steps".

### L6: Single-source-of-truth model collapses three layered hacks

**Surfaced:** Three failed elevation attempts (3-level colouring,
body-aware footprint spanning both levels, route-segment span elevations)
all carried partial elevation information in multiple places — every
consumer had its own interpretation, producing spurious yields and
over-conservative behaviour.

**Worked:** Binary model — `vehicle.currentElevation` is the single
point read by everyone (`CollisionAvoidance.currentSegElevation`,
`OverlapTracker.currentSegElevRange`, `VehicleUpdate.couldRoutesCollide`).
Three transition rules update it. Future-route segments evaluated at
target, not span. Throughput went from plateau 2.905 to 3.314 v/sim-s.

**Folded into:** Plan 03 (PM's `detectHiddenCoupling` flags when WIs
imply the same fact needs reading from multiple files); plan 06
(reflector extracts this kind of project-agnostic principle into forge
themes).

**Source:** [`brain/projects/trafficGame/themes/2026-05-23-binary-elevation-model.md`](../../../brain/projects/trafficGame/themes/2026-05-23-binary-elevation-model.md), ADR `projects/trafficGame/docs/decisions/adr-collision-architecture-2026-05-22.md`.

### L7: $-budget gates were never load-bearing — iteration caps are

**Surfaced:** The arc spent $-tier money but iteration caps prevented
runaway. The two real "burned the budget" case studies (betterado $534
silent drop, intersection-backpressure thrash) were caused by **bad PM
decomposition**, not lack of $-cap.

**Worked:** C19 — strip all $-thresholds (per-WI $1.0 cap, unifier
$1.50 cap, two bench criteria `cost_budget_respected` + `cost_within_unifier_budget`,
aggregate-budget gate, auto-escalation). Keep `cost_usd` per-event JSONL
(data) + `cost_tick` derived consumer (data). PLAN.md surfaces aggregate
cost as informational only.

**Folded into:** Already ratified as C19 in CONTRACTS.md. This learning
*validates* C19 was the right call — and motivates Plan 08 (token
economy) as the **positive** counterpart (lower the natural cost rather
than police it).

**Source:** [`CONTRACTS.md`](./CONTRACTS.md) § C19 (operator-authored
quote), commit `d61e258`.

### L8: Demo / verification gate must be the *real* artefact, not jsdom

**Surfaced:** Earlier in the arc (PR #56, 2026-05-19), the
overlay-darken bug had unit tests passing for the broken iteration
because `jsdom`'s `getImageData` throws → graceful-degrade hides the
regression. The operator only believed the fix once Playwright +
measured-pixel luminance ran (43.93 → 17.43, stable across 12 hover
cycles).

**Worked:** Real-browser luminance measurement is the only honest gate
for visual / canvas / physics correctness. The `canvas-bpr-flow-tests`
pattern is project-elevated to a mandate.

**Folded into:** Plan 04's `demo.shape: browser` must mean a real
browser, not jsdom. Reinforces C2 (demo.shape taxonomy).

**Source:** [`brain/projects/trafficGame/themes/2026-05-10-ui-canvas-overlay-pattern.md`](../../../brain/projects/trafficGame/themes/2026-05-10-ui-canvas-overlay-pattern.md) § "Reusable lesson", [`brain/_raw/cycles/2026-05-19_trafficgame-overlay-darken-fix-arc.md`](../../../brain/_raw/cycles/2026-05-19_trafficgame-overlay-darken-fix-arc.md) § "Trust + verification lesson".

### L9: Scope-creep is structurally invisible to the current spec model

**Surfaced:** The original `INIT-2026-05-19-trafficgame-backpressure-live`
manifest scoped 2 features and `iteration_budget: 14`. What actually
landed: 5 dead source files removed, new `CollisionAvoidance.ts`, new
`OverlapTracker.ts`, binary elevation rewrite, `scripts/grading/` (8
sweep scripts + library + capture-notable + README), 14 PNG screenshots,
3 frontier docs, ADR. ~3000 LOC. The PM/architect contract had no way
to flag this growth.

**Worked:** Honest retrospective archive (`brain/_raw/cycles/2026-05-23_trafficgame-elevation-grading-arc.md`)
explicitly distinguishing "original scope" from "actual scope landed"
and tracing **how the scope grew** — each fix exposed the next
structural problem.

**Folded into:** Plan 06 — reflector produces a structured scope-delta
artefact when actual-landed work diverges from the manifest. Plan 02 —
exploration-type manifests treat `iteration_budget` as a hint, not a
contract (per C27).

**Source:** [`brain/_raw/cycles/2026-05-23_trafficgame-elevation-grading-arc.md`](../../../brain/_raw/cycles/2026-05-23_trafficgame-elevation-grading-arc.md) § "Origin and scope-creep".

### L10: Brain freshness is itself a load-bearing artefact for autonomous loops

**Surfaced:** PR #56 retrospectively documented that
`INIT-2026-05-19-trafficgame-backpressure-wiring` failed because forge
did not `alignLocalToRemote` before `git worktree add` for dependents —
dev-loop re-implemented FEAT-1/2 against stale local `main`. Separately,
brain themes pre-2026-05-23 said "elevation gives no measurable lift on
crossroads" (true at the time, but the operator's split-grid intuition
required the brain to *not* claim closure on the topic).

**Worked:** `2026-05-10-campaign-mode-state.md` shows the discipline:
explicit "History (do not regress to these)" header + dated PR
references + reference to the failure pattern
(`stale-brain-contradicts-code-pm-failure`). Theme updates with
`updated_at` distinct from `created_at`. Themes don't only record
success — they record what's "not built / future direction (do not
pick up without an initiative)."

**Folded into:** Plan 01 — staleness detection scope `cycle-touched-themes`
already in C7. Plan 06 — reflector proposes theme updates when arc
results contradict an existing theme. Architect (Plan 02) — must trust
theme `updated_at` and recency markers.

**Source:** [`brain/projects/trafficGame/themes/2026-05-10-campaign-mode-state.md`](../../../brain/projects/trafficGame/themes/2026-05-10-campaign-mode-state.md) (updated_at 2026-05-18), [`brain/_raw/cycles/2026-05-19_trafficgame-overlay-darken-fix-arc.md`](../../../brain/_raw/cycles/2026-05-19_trafficgame-overlay-darken-fix-arc.md).

## Cross-cutting themes

- **The measurement layer is missing across the board.** Every learning
  (L1, L3, L4, L7) returns to "you need a holistic metric + locked
  baseline; tests are not enough; visuals are not optional." One
  architectural addition (C26 metrics contract clause) with
  implications down every phase.
- **Exploration is a first-class operational mode forge currently lacks.**
  L2 + L5 + L9 point at the same gap: the architect/PM/dev-loop/reviewer
  pipeline is implementation-shaped. A second pipeline shape
  (exploration-shaped) is the deliverable, not a flag on the existing
  one (C27).
- **Operator load = hypothesis + approval; everything else is automatable.**
  L5 reframes "autonomy" as "compress the operator's surface to two
  activities." Recurs in Plan 02 (plan-doc artefact), Plan 05
  (PR-comment review), Plan 06 (slash-command write-timing C9).
- **Single source of truth beats layered fixes.** L6 (binary elevation),
  L8 (real browser not jsdom), and the C19 budget removal (L7) are all
  "stop carrying the same fact in multiple places with multiple
  interpretations." A meta-pattern the reflector should learn to surface.

## Picks (operator pre-decisions surfaced in this batch)

The agent surfaced 5 open questions. My picks for ratification — flag any
to override before slicing:

| # | Open question | Pick | Why |
|---|---|---|---|
| 1 | Metrics contract: new plan or fold? | **Fold (as C26 + amendments to plans 02-05)** | Not a separate plan — it's a contract decision (one `.forge/project.json` field, one architect read, one reviewer check). |
| 2 | Projects without a clean holistic metric | **Accept "implementation-only" projects** (`type: exploration` initiatives unavailable for them); C27 makes this explicit | Don't force a proxy metric where none exists; some projects only get implementation cycles. |
| 3 | `project-sweep` skill location | **Forge-provided abstract skeleton, per-project plug-ins** | Generalises trafficGame's `runSweep.mjs` shape; same north-star pattern as architect-council. |
| 4 | Scope-creep: `scope_can_grow` flag or `type: exploration` only? | **`type: exploration` only** | One mechanism, not two. Implementation manifests are scope-firm by definition. |
| 5 | Screenshots in project repo? | **Yes (current trafficGame pattern)** | Visual reference is load-bearing for the project's own readers; aligns with C2's "demo bundle is tracked, not gitignored". |

## Where these land — index of amendments

| Learning | Amends | New C-decision |
|---|---|---|
| L1 holistic metrics | Plans 02, 03, 04, 05 | **C26** |
| L2 exploration manifest type | Plans 02, 03, 04, 05, 06 | **C27** |
| L3 project-sweep skill | Plan 04 | (none — sub-skill of the dev-loop unifier) |
| L4 visual confirmation | Plans 04, 05 | folded into C26 |
| L5 operator load = hypothesis+approval | Plans 02, 06 | (none — reinforces existing C9, C12) |
| L6 single source of truth | Plans 03, 06 | (none — bench criterion in plan 03's `detectHiddenCoupling`) |
| L7 C19 validation | (no amendment — confirms) | (validates C19) |
| L8 real browser, not jsdom | Plan 04 | folded into C2 |
| L9 scope-creep visibility | Plans 02, 06 | folded into C27 |
| L10 brain freshness | Plans 01, 02, 06 | folded into C7 |
