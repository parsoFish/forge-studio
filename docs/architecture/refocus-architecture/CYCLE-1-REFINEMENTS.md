# Refinements from the first real cycle (re-review, 2026-06-04)

> The first real release-component cycle (INIT-2 `release_folder`, PR #6) succeeded mechanically
> but exposed four meta-faults. A forge-wide re-review (5 facets) traced each to the line. This is
> the consolidated, sequenced execution plan. PR #6 stays **unmerged** (validation artifact);
> `release_folder` is re-run clean once these land.

## What the cycle exposed

WI-1 wrote the *entire* small resource (schema + CRUD + 5 tests) in one pass → WI-2's gate was
already green → `gate-too-loose` **false-failure** → WI-3 (dependent) **skipped** → F3 (acc test +
docs) silently undelivered — yet shipped as `pr-open` success, with the PR + recap **overclaiming**
F3. Plus: a broken relative demo link, a phantom "Visual Changes"/video section on a media-less
harness demo, and a thin metric-table-only demo. **Three recurring meta-faults:** ceremony that
doesn't earn its keep (the feature layer), reporting not grounded in git-truth, templates assuming
more than the cycle produced — plus a decomposition/gate-misfire.

---

## R1 — Remove the feature layer (LOCKED) · initiative → work-items

**New model:** the **architect** emits initiatives whose body carries vision + **Given/When/Then
acceptance criteria** (no `features[]`). The **PM** decomposes the initiative's ACs **directly** into
outcome-sized work-items; WI deps stay `depends_on` (intra-initiative DAG, unchanged mechanics);
cross-initiative ordering stays `depends_on_initiatives` (unchanged). 4 levels → 3.

19 touchpoints (traced to the line), executed as one migration in 3 waves:

- **Schema/core:** `manifest.ts` (drop `Feature`/`features[]`/`FEATURE_ID_PATTERN`/`parseFeature`/the
  feature validation+cycle block), `work-item.ts` (drop `feature_id` + its validation + `knownFeatureIds`).
- **PM/architect:** `phases/project-manager.ts` (delete the feature-coverage/hallucination retry loop;
  `_coverage.md` → flat `_decomposition.md`; drop `pm.feature-*` events), `pm-invocation.ts` (drop the
  "Known feature IDs" block + both feature retry-augments; prompt = "decompose the ACs directly"),
  `failure-classifier.ts` (drop `pm-feature-*` modes → `pm-empty-decomposition`), `architect-runner.ts`
  (DRAFT schema/prompt emit ACs in the body, not `features[]`), `cli/architect-plan.ts` (drop the feature
  dep-graph SVG; PLAN renders initiative ACs + WIs), skills `architect`/`project-manager` (rewrite).
- **UI/docs:** `ui-bridge` `/api/manifest` (drop features map), `bridge-client` (drop `InitiativeFeature`),
  `use-graph-model` (drop feature rollup), `AgentGraphCanvas` (collapse the feature tier — WIs branch
  off dev-loop directly; drop `data-feature-hex`), `hex-detail`/`HexDetailDrawer`/`page.tsx` (drop the
  feature kind), `forge-metrics` (drop featureRows), `CLAUDE.md` (drop the feature-hex DOM line), ADR-015
  amendment + refocus-architecture docs (Architect/Project-Manager/Component-Relationships) + phase docs.

**Risk:** the UI feature-tier collapse + the DOM-as-metrics convention change (the e2e harness asserts
`data-feature-hex`). Gate with `npm run build` + `npm test` after schema, after PM/architect, after UI.

## R2 — Ground all reporting in git-truth

The cycle's false-success traces to reporting from the *plan*, not the *diff*. Introduce **one
git-truth delivery manifest** computed after the unifier: `git diff --name-only main...HEAD` ×
each WI's `creates`/`files_in_scope`/ACs → {delivered · already-satisfied-by-sibling · genuinely-absent}.

- **Add a 5th `composedUnifierGate` sub-gate: incomplete-delivery** — if any WI's declared `creates`
  paths are absent from the diff, **do not open the PR** (no more silent partial-ships).
- **Reclassify `gate-too-loose` → `complete` (`already-complete`)** when the WI's declared paths *are*
  present on the branch (a sibling delivered them) — kills the false-failure + the dependent-skip cascade.
- **Drive the PR body, demo ACs, cycle report, and reflector from this manifest** — author from "what
  git shows landed," never the WI spec list. (Fixes the F3 overclaim.)

## R3 — Fix the stale PR/demo templates

- **PR `## Demo` link:** remove the broken relative `../demo/…` from the unifier skeleton
  (`unifier-invocation.ts`); let `pr.ts:embedDemoInPr` emit the branch-absolute blob link (and dedup any
  existing `## Demo` before appending).
- **Shape-aware demo sections:** `renderDemoMarkdown` + `buildVisualChangesSection` →
  "Test Evidence" (harness) / "CLI Diff" (cli-diff) / "Visual Changes" only when screenshot/video exist.
  No more phantom video/visual section on a harness demo.
- **Validate the parity vocabulary** (`match|within|diverged|incomplete`) in `validateDemoModel` (the
  cycle used `pass` → silently unstyled) + document it in the demo skill + `demoInstructionsForShape`.
- **Strip orchestrator scratch** (`AGENT.md`, `fix_plan.md`) from the demo `diffStat`.

## R4 — Fix the gate-too-loose cross-WI misfire + PM sizing

- **`loops/ralph/stop-conditions.ts` / `runner.ts`:** 3-way gate check — gate-passes + *no new commits
  vs main* → hollow (`gate-too-loose`, as today); gate-passes + *branch already has commits* (sibling
  delivered) → `already-complete` / status `complete`, **not failed**.
- **`developer-loop.ts`:** wire `WI.creates[]` into `requiredPaths` so gate-tightening also requires the
  WI's declared outputs to land on the branch before "complete".
- **PM sizing rule (skill):** one WI = one independently-runnable AC; if WI-N's gate can only pass by
  writing the same file WI-(N-1) needs, **merge them** (the gate-overlap anti-pattern). This is what
  would have made `release_folder` a single WI.

## R5 — Rich, INTERACTIVE demo that demonstrates the new capability

> Operator vision (2026-06-04): the review page must be **interactive** — you *exercise and explore*
> the new capability there, not read a table. Demo-ability is designed with interactivity in mind, and
> is **project-specific** (a provider, a UI app, an API each demo differently → a project-side skill).

- **Author from git-truth + add intent fields:** `DemoModel` gains `usage_example` (the HCL/CLI/API the
  operator can now run to use the new capability) + `impact` (what it unlocks / next capability). Mandate
  them for new-capability initiatives in the demo skill.
- **Sync the UI to the schema:** `bridge-client.ts` `DemoModel` is stale (missing `summary`/`apiDiff`/
  `testEvidence`/`filesChanged`); add them + the two new fields, and have `DemoComparison.tsx` render all
  sections (the schema is the contract; the UI must mirror it).
- **Wire the project demo-skill (live evidence):** the unifier reads `.forge/project.json` `demo.skill`
  (e.g. betterado's `ado-demo`: `terraform apply` → API GET → portal screenshot → `destroy`) and attempts
  the **live capability demonstration** first, falling back to harness only if creds are absent (stating so).
- **Interactive review experience (design):** the `/review/<cycleId>` screen becomes explorable — an
  interactive diff/usage view + (for live-capable projects) the *actual created resource* surfaced
  interactively (e.g. the ADO release-folder the new code creates), the post-build counterpart to the
  architect's interactive PLAN gate. This is the demo facet's higher bar; designed per project shape via
  the project demo-skill.

---

## Sequencing

| Wave | Scope | Gate |
|---|---|---|
| **A** | R1 feature-layer removal (schema → PM/architect → UI/docs) | build + test after each sub-step |
| **B** | R2 git-truth reporting + R4 gate-misfire fix (interlock — both touch dev-loop/unifier/gate) | build + test; unit tests for the delivery-manifest + 3-way gate |
| **C** | R3 template grounding + R5 demo richness + interactive review | build + test; render a sample DEMO.html + review screen and eyeball |
| **D** | **Re-run `release_folder` clean** — expect ONE WI, no false failure, F3 delivered, rich/interactive demo, PR opened only on complete delivery | a real cycle + verify outcomes |

Then the betterado roadmap (INIT-1 etc.) runs on the simplified, git-truthful, interactive-demo forge.
