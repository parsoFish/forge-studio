---
plan: 03-project-manager
councilled_at: 2026-05-21
critics: ceo, eng, design, dx
---

# Council review — 03-project-manager

## Headline

Plan is well-grounded — every cited path resolves, the FEAT-5 hallucination
and 8-WI/4-feature mismatch in `_logs/.../intersection-backpressure/` is
real, and the proposed downstream-predictive criteria attack the exact
pathology that gets through the current 100%-green bench. The biggest risk
is **cross-plan contract drift**: the plan assumes 02-architect emits
`quality_gate_cmd` / `non_goals` / `hard_constraints` per-feature, but
02-architect.md mentions none of those fields. If 02 doesn't change, half
the new PM bench criteria have nothing to score against.

## Mechanical flags (auto-applicable)

### `eng:cross-plan-filename-drift`
**Issue:** Plan links to `[04-developer-loop.md](./04-developer-loop.md)` in three
places (lines 33, 90, 135), but the file on disk is
`docs/planning/2026-05-20-refinement/04-dev-loop.md`. Same drift applies to
the in-prose reference "the dev-loop refinement plan (04)".
**Proposed fix:** Replace `04-developer-loop.md` with `04-dev-loop.md`
everywhere in 03-project-manager.md.

### `eng:plan-number-mismatch-in-cross-refs`
**Issue:** 04-dev-loop.md refers to "**PM plan (02)**" (line 255, 381) when
PM is plan 03 and architect is plan 02. Symmetric problem: the PM plan's
own §"Dependencies on other refinement plans" lists "**[02-architect.md]**"
correctly but the dev-loop plan disagrees. Future readers will follow the
wrong link.
**Proposed fix:** Either fix the dev-loop plan's references (out of scope
for THIS plan) or add a one-line note in 03's §Dependencies noting the
dev-loop plan's mis-numbering so the reader doesn't get lost. Cheapest fix:
correct 04 in a follow-up patch.

### `eng:initiatives-json-schema-change-undocumented`
**Issue:** Acceptance bullet on l.84 says "remove hardcoded `min/max_work_items`
per fixture" from `benchmarks/project-manager/initiatives.json`. The current
file (verified) has `expected.min_work_items` / `max_work_items` /
`parallel_fraction_at_least` on every entry. Removing these silently
changes the score.ts contract; no migration story for in-flight bench runs
or for `benchmarks/project-manager/results/` historical comparison.
**Proposed fix:** Add a "Migration" sub-section: keep both shapes parseable
for one release (compute range from manifest topology if absent, fall back
to hardcoded values if present) and emit a deprecation log line. Drop
hardcoded values in a follow-up after the next clean bench pass.

### `eng:knownFeatureIds-already-implemented`
**Issue:** Plan claims the FEAT-5 hallucination is uncaught by the bench.
True for the bench rubric — but `orchestrator/work-item.ts:validateWorkItem`
**already** rejects unknown `feature_id` if `knownFeatureIds` is passed
(`work-item.ts:113-115`). The actual bug is that the bench harness +
`runProjectManager` aren't wiring `knownFeatureIds` from the manifest. The
plan's parenthetical "(confirm bench passes `known_feature_ids`)" hides
this — it's the load-bearing fix, not a confirmation step.
**Proposed fix:** Promote to its own deliverable: "Wire
`knownFeatureIds: new Set(manifest.features.map(f => f.feature_id))` into
both `benchmarks/project-manager/score.ts` and
`orchestrator/cycle.ts:runProjectManager` before adding any new rubric
criterion." That alone closes the WI-8/FEAT-5 case at the validator layer,
and the `feature_id_in_manifest` gate becomes a bench-side belt-and-braces.

### `eng:files_real_or_explicitly_new-implementability`
**Issue:** New criterion l.75 requires every `files_in_scope` path to
"exist on disk in the fixture's `project_tree` OR appear in an acceptance
criterion's `then` clause as a newly-created artifact." The "appears in
then-clause" check is fuzzy NLP (the criterion is a free-text string); not
mechanically verifiable without an LLM-judge. Other new criteria
(`one_creator_per_file`, `quality_gate_cmd_present`) are deterministic.
**Proposed fix:** Tighten to "OR the WI body explicitly states `creates: <path>`
as a structured marker" — or move this criterion behind an LLM-judge sub-rubric
analogous to architect-bench's judge layer, and drop it from the 0/1
weighted criteria. The PM bench has stayed cheap precisely because
everything is mechanical; introducing one fuzzy criterion erodes that.

### `dx:adr-015-amendment-vs-extension-clarity`
**Issue:** Acceptance criterion 6 says "ADR 015 amended (not replaced) with
the extension fields + a §'Refinement 2026-05-20' log entry." But the four
new fields change the schema visible to anything that reads WI files
(serializeWorkItem round-trip will emit them). Today serializeWorkItem
unconditionally writes seven frontmatter keys; adding four optional ones
changes diff output for every WI written after the change.
**Proposed fix:** Spell out in the ADR amendment that the new fields are
**only serialised when present** (omit-on-undefined). Add a test in
`work-item.test.ts` asserting that round-trip of a pre-amendment WI
produces byte-identical frontmatter.

## Escalations (taste decisions for the operator)

### [CEO] Is PM the most leveraged plan to refine right now?
- **Yes, refine PM next** — Every cycle since 2026-05-10 that wedged did so
  in dev-loop or review, but the **root cause** in 3 of 4 documented wedges
  was a PM decomposition antipattern (FEAT-5 hallucination, linear chains
  hiding parallelism, file-coupling forcing send-backs). Fix PM, fewer
  downstream rescues needed.
- **No, refine review (05) first** — The operator's stated north-star
  (unattended operation) is bottlenecked by review send-back rounds, not by
  PM output quality. The intersection-backpressure cycle still merged
  cleanly despite the FEAT-5 hallucination — the dev-loop just spent extra
  budget. Reviewer reliability is the demand-side fix.
- **No, lock cross-plan contracts (02 → 03 → 04) before deepening any one
  plan** — Right now 02-architect.md doesn't promise `quality_gate_cmd`,
  `non_goals`, or `hard_constraints` per-feature, but 03 assumes they
  arrive. Decide the manifest shape first, then refine PM against the
  locked shape.

### [Eng] `quality_gate_cmd` location of truth (also Open Q1 in the plan)
- **Per-WI emit, manifest-inherit fallback** — Matches the plan's "lean";
  closes the trivially-green pathology in slugifier rounds 5–6; mirrors
  what dev-loop plan 04 actually wants.
- **Manifest-only, never per-WI** — Simpler; one source of truth; PM doesn't
  invent gates. Cost: same-file siblings can't have per-WI gates that scope
  to one impl.
- **Per-feature emit (architect's job, not PM's)** — Push the contract
  upstream. PM inherits; never invents. Most consistent with "the planner
  encodes intent; the dev-loop reads it."

### [Eng] Hallucinated FEAT behaviour (Open Q3 in the plan)
- **Hard error (fail the cycle)** — Plan's lean. Forces architect-PM
  misalignment to be visible immediately. Cost: a cycle that would have
  merged at 7/8 WIs aborts.
- **Auto-strip extras + warn** — Permissive; cycle completes with the valid
  subset. Cost: hides drift; the next time the architect emits 4 features,
  PM may again invent a 5th and the warning gets ignored.
- **Hard error at validator, but the orchestrator catches and routes back to
  PM with a "you invented FEAT-5; the manifest has FEAT-1..FEAT-4" prompt
  for a single retry** — Best of both: visible failure mode, automatic
  recovery, no silent stripping.

### [DX] Bench fixture refresh (Open Q6)
- **Keep all 5 hand-written + add 2–3 architect-handoff cases** — Safest
  for regression coverage; the 5 fixtures are calibrated against six
  criteria today and removing them invalidates the only "known clean"
  baseline.
- **Replace all 5 with architect-bench output** — Tighter coupling;
  surfaces architect-PM drift faster; cheaper to maintain. Risk: if
  architect bench changes shape, PM bench breaks too.
- **Keep 1 curated per project (5) + add 2–3 architect-handoff** — Plan's
  lean; reasonable middle ground.

## Per-critic verdict

### CEO
- flags: 0
- escalations: 1
- summary: Aligns with the north-star (preserves unattended operation by
  catching decomposition bugs at PM-end rather than in dev-loop budget).
  The operator-value claim is concrete: 3 of 4 documented wedges trace to
  PM. Scope is cohesive but the cross-plan contract risk is real — see CEO
  escalation.

### Engineering
- flags: 5
- escalations: 2
- summary: The strongest section of the plan is the grounding (paths
  verify, the FEAT-5 case is genuine). The weakest is the cross-plan
  contract: 02-architect.md has zero mentions of `quality_gate_cmd`,
  `non_goals`, `demo_hook`, or `hard_constraints`. The `knownFeatureIds`
  wiring is the load-bearing fix the plan understates. One new criterion
  (`files_real_or_explicitly_new`) needs sharpening to stay mechanical.

### Design
- flags: 0
- escalations: 0
- summary: PM is internal; the plan correctly stays away from
  operator-facing surface. `demo_hook` is the only operator-touching
  field, and it's deferred to the reviewer plan's contract — appropriate.

### DX
- flags: 1
- escalations: 1
- summary: Schema churn is the main maintainability concern: four new
  optional fields land in ADR 015 + `work-item.ts` + serialisation +
  bench. The plan handles this reasonably (extensions, defaults provided)
  but should spell out the omit-on-undefined serialisation rule and add a
  round-trip test. No new external deps. Operator runbook: the plan
  doesn't update `docs/phases/project-manager.md` — implied but not in
  the file-touch list. Minor.

## Recommended next action for the operator

1. **Resolve the CEO escalation first** (PM next vs. review next vs.
   contracts first). If you choose "contracts first", merge 02 + 03 + 04
   refinement into a single cross-plan-contract initiative before deepening
   any one of them.
2. **Apply the 6 mechanical flags** before slicing into initiatives —
   especially `eng:knownFeatureIds-already-implemented`, which changes the
   shape of the first deliverable.
3. **Decide Open Q1 (`quality_gate_cmd` location) and Open Q3 (hallucinated
   FEAT behaviour) explicitly** in the plan before slicing — both ripple
   into the architect and dev-loop plans.
4. **Confirm 02-architect.md will emit** `quality_gate_cmd` + `non_goals` +
   `hard_constraints` per-feature, or rewrite this plan's §"Cross-phase
   contract" against what 02 actually promises.
