# Forge 1.0 Blueprint — design spec

- **Date:** 2026-08-28 · **Base:** main `03bf47db`, v0.9.0
- **Status:** design approved in session (operator decisions D1–D3 below, plus the §0.1 addendum). The plan is `docs/roadmaps/1.0.md`. Not started — kickoff is by a fresh session per that plan's §1.
- **Companion:** the visual proposal at <https://claude.ai/code/artifact/2559035a-2e09-4f75-b42c-b03f32b6dbf6>; the pre-existing four-phase relight assessment at <https://claude.ai/code/artifact/26889f4f-f8b8-4f02-b2d4-fa7bca04461e> (its Phases 0–1 are this spec's Phases 0–1).

## 0. Operator decisions (2026-08-28)

| # | Decision | Ruling |
|---|---|---|
| D1 | Identity and distribution | One name: **forge-studio**. Licence stays **AGPL-3.0-or-later** (revisit only if Studio is hosted or an enterprise engagement appears). 1.0 install form: **Node source checkout**. Supported platform matrix declared as **WSL2 / Linux**. "ideas machine" and "forge v2" are retired everywhere. |
| D2 | Proof standard and grounds | **Run Phase 0**: re-prove the develop-flow tail on gitpulse, bounded to three runs / $60, before any structural move. **betterado is a supported 1.0 ground** (live-ADO tier): the live-tier e2e, the secrets model and the betterado brain are in scope. |
| D3 | Tree strategy | **Approach A, strangler in place, with grafts**: same repo, `packages/*` + `apps/*` under npm workspaces, a dependency-cruiser allow-graph enforced as a ratchet, `git mv` with history, the OOTB flow as one deletable package. **Microservices closed**: no network boundary; the only future candidate is untrusted community-hook execution in `library`, and only on a concrete driver. Governance accepted: feature freeze during the move; per-package LOC caps; one-session-one-package enforced by lint; per-session disk/port budgets. |

### 0.1 Operator addendum (2026-08-28, after D1–D3)

- **The 1.0 gate is nine operator stories** (onboard an existing project — gitweave; create a project from scratch; reset a project contract — betterado; create a flow; create an agent; create a KB; create library components; install from community; do all of it through the assistant), each authored interactively with the operator, each serving as e2e test, demo and usage doc from one script. They **replace** the current journey harness rather than collapsing it. Definition and schedule: `docs/roadmaps/1.0.md` §3.
- **Cull stance:** assume no existing component is good; every guard, test, doc, journey and config knob must justify itself against a real incident or a story or be deleted; the instruction layer (CLAUDE.md, SKILL.mds, stale docs, brain one-shots) is culled before any code moves so fresh sessions cannot learn cruft. `docs/roadmaps/1.0.md` §2.
- **New capability in scope:** `forge project reset` / Studio "Rebuild contract" (projects package) — proven by the betterado story.
- **Execution model:** no kickoff from the design session; fresh sessions work the plan under `tiered-orchestration` with file-durable state in `_1.0/`; per-milestone implementation plans are written at each milestone's kickoff.

## 1. Problem

Forge at 0.9.0 is ~161k prod LOC (orchestrator 56k · cli 40k · forge-ui 62k) and ~240k test LOC, with 150+ files flat in `orchestrator/` and 90+ in `cli/`, no owner per file, and no enforced boundary (`orchestrator` imports `cli` in 34 files; `flow-runner.ts` imports ten phase modules by name; eight circular file dependencies). 65 % of prod code postdates the last real merged cycle (2026-07-11); the rebuilt develop flow (2026-08-03) has never executed demo → review → merge → reflect on a real ground. The repo carries 2.6 GB of untracked demo runs, ~300 merged branches, 7 dead worktrees, 96 docs (ten narrating the retired unifier as current), 21 seeded journeys and a 6,602-line bridge file. Every session therefore spans many concerns and generates more weight; the operator cannot run parallel sessions safely.

Three candidate strategies were authored independently and judged adversarially (strangler in place / distilled rewrite / hybrid skeleton). Both judges chose the strangler: a rewrite discards the two best-tested surfaces (the bridge has 36 test files; forge-ui already has a clean 0/281 boundary) and the ~26k-LOC spine that shipped real PRs, then re-derives the tail with no oracle while suspending unattended operation.

## 2. Identity

**Positioning.** Forge is a construction platform for agentic software factories: a small set of composable primitives — agents, skills, flows, knowledge, and gates — that let one operator assemble a lightweight, purpose-built delivery pipeline for any codebase. It ships one working example, the develop flow, to prove the primitives out of the box — evidence the kit works, not the product itself.

**Vocabulary (use consistently in docs, UI, code):** Factory (one assembled, running pipeline; the OOTB develop flow *is a* factory built on forge) · Flow (ordered path of stations; `FlowDef`, ADR 028) · Station (a step where an agent or gate acts) · Gate (human or automated approval between stations) · Agent (worker executing a station; `PhaseAgentSpec`, ADR 024; session kinds, ADR 043) · Skill (reusable instruction/tool unit) · Brain in-product, Knowledge outward (`KbBackend`, ADR 018).

**Enforcement.** A `check-identity` lint fails CI on `unifier|ideas machine|forge v2|zep` in any current-state doc, skill or README from Phase 0. ADR 038 is amended (new ADR 048) from "platform + ideas machine" to "platform + example factory". The rename to one name lands once, in Phase 7.

## 3. Target structure

One repo, one npm workspace root, one Node process, no build step (Node 22 strip-types resolves workspace packages through symlinks; fallback: a root `imports` map).

```
forge/
├── package.json          workspaces: ["packages/*", "apps/*"]; npm test = per-package tiers; dependency-cruiser ratchet
├── packages/
│   ├── contracts/        @forge/contracts — browser-safe types + consts only (~0.3k). The ONLY package apps/studio may import.
│   ├── kernel/           @forge/kernel   — logging + event types, event-cost (the one cost rule), config/layout, path guards,
│   │                                       generic studio object-model loader, ADR-045 resolveRoot. Cap ~3k of new logic.
│   ├── library/          @forge/library  — skills, hooks, connections, templates, seeds, community: author → scan → approve → list.
│   ├── knowledge/        @forge/knowledge — KbBackend, brain paths/index/lint/fix/drain/consolidate, theme-frontmatter contract.
│   ├── projects/         @forge/projects — project contract: config, preflight C1–C10, contract stages, create, repo-tx.
│   ├── agents/           @forge/agents   — run ONE agent: run-agent, dispatch, band guards, Ralph runner + stop-conditions,
│   │                                       adapter registry, failure-classifier, per-spawn runtime (skill-path, hook-dispatch, connection gate).
│   ├── sessions/         @forge/sessions — the ADR-043 interactive spine: session kinds, turnSpec, transcript, lifecycle, finalizers.
│   ├── flows/            @forge/flows    — flow-runner (against a PhaseExecutor port), scheduler, daemon, queue state machine, manifest,
│   │                                       triggers, run-model, finalize-merged, git/PR/WI mechanics (pr, worktree, work-item, fix-work-items).
│   └── factory/          @forge/factory  — THE example: six phase agents + SKILL.mds + studio/flows/* + artifact templates + class→gate table.
│                                            Deleting this package leaves `forge studio` bootable (CI-tested).
├── apps/
│   ├── forge/            CLI router + bridge host (≤800 lines): origin/CSRF/JSON envelope, WS, health, daemon wiring
│   │                     flows.runFlow(…, factory.EXECUTOR); assembles each package's routes.ts table.
│   └── studio/           = forge-ui, git mv, HTTP-only consumer.
├── studio/  (tracked operator registry, data) · _local/ (gitignored operator root, ADR 045) · tests/e2e/ (journeys + verify-cycle)
└── docs/    Diátaxis ≤25 files + decisions/ (append-only) + roadmaps/1.0.md
```

**Allow-graph** (enforced by dependency-cruiser; the violation baseline may only shrink):

```
contracts ← kernel ← { library, knowledge, projects } ← agents ← sessions ← flows ← factory ← apps/{forge, studio}
apps/studio imports contracts only.  packages never import orchestrator/ cli/ loops/.
legacy imports a package only via orchestrator/_pkg/<pkg>.ts (one greppable shim per package, deleted at cutover).
additive-only edits to contracts/kernel from any lane, disclosed in the PR title (ADR 042 rule, per package).
edges to break during porting: knowledge→sessions (7), projects→sessions (5), library→sessions (5) — all via the bespoke runners.
```

**Two new ports** (kernel): `PhaseExecutor { run(nodeId, ctx) → CycleOutcome }` — replaces flow-runner's ten direct phase imports; `ProjectGate { runPreflight(projectId) }` — replaces the tolerated flows→projects import.

**Collapse rule** after Phase 4: a package whose public API is under five operations folds into its neighbour (candidates: contracts→kernel, projects→flows).

### 3.1 Disposition of the operator's eight slices

| Proposed | Ruling | Change |
|---|---|---|
| forge-ui | agree | `apps/studio`, verbatim; six test-only parity imports repoint to contracts; boundary rule forbids anything else. |
| forge-agents | agree, trimmed | One-agent lifecycle only. Logging → kernel; queue/recovery → flows; the six phases → factory. |
| forge-flows | agree, widened | + eleven orphaned flows files (finalize-merged, run-model, daemon, requeue…) and the git/PR/WI mechanics (`pr.ts`, `work-item.ts`, worktree, wi-merge-back, closure, fix-work-items). |
| forge-library | agree, carved | Per-spawn runtime (`skill-path`, `hook-dispatch`, `connection-run-gate`) → agents. Plugin-host isolation applies here only. |
| forge-knowledge | agree, carved | Reflector → factory. `KbBackend` has one implementation and the planner read bypasses it: Phase 4 routes the read through it and adds a conformance test, or the plural is dropped. |
| forge-config / workspace | split | Queue → flows; logging → kernel; trust ledgers → library; project-side `.forge/` → projects; remainder (config, layout, `_local/` resolution) = kernel. "Move project artifacts forge-side" is a new ADR after 1.0, not part of this restructure (ADR 035 already moved knowledge, history and contract central). |
| forge-assistant | agree spine, split runners | `sessions` = the ADR-043 spine. The seven bespoke runners are ported onto it as session kinds that own their own composition (brain: a spine dissolves shared plumbing, not identity). |
| forge-projects | agree, trimmed | project-brain-* → knowledge; preflight-fix-runner → a session kind. Per-project-type handling is a new seam, deferred. |

## 4. Weight

No code move is required for any of this.

- **Git:** delete the 204 merged local and 87 merged remote branches (`git branch -d` refuses unmerged), prune 7 `_worktrees/` and the 8 stale `forge/*` ground branches; set `delete_branch_on_merge` on forge-studio, gitpulse and terraform-provider-betterado; worktree prune joins the merge protocol. First, gzip the real traces (four July merged cycles, three August failed runs, the betterado docs run) into `tests/regression/traces/`.
- **Demos / mockups / journeys:** delete `demos/verify` (2.5 GB untracked); keep `demos/e2e` (92 MB curated gallery), regenerated only on a beat change. Extract the facts `mockups/studio-endstate-v2` still supplies to `home-view.ts`, `roadmap-dag-layout.ts` and `story-registry.mjs` into one reference doc, then delete `mockups/`. Journeys 21 → 6–8: one real cycle (no `FORGE_ARCHITECT_NO_SPAWN`; budgeted; operator-gated), one per package boundary, home/monitor; the seven roadmap-slug pins become per-package contract tests; the collapsed set runs in CI; the walkthrough runs nightly.
- **Tests:** four named tiers per package — unit (pure; every commit) · integration (fs/git/bridge in-process; LLM replaced by recorded traces asserting tool-call sequences, never text; every PR) · regression (real past-cycle artifacts replayed + a bounded LLM-judge pass; nightly and pre-tag) · e2e (`verify-cycle.mjs`; operator-gated; never CI). Keep by name: 29 allowlist ratchets, ~53 two-sided parity tests, 5 spawn-capture goldens. Cut near-duplicate bridge-route tests (table-driven), tests of deleted subjects, DOM-count pins. Target ~110k test LOC.
- **Docs:** 96 → ≤25 Diátaxis files (tutorials 2 · how-to 5 · reference 7 · explanation 11) + `decisions/` (append-only; two-way `supersedes` links on the 22 amended records) + one roadmap `docs/roadmaps/1.0.md` (R1–R8 archived). Retire from `docs/`: investigations, verify-cycle-ideas, the merger brief, the market memo, the security audit (conclusions → an explanation page), the DOM/harness doc (per-package reference). Campaign residue only in gitignored `_waveN/`. Fix the ten current-state docs that narrate the unifier.
- **Brain:** never delete. Scripted terminology sweep (172 files), `status: historical` on one-shot campaign notes, `enforced_by: <package>/<test>` on every incident theme whose lesson is now code.

## 5. The example factory, v2 (`@forge/factory`)

```
architect ─plan─▶ plan ─work-items─▶ build ─branch─▶ integrate ─pr─▶ review ─findings─▶ verdict ··on:merged··▶ reflect
(interactive,     (one-shot; may     (ralph fan-out;  (orchestrator    (ONE read-only    (operator)               (one-shot;
 gate: plan;       emit one WI)       class gate)      band; no LLM)    agent; class                              optional by
 cost recorded)                                                          lenses + AC verdict)                     class)
```

1. `class: code | docs | config | infra` — typed manifest field the architect sets and the operator confirms at the plan gate; inherited by every WI. One data table maps class → gate profile (iter-0 fail-first, required-paths source, which `testProcess.*` runs at the merge boundary, capture, review lenses, reflect, single-WI allowed).
2. Typed `acceptance_criteria:` in manifest frontmatter (`{given, when, then}`), shared by architect, PM, review and PLAN.html; retires `extractGwtBlocks`.
3. Lane check at the plan gate: a body that prescribes WI sizing or `quality_gate_cmd` is flagged. `creates:` under a gitignored path is a PM validation error.
4. `integrate` is an orchestrator band: boundary commit, sync invariant, empty-branch guard, class-selected merge-boundary gate that **fails loud** on a config error, capture where the class says so, a *derived* DEMO.md / PR body from the AC table + gate evidence + diffstat. No `demo.json` authoring retries, no Jaccard coverage, no `fix-proposals.json`.
5. One review agent: today's adversarial-review plus the per-AC verdict and the Why/What/How paragraph; read-only, no execution tools (ADR 036 stands); `demo-fix` folds into `review-fix`.
6. Gates are orchestrator verbs, never agent-authored scripts; `quality_gate_cmd` must be project tooling or a repo-committed `scripts/gates/*`; ship `forge gate docs` (sections / forbidden token with word boundaries / link check).
7. Cost: `CostTracker` adopts the `event-cost.ts` restatement rule and checks per WI; architect cost is threaded into the cycle.
8. Architect → develop, one-to-many: the manifest declares class and target flow; a flow registers the manifest classes it accepts; the plan gate checks the pair.
9. Docs-only work: bulk checkable transformations ride the `docs` class (target ≈ $8–12, ~20 min, one WI); operator-shaped prose stays in an interactive authoring session that can emit WIs.

Keep (proven over 88+ cycles): Ralph runner + stop-conditions; WI schema + `validateWorkItemSet` + hidden-coupling compile; per-WI worktree fan-out/fan-in; merge-boundary gate (class-aware, fail-loud); queue state machine, closure, finalize-merged, one `cycle_id`; flow DSL with band-guard dispatch; event log, report, `event-cost`; interactive architect + plan gate; reflector's brain-write contract. Rebuild or cut: `demo-agent` as an LLM node; `adversarial-review` → the single review agent; the deterministic rules in the PM SKILL.md → compiler/validator/class table; `gate-recipes.ts` language detection → class × `testProcess` profiles; `flow-budgets.ts` CostTracker; `extractGwtBlocks`; the `demo-fix` loop; the four class-blind standing ACs; `docs/phases/review-loop.md`.

## 6. Sequence

Phases 0–3 are serial (~11 sessions); three-wide parallelism opens at Phase 4. Every phase exit is a real merge on gitpulse, never a green suite alone.

| Phase | Sessions | Work | Exit |
|---|---|---|---|
| **0 Prove the tail, or decide it is unproven** | 3–4 (+ ~$60) | Fix in place: CostTracker triple-count → event-cost rule + per-WI check; merge-gate `ok:true` on config error → park needs-operator; demo-agent contract residue after #68; harness `:425` (post-merge tests pass without a merge) and the `--project mdtoc` default. gitpulse `testProcess` migration onto `main` + push; preflight on main. Free host disk to ≥ 20 GB. `verify:cycle --project gitpulse`, bound 3 runs. Open the betterado docs branch as a manual PR. Gzip the real traces. Land `check-identity`. Write four brain themes (cost restatement; merge-gate fail-open; agent-authored gates = self-grading; class-blind gates). | A 2026-09 manifest in `_queue/done/`, `gh pr view` MERGED on gitpulse, a new Brain-3 theme — **or** a recorded decision that the tail is rewritten in Phase 5, pulled forward. |
| **1 Delete weight in place** | 2 | Git recipe; `demos/verify`; `mockups/` after extraction; docs retire list; `graphify-out`, `zep.env`; journey collapse plan written. | Checkout ≤ 300 MB; ≤ 15 branches; one worktree; docs index truthful; identity lint green. |
| **2 Skeleton, contracts, kernel, written contracts** | 3–4, serial | Workspaces; ten empty packages; dependency-cruiser ratchet; `check-owner.mjs`; populate contracts + kernel (quarried, capped); `git mv forge-ui apps/studio`; **SPEC.md** (six ≤1-page contracts: Agent, Station, Artifact, Knowledge, Session, Project — transcribed from ADR-named seams); **QUARRY.md** (every prod file → owner + verbatim/pruned/rewritten/deleted + LOC); ADR 046. | Legacy suites green; boundary lint green with a baselined count; kernel builds standalone. |
| **2.5 Cut the two ports on the legacy tree** | 1–2 | `PhaseExecutor`/`registerBand`; `ProjectGate`; break `cycle ↔ cycle-helpers ↔ flow-runner` and `run-model ↔ run-model-derive`. | Second real merge through the port; spawn-capture goldens byte-identical; those cycles at zero. |
| **3 Big-bang move** | 2, solo | `git mv` to QUARRY.md owners; cross-package imports rewritten in a separate commit; zero content edits. | Phase-0 oracle re-passes; every file has one owner; baseline recorded. |
| **4 Package lanes** | 6 lanes × 2–3, 3-wide | Order: knowledge, projects, library → sessions → agents → flows. Per lane: carve routes into `routes.ts` → carve-outs → split > 800 → re-bucket tests → README (API) + design.md (ADRs) → `contract.test.ts`. Sessions lane ports the seven runners. Bridge host shrinks to ≤ 800 lines. | Per package: standalone build, contract test green, unit+integration < 60 s, zero violations. Phase: third real merge. |
| **5 Factory v2** | 7–9 (+ ~$100), concurrent with 4 | §5 in full; ADR 048 (deletable OOTB package; amends 038) and ADR 051 (change-class + typed ACs); operator authors the class→gate table. | A code initiative merges on gitpulse **and** the betterado docs initiative merges through the docs path in one session at ≤ $12 with zero PM retries; Studio shows a reflect theme from run N read by the planner in run N+1. |
| **6 Distil** | 5–6, three lanes | Tests re-bucketed; duplicates collapsed; regression tier seeded; docs to the ≤25 tree; brain sweep + tags; journeys 6–8 in CI; demos re-recorded for those only. | `orchestrator/`, `cli/`, `loops/`, `forge-ui/` gone; CI = per-package tiers + boundary lint + journeys; fourth real merge, driven from Studio. |
| **7 Prove the platform, cut 1.0** | 3–4 | A second factory (e.g. `forge-docs`) built from data + `registerFactory` only, run to merge on gitpulse; CI test "delete `packages/factory`, studio still boots"; the identity rename; ADRs 046–051 accepted; CHANGELOG 1.0.0; tag. | The §7 definition checked line by line with evidence links. |

Estimate: 40–47 agent sessions, ~15 operator hours, ~$250 harness spend, ~6 weeks at wave cadence.

## 7. Definition of 1.0

1. **Packaged and enforced.** Every package: one-page README with its API, own tests under 30 s, zero boundary violations; `apps/studio` imports only contracts; every extension seam is a registry with a conformance test (RuntimeAdapter, KbBackend, TriggerKind, session-kind + finalizer, band-executor, class→gate table).
2. **Two factories, nine stories.** The OOTB develop factory merges real initiatives on gitpulse; a second factory built from data only merges too; deleting the example package leaves the platform running; the nine operator stories (`docs/roadmaps/1.0.md` §3) run green on a clean checkout in one recorded run.
3. **Recent, costed proof.** A merged initiative within the last 30 days on each supported ground (gitpulse; betterado live tier); cost-per-merged-initiative by class; architect cost non-zero; Studio's figure equals the event log's.
4. **Capped weight.** Per-package LOC caps, ≤ 25 docs, ≤ 8 journeys, identity lint, one roadmap; campaign notes never in `docs/`.
5. **A stranger can resume.** Install form, platform matrix, secrets model, per-package crash/recovery invariants, and a getting-started that runs to a merged PR.

## 8. Governance

- Feature freeze on `orchestrator/`, `cli/`, `loops/` during Phases 2–4; only move PRs and disclosed additive kernel/contracts edits.
- Per-package LOC cap (starting values from the QUARRY.md targets); the 800-line file rule enforced by lint, not prose.
- One session = one package: a lane may touch its package, its routes and tests, plus additive-only contracts/kernel edits named in the PR title; `check-owner.mjs` + dependency-cruiser fail anything else.
- Each lane in its own worktree at `~/forge-<pkg>` with a per-session disk budget and a VHDX preflight; only CI and the studio lane run journeys; commit-first before any journey run.
- Merge protocol unchanged: strict branch protection → update-branch → CI on the exact head → merge → re-verify main.
- Every wave ends with one real run, or the exit table says NOT MET.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Phase 0 cannot reach merge in three runs | Hard $60 cap; the outcome is a recorded decision (rewrite the tail in Phase 5, pulled forward), not an open fix loop. |
| The big-bang move collides with a lane or breaks rename detection | Phase 3 is solo; moves and import rewrites are separate commits; zero content edits; oracle re-run before merge. |
| Boundary lint becomes friction (the `check-raw-fs-guarded` pattern, 123 touches) | Package-granularity rules only; no per-file exceptions; ratchet-only baseline; the rule file owned by the kernel lane. |
| Second-system creep inside the strangler | Move PRs are behaviour-neutral by rule; redesign is confined to Phase 5 inside `packages/factory`. |
| Hidden cross-package cycles stall a lane | Intra-package cycles tolerated; cross-package ones broken by moving the type to contracts/kernel; the three known runner edges are ported in the sessions lane. |
| Weight deletion loses a live reference | Extract-then-delete for `mockups/studio-endstate-v2`; Brain 2's unifier notes become `status: historical`, never deleted; the betterado branch becomes a PR before its worktree is pruned. |
| Test distillation removes a real ratchet | Ratchets and parity tests are protected by name; only duplicates and orphaned tests are cut; regression is seeded from real incidents. |
| Ten packages feel heavy for one operator | The collapse rule after Phase 4. |
| Host disk (the wave-8 WSL kill) | Phase 0 frees ≥ 20 GB; VHDX preflight in every lane brief; worktrees pruned on merge. |

## 10. Deferred / out of scope for 1.0

- Moving project-side artifacts (`.forge/`, `forge/history/`) fully forge-side — a new ADR after 1.0.
- Per-project-type handling in `projects` — a new seam after 1.0.
- A second `KbBackend` implementation — not required; the seam must be real (read routed through it + conformance test) or the plural dropped.
- Packaging as an npm artifact (R8-01), relicensing, hosted Studio.
- Non-SWE connectors (ADR 038 stance unchanged).

## 11. Sources

Eight slice audits; test/docs/demos weight audits; the OOTB develop-flow post-mortem (betterado 2026-08-22 log, 1,605 events; three 2026-08-03 `verify:cycle` summaries); git hygiene inventory; research threads on software-factory positioning (Factory.ai, BCG Platinion, Augment Code, TrueFoundry), modular-monolith vs microservices (Grzybek, Fowler, Newman, Shopify, Team Topologies, Backstage/VS Code/n8n plugin hosts), rewrite vs refactor (Spolsky, Caudill, DHH, Slack, Shopify, Brooks, Augment), test/doc taxonomy (Block goose, LangWatch, Diátaxis, Temporal, Dagger, Backstage); three approach authors; two adversarial judges; a completeness critic (16 contradictions, five load-bearing claims re-verified, two refuted). Brain themes: generalise-plumbing-not-composition, declared-data-fails-open, roadmap-simplification-convergence, avoid-hand-rolling-tools, forge-studio-build-arc.
