# QUARRY — every production file, its owner package, and how it moves

This file is **load-bearing**, not a planning note: `scripts/check-owner.mjs` reads it
and fails CI when a production file has no row, has two, or names an owner or a
disposition outside the vocabularies below. A file that changes owner changes this
file in the same PR.

**Scope.** Every production file under `orchestrator/`, `cli/`, `loops/`,
`skills/`, `packages/` and `apps/forge/` — code (`.ts .tsx .mjs .js .cjs`) plus the `SKILL.md` agent definitions,
which are production artifacts ([SPEC §1](./SPEC.md):
the `SKILL.md` **is** the agent), in either discovery-root shape SEAM F1
(`packages/kernel/discovery-roots.ts`, operator ruling item 81) makes real: the
top-level `skills/<slug>/SKILL.md` and a package's own
`packages/<pkg>/skills/<slug>/SKILL.md`. Test files and fixtures are excluded — a test
travels with the module it tests. A `flow.yaml` (top-level `studio/flows/<id>/flow.yaml`
or its package-owned `packages/<pkg>/flows/<id>/flow.yaml` counterpart) is **not** in
scope here, deliberately: the top-level form was never production by this gate's own
rule (`studio/` is not a quarried tree and `.yaml` is not a code extension), so the
package-owned form gets the identical treatment rather than net-new scope invented for
it — neither counted nor owned by `check-owner.mjs`.

**Owner** is one of the nine packages plus the two apps named by
[`docs/roadmaps/1.0.md`](docs/roadmaps/1.0.md) §0 and §4 M2, and described in the
blueprint spec
[§3](docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md). D-29
ratifies that layout and is **proposed, not yet accepted** — it is parked at the
operator gate H5 (`1.0.md` §5), so this file cites the roadmap and the spec,
which are on `main`, rather than an ADR that is not. **Disposition** is how the
file reaches its package at M3:

| disposition | meaning | count |
|---|---|---|
| `verbatim` | moves unchanged | 367 |
| `pruned` | moves, with a part that belongs elsewhere dropped on the way | 4 |
| `rewritten` | **cannot** move without a behaviour change; stays where it is until rewritten | 142 |
| `deleted` | not carried forward | 0 |

## Per-file 800-line ratchet — ratified raises

`scripts/baselines/file-size.json` records every file already over the 800-line cap and
REFUSES growth on any of them ("an exemption is a debt, not a licence"). The file is strict
JSON keyed by path, and `check-file-size.mjs` reports any key that is not an existing file as
`stale` and fails — so a raise's reason CANNOT live beside its entry. It lives here.

| file | raise | reason |
|---|---|---|
| `apps/studio/lib/bridge-client.ts` | **1,517 → 1,519** | **M6-C, `forge-8vfn.7.6.132`, T1 ruling 1134.** ONE payload field (`canStartDevelopment?: boolean`) plus its one-line doc, so the roadmap card reads the server's verdict instead of re-deriving it. The rule itself (`isRunnableSource`) is in `packages/contracts`, and the boolean is computed in `bridge-studio.ts` — which is why the card went the other way, **870 → 869**. A field cannot cost less than a line: this is the measured minimum, not a rounded allowance. **The split is owed and minted for M7.** 666's spirit applied to the file ratchet — a measured, minimal, recorded raise is not the licence the guard's wording warns against; the licence is the raise nobody writes down. |

## Per-package LOC caps

Spec §8: "Per-package LOC cap (starting values from the QUARRY.md targets)". A
package that would exceed its cap parks; the fix is a cull, a split, or an
operator-ratified new cap — never a silent raise.

| package | files | quarried LOC | cap | note |
|---|---|---|---|---|
| `contracts` | 9 | 1,782 | **1,782** | ratified 1,782 — forge-mfv5.1.27: `fixRoundOf` beside `isAwaitingKickoff`, `Run.fixRound`, and the pure delivered-head reader + named head verdict; +43 measured on main 1,739, lane-ratified (≤100, ruling 666). |
| `kernel` | 39 | 6,743 | **5,609** | ratified 5,609 — forge-nk1y.8: one safe URL decoder (`url-decode.ts`, a named `MalformedUrlEncodingError`) on top of the spend-ceiling derivation; +32 measured on main 5,577, lane-ratified (≤100, ruling 666). |
| `library` | 63 | 17,108 | **16,992** | ratified 16,992 — +65: installCommunityHookPackage/installSkillPackage adopt stage-then-rename, G2 staged community install (forge-8vfn.8.5.2); see git history for prior raises. |
| `projects` | 53 | 11,871 | **10,074** | ratified 10,074 — forge-mfv5.1.23: Save merges its forge-studio PR only on green required checks and GitHub's CLEAN (pure verdict over one graphql read), `--auto` only when allowed; +100 measured on main 9,974, lane-ratified (≤100, ruling 666). |
| `knowledge` | 44 | 13,499 | **12,918** | ratified 12,918 — forge-mfv5.1.15: the project-brain analyze plan carries the operator's revision notes and the revise-in-place instruction; +18 measured on main 12,900, lane-ratified (≤100, ruling 666). |
| `agents` | 44 | 12,504 | **12,532** | ratified 12,532 — row 211 (forge-8vfn.8.5.47): the `FORGE_AGENT_SPAWN` overlay, +50 (measured ceiling), lane-ratified under ruling 666; see git history for prior raises. |
| `sessions` | 65 | 21,283 | **21,245** | ratified 21,245 — forge-mfv5.1.15: the project-brain Revise with notes route, its verdict history, revise turn and no-change refusal; +151 on main 21,094, operator ruling 2026-10-10 (R43, T1 ask). |
| `flows` | 91 | 25,502 | **25,303** | ratified 25,303 — forge-nk1y.21: `docs-gate-argv.ts`, the plan-time argv check for a `forge gate docs` work-item gate (a `-`-prefixed or unsafe operand is refused naming it); +75 measured on main 25,228, lane-ratified (≤100, ruling 666). |
| `factory` | 17 | 3,073 | **2,297** | ratified 2,297 — F3 re-attribution of the station executor to `stations` (operator ruling items 81/83); see git history for prior raises. |
| `stations` | 48 | 12,644 | **12,644** | ratified 12,644 — forge-nk1y.21: the docs verb argv carries a `--` end-of-options marker; +1 measured on main 12,643, lane-ratified (≤100, ruling 666). |
| `forge-docs` | 3 | 352 | **352** | ratified 352 — introduced as a NEW ROW at G3 (the second factory; operator items 73/81), exact measured total, no headroom; see git history for detail. |
| `apps/forge` | 37 | 8,762 | **800** | the spec states "CLI router + bridge host (≤800 lines)". The quarried total is 10,089 — a 9,289-line debt, all four files marked pruned or rewritten. This cap is a TARGET the move must reach, not a baseline. R4 row 205 (forge-8vfn.8.5.54): 8,041 → 8,366 (+325) for the Studio serve supervisor and its exit sequencing, ratified at the measured figure by T1 1973mu (operator veto open until merge, handoff Q35); `flows` +21 net (cap 24,918) in the same PR. |
| `apps/studio` | 0 | 0 | — | the `git mv` of `forge-ui`; it quarries nothing from these four trees. |
| `apps/docs` | 0 | 0 | — | the published docs site (R20), owner `apps/docs`; it quarries nothing and imports nothing from the product (`check-boundaries.mjs` rule `docs-app-imports-product`). Its content is pages, not production code: word ceilings (`check-docs-budget.mjs --strict`) bound it, not a LOC cap. |
| **total** | **513** | **135,123** |  | F3 (operator ruling, items 81/83): +2 files / +150 lines — `class-profile-port.ts` and `stations/index.ts`, the only genuinely new content in an otherwise pure `factory → stations` transfer (10,905 lines moved, re-attributed, no change to this total). |

## Three numbers that are findings, not targets

1. **`apps/forge` is 9,289 lines over its stated cap.** The spec fixes the router and
   bridge host at ≤800 lines; the four files that land there quarry 10,089, of which
   `apps/forge/ui-bridge.ts` alone is 6,602. Three of the four are marked `rewritten` and one
   `pruned` for exactly this reason: the host is a monolith that mixes generic
   plumbing with route handlers belonging to five packages. Reaching 800 is the
   single largest piece of M3/M4 work this quarry surfaces.
2. **`contracts` quarries one file, 738 lines, against a ~0.3k target.**
   `orchestrator/studio/types.ts` is the only file in the tree that is purely types
   with no runtime behaviour. It moves `verbatim` and is then pruned to what
   `apps/studio` actually imports.
3. **Eleven files are `rewritten` and therefore do NOT move at M3.** Each straddles two or
   more packages, and rewriting one here would be a behaviour change smuggled into a
   move. They are listed together below so the M4 lanes inherit them explicitly.

### The `rewritten` set — files that stay put until their package rewrites them

| path | owner | LOC | why it cannot move as-is |
|---|---|---|---|
| ~~`cli/bridge-studio-affordances.ts`~~ | `sessions` | 1,313 | **CARVED (M4-sessions s5, ruling 87).** The dispatch is `packages/sessions/bridge-studio-sessions-affordances.ts`; the per-kind arms it inlined went to their own kinds (`kinds/{instructions,demo-builder,kb-cleanup,authoring}.ts`, the last two minted identity-only by ruling 87) and the shared shell to `bridge-studio-sessions-affordance-shell.ts`. The route is table entry 37 in `packages/sessions/routes.ts`, after cancel. |
| `apps/forge/bridge-studio-writes.ts` | `projects` | 2,482 | one route file writing agent SKILL.md, community entries, project scaffolding and flow.yaml |
| `apps/forge/bridge-broadcast-log.ts` | `apps/forge` | 84 | `forge-8vfn.7.6.35` — the bridge's record of its own socket broadcasts (type, cycleId, timestamp, subscriber count). It is a FILE rather than eight lines inside `ui-bridge.ts` because folding it there grew that file 2,276 → 2,310 and `check-file-size` refused it ("an exemption is a ceiling, not a licence"); extracted, `makeRecordingBroadcast` replaces the inline function and `ui-bridge.ts` lands at 2,259 — 17 BELOW its baseline. §15.412: shrink the addition, not the cap. |
| `apps/forge/bridge-studio.ts` | `apps/forge` | 1,750 | generic CSRF/origin/JSON plumbing interleaved with flows and library GET routes |
| `cli/dry-bridge.ts` | `kernel` | 453 | one static table classifying routes owned by flows, agents and library alike |
| `apps/forge/studio-lint.ts` | `apps/forge` | 805 | validates agent, flow, catalog and community definitions in a single pass. **Owner corrected `kernel` → `apps/forge` (ruling 55, M4-knowledge s5): the `kernel` cell was unsatisfiable.** This file imports `@forge/flows` (rank 5), `@forge/sessions` (4), `@forge/agents` (3), five `@forge/library` modules — and `orchestrator/studio/{registry,validate}.ts` directly. Rule 1 ("packages never import legacy") has no rank exception, so no package at ANY rank can host it, kernel least of all; and it is a live CLI entry point (`apps/forge/cli.ts:471` backs `forge studio lint`). `apps/forge` is the one tree `classify()` gives no rule. Cell only — the two knowledge rows into it go to the host carve. |
| `packages/kernel/provenance.ts` | `kernel` | 54 | a 54-line pure mapping whose ONLY test is a 642-line bridge integration test that imports `ui-bridge.ts`; the test cannot follow it into a package without dragging the bridge across the boundary, and a kernel module with no package-level test is the shape this campaign exists to stop. Needs its pure-mapping test extracted from the integration test first. **MOVED 2026-09-03 (M4-knowledge s5): `cli/studio-provenance.ts` → `packages/kernel/provenance.ts`, with that precondition met in the same PR** — AT-3a's mapping cases are now `packages/kernel/tests/unit/provenance.test.ts` beside the module, and the bridge test keeps only what is genuinely about a route's response. The move closed the `package-to-legacy` row from `packages/knowledge/bridge-studio-kbs.ts` into this file: knowledge had to reach into `cli/` for a mapping that is "a fact every package needs and none of them owns" — kernel's own charter. |
| `apps/forge/ui-bridge.ts` | `apps/forge` | 6,602 | the 6,602-line host: agent spawn, session index and authoring routes in one file |
| `packages/agents/band-agent-run.ts` | `agents` | 242 | generic band dispatch that hardcodes two `orchestrator/phases/` imports — the port must exist first. **MOVED 2026-09-03 (M4-agents s3): `packages/agents/band-agent-run.ts`.** The port could not be `PhaseExecutor` — that returns `CycleOutcome` (`'merged'\|'pr-open'\|'ready-for-review'`), while what crosses this seam is a PIPELINE status the run's terminal `end` event and the CLI summary both read — so `BandAgentDeps` is declared in the package (ruling 59's shape) and bound at `apps/forge/band-agent-deps.ts`. The queue/manifest reads (`@forge/flows`, rank 6) ride the same object. Every guard stayed (COMMON §15.47). |
| `packages/flows/flow-runner.ts` | `flows` | 615 | M2-B replaced its ten phase imports with the `PhaseExecutor` port; the table it shed is `phases/executor-{table,deps}.ts` |
| `packages/sessions/kinds/project-brain.ts` | `sessions` | 186 | **PORTED 2026-09-03 (M4-sessions s3, ruling 60).** Was `orchestrator/project-brain-builder-runner.ts`. The brain half — `buildAnalyzePlan`, `commitProjectBrain`, `listStagedThemes`, `PROJECT_BRAIN_KIND_DIR` — left first as `packages/knowledge/project-brain-build.ts` (M4-knowledge s5, ruling 56). The 296-line residue was the SHED PLUMBING, and this port sheds it: containment preamble, guarded status read/write, logger/sink/heartbeat/thinking construction and the start/end events are now `kinds/kind-turn.ts`'s, shared by every ported kind. What is left here is the kind's IDENTITY — its phase set, its agent spec, and the two steps that do work. Its `AGENT_RUNNERS` row moved to `kinds/registry.ts` beside it; the old file is deleted. Owner cell now `sessions`, as the knowledge row predicted it would become. |
| `orchestrator/studio/registry.ts` | `kernel` | 1,180 | one loader for Agent, Flow, KB, Catalog, Community, Template and Project — five packages in one file. **DELETED 2026-09-04 (M4-library s3, ruling 113 as amended by 126/130).** Each kind left for the package that owns it across M3 and M4 — Agent to `@forge/agents`, Flow to `@forge/flows`, KB to `@forge/knowledge`, Skill/Template/Catalog/Community to `@forge/library/studio/*-registry.ts`, project discovery to `@forge/kernel` — leaving a 123-line re-export hub with 36 importers and nothing defined in it. Annotated rather than removed, matching the `band-agent-run.ts` and `project-brain.ts` rows above: this table records what the quarry FOUND and what became of it. |
| `orchestrator/studio/validate.ts` | `kernel` | 1,066 | the same split on the validation side — **four-way, not five: kernel owns only `ids.ts` and `findings.ts` (T1 ruling 159)**. **DELETED 2026-09-05 (M5-A s2).** `validateAgent` → `packages/agents/studio/validate-agent.ts`, `validateFlow` + `validateArtifactRef` → `packages/flows/studio/validate-flow.ts`, `validateKb` → `packages/knowledge/studio/validate-kb.ts`, `validateProject` + `validateDiscoveredProjects` → `packages/projects/studio/validate-project.ts`; the library validators had already gone in the M4 carve and the id/`Finding` re-exports die with the file. The KB binding cross-reference composition stays in `apps/forge/studio-lint.ts`, its only composer. `TriggerCheckOpts` was NOT promoted to `@forge/contracts`: measured, its only cross-package consumer was this file, and `validate-flow.ts` now sits beside `validate-triggers.ts` in the same package (disclosed to T1). Annotated rather than removed, matching the `registry.ts` row above. |

### `pruned` and `deleted`

| path | owner | disposition | LOC | what is dropped |
|---|---|---|---|---|
| `packages/projects/preflight.ts` | `projects` | `pruned` | 1,135 | M2-B moved its four pure report types (`ClauseId`, `ClauseResult`, `PreflightReport`, `PreflightOptions`) to `packages/kernel/project-contract.ts`, because the `ProjectGate` port declares them and flows may not import this file (SPEC.md §6); the module re-exports them |
| `packages/knowledge/brain-paths.ts` | `knowledge` | `pruned` | 141 | the project-side `.forge/` artifact-root read goes to `projects` |
| `orchestrator/cli.ts` | `apps/forge` | `pruned` | 998 | every subcommand body goes to the package that owns it; only the router stays |
| `packages/flows/flow-artifacts.ts` | `flows` | `pruned` | 437 | the develop-flow-specific artifact schemas go to `factory` |
| `packages/kernel/init.ts` | `kernel` | `pruned` | 144 | the `forge init` command shell goes to `apps/forge`; the layout constants stay |
| `orchestrator/_pkg/contracts.ts` | `contracts` | `deleted` | 12 | the one greppable shim through which legacy reaches `@forge/contracts` (§0); deleted at cutover, and `grep -rl "_pkg/contracts"` is the exact list of legacy files still depending on the package |
| `orchestrator/phases/demo-fanin-honesty.ts` | `factory` | `deleted` | 183 | dead: its only production caller was the retired unifier gate; knip and grep agree nothing reaches it |
| `packages/stations/phases/developer-loop.ts` | `factory` | `pruned` | 1,941 | the per-work-item queue and recovery bookkeeping goes to `flows` (spec §3.1: "queue/recovery → flows") |

## Every production file

| path | owner | disposition | loc |
|---|---|---|---|
| apps/forge/agent-run.ts | apps/forge | verbatim | 392 |
| packages/sessions/kinds/architect-plan.ts | sessions | verbatim | 405 |
| packages/sessions/kinds/architect-plan-html.ts | sessions | rewritten | 375 |
| packages/knowledge/brain-fix-auto.ts | knowledge | verbatim | 275 |
| packages/knowledge/brain-index.ts | knowledge | verbatim | 369 |
| packages/knowledge/brain-lint-checks-filing.ts | knowledge | verbatim | 305 |
| packages/knowledge/brain-lint-checks-graph.ts | knowledge | verbatim | 247 |
| packages/knowledge/brain-lint-checks-integrity.ts | knowledge | verbatim | 502 |
| packages/knowledge/brain-lint-checks-truth.ts | knowledge | verbatim | 219 |
| packages/knowledge/brain-lint-theme-paths.ts | knowledge | verbatim | 145 |
| packages/knowledge/brain-lint-types.ts | knowledge | verbatim | 54 |
| packages/knowledge/brain-lint.ts | knowledge | verbatim | 668 |
| packages/flows/cost-by-class.ts | flows | rewritten | 98 |
| packages/flows/demo-checkpoint-preflight.ts | flows | rewritten | 92 |
| packages/flows/bridge-hooks.ts | flows | verbatim | 394 |
| packages/flows/bridge-recovery.ts | flows | verbatim | 394 |
| packages/flows/halt-watch.ts | flows | rewritten | 38 **New file, row 207 (forge-8vfn.8.5.57):** the serve tick's view of the emergency halt — logs on transition and at most every `HALT_REMINDER_MS`. |
| packages/flows/kickoff-facts.ts | flows | rewritten | 56 **New file, forge-mfv5.1.25:** the one reader of the Kickoff-gate facts. |
| packages/flows/operator-stop.ts | flows | rewritten | 205 |
| packages/sessions/bridge-studio-sessions-affordance-shell.ts | sessions | rewritten | 385 |
| packages/sessions/bridge-studio-sessions-affordances.ts | sessions | rewritten | 458 |
| packages/sessions/bridge-studio-agent-capability.ts | sessions | verbatim | 110 |
| packages/library/bridge-studio-authoring-hook.ts | library | verbatim | 280 |
| packages/library/bridge-studio-authoring-skill.ts | library | verbatim | 64 |
| packages/library/bridge-studio-authoring-template.ts | library | verbatim | 135 |
| packages/library/bridge-studio-authoring-types.ts | library | verbatim | 24 |
| packages/library/bridge-studio-authoring.ts | library | verbatim | 514 |
| packages/library/testing.ts | library | verbatim | 23 **M7-C 2026-09-25 (bead forge-8vfn.5.31) — the one test-only subpath: `installSkillPackage`/`approveSkillDraft`/`validateCatalog`/`ComposableKind`/`fixtureFlowSource`/`loadDemoElement`/`loadInstructionSeed`/`loadCommunityRegistry`/`serializeCommunityRegistry`/`resolveCommunitySource`/`communityRegistryPath`/`COMMUNITY_REGISTRY_SCHEMA_VERSION` have no production consumer outside this package, only `apps/forge` tests reach for them.** |
| packages/library/bridge-studio-community-crud.ts | library | verbatim | 371 |
| packages/library/bridge-studio-community-hook-preinstall.ts | library | verbatim | 108 |
| packages/library/bridge-studio-community-wire.ts | library | verbatim | 254 |
| packages/library/bridge-studio-community.ts | library | verbatim | 712 |
| packages/library/bridge-studio-connections.ts | library | verbatim | 303 |
| packages/library/bridge-studio-hooks-approval.ts | library | verbatim | 145 |
| packages/library/bridge-studio-hooks-decline.ts | library | verbatim | 61 |
| packages/library/bridge-studio-hooks-detail.ts | library | rewritten | 273 |
| packages/library/bridge-studio-hooks-test-fire.ts | library | rewritten | 81 |
| packages/library/bridge-studio-hooks.ts | library | verbatim | 497 |
| packages/library/bridge-studio-instructions.ts | library | verbatim | 144 |
| packages/knowledge/bridge-studio-kb-consolidate.ts | knowledge | verbatim | 465 |
| packages/knowledge/bridge-studio-kb-drain.ts | knowledge | verbatim | 796 |
| packages/knowledge/bridge-studio-kb-routes-lifecycle.ts | knowledge | verbatim | 570 |
| packages/knowledge/bridge-studio-kb-routes-maintenance.ts | knowledge | verbatim | 632 |
| packages/knowledge/bridge-studio-kb-routes-read.ts | knowledge | verbatim | 290 |
| packages/knowledge/bridge-studio-kbs.ts | knowledge | verbatim | 773 |
| packages/sessions/bridge-studio-lifecycle.ts | sessions | verbatim | 422 |
| packages/flows/bridge-studio-runs.ts | flows | verbatim | 476 |
| packages/flows/bridge-studio-runs-review.ts | flows | verbatim | 528 |
| packages/sessions/bridge-studio-session-cancel.ts | sessions | verbatim | 211 |
| packages/sessions/bridge-studio-sessions.ts | sessions | verbatim | 696 **Ceiling re-keyed +4 (M4-sessions s3 3b, T1 ruling 83):** the ruled manifest seam (ruling 81) threads an injected port through this file — three `package-layer-order` rows closed for it. Paid down as far as the file allows before the re-key: the ports contract was extracted to `kinds/architect-ports.ts` (which returned `kinds/architect.ts` to exactly 1,584, no raise), every added comment tightened, and stale runner paths corrected. Not a licence — the next edit measures against the new number. |
| packages/sessions/session-resolution.ts | sessions | rewritten | 446 |
| packages/library/bridge-studio-skills.ts | library | verbatim | 660 |
| packages/library/bridge-studio-templates.ts | library | verbatim | 428 |
| apps/forge/bridge-studio-writes.ts | projects | rewritten | 711 |
| apps/forge/bridge-studio.ts | apps/forge | rewritten | 1215 |
| packages/library/community-refresh-cmd.ts | library | verbatim | 104 |
| packages/library/community-refresh-run.ts | library | verbatim | 621 |
| packages/library/community-registry-lock.ts | library | verbatim | 126 |
| packages/projects/contract-compliance-loop.ts | projects | verbatim | 167 |
| packages/projects/contract-stages.ts | projects | verbatim | 347 |
| packages/stations/cycle-recap.ts | stations | verbatim | 411 |
| packages/factory/class-profiles.ts | factory | rewritten | 135 |
| packages/stations/class-profile-port.ts | stations | rewritten | 133 |
| packages/stations/index.ts | stations | rewritten | 34 |
| packages/stations/gates/docs-gate.ts | stations | verbatim | 114 |
| packages/stations/phases/pm-prompt-context.ts | stations | verbatim | 139 |
| packages/stations/phases/pm-class-set-rules.ts | stations | verbatim | 46 |
| packages/stations/phases/review-budget.ts | stations | verbatim | 136 |
| packages/stations/phases/capture-nonce.ts | stations | verbatim | 58 |
| packages/stations/phases/pm-decomposition-doc.ts | stations | verbatim | 68 |
| packages/stations/phases/review-chunks.ts | stations | verbatim | 268 |
| packages/stations/phases/merge-boundary.ts | stations | verbatim | 116 |
| packages/knowledge/cycle-retention.ts | knowledge | verbatim | 204 |
| packages/factory/demo-overlay.ts | factory | rewritten | 195 |
| packages/factory/demo-capture.ts | factory | rewritten | 331 |
| packages/factory/demo-runtime.ts | factory | verbatim | 308 |
| packages/stations/demo-types.ts | stations | verbatim | 115 |
| apps/forge/library-flow-source.ts | apps/forge | rewritten | 15 |
| apps/forge/library-authoring-session.ts | apps/forge | rewritten | 30 |
| apps/forge/library-agent-facts.ts | apps/forge | rewritten | 62 |
| apps/forge/dry-bridge.ts | kernel | rewritten | 319 |
| packages/flows/flow-band-vocab.ts | flows | verbatim | 69 |
| packages/flows/forge-metrics.ts | flows | verbatim | 800 |
| packages/flows/forge-requeue.ts | flows | verbatim | 311 |
| apps/forge/forge-watch.ts | apps/forge | verbatim | 800 |
| packages/knowledge/kb-drain-edit-soundness.ts | knowledge | verbatim | 742 |
| packages/knowledge/brain-write-lease.ts | knowledge | verbatim | 137 |
| packages/knowledge/kb-drain-structural.ts | knowledge | verbatim | 230 |
| packages/knowledge/kb-job-state.ts | knowledge | verbatim | 224 |
| packages/knowledge/kb-drain-routes.ts | knowledge | verbatim | 409 |
| packages/knowledge/kb-drain-model.ts | knowledge | verbatim | 553 |
| packages/knowledge/kb-drain-store.ts | knowledge | verbatim | 483 |
| packages/knowledge/routes.ts | knowledge | verbatim | 337 |
| packages/library/routes.ts | library | verbatim | 495 |
| packages/knowledge/kb-lint-summary.ts | knowledge | verbatim | 548 |
| packages/knowledge/kb-read-policy.ts | knowledge | verbatim | 91 |
| packages/knowledge/kb-sites.ts | knowledge | verbatim | 110 |
| packages/flows/manifest-path-guard.ts | flows | verbatim | 344 |
| packages/agents/materials-staging.ts | agents | verbatim | 192 |
| packages/flows/metrics.ts | flows | verbatim | 208 |
| packages/projects/preflight-fix-auto.ts | projects | verbatim | 201 |
| packages/projects/preflight-resolve.ts | projects | verbatim | 77 |
| packages/projects/preflight.ts | projects | pruned | 291 |
| packages/projects/preflight-build.ts | projects | verbatim | 138 |
| packages/projects/preflight-demo.ts | projects | verbatim | 179 |
| packages/projects/demo-means.ts | projects | rewritten | 77 |
| packages/projects/demo-plan.ts | projects | rewritten | 95 |
| packages/projects/preflight-gate.ts | projects | verbatim | 281 |
| packages/projects/preflight-instructions.ts | projects | verbatim | 135 |
| packages/projects/preflight-release.ts | projects | verbatim | 71 |
| packages/projects/preflight-repo.ts | projects | verbatim | 224 |
| packages/projects/preflight-skills.ts | projects | verbatim | 202 |
| packages/projects/preflight-deps.ts | projects | verbatim | 175 |
| packages/projects/project-migrate.ts | projects | verbatim | 232 |
| packages/stations/reflect-reconcile.ts | stations | verbatim | 169 |
| packages/stations/reflection-doc.ts | stations | verbatim | 354 |
| packages/flows/run-list-cache.ts | flows | verbatim | 397 |
| packages/sessions/session-model-tier.ts | sessions | verbatim | 54 |
| packages/sessions/bridge-studio-instructions.ts | sessions | verbatim | 258 |
| packages/sessions/session-answer-limits.ts | sessions | verbatim | 14 |
| packages/sessions/bridge-studio-project-brain.ts | sessions | verbatim | 423 |
| packages/sessions/bridge-studio-kickoff.ts | sessions | verbatim | 788 |
| packages/sessions/bridge-studio-demo.ts | sessions | verbatim | 624 |
| packages/sessions/bridge-studio-session-index.ts | sessions | verbatim | 355 |
| packages/sessions/bridge-studio-architect.ts | sessions | verbatim | 489 |
| packages/sessions/bridge-studio-session-helpers.ts | sessions | verbatim | 580 |
| packages/sessions/routes.ts | sessions | verbatim | 462 |
| packages/sessions/session-phases.ts | sessions | verbatim | 81 |
| packages/sessions/session-readability.ts | sessions | verbatim | 259 |
| packages/library/skill-path.ts | library | verbatim | 146 |
| packages/library/skill-staging.ts | library | verbatim | 197 |
| packages/library/studio-lint-library-passes.ts | library | verbatim | 239 |
| packages/library/studio-lint-tool-fence.ts | library | verbatim | 155 |
| apps/forge/studio-lint.ts | kernel | rewritten | 724 |
| packages/kernel/provenance.ts | kernel | rewritten | 106 |
| packages/kernel/dry-bridge.ts | kernel | rewritten | 230 |
| packages/kernel/log-cycles.ts | kernel | rewritten | 70 |
| packages/kernel/bounded-log.ts | kernel | rewritten | 44 |
| packages/kernel/contained-read.ts | kernel | verbatim | 34 |
| packages/kernel/discovery-roots.ts | kernel | verbatim | 148 |
| packages/knowledge/theme-frontmatter.ts | knowledge | verbatim | 116 |
| apps/forge/ui-bridge.ts | apps/forge | rewritten | 797 |
| apps/forge/bridge-halt.ts | apps/forge | rewritten | 65 **New file, row 207 (forge-8vfn.8.5.57):** `POST /api/halt`, `POST /api/halt/release` and the `serve.halt` health read. |
| apps/forge/bridge-cycle-data.ts | apps/forge | rewritten | 381 |
| apps/forge/serve-supervisor.ts | apps/forge | rewritten | 395 |
| apps/forge/bridge-run-triggers.ts | apps/forge | rewritten | 285 |
| apps/forge/bridge-review-comments.ts | apps/forge | rewritten | 203 |
| apps/forge/bridge-agent-dispatch.ts | apps/forge | rewritten | 522 |
| apps/forge/bridge-reflect.ts | apps/forge | rewritten | 303 |
| apps/forge/bridge-safe-dispatch.ts | apps/forge | rewritten | 47 |
| apps/forge/reflection-pending.ts | apps/forge | rewritten | 92 |
| apps/forge/bridge-cycle-scan.ts | apps/forge | rewritten | 259 |
| apps/forge/bridge-http.ts | apps/forge | rewritten | 60 |
| apps/forge/bridge-broadcast-log.ts | apps/forge | rewritten | 92 |
| apps/forge/broadcast-coalescer.ts | apps/forge | rewritten | 77 |
| packages/agents/_adapters/aider/index.ts | agents | verbatim | 477 |
| packages/agents/_adapters/claude/index.ts | agents | verbatim | 29 |
| packages/agents/_adapters/conformance.ts | agents | verbatim | 203 |
| packages/agents/_adapters/example/index.ts | agents | verbatim | 111 |
| packages/agents/_adapters/gemini/index.ts | agents | verbatim | 544 |
| packages/agents/_adapters/registry.ts | agents | verbatim | 99 |
| packages/agents/_adapters/types.ts | agents | verbatim | 56 |
| packages/agents/ralph/claude-agent.ts | agents | verbatim | 577 |
| packages/agents/ralph/runner.ts | agents | verbatim | 484 |
| packages/agents/ralph/stop-conditions.ts | agents | verbatim | 800 |
| packages/agents/agent-bands.ts | agents | verbatim | 76 |
| packages/agents/agent-dispatch.ts | agents | verbatim | 372 |
| packages/agents/dispatch-terminal.ts | agents | verbatim | 194 |
| packages/agents/band-agent-run.ts | agents | rewritten | 377 |
| packages/agents/routes.ts | agents | rewritten | 134 |
| packages/agents/bridge-agents-run-state.ts | agents | rewritten | 430 |
| packages/agents/bridge-agents-history-rows.ts | agents | rewritten | 534 |
| packages/agents/bridge-agents-runs.ts | agents | rewritten | 240 |
| packages/agents/bridge-agents-slug.ts | agents | rewritten | 567 |
| packages/agents/bridge-agents-studio.ts | agents | rewritten | 640 |
| apps/forge/agent-dispatch-cmd.ts | apps/forge | rewritten | 554 |
| packages/agents/find-session-project.ts | agents | verbatim | 35 |
| packages/agents/agents-md-compose.ts | agents | verbatim | 116 |
| apps/forge/band-agent-deps.ts | apps/forge | verbatim | 63 |
| packages/sessions/kinds/architect.ts | sessions | verbatim | 355 |
| packages/sessions/kinds/architect-session.ts | sessions | rewritten | 387 |
| packages/sessions/kinds/architect-steps.ts | sessions | rewritten | 760 |
| packages/sessions/kinds/architect-stage-events.ts | sessions | rewritten | 40 The architect's per-stage `architect.<stage>.start` event, emitted before each stage's model turn (forge-8vfn.8.1.14). |
| packages/sessions/kinds/architect-structured-turn.ts | sessions | rewritten | 149 `runStructured` moved out of `architect-steps.ts` verbatim (forge-8vfn.8.1.14) to give that file headroom for the critiquing/revising phase writes. |
| packages/sessions/kinds/architect-manifest.ts | sessions | rewritten | 189 |
| packages/sessions/kinds/architect-draft-repair.ts | sessions | rewritten | 116 **New file, row 159 (forge-8vfn.8.1.47, ruling 1891):** the architect's ONE bounded draft-manifest repair turn, split out of `architect-steps.ts` (file-size budget) — mirrors `stations/phases/pm-acceptance-gate.ts`'s row-157 shape. |
| packages/sessions/kinds/architect-brain-read.ts | sessions | rewritten | 93 **New file, M7-C ABR (forge-8vfn.8.3.5, ruling 666):** the architect's own `brain.read` tally + emission, wrapping each phase's `KindStepHandler` from outside `architect-steps.ts` (near the file cap) and `kind-turn.ts` (ruling 78's hook budget). Priced into `sessions`'s cap-table raise 20,000 → 20,093. |
| packages/sessions/bash-fence.ts | sessions | verbatim | 508 |
| packages/sessions/kinds/brain-fix.ts | sessions | rewritten | 277 |
| packages/sessions/kinds/fix-turn.ts | sessions | rewritten | 384 Row 164 (forge-8vfn.8.1.51, ruling 1904): wires the shared interval heartbeat ticker around its own stream loop, stopped in a `finally`. |
| packages/sessions/kinds/fix-registry.ts | sessions | rewritten | 76 |
| packages/knowledge/brain-paths.ts | knowledge | pruned | 198 |
| packages/flows/claim-validator.ts | flows | verbatim | 397 |
| apps/forge/cli.ts | apps/forge | pruned | 793 **Ceiling re-keyed +1 (M4-sessions s3 3b, T1 ruling 83):** the ruled manifest seam (ruling 81) threads an injected port through this file — three `package-layer-order` rows closed for it. Paid down as far as the file allows before the re-key: the ports contract was extracted to `kinds/architect-ports.ts` (which returned `kinds/architect.ts` to exactly 1,584, no raise), every added comment tightened, and stale runner paths corrected. Not a licence — the next edit measures against the new number. |
| apps/forge/routes.ts | apps/forge | verbatim | 251 |
| packages/sessions/kinds/architect-critic.ts | sessions | verbatim | 449 |
| packages/projects/constraint-author.ts | projects | verbatim | 99 |
| packages/projects/constraint-blocks.ts | projects | verbatim | 257 |
| packages/flows/cron-triggers.ts | flows | verbatim | 250 |
| packages/flows/ci-gate.ts | flows | verbatim | 147 |
| packages/flows/cycle-context.ts | flows | verbatim | 383 |
| packages/flows/cycle-helpers.ts | flows | verbatim | 715 |
| packages/flows/cycle-pr-open.ts | flows | rewritten | 148 |
| packages/flows/cycle-report.ts | flows | verbatim | 31 |
| packages/flows/cycle.ts | flows | verbatim | 540 |
| packages/flows/daemon.ts | flows | verbatim | 265 |
| packages/sessions/kinds/demo-builder.ts | sessions | verbatim | 419 |
| packages/sessions/kinds/authoring.ts | sessions | rewritten | 141 |
| packages/sessions/kinds/demo-session-store.ts | sessions | rewritten | 152 |
| packages/sessions/kinds/demo-generate.ts | sessions | rewritten | 392 **Split from `kinds/demo-builder.ts` (M6-A s3, row 5 / bead `forge-8vfn.6.11.49`)** — the generate step and its six private prompt helpers, taken out when the write-then-run fix put the parent at 802 against the 800-line cap. `rewritten` rather than `verbatim`: the step's signature gains `agentSpec`, because `demoBuilderAgentSpec` is the kind's SPEC §1 identity and stays in the parent rather than being imported back as a cycle. |
| packages/sessions/kinds/kb-cleanup.ts | sessions | rewritten | 77 |
| packages/flows/docs-gate-argv.ts | flows | rewritten | 70 |
| packages/flows/drain-fix-loop.ts | flows | verbatim | 301 |
| packages/flows/enqueue-develop-run.ts | flows | verbatim | 82 |
| packages/flows/enqueue-flow-run.ts | flows | verbatim | 415 |
| packages/flows/enqueue-plan-run.ts | flows | verbatim | 236 |
| packages/agents/failure-classifier.ts | agents | verbatim | 722 |
| packages/flows/finalize-merged.ts | flows | verbatim | 519 |
| packages/flows/fix-work-items.ts | flows | verbatim | 400 |
| packages/flows/flow-artifacts.ts | flows | pruned | 440 |
| packages/flows/flow-budgets.ts | flows | verbatim | 558 |
| packages/flows/flow-run-requests.ts | flows | verbatim | 408 |
| packages/flows/flow-node-context.ts | flows | verbatim | 54 |
| packages/flows/flow-node-kind.ts | flows | verbatim | 66 |
| packages/flows/flow-runner.ts | flows | rewritten | 777 |
| packages/flows/flow-fanout.ts | flows | verbatim | 34 |
| packages/flows/flow-accepts-class.ts | flows | rewritten | 34 |
| packages/flows/flow-trigger.ts | flows | verbatim | 222 |
| packages/flows/gate-fix-loop.ts | flows | verbatim | 163 |
| packages/projects/gate-recipes.ts | projects | verbatim | 146 |
| packages/flows/initiative-id.ts | flows | verbatim | 210 |
| packages/library/instruction-seed-match.ts | library | verbatim | 152 |
| packages/sessions/kinds/instructions.ts | sessions | verbatim | 753 |
| packages/sessions/interactive-finalizers.ts | sessions | verbatim | 590 |
| packages/sessions/interactive-runner.ts | sessions | verbatim | 306 `makeHeartbeatWriter` now imported from the new `heartbeat.ts` (pure move, forge-8vfn.8.1.51 prep). |
| packages/sessions/interactive-agent-step.ts | sessions | rewritten | 739 |
| packages/sessions/interactive-session.ts | sessions | rewritten | 780 Row 164 (forge-8vfn.8.1.51, ruling 1904): wires the shared interval heartbeat ticker around `runStructuredTurn`/`runAgentTurn`'s stream loops, stopped in a `finally`. |
| packages/sessions/heartbeat.ts | sessions | rewritten | 109 Row 164 (forge-8vfn.8.1.51, ruling 1904): adds `startHeartbeatTicker`, the interval ticker every SDK-call path shares — see the function's own doc comment. |
| packages/sessions/turn-cost-rows.ts | sessions | verbatim | 167 |
| packages/sessions/turn-budget.ts | sessions | rewritten | 223 **New (row 193b / bead `forge-8vfn.8.5.38`, T1 1973gq/gt)** — a session turn's cap: the session's declared cost ceiling (else the bridge's) minus its priced spend and bounded unpriced turns. |
| packages/sessions/session-start-ceiling.ts | sessions | rewritten | 72 |
| packages/sessions/session-status-io.ts | sessions | rewritten | 224 |
| packages/knowledge/kb-backend.ts | knowledge | verbatim | 280 |
| packages/knowledge/kb-graph.ts | knowledge | verbatim | 662 |
| packages/knowledge/kb-health.ts | knowledge | verbatim | 263 |
| packages/flows/manifest.ts | flows | verbatim | 662 |
| packages/flows/mint-triggered-initiative.ts | flows | verbatim | 284 |
| packages/agents/model-range.ts | agents | verbatim | 79 |
| packages/flows/notify.ts | flows | verbatim | 73 |
| packages/agents/phase-agent.ts | agents | verbatim | 101 |
| packages/stations/phases/adversarial-review-binding.ts | stations | verbatim | 164 |
| packages/stations/phases/adversarial-review.ts | stations | verbatim | 695 |
| packages/stations/phases/review-refusal.ts | stations | rewritten | 135 |
| packages/agents/phases/agent-scope-guard.ts | agents | verbatim | 111 |
| packages/flows/phases/closure.ts | flows | verbatim | 454 |
| packages/stations/phases/executor-deps.ts | stations | verbatim | 337 |
| packages/stations/phases/pm-rejected-set.ts | stations | verbatim | 139 |
| packages/sessions/session-write-fence.ts | sessions | verbatim | 300 |
| packages/sessions/testing.ts | sessions | verbatim | 15 **M7-C 2026-09-25 (bead forge-8vfn.5.31) — the one test-only subpath: `tests/architect-ports-stub.ts`'s `stubArchitectManifestPorts`, three `kinds/architect-critic.ts` symbols, and three `turn-cost-rows.ts` symbols have no production consumer outside this package, only `apps/forge`/`scripts/stories` tests reach for them.** |
| packages/stations/phases/cycle-id.ts | stations | rewritten | 12 |
| packages/stations/phases/executor-table.ts | stations | verbatim | 743 |
| packages/stations/phases/agent-skill-text.ts | stations | rewritten | 30 |
| packages/forge-docs/skills/docs-integrate/SKILL.md | forge-docs | rewritten | 70 |
| packages/forge-docs/skills/docs-review/SKILL.md | forge-docs | rewritten | 173 |
| packages/forge-docs/skills/docs-writer/SKILL.md | forge-docs | rewritten | 109 |
| packages/flows/phase-wiring.ts | flows | verbatim | 54 |
| apps/forge/factory-wiring.ts | apps/forge | verbatim | 181 |
| apps/forge/example-hooks.ts | apps/forge | rewritten | 113 |
| apps/forge/factory-cli-wiring.ts | apps/forge | verbatim | 65 |
| packages/stations/phases/decompose-completeness.ts | stations | verbatim | 251 |
| packages/stations/phases/dev-binding.ts | stations | verbatim | 317 |
| packages/stations/phases/dev-cost-bound.ts | stations | verbatim | 88 |
| packages/stations/phases/developer-loop.ts | stations | verbatim | 1831 |
| packages/stations/phases/live-acceptance-env.ts | stations | verbatim | 22 |
| packages/stations/phases/wi-quality-gate.ts | stations | verbatim | 135 |
| packages/flows/phases/gitignored-creates.ts | flows | rewritten | 79 |
| packages/flows/plan-gate-class-check.ts | flows | rewritten | 59 |
| packages/stations/phases/pm-binding.ts | stations | verbatim | 395 |
| packages/stations/phases/project-manager.ts | stations | verbatim | 766 |
| packages/stations/phases/pm-acceptance-gate.ts | stations | rewritten | 257 |
| packages/flows/phases/ralph-spec-lint.ts | flows | verbatim | 469 |
| packages/stations/phases/reflector-binding.ts | stations | verbatim | 253 |
| packages/stations/phases/reflector.ts | stations | verbatim | 623 |
| packages/stations/phases/reflector-questions.ts | stations | rewritten | 196 |
| packages/stations/phases/reflector-brain-writes.ts | stations | verbatim | 397 |
| packages/stations/phases/release-finalize.ts | stations | verbatim | 299 |
| packages/flows/phases/wi-spec-compile.ts | flows | verbatim | 532 |
| packages/agents/pinned-sdk-query.ts | agents | verbatim | 193 |
| packages/flows/planned-initiatives.ts | flows | verbatim | 96 |
| packages/flows/gh-pinned.ts | flows | rewritten | 205 |
| packages/flows/pr-branch-sync.ts | flows | verbatim | 597 |
| packages/flows/pr-ci-watch.ts | flows | verbatim | 187 |
| packages/sessions/kinds/preflight-fix.ts | sessions | rewritten | 172 |
| packages/sessions/kinds/kind-turn.ts | sessions | rewritten | 482 `makeHeartbeatWriter` now imported from the new `heartbeat.ts` (pure move, forge-8vfn.8.1.51 prep). |
| packages/sessions/kinds/project-brain.ts | sessions | rewritten | 237 |
| packages/sessions/kinds/registry.ts | sessions | rewritten | 131 |
| packages/sessions/kinds/architect-ports.ts | sessions | rewritten | 52 |
| packages/contracts/manifest-types.ts | contracts | rewritten | 243 |
| packages/sessions/tests/architect-ports-stub.ts | sessions | rewritten | 49 |
| apps/forge/session-kind-deps.ts | apps/forge | rewritten | 61 |
| apps/forge/brain-fix-turn.ts | apps/forge | rewritten | 99 |
| apps/forge/manifest-fixtures.ts | apps/forge | rewritten | 46 |
| packages/knowledge/project-brain-build.ts | knowledge | rewritten | 249 |
| packages/knowledge/project-brain-seed.ts | knowledge | verbatim | 395 |
| packages/knowledge/testing.ts | knowledge | verbatim | 13 **M7-C 2026-09-25 (bead forge-8vfn.5.31) — the one test-only subpath: `resolveKbProcesses` has no production consumer outside this package, only two `apps/forge` tests reach for it, so it stays off the main door and behind `@forge/knowledge/testing` instead.** |
| packages/projects/project-config.ts | projects | verbatim | 325 |
| packages/projects/project-config-write.ts | projects | verbatim | 74 |
| packages/projects/project-config-sidecar.ts | projects | verbatim | 73 |
| packages/projects/project-config-types.ts | projects | verbatim | 208 |
| packages/projects/project-config-validate.ts | projects | verbatim | 464 |
| packages/projects/project-create.ts | projects | verbatim | 594 |
| packages/projects/project-repo-github.ts | projects | rewritten | 134 |
| packages/projects/project-pr-verdict.ts | projects | rewritten | 54 |
| packages/projects/project-repo-save.ts | projects | rewritten | 304 |
| packages/projects/project-repo-tx.ts | projects | verbatim | 226 |
| packages/projects/reset.ts | projects | verbatim | 711 |
| packages/projects/reset-cli.ts | projects | verbatim | 160 |
| packages/projects/reset-command-resolve.ts | projects | verbatim | 74 |
| packages/projects/reset-report.ts | projects | verbatim | 179 |
| packages/projects/testing.ts | projects | verbatim | 12 **M7-C 2026-09-25 (bead forge-8vfn.5.31) — the one test-only subpath: `parseSkills` and `checkDemo` have no production consumer outside this package, only `scripts/skill-example-validators.test.ts` and `apps/forge/tests/contract/demo-descriptor-parity.test.ts` reach for them.** |
| packages/flows/promote-manifests.ts | flows | verbatim | 76 |
| packages/flows/queue.ts | flows | verbatim | 287 |
| packages/stations/reflector-rerun.ts | stations | verbatim | 116 |
| packages/stations/release-finalize-invocation.ts | stations | verbatim | 165 |
| packages/stations/release-process.ts | stations | verbatim | 66 |
| packages/stations/testing.ts | stations | verbatim | 23 **M7-C 2026-09-25 (bead forge-8vfn.5.31) — the one test-only subpath: `settleWiOutcome`/`assertOutcomesSettled`/`WiOutcome` (phases/developer-loop.ts), `runProjectManager`/`PmQueryFn` (phases/project-manager.ts), `NodeExecutor`/`integrateDeliveryFailure` (phases/executor-table.ts) and `deriveDemoModel` (phases/derive-demo-model.ts) have no production consumer outside this package, only `apps/forge`/`packages/flows` tests reach for them.** |
| packages/stations/phases/integrate.ts | stations | verbatim | 383 |
| packages/stations/phases/dev-loop-events.ts | stations | rewritten | 167 |
| packages/stations/phases/derive-pr-body.ts | stations | verbatim | 97 |
| packages/stations/demo-delta.ts | stations | verbatim | 145 |
| packages/stations/demo-form.ts | stations | rewritten | 73 |
| packages/stations/demo-planner-port.ts | stations | rewritten | 77 |
| packages/stations/phases/derive-demo-model.ts | stations | verbatim | 292 |
| packages/stations/demo-model.ts | stations | verbatim | 794 |
| packages/flows/requeue-resume.ts | flows | verbatim | 331 |
| packages/flows/review-comments.ts | flows | verbatim | 224 |
| packages/agents/run-agent.ts | agents | verbatim | 800 |
| packages/agents/spawn-marker.ts | agents | verbatim | 313 |
| packages/flows/run-model-derive.ts | flows | verbatim | 45 |
| packages/flows/run-model-derive-status.ts | flows | verbatim | 481 |
| packages/flows/run-model-derive-cost.ts | flows | verbatim | 373 |
| packages/flows/run-model-derive-lineage.ts | flows | verbatim | 135 |
| packages/flows/run-model-derive-node-id.ts | flows | verbatim | 35 |
| packages/flows/run-model.ts | flows | verbatim | 641 |
| packages/flows/run-model-flow-graph.ts | flows | verbatim | 248 |
| packages/flows/scheduler-dispatch.ts | flows | verbatim | 254 |
| packages/flows/scheduler.ts | flows | verbatim | 391 |
| packages/flows/scheduler-sweeps.ts | flows | verbatim | 183 |
| packages/flows/scheduler-run-one.ts | flows | verbatim | 689 |
| packages/flows/stale-remote-branch-guard.ts | flows | verbatim | 116 |
| packages/agents/skill-path.ts | agents | verbatim | 239 |
| packages/agents/stream-deadline.ts | agents | verbatim | 132 |
| packages/agents/testing.ts | agents | verbatim | 13 **M7-C 2026-09-25 (bead forge-8vfn.5.31) — the one test-only subpath: `studio/materials.ts`'s exports, `DEFAULT_IDLE_DEADLINE_MS`, `registeredSdkIds`, `DispatchAgentRunOpts`/`DispatchAgentRunResult` have no production consumer outside this package, only `apps/forge`/`packages/sessions` tests reach for them.** |
| packages/library/studio/artifact-registry.ts | library | verbatim | 151 |
| packages/library/studio/catalog-registry.ts | library | verbatim | 90 |
| packages/library/studio/community-index.ts | library | verbatim | 740 |
| packages/library/studio/community-install.ts | library | verbatim | 285 |
| packages/library/studio/community-fetch-package.ts | library | rewritten | 359 |
| packages/library/studio/community-hub-index.ts | library | rewritten | 240 |
| packages/library/studio/community-refresh-api.ts | library | verbatim | 627 |
| packages/library/studio/community-registry.ts | library | verbatim | 359 |
| packages/library/studio/community-source-url.ts | library | verbatim | 165 |
| packages/library/studio/connection-catalog.ts | library | verbatim | 163 |
| packages/library/studio/connection-install.ts | library | verbatim | 153 |
| packages/library/bridge-studio-catalog.ts | library | verbatim | 61 |
| packages/library/studio/authoring-session.ts | library | rewritten | 33 |
| packages/library/studio/agent-facts.ts | library | rewritten | 36 |
| packages/library/studio/connection-library.ts | library | verbatim | 243 |
| packages/library/studio/connection-probe.ts | library | verbatim | 417 |
| packages/library/studio/connection-readiness.ts | library | verbatim | 49 |
| packages/agents/studio/connection-run-gate.ts | agents | verbatim | 71 |
| packages/library/studio/connection-validate.ts | library | verbatim | 217 |
| packages/agents/studio/agent-registry.ts | agents | verbatim | 287 |
| packages/agents/studio/validate-agent.ts | agents | rewritten | 297 |
| packages/agents/studio/agent-usage.ts | agents | verbatim | 122 |
| packages/agents/studio/derive.ts | agents | verbatim | 300 |
| packages/agents/studio/hook-dispatch.ts | agents | verbatim | 546 |
| packages/library/studio/hook-library.ts | library | verbatim | 535 |
| packages/library/studio/hook-package.ts | library | verbatim | 502 |
| packages/library/studio/hook-runtime.ts | library | verbatim | 619 |
| packages/library/studio/hook-approval-ledger.ts | library | verbatim | 485 |
| packages/library/studio/hook-scan.ts | library | verbatim | 524 |
| packages/library/studio/hook-fire-summary.ts | library | verbatim | 75 |
| packages/library/studio/instructions-draft.ts | library | verbatim | 185 |
| packages/library/studio/library-validate.ts | library | verbatim | 260 |
| packages/knowledge/studio/kb-descriptor.ts | knowledge | verbatim | 210 |
| packages/knowledge/studio/validate-kb.ts | knowledge | rewritten | 42 |
| packages/agents/studio/materials.ts | agents | verbatim | 194 |
| packages/sessions/studio/session-kinds.ts | sessions | verbatim | 610 |
| packages/sessions/studio/session-kinds-validate.ts | sessions | rewritten | 727 |
| packages/sessions/studio/session-kinds-affordances.ts | sessions | rewritten | 148 |
| packages/sessions/studio/session-transcript.ts | sessions | verbatim | 636 **Ceiling re-keyed +9 to 1,368 (M4-sessions s3 3b, T1 ruling 83), and that condition is now DISCHARGED (s4).** The re-key paid for the ruled manifest seam (ruling 81) threading an injected port through this file — three `package-layer-order` rows closed for it — and ruling 83 accepted it *on the condition that row 5's split brought the file back down*. It has: `deriveRoadmapDraft` and its three types moved to `packages/sessions/studio/roadmap-draft.ts`, taking the file to **1,298**, below even the pre-3b ceiling of 1,359, and the exemption was TIGHTENED to 1,298 rather than left as a stale allowance. Earlier payment, before the re-key, is still on the record: the ports contract went to `kinds/architect-ports.ts` (returning `kinds/architect.ts` to exactly 1,584, no raise), comments tightened, stale runner paths corrected. Not a licence — the next edit measures against 1,298. |
| packages/sessions/studio/session-artifact-derivers.ts | sessions | rewritten | 696 |
| packages/sessions/studio/roadmap-draft.ts | sessions | rewritten | 111 |
| packages/library/studio/skill-install-ledger.ts | library | verbatim | 166 |
| packages/library/studio/skill-install.ts | library | verbatim | 383 |
| packages/library/studio/skill-package.ts | library | verbatim | 231 |
| packages/library/studio/skill-registry.ts | library | verbatim | 43 |
| packages/library/studio/skill-trust.ts | library | verbatim | 439 |
| packages/agents/studio/skill-md-fidelity.ts | agents | verbatim | 226 |
| packages/library/studio/template-library.ts | library | verbatim | 596 |
| packages/flows/studio/flow-registry.ts | flows | verbatim | 342 |
| packages/flows/studio/validate-flow.ts | flows | rewritten | 310 |
| packages/flows/studio/flow-kickoff.ts | flows | rewritten | 137 |
| packages/flows/studio/validate-triggers.ts | flows | verbatim | 429 |
| packages/library/studio/yaml-comments.ts | library | verbatim | 132 |
| packages/kernel/studio/yaml-fields.ts | kernel | verbatim | 105 |
| packages/agents/tool-event-emit.ts | agents | verbatim | 259 |
| packages/agents/project-skills.ts | agents | verbatim | 79 |
| packages/flows/trigger-payload.ts | flows | verbatim | 298 |
| packages/flows/webhook-verify.ts | flows | verbatim | 114 |
| packages/flows/wi-dispatch-scheduler.ts | flows | verbatim | 151 |
| packages/flows/wi-merge-back.ts | flows | verbatim | 464 |
| packages/flows/wi-worktree.ts | flows | verbatim | 330 |
| packages/flows/work-item.ts | flows | verbatim | 754 |
| packages/flows/worktree.ts | flows | verbatim | 201 |
| packages/flows/testing.ts | flows | verbatim | 13 **M7-C 2026-09-25 (bead forge-8vfn.5.31) — the one test-only subpath: `hasMergeGateConfigErrorMarker`/`mergeGateConfigErrorPath` (fix-work-items.ts), `CostTracker` (flow-budgets.ts) and `validateCompiledWorkItemSet` (phases/wi-spec-compile.ts) have no production consumer outside this package, only `apps/forge`/`packages/factory` tests reach for them.** |
| skills/adversarial-review/SKILL.md | factory | verbatim | 249 |
| skills/architect-completeness-critic/SKILL.md | factory | verbatim | 86 |
| skills/architect/SKILL.md | factory | verbatim | 217 |
| skills/brain-fix/SKILL.md | knowledge | verbatim | 66 |
| skills/brain-ingest/SKILL.md | knowledge | verbatim | 106 |
| skills/brain-lint/SKILL.md | knowledge | verbatim | 66 |
| skills/brain-maintenance/SKILL.md | knowledge | verbatim | 148 |
| skills/brain-query/SKILL.md | knowledge | verbatim | 92 |
| skills/changelog-semver/SKILL.md | flows | verbatim | 56 |
| skills/contract-check/SKILL.md | projects | verbatim | 89 |
| skills/creation-agent/SKILL.md | library | verbatim | 118 |
| skills/cruft-sweep/SKILL.md | kernel | verbatim | 91 |
| skills/demo-agent/SKILL.md | factory | verbatim | 91 |
| skills/demo-builder/SKILL.md | projects | verbatim | 134 |
| skills/demo-design/SKILL.md | projects | verbatim | 110 |
| skills/demo/SKILL.md | factory | verbatim | 305 |
| skills/developer-ralph/SKILL.md | factory | verbatim | 108 |
| skills/doc-updater/SKILL.md | flows | verbatim | 52 |
| skills/forge-onboard-project/SKILL.md | projects | verbatim | 204 |
| skills/handoff/SKILL.md | sessions | verbatim | 38 |
| skills/instructions-creator/SKILL.md | projects | verbatim | 125 |
| skills/onboarding-agent/SKILL.md | projects | verbatim | 138 |
| skills/pre-impl-interview/SKILL.md | factory | verbatim | 39 |
| skills/preflight-fix/SKILL.md | projects | verbatim | 72 |
| skills/project-brain-builder/SKILL.md | knowledge | verbatim | 103 |
| skills/project-manager/SKILL.md | factory | verbatim | 241 |
| skills/project-scoped-review/SKILL.md | projects | verbatim | 214 |
| skills/reflector/SKILL.md | factory | verbatim | 181 |
| skills/release-finalizer/SKILL.md | flows | verbatim | 91 |
| apps/forge/index.ts | apps/forge | verbatim | 8 |
| packages/agents/index.ts | agents | verbatim | 133 |
| packages/contracts/index.ts | contracts | verbatim | 275 |
| packages/contracts/project-readiness.ts | contracts | rewritten | 61 |
| packages/contracts/awaiting-kickoff.ts | contracts | rewritten | 83 **New file, forge-mfv5.1.25:** `isAwaitingKickoff`, the one Kickoff-gate rule. |
| packages/contracts/run-view-types.ts | contracts | rewritten | 101 |
| packages/contracts/runnable-source.ts | contracts | rewritten | 33 |
| packages/contracts/studio-types.ts | contracts | verbatim | 761 |
| packages/contracts/demo-declaration.ts | contracts | rewritten | 194 |
| packages/contracts/session-anchors.ts | contracts | rewritten | 31 New file (D-29 boundary fix, `studio-beyond-contracts` edge 3): pure transfer of `isPseudoProjectAnchor` / `COMMUNITY_REFRESH_PROJECT_ANCHOR` out of `packages/sessions/session-resolution.ts` (461 → 447, -14), so `apps/studio`'s own hand-kept mirror of both (`apps/studio/lib/session-shell-view.ts`) could be deleted and re-exported from here instead of held in step by a parity test. |
| packages/factory/index.ts | factory | verbatim | 8 |
| packages/factory/demo.ts | factory | verbatim | 454 |
| packages/factory/demo-api-capture.ts | factory | rewritten | 42 |
| packages/factory/demo-planner.ts | factory | rewritten | 83 |
| packages/flows/index.ts | flows | verbatim | 132 |
| packages/flows/demo-paths.ts | flows | verbatim | 75 |
| packages/flows/phases/orchestrated-capture.ts | flows | verbatim | 441 |
| packages/flows/pr.ts | flows | verbatim | 420 |
| packages/flows/pr-media.ts | flows | rewritten | 157 |
| packages/kernel/config.ts | kernel | verbatim | 600 |
| packages/kernel/url-decode.ts | kernel | rewritten | 30 |
| packages/kernel/run-ceiling.ts | kernel | rewritten | 71 |
| packages/kernel/gh-identity.ts | kernel | verbatim | 111 |
| packages/kernel/ids.ts | kernel | verbatim | 136 |
| packages/kernel/event-cost.ts | kernel | verbatim | 158 |
| packages/kernel/index.ts | kernel | verbatim | 112 |
| packages/kernel/checkpoint-command.ts | kernel | rewritten | 88 **New file, forge-8vfn.30.9: the one checkpoint-command head resolver (PATH, then a contained package.json bin) shared by the pre-claim check and the capture spawn.** |
| packages/kernel/init.ts | kernel | verbatim | 171 |
| packages/kernel/logging.ts | kernel | verbatim | 336 |
| packages/kernel/tool-fence.ts | kernel | rewritten | 94 **Written for bead `forge-a9o9` (T1 rulings 670/691) — deny-by-default tool access, with no enumeration anywhere. Here rather than beside `makeToolEventSink` in `agents` because the spawn paths that need it span `sessions`, `agents` and `factory`, and the kernel is the only layer all three already stand on; `spawn-env.ts` next door settled the same class for env vars.** |
| packages/kernel/path-guard.ts | kernel | verbatim | 786 |
| packages/kernel/session-dir.ts | kernel | verbatim | 47 |
| packages/kernel/case-folding-probe.ts | kernel | rewritten | 96 **M7-C 2026-09-25, T2 review follow-up (ruling 666) — the one `detectVolumeCaseFolding`/`CaseFoldingProbe`/`CASE_PROBE_PREFIX` mechanism, consolidated down from verbatim-copied duplicates in `packages/agents/materials-staging.ts` (forge-qn8) and `packages/library/skill-staging.ts` (forge-gp4). `rewritten`, not `verbatim`: the two source copies' docstrings differed (materials vs skill wording) and were merged into one kernel-level doc; the mechanism itself (create-marker/stat/compare/cleanup) is unchanged. See QUARRY.md's `kernel`/`agents`/`library` cap-table notes for the measured line deltas.** |
| packages/kernel/guarded-scan.ts | kernel | rewritten | 71 |
| packages/kernel/ports.ts | kernel | verbatim | 71 |
| packages/kernel/spawn-env.ts | kernel | verbatim | 323 |
| packages/kernel/claude-cli-path.ts | kernel | verbatim | 126 |
| packages/kernel/studio-object.ts | kernel | verbatim | 96 |
| packages/kernel/route-entry.ts | kernel | verbatim | 148 |
| packages/kernel/http-envelope.ts | kernel | verbatim | 141 |
| packages/kernel/project-contract.ts | kernel | verbatim | 52 |
| packages/kernel/findings.ts | kernel | verbatim | 37 |
| packages/kernel/project-layout.ts | kernel | verbatim | 202 |
| packages/kernel/process-liveness.ts | kernel | rewritten | 124 **Written for bead `forge-8vfn.8.1.6` (T1 review follow-up) — the ONE `/proc/<pid>/stat`-based pid-liveness read (`isProcessRunning`; ENOENT=gone, Z/X=gone, any other read failure=not concluded gone), so `packages/flows/daemon.ts`'s `isAlive` and the story runner's scheduler preflight (`scripts/stories/scheduler-preflight.mjs`, via `scripts/stories/sweep-teardown.mjs`'s `isRunning`) cannot disagree about a zombie pid. `isAlive` delegates to it; `isRunning` delegates to it through a relative `.ts` import (proven to load under the plain `node` the story runner is launched with).** |
| packages/kernel/forge-ref-guard-hook.ts | kernel | rewritten | 238 **New file, row 211 (forge-8vfn.8.5.47):** the `reference-transaction` git hook script + its idempotent installer, replacing row 208's PreToolUse Bash-command fence (`forge-repo-git-fence.ts`/`repo-identity.ts`, both deleted by this same change) after it misfired on a project commit it misparsed. Asks git's own ref-moving machinery instead, from inside git itself. |
| packages/kernel/per-work-item-row.ts | kernel | rewritten | 19 **New file, row 207 (forge-8vfn.8.5.57):** `isPerWorkItemRow` — the one predicate run-model derivation and the story harness's run-end parity share to keep per-work-item rows out of run-level pairing. |
| packages/kernel/halt.ts | kernel | rewritten | 69 **New file, row 207 (forge-8vfn.8.5.57):** the one emergency halt record `<forgeRoot>/_queue/halt.json` (D-03) — `forgeQueueRoot`/`haltPath`/`readHalt`/`writeHalt`/`releaseHalt`; kernel so the queue claim (flows) and the dispatch claim (kernel) read the same file. |
| packages/kernel/dispatch-claim.ts | kernel | rewritten | 319 **New file, row 206 (forge-8vfn.8.5.56):** `claimDispatchSlot`/`releaseDispatchSlot` + `newRunStamp`/`randomRunSuffix`, the ONE on-disk dispatch claim `apps/forge/bridge-agent-dispatch.ts`, `apps/forge/bridge-studio-writes.ts` and `@forge/knowledge`'s `spawnBrainFix` all share, so no rank-1-or-above package copies it. `isAlive` is an injected parameter (kernel is rank 1; the real `isTurnAlive` is rank 4). |
| packages/knowledge/index.ts | knowledge | verbatim | 112 |
| packages/library/index.ts | library | verbatim | 115 |
| packages/projects/index.ts | projects | verbatim | 108 |
| packages/projects/project-roster.ts | projects | verbatim | 468 |
| packages/projects/project-preflight-read.ts | projects | verbatim | 208 |
| packages/projects/project-roadmap.ts | projects | verbatim | 90 |
| packages/projects/bridge-studio-project-onboard.ts | projects | verbatim | 696 |
| packages/projects/bridge-studio-project-preflight-write.ts | projects | verbatim | 307 |
| packages/projects/project-contract-scaffold.ts | projects | verbatim | 501 |
| packages/projects/bridge-studio-project-reset.ts | projects | verbatim | 230 |
| packages/projects/routes.ts | projects | verbatim | 386 |
| apps/forge/cli-gate.ts | apps/forge | rewritten | 76 |
| apps/forge/cli-cost.ts | apps/forge | rewritten | 61 |
| apps/forge/cli-instructions.ts | apps/forge | verbatim | 79 |
| apps/forge/cli-create.ts | apps/forge | rewritten | 112 |
| apps/forge/cli-flags.ts | apps/forge | rewritten | 15 |
| apps/forge/cli-brain-lint.ts | apps/forge | rewritten | 93 |
| packages/projects/studio/validate-project.ts | projects | rewritten | 94 |
| packages/sessions/index.ts | sessions | verbatim | 57 |
