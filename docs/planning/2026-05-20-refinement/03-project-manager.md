---
area: project-manager
date: 2026-05-20
date_contracts_locked: 2026-05-21
status: contracts locked — see CONTRACTS.md
contract_deps: [C3c, C4, C5, C5a, C5b, C10, C11]
---

# PM refinement plan

> **Contracts locked.** This plan honours [CONTRACTS.md](./CONTRACTS.md).
> Where this plan and `CONTRACTS.md` disagree, `CONTRACTS.md` wins.
> Specifically: C4 (architect emits the per-feature fields PM reads),
> C5 (PM emits per-WI optional fields, `demo_hook` is **NOT** a WI field —
> it's initiative-level only per C15b), C5a (`knownFeatureIds` wiring is
> a load-bearing deliverable, not a confirmation step), C5b
> (hallucinated-FEAT = hard error with one orchestrator retry), C10
> (`benchmarks/_lib/handoff.ts` single module), C11
> (`initiatives.json` migration parses both shapes for one release),
> C3c (cross-plan filename refs).

## Problem (grounded in real PM outputs)

The PM bench is green (5/5, 100%) but **real cycles still exhibit downstream-breaking decomposition failures** that the current six structural criteria can't catch:

- **Feature hallucination.** [`_logs/2026-05-18T12-01-50_INIT-2026-05-18-trafficgame-intersection-backpressure/work-items-snapshot/WI-8.md`](../../../_logs/2026-05-18T12-01-50_INIT-2026-05-18-trafficgame-intersection-backpressure/work-items-snapshot/WI-8.md) declares `feature_id: FEAT-5`, but the manifest only has FEAT-1..FEAT-4 ([`_queue/done/INIT-2026-05-18-trafficgame-intersection-backpressure.md`](../../../_queue/done/INIT-2026-05-18-trafficgame-intersection-backpressure.md)). The event log entry confirms: `result_subtype: "error_max_turns"`, `cost_usd: 1.36`, `per_item_error_count: 1`. The bench rubric's `every_item_has_gwt` passes despite this — it scores frontmatter completeness, not manifest agreement.
- **PM-thrash on stale brain.** [`brain/projects/trafficGame/themes/2026-05-17-stale-brain-contradicts-code-pm-failure.md`](../../../brain/projects/trafficGame/themes/2026-05-17-stale-brain-contradicts-code-pm-failure.md): 8 brain reads, irreconcilable contradiction with `Glob`, full budget burned. Bench has no signal for this — `tool_use.brainReads` is recorded but unscored.
- **Architect-side rescue lifts the contract.** The betterado manifests carry **§"Scope — PM: stay inside this"** and **§"Council constraints (binding)"** sections ([`_queue/pending/INIT-2026-05-18-betterado-01-release-def-test-substrate.md:91-99`](../../../_queue/pending/INIT-2026-05-18-betterado-01-release-def-test-substrate.md)). The current PM bench fixtures don't carry these sections; PM hasn't been tested against the shape of manifests it now receives.
- **Downstream-blind scoring.** [`brain/projects/trafficGame/themes/2026-05-17-file-isolation-constraint-enables-single-iteration.md`](../../../brain/projects/trafficGame/themes/2026-05-17-file-isolation-constraint-enables-single-iteration.md) shows the cycle-of-the-century pattern: one-file-per-WI ⇒ 1-iteration dev-loop runs. PM bench doesn't currently distinguish "files_in_scope present" from "files_in_scope tight enough to avoid intra-feature contention".

## Current state
- [`docs/phases/project-manager.md`](../../phases/project-manager.md) — phase doc; success signals lean structural.
- [`docs/decisions/015-work-item-format.md`](../../decisions/015-work-item-format.md) — schema lock.
- [`orchestrator/work-item.ts`](../../../orchestrator/work-item.ts) — parse / validate / `detectHiddenCoupling` / `topologicalOrder`.
- [`orchestrator/pm-invocation.ts`](../../../orchestrator/pm-invocation.ts) — shared user/system prompt builder (incl. Step 0.5 structural `Glob`).
- [`skills/project-manager/SKILL.md`](../../../skills/project-manager/SKILL.md) — agent contract.
- [`benchmarks/project-manager/`](../../../benchmarks/project-manager/) — 5 fixtures, six 0/1 criteria, pass = 0.7.

## What "good PM output" looks like

Drawn from the merged cycles that ran clean:

- **Sizing band.** [`work-item-completion-by-domain`](../../../brain/forge/themes/work-item-completion-by-domain.md) puts develop time at 3.6–6.3 min avg per WI across 109 v1 items. World-graph-connectivity (3 WIs, 3 features, 3 single-iteration runs at $0.41–$0.52 each, 3 production files) is the gold standard; slugifier-basic (6 WIs across 3 features) matches; intersection-backpressure (8 WIs from a 4-feature manifest) is the cautionary case. Empirical floor: **~1.5–2.5 WIs per manifest feature**, capped at **≤ 8 total** unless the manifest declares >4 features.
- **GWT specificity.** Reference: [`_logs/.../WI-1.md`](../../../_logs/2026-05-18T12-01-50_INIT-2026-05-18-trafficgame-intersection-backpressure/work-items-snapshot/WI-1.md) — five criteria, each naming a typed return value or observable count. Bad smell: "and works correctly".
- **Explicit non-goals.** Slugifier WI-1 calls out "options parameter is accepted ... but may be ignored in this WI". Most WIs don't.
- **Fixture pre-staging / quality-gate command.** Today: `quality_gate_cmd` lives at the **initiative** level (e.g. `go test ./azuredevops/internal/service/release/...`). Per-WI gate is implicit (the project-wide `npm test`). [The dev-loop refinement plan (04)](./04-dev-loop.md) wants a per-WI gate; PM should emit it.
- **File-isolation discipline.** Manifest-level constraint when achievable (`world-graph-connectivity`); PM mirrors it. Non-overlapping `files_in_scope` per WI correlates 1:1 with single-iteration dev-loop completion.

## Proposed refinement

### Required WI fields

Add to the ADR-015 frontmatter (extensions; not breaking — defaults provided):

| Field | Type | Rationale |
|---|---|---|
| `quality_gate_cmd` | `string[]` (optional, defaults to manifest's) | Per-WI gate command the dev-loop runs. E.g. WI-1 = `["npm","test","--","tests/traffic/RoadSegmentMetrics.test.ts"]`. Eliminates the trivially-green pathology the e2e bench documented (slugifier rounds 5–6 in [`brain/log.md`](../../../brain/log.md)). |
| `non_goals` | `string[]` (optional) | Explicit out-of-scope items. Forces PM to state what NOT to touch — the rescue for over-eager dev-loop. |
| `verification_artifact` | `string` (optional) | Expected file/path the dev-loop must produce that the gate exercises (e.g. `tests/traffic/RoadSegmentMetrics.test.ts`). Pairs with `quality_gate_cmd`. |
| `creates` | `string[]` (optional) | Structured marker: files this WI creates from scratch. Tightens the previously-fuzzy "newly created artifact" criterion to deterministic (council 03 flag `files_real_or_explicitly_new-implementability`). |

> **`demo_hook` is NOT a WI field** (per C5 / C15b). It lives at the
> **initiative level** in the manifest body. PM does not author demos;
> the unifier (plan 04) reads `demo_hook` from the manifest for demo
> authoring.

Validation: extend [`orchestrator/work-item.ts:validateWorkItem`](../../../orchestrator/work-item.ts) — all four optional, `quality_gate_cmd` must be non-empty array if present, `files_in_scope` paths in `verification_artifact` must appear in `files_in_scope`.

**Deliverable:** ADR 015 amendment + `work-item.ts` parser/validator update.
**Files touched:** `docs/decisions/015-work-item-format.md`, `orchestrator/work-item.ts`, `skills/project-manager/SKILL.md`, `orchestrator/pm-invocation.ts`.
**Acceptance test:** existing WI files (with no extension fields) still parse + validate; new fields when present round-trip through `serializeWorkItem`.

### Sizing guidance

Locked in `pm-invocation.ts` user prompt + SKILL.md:

- **Per feature:** 1–3 WIs. <1 = under-decomposed (merge implementation + tests into one giant); >3 = the feature is two features (escalate to architect via a brain-gap note, do not silently split).
- **Per initiative:** ≤ `2 * feature_count + 2`, floor `feature_count`, ceiling 8 (matches all clean cycles in `_logs/`).
- **Per-file rule:** at most one WI **creates** a given file (and lists it in its `creates` array per C5); subsequent WIs **extend** it and `depends_on` the creator. Mirrors [`file-isolation-constraint-enables-single-iteration`](../../../brain/projects/trafficGame/themes/2026-05-17-file-isolation-constraint-enables-single-iteration.md).
- **No new features.** PM may not invent a `FEAT-N` not in the manifest. **Load-bearing fix per C5a (was incorrectly described as a confirmation step):** wire `knownFeatureIds: new Set(manifest.features.map(f => f.feature_id))` into BOTH `benchmarks/project-manager/score.ts` AND `orchestrator/cycle.ts:runProjectManager` before adding any new rubric criterion. That alone closes the WI-8/FEAT-5 case at the validator layer; the `feature_id_in_manifest` bench gate becomes belt-and-braces.
- **Hallucinated-FEAT behaviour (per C5b):** validator hard-errors on unknown `feature_id`. The orchestrator catches and re-runs PM **once** with an augmented prompt that names the manifest's feature IDs. Two failures = cycle classified failure (no silent strips).

### Bench redesign

Add three downstream-predictive criteria; rebalance weights so structural criteria stay valuable but quality leads:

| Criterion | Weight | Source |
|---|---|---|
| `feature_id_in_manifest` (gate) | gate | Every WI's `feature_id` ∈ manifest.features. The intersection-backpressure FEAT-5 case fails today. |
| `every_item_has_gwt` | 0.18 (-0.07) | Unchanged check; relative weight down because of new criteria. |
| `no_hidden_coupling` | 0.15 (-0.05) | Unchanged. |
| `one_creator_per_file` | 0.12 (new) | At most one WI per file lists it in `files_in_scope` AND has no `depends_on` mentioning a predecessor that also lists it. |
| `quality_gate_cmd_present` | 0.10 (new) | When the initiative declares an `iteration_budget` > 5 (i.e. non-trivial), every WI carries a `quality_gate_cmd` OR the WI's body declares why the manifest-level gate suffices. |
| `files_real_or_explicitly_new` | 0.10 (new) | Every `files_in_scope` path either exists on disk in the fixture's `project_tree` OR appears in the WI's `creates: <path>` array (structured marker per C5). Deterministic, not NLP-based — tightened per council 03 flag `files_real_or_explicitly_new-implementability`. |
| `parallel_fraction_meets` | 0.10 | Unchanged. |
| `work_item_count_in_range` | 0.10 | Range derived from manifest feature_count (`fc..2*fc+2`). |
| `every_item_lists_scope` | 0.10 | Unchanged. |
| `graph_emitted_valid` | 0.05 | Unchanged. |

Pass threshold stays 0.7. Brain-cite check stays unscored but emitted (`tool_use.brainReads`).

**Deliverable:** `benchmarks/project-manager/scoring.ts` + `scoring.test.ts` + README update.
**Files touched:** `benchmarks/project-manager/{scoring.ts, scoring.test.ts, score.ts, README.md}`, `benchmarks/project-manager/initiatives.json` (range derived; **migration per C11** — both shapes parseable for one release: compute range from manifest topology when absent; fall back to hardcoded `min/max_work_items` / `parallel_fraction_at_least` if present with a deprecation log line; drop hardcoded values in a follow-up after the next clean bench pass).
**Acceptance test:** old fixtures still pass at ≥0.7 with new rubric; replay intersection-backpressure PM output (synthesised from `_logs/.../work-items-snapshot/`) ⇒ scores < 0.7 (the FEAT-5 hallucination + 8-WI count for 4 features both fail). **Round-trip test** (per council 03 dx flag): a pre-amendment WI without the new fields serialises byte-identically.

### Cross-phase contract

- **Architect-bench-out → PM-bench-in.** [Plan 02 (architect)](./02-architect.md) will emit one initiative manifest per architect bench case; PM bench consumes these manifests directly via `benchmarks/_lib/handoff.ts` (single canonical module per C10). Replaces today's hand-written fixture initiatives. Each manifest carries: `features[]` with `depends_on`, `quality_gate_cmd`, `non_goals`, `hard_constraints` (per C4 — architect emits all of these). Bench harness picks N architect outputs and runs PM against them, scoring with the rubric above.
- **PM-bench-out → Dev-loop-bench-in.** [Plan 04 (dev-loop)](./04-dev-loop.md) will consume `{WI-N.md, _graph.md, quality_gate_cmd}` triples; PM bench writes those triples to `benchmarks/project-manager/results/<iso>/handoff/<fixture-id>/` so the dev-loop bench can pick them up via `loadPmHandoff(fixtureId)` (exported from `benchmarks/_lib/handoff.ts`). Closes the loop: architect → PM → dev-loop benches chain.

**Deliverable:** `benchmarks/_lib/handoff.ts` (exports `loadArchitectHandoff` + `loadPmHandoff`, per C10), score.ts updates.
**Acceptance test:** wired smoke — running architect bench then PM bench then dev-loop bench in sequence consumes prior outputs with no manual editing.

## Betterado walkthrough

### `INIT-2026-05-18-betterado-01-release-def-test-substrate`

Manifest: 4 features, `quality_gate_cmd: go test ./azuredevops/internal/service/release/...`, explicit Council constraints ("5 mock unit tests per resource"), explicit PM scope-narrowing.

**Where current PM slips:**
- FEAT-1 (characterization tests for existing resource) is naturally one big WI but the bench's parallel-fraction-meets criterion (0.3 floor) pushes PM toward splitting — possibly into 5 sub-WIs per the Council's "5 mock unit tests" enumeration. That puts five WIs editing the same `resource_release_definition_test.go` ⇒ hidden coupling. Current PM resolves by chaining `WI-1 → WI-2 → ... → WI-5` (serialised), which scores fine on `no_hidden_coupling` but produces a linear chain → dev-loop has 4 sequential single-iteration runs ⇒ wasted parallelism.
- FEAT-4 (docs + example) lives in `docs/resources/` + `examples/`; with the new `non_goals` field PM could state "no Go code edits in this WI" — closes the over-eager-dev-loop pathway.

**What refined PM produces** (5 WIs, target):
| WI | Feature | files_in_scope | quality_gate_cmd |
|---|---|---|---|
| WI-1 | FEAT-1 | `azuredevops/internal/service/release/resource_release_definition_test.go` (creates) | `go test ./azuredevops/internal/service/release/... -run TestReleaseDefinition` |
| WI-2 | FEAT-2 | `resource_release_definition.go` (extends; depends_on WI-1) | same |
| WI-3 | FEAT-3 | (extends WI-2's file; depends_on WI-2) | same |
| WI-4 | FEAT-4 docs | `docs/resources/release_definition.md`, `examples/release_definition/` | `go build -mod=vendor ./...` (cheap doc-only gate) |

Parallel-fraction relaxed because manifest features are linearly chained (FEAT-1 → FEAT-2 → FEAT-3 → FEAT-4); the new bench reads `min_parallel_fraction` from manifest topology, not a flat 0.3.

### `INIT-2026-05-18-betterado-02-release-folder`

Manifest: 3 features, `depends_on_initiatives: [01]`. FEAT-2 (data source) and FEAT-3 (docs) both `depends_on: [FEAT-1]` but not each other ⇒ **sibling-parallel**.

**Where current PM slips:** the dependency-edge sibling-parallel inheritance rule (`pm-invocation.ts:144`) is correctly stated in the prompt but only enforced as a soft criterion. Without the new `feature_id_in_manifest` gate + the manifest-derived parallel-fraction, a chain `WI-1 → WI-2 → WI-3` here would still pass bench. Refined PM with manifest-topology-derived `min_parallel_fraction = 2/3` (≥66% of WIs runnable after the FEAT-1 root) would fail-score that chain and force the correct sibling layout.

**What refined PM produces** (3 WIs, all `depends_on: [WI-1]` for WI-2 and WI-3, neither on the other), with per-WI `quality_gate_cmd` scoped to `release/...`.

## Open questions for the operator

1. ~~`quality_gate_cmd` location of truth.~~ **Decided (C5):** PM emits per-WI when tighter than initiative; otherwise inherits from feature/initiative.
2. **`one_creator_per_file` strictness.** Should a WI that adds a single function to an existing file count as "creator"? Recommended: no — "create" means file did not exist pre-WI. (Pairs with the `creates: <path>` structured marker per C5.)
3. ~~Hallucinated-FEAT behaviour.~~ **Decided (C5b):** hard error at validator with single orchestrator retry naming the manifest's feature IDs. No silent strips.
4. **Manifest-derived sizing band.** Should `min_work_items = feature_count` be enforced even when one feature is a no-op (e.g. betterado FEAT-4 docs)? Recommended: yes, with the `non_goals` field absorbing the slack.
5. ~~Demo-hook scope.~~ **Decided (C5 / C15b):** initiative-level only, NOT a WI field. Manifest body owns it.
6. **Bench fixture refresh cadence.** Plan keeps all 5 hand-written + adds 2 architect-handoff cases (council 03 lean). Revisit once the architect bench's handoff is well-exercised.

## Dependencies on other refinement plans

- **[02-architect.md]** — defines the manifest fields PM bench reads (`hard_constraints`, `quality_gate_cmd`, `non_goals` per-feature). PM-plan needs architect-plan to emit these.
- **[04-dev-loop.md]** — consumes the new `quality_gate_cmd`/`verification_artifact` WI fields. Dev-loop bench needs PM-plan's per-WI gate output shape.
- **[05-reviewer.md]** — `demo_hook` feeds the reviewer's demo-plan; reviewer plan needs PM-plan's field.

## Acceptance criteria for THIS refinement

1. Bench rubric scores **≥ 0.7 on all 5 current fixtures** (no regression) with the new criteria + weights.
2. Bench rubric scores **< 0.7 when fed the intersection-backpressure 8-WI/FEAT-5 snapshot** as a regression fixture (the hallucination case must visibly fail).
3. PM run against `INIT-2026-05-18-betterado-01` produces a 4–5 WI decomposition (no more), all `feature_id ∈ {FEAT-1..FEAT-4}`, with per-WI `quality_gate_cmd` populated.
4. Architect-bench-out → PM-bench-in chain wired and demonstrated on at least one betterado initiative end-to-end without manual fixture editing.
5. Brain themes updated: `work-item-completion-by-domain.md` adds 2026-05 datapoints (slugifier, intersection-backpressure, world-graph-connectivity).
6. ADR 015 amended (not replaced) with the extension fields + a §"Refinement 2026-05-20" log entry. **Serialisation rule spelt out**: new fields are only serialised when present (omit-on-undefined). A round-trip test in `work-item.test.ts` asserts that a pre-amendment WI produces byte-identical frontmatter.
7. `docs/phases/project-manager.md` updated with the new fields + sizing band + hallucinated-FEAT recovery flow (per council 03 dx flag — was implied but uncalled).
