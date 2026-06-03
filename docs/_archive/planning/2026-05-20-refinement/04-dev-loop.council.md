---
plan: 04-dev-loop
councilled_at: 2026-05-21
critics: ceo, eng, design, dx
---

# Council review — 04-dev-loop

## Headline

Largest refinement in the set: a new unifier sub-phase + demo contract + branch-sync invariant + bench redesign. The plan is well-grounded in real cited paths (per-WI Ralph at `developer-loop.ts:62-350`, `embedDemoInPr` at `pr.ts:75-191`, the removed budget guard at `reviewer.ts:67-77`) and the betterado walkthrough is concrete. But the proposal **smuggles three distinct concerns** under one heading (unifier loop, demo contract, branch hygiene closure) and **introduces a new project-level `forge.config.json` whose location collides** with the existing forge-root `forge.config.json.example` (per-machine, ADR 009). The biggest unknown: per-project demo kinds (`browser | harness | cli-diff | artifact | none`) vs. the existing per-checkpoint demo taxonomy (`screenshot | video | harness`) in `skills/demo/SKILL.md` — same word, different axis.

## Mechanical flags

### `eng:F1`-config-location-collision
**Issue:** Plan §"Demo contract" + §"Onboarding contract" puts `forge.config.json` at the **project root**. The existing file by that exact name (`forge.config.json.example` at forge root) is **per-machine** config (ADR 009 — `projectsDir`, `scheduler.maxConcurrentInitiatives`, `notify.*`). Two files with the same name, different schemas, different roots, different lifecycles — load-bearing ambiguity for anyone reading the codebase a year from now. The plan acknowledges this in OQ#2 but doesn't pick.
**Proposed fix:** Rename one. Either project file is `forge.project.json` / `.forgeproject` / `.forge/project.json`, or per-machine file is `forge.machine.json`. Decide before the unifier starts reading any path.

### `eng:F2`-demo-kind-taxonomy-overlap
**Issue:** Existing `skills/demo/SKILL.md` defines a `kind` field at the **checkpoint** level: `screenshot | video | harness`. The plan defines `demo.kind` at the **project** level: `browser | harness | cli-diff | artifact | none`. `harness` appears in both with different semantics (in SKILL.md it's a Node/test measurement; in the plan it's the whole project's demo shape). A reader hitting either name will guess wrong.
**Proposed fix:** Either rename the project-level field (`demo.shape` instead of `demo.kind`) or call out the overlap explicitly in both docs and reuse `harness` to mean exactly one thing.

### `eng:F3`-unifier-budget-unsourced
**Issue:** "3 iterations / $1.50" is admitted as a guess (OQ#3). The per-WI cap is 5 iter / $1.0; the unifier is given 60% more $ for 60% fewer iterations. The justification ("browser demo install can spend $0.20 just on infrastructure") is plausible but unmeasured. Worse, browser-kind unifier on trafficGame will pay Playwright install cost from `orchestrator/demo-runtime.ts:installDeps` every fresh worktree — that's an OS-level network cost, not an LLM cost, so it doesn't actually justify a larger $ cap.
**Proposed fix:** Land the unifier with an `iterationCap` and pull the $ cap from `CycleInput` (already plumbed for per-WI). First bench pass calibrates. Don't hard-code $1.50.

### `eng:F4`-demo-contract-coverage-gap
**Issue:** The five managed projects in `projects/` are trafficGame (UI), terraform-provider-betterado (Go provider), and three others. The plan claims all are covered by `browser | harness | cli-diff | artifact | none`. Specifically unclear: healarr/simplarr/env-optimiser shapes — only one (simplarr) is named explicitly under `cli-diff`. The cited bp-demo path (`projects/trafficGame/bp-demo.html`) **does not exist** at that path today — there's `projects/trafficGame/demo/` with `INIT-…` bundles instead. Citation is stale; suggests the demo shape for trafficGame is also evolving.
**Proposed fix:** Before locking the taxonomy, enumerate each of the five managed projects with the proposed `kind` value and one-line reasoning. Catch the misfits before bench fixtures depend on them.

### `eng:F5`-i2-asserted-only-via-error
**Issue:** §"Branch + worktree hygiene" I2 says `assertLocalRemoteSynced` is called at unifier close and throws on divergence (good). But the current dev-loop pushes per-WI and **never** asserts at close — the comment at `developer-loop.ts:298-301` admits "the hard invariant is asserted once at close (below)" with no implementing code. A refinement that fixes this should call it out as a **bug fix on existing code path**, not a side effect of adding the unifier.
**Proposed fix:** Split into two acceptance criteria: (a) add `assertLocalRemoteSynced` at current dev-loop close *today* (small PR, low risk); (b) wire it into unifier exit. AC#7 covers (b); add (a) explicitly.

### `eng:F6`-migration-of-embedDemoInPr
**Issue:** Plan §"PR-as-self-contained-review-window" says `embedDemoInPr` survives as PR-body composer only; the unifier writes to the tracked path directly, no `.forge/demos/<id>/` shadow. But `pr.ts:75-191` today **reads** from `.forge/demos/`, then **copies + commits + composes**. The refactor splits one function into two phases owned by different actors (unifier writes; PR phase composes). The plan doesn't list which existing call sites break or how the transition lands without a flag (CLAUDE.md forbids "for backwards compatibility" paths — so this must be atomic).
**Proposed fix:** Acceptance criteria list explicit call-site edits: (1) `pr.ts:openPullRequest` no longer calls `cpSync`; (2) `pr.ts:embedDemoInPr` signature becomes `(worktree, initiativeId, branch, trackedDemoDir) → bodyBlock | null`; (3) reviewer call site removed per AC#4. Make these granular so the dev-loop refinement can't ship without the review refinement landing in sync.

### `design:F7`-failure-mode-for-unifier-gate-cap
**Issue:** When the unifier hits its 3-iteration cap WITHOUT passing the four composed gates (`initiative_gate`, `demo_runs_clean`, `pr_self_contained`, `branches_in_sync`), what does the operator see? The per-WI loop has the `pm-thrash-no-converge` classifier-equivalent precedent. The plan mentions a "classifiable failure (`pm-thrash-no-converge` classifier-equivalent for dev-loop)" only inside I2. No surface defined for "demo couldn't be authored" vs "initiative gate failed against branch tip" — these have very different operator responses.
**Proposed fix:** Define three classified failures: `dev-loop-unifier-gate-failed`, `dev-loop-unifier-demo-failed`, `dev-loop-unifier-branch-divergence`. Map each to the operator inbox (the cycle's stop reason).

### `dx:F8`-onboarding-checklist-fail-mode
**Issue:** OQ#4 raises fail-closed vs fail-open for missing project config. Inclination: fail-closed at onboarding, silent-default once registered. That last clause ("silent-default once registered") is a **drift-tolerance feature flag in disguise** — it lets config rot through unattended cycles, which violates north-star #1 (preserve unattended operation by *failing loudly when invariants break*, not by silently defaulting).
**Proposed fix:** Always fail-closed when `forge.<whatever>.json` is missing or invalid at cycle start. The scheduler should refuse to schedule that initiative and surface in the operator queue. No silent defaults.

### `dx:F9`-no-runbook-for-adding-new-project
**Issue:** The plan implies "every new project must declare demo shape" but doesn't list where the runbook lives. `docs/phases/developer-loop.md` is named in AC#6 ("onboarding checklist documented") but the structure (one-page checklist? per-kind playbook? troubleshooting?) is left to implementation taste.
**Proposed fix:** AC#6 should say: "`docs/phases/developer-loop.md` gains an `## Onboarding a project` section with: (a) checklist; (b) one worked example per `kind` (cross-link to managed-project configs); (c) failure-mode table."

## Escalations

### [eng] Should the unifier own `embedDemoInPr`'s commit step entirely, or share with the PR-open path?
- **Unifier owns the commit, PR-open is read-only on the tracked path** — clean separation, matches §"Branch + worktree hygiene" I4 (never rebase mid-dev-loop). PR phase just composes body.
- **PR-open still commits if the unifier didn't** — defensive, but smells like dual ownership.
- Inclined: option 1, with an `assertTrackedDemoExists` gate at PR-open entry that throws (not silently re-commits) if missing.

### [eng] Per-WI quality_gate_cmd vs per-initiative?
- **Per-initiative only** — simplest, matches today's `CycleInput.qualityGateCmd`. PM lifts it to manifest.
- **Per-WI override allowed** — handles a refactor WI that intentionally breaks a test the next WI fixes. But this is the "stacked PR" antipattern we've already banned.
- Inclined: per-initiative only. Per-WI ACs are still per-WI; the **gate command** is one.

### [design] PR-as-sole-review-window for `kind: "none"` initiatives — silent or rationale block?
- **Rationale block always** — matches the theme's invariant ("the PR is the operator's review surface"). A reviewer hitting a `none` PR sees "no media, here's why".
- **Silent for `none`** — less noise, but breaks the "PR is self-contained" promise for the operator who hasn't read the manifest.
- Inclined: rationale block. OQ#1 already inclines this way; lock it.

### [dx] Where does `forge.<project>.json` live and what is it called?
- **`<project>/.forge/project.json`** — hidden, namespaced under existing `.forge/` convention, doesn't pollute project root.
- **`<project>/forge.json`** at project root — visible, but pollutes (one file per tool the project is in).
- **`<project>/.forgerc`** — rc-file convention, less standard for JSON.
- Inclined: `.forge/project.json` — uses the existing scratch dir's namespace; .gitignore can carve out just this file as tracked while everything else under `.forge/` stays untracked.

### [ceo] Is the right scope for THIS refinement "unifier + demo + branch hygiene" or only "unifier"?
- **All three (as written)** — they truly couple: the unifier authors the demo + asserts branch sync. Splitting creates a half-state where the review phase still owns demo prep.
- **Unifier only; demo contract is its own refinement** — cleaner narrative, two smaller bench surfaces. But the unifier has nothing to demo-gate against without the contract.
- Inclined: keep all three together but make the **call-site removals in `reviewer.ts`** (§AC#4) a single atomic commit so neither phase ends up half-owning PR prep.

## Per-critic verdict

### CEO
- flags: 0 mechanical (escalations only)
- escalations: 1
- summary: Strategically right — review-phase scope creep was real, north-star #1 (unattended operation) is directly served by reducing review's surface to verdict-only. The risk is bundling three concerns under one initiative slice. Acceptable if AC#3+#4 ship atomically; reject if they can land independently.

### Engineering
- flags: 6 (F1-F6)
- escalations: 2
- summary: Heaviest critique surface. The plan cites real paths and the betterado walkthrough is concrete enough to bench. Three mechanical sharpenings needed before slicing: (1) resolve the config-name collision; (2) disambiguate `kind` taxonomy; (3) make the `embedDemoInPr` refactor's call-site edits explicit so the dev-loop and review refinements can't ship out of sync. Don't hard-code the $1.50 cap.

### Design
- flags: 1 (F7)
- escalations: 1
- summary: PR-as-sole-review-window invariants from `brain/forge/themes/pr-as-sole-review-window.md` are preserved (visibility detection unchanged, default-to-private kept). The gap: classified failure surfaces for the unifier's three distinct failure modes — operator needs to see which gate broke, not just "unifier capped".

### DX
- flags: 2 (F8, F9)
- escalations: 1
- summary: The onboarding tax is real but tolerable IF fail-closed everywhere and a runbook exists. The "silent-default once registered" inclination in OQ#4 must be rejected — it's an unattended-operation hazard. No new external dependencies introduced (Playwright already used by trafficGame, `gh` already required). Acceptable cost.

## Recommended next action for the operator

Decide three things before slicing this plan into initiatives:

1. **Config file name + location** (escalation [dx]) — pick `.forge/project.json` or rename the per-machine file. One-line ADR amendment.
2. **`kind` taxonomy disambiguation** (F2) — either rename the project-level field to `demo.shape` or document the overlap in both `skills/demo/SKILL.md` and the new project config schema.
3. **Atomicity of the `embedDemoInPr` refactor** (F6 + CEO escalation) — confirm the dev-loop refinement and the review refinement (plan 05) will land in a single PR or as a coordinated stacked pair (with the squash-merge ban acknowledged).

Then this plan can slice into: (a) `assertLocalRemoteSynced` at current dev-loop close (small, today); (b) project config schema + onboarding checklist (small); (c) unifier sub-phase + bench redesign + reviewer call-site removals (large, atomic with plan 05).
