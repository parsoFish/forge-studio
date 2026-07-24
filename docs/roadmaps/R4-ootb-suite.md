# R4 — OOTB suite

> Mission: the out-of-the-box agent and flow suite forge ships — migrate today's
> platform-baked phases onto the runnable primitive, ship the refined agent
> roster (onboarding, creation, architect, plan, develop, demo, adversarial
> review, reflect), assemble the develop-cycle OOTB flow, and give the roadmap
> screen the states and attention surface the suite needs. Scope boundary: this
> is the **shipping of Scope-2 content** ([docs/repo-map.md](../repo-map.md)) —
> agents/flows as *data* forge ships OOTB, built on Scope-1 componentry (R2),
> never assuming a particular managed project. What operators author inside
> Studio at runtime is out of scope (index §7).

**Status vocabulary:** implemented | in-progress | planned | deferred. All
initiatives in this file are planned/deferred as of 2026-07-17.

**Suite doctrine (operator, from the planning diagram):** *"any agentic flow we
ship in forge should be made available as an OOTB agent, rather than baking it
into the platform itself, for consistency of implementation and extensibility"*
— R4-01 codifies this as an ADR. Corollary doctrine: the OOTB agents have
**strong ties to each other** (the plan agent designs specs *for* the develop
agent's ralph loop) rather than being maximally agnostic — and that choice is
made explicit to operators authoring their own agents, so they can follow or
diverge deliberately. The ties are expressed as **versioned artifact
contracts** (the R4-05-F2 spec schema), never as knowledge of the partner
agent's internals — the develop agent is the reference consumer of the spec
schema, not its addressee (adversarial review 2026-07-17, E11).

## As-built baseline (implemented)

### R4-B1 Seed cycle flows

`studio/flows/{forge-architect,forge-develop,forge-reflect}/flow.yaml` (ADR-028):
architect(gate:plan)→pm; dev→unifier(resumable)→review(gate:verdict) with
trigger `{on: merged, flow: forge-reflect}` fired async by
`orchestrator/finalize-merged.ts`; reflect = single disposable node, no gate.
Starters (inert templates, ADR-033): `studio/starters/agents/{plan,dev,review}` +
`studio/starters/flows/basic.yaml`.

### R4-B2 Agent roster + dispatch reality

"An agent IS a skill directory" (`orchestrator/studio/types.ts`): 14 of 24
`skills/` dirs carry a `runtime:` block; 8 are in the composable roster
(`library: false` excludes the rest). Flow-engine dispatch is the hardcoded
`AGENT_KIND` table mapping 4 slugs (`project-manager`, `developer-ralph`,
`developer-unifier`, `reflector` — `orchestrator/flow-runner.ts:233`); phase
intent still lives in `orchestrator/*-invocation.ts` + `PhaseAgentSpec`
derivation (`orchestrator/studio/derive.ts`, ADR-024). The migration R4-01
performs starts from here.

### R4-B3 Architect (as-is)

In-UI file-checkpointed runner (ADR-020): `/architect/new` +
`/architect/[sid]/interview`, bounded Ralph-style turns via
`spawnArchitectTurn`, PLAN gate at `/artifact?type=plan&mode=gate`. The
`architect-completeness-critic` skill exists as a bridge-dispatched runner
(2026-07 refinement) but is not folded into the architect's FINALIZE step.

### R4-B4 Project-manager / decomposition (as-is)

`skills/project-manager` + PM invocation; wi-spec-compiler **deterministic
core** live at the PM seam (ADR-037 — Proposed; the bounded sonnet assist is
unbuilt, known-gaps §4.1); PM never populates a WI `domain` field (known-gaps
§4.6); decompose-completeness is variable — PM under-planning observed on the
betterado roadmap run (memory: dashboard-extension 1/2 WIs, core 2/7).

### R4-B5 Develop + unifier (as-is)

`developer-ralph` per-WI Ralph loops (ADR-002) under
`orchestrator/wi-dispatch-scheduler.ts` (concurrency default 1, known-gaps
§4.2); `developer-unifier` holds the dual-boundary full-suite gate — the
known-gaps "strength worth preserving" that Q3-B's retirement must re-home
(spec: R1-03-F4; execution home: R4-10-F2).

### R4-B6 Demo machinery (as-is)

**Four** live mechanisms, with explicit dispositions under this roadmap
(adversarial review 2026-07-17, A4): (1) `skills/demo` — the demo-contract
SSOT, whose frontmatter names the developer-unifier as composer → **the
R4-07 demo agent becomes its composer** (frontmatter consumer updated;
contract survives); (2) `skills/demo-design` — the save-time generator of
per-project demo machinery → **stays the save-time generation step, owned by
R1-03-F2**; (3) `skills/demo-builder` + `/demo/[sid]`
(`orchestrator/demo-builder-runner.ts`) — the builder UI, **surgery owned
solely by R1-03-F2**, R4-07-F3 only consumes its output; (4)
`studio/demo-elements/` (6 element kinds authoring project-side
`.forge/skills/demo/<id>/`) — composed by the demo agent. Schema-validated
`demo.json` (ADR-021); orchestrator-owned gate execution + capture nonce
(ADR-036). Demos must be visual evidence — live REST evidence for live-capable
projects (verify-cycle betterado tier's 5th gate).

### R4-B7 Reflect (as-is)

`reflector` skill + `rerunReflector`; fires on merge via
`finalize-merged.ts`; writes Brain-2/Brain-3 central themes (ADR-035);
done-vs-archive artifact-diff lint (reflector-completion theme, landed
2026-07-11). The reflector is "genuinely sharp" (known-gaps strengths) — R4-09
must not regress it.

### R4-B8 Onboarding / creation / instructions (as-is)

`forge-onboard-project` skill + `ProjectOnboardForm`
(`[data-section="project-onboard"]`) + pure `forge preflight` (ADR-033/034);
`instructions-creator` agent (Stage A, `/instructions/[sid]`);
`project-brain-builder` (`/project-brain/[sid]`). No greenfield
project-creation path exists.

### R4-B9 Roadmap surface (as-is)

`SerpentineTimeline.tsx` with initiative statuses `pending | in-flight |
ready-for-review | done | failed` — no `merged` state, no per-initiative plan
trigger, no blocked-until-WIs concept; stuck-cycle recovery is a standalone
`/recovery` tab (known-gaps §4b.4 flags it for folding); no cross-project
aggregate view (ADR-031 retired the old pane; MVUS still requires one).

### R4-B10 Plan agent (implemented)

R4-05 landed 2026-07-18 (wave 2, branch `feat/r4-05-plan-agent`). The `project-manager` skill IS forge's plan
agent — evolved **in place** (`executor: pm`, seed flows untouched; the PM→generic-agent migration remains
R4-01-F2, wave 4):

- **Spec back-refs (F2):** `InitiativeManifest.specs?: string[]` + `persistManifestSpecs`
  (`orchestrator/manifest.ts`), written on the PM pass success path (`orchestrator/phases/project-manager.ts`);
  ADR-015 amended (`docs/decisions/015-work-item-format.md`).
- **ADR-037 (F3):** Accepted at the plan-agent seam (`docs/decisions/037-compiled-wi-contracts.md`). Deterministic
  core (items 1+2 — `orchestrator/phases/wi-spec-compile.ts` + `orchestrator/constraint-blocks.ts`) + ralph-spec-lint
  (item 4) are as-built; **item 3 (the sonnet-assist skill) DEFERRED** (see R4-05 implemented-notes). `WorkItem.domain?`
  added (F7 — `orchestrator/work-item.ts`) so `applies_to: wi.domain=…` selectors match.
- **Entry paths (F4/F5):** both dispatch decomposition through ONE pipeline — `execPm` → `runProjectManager`
  (`orchestrator/flow-runner.ts` / `orchestrator/phases/project-manager.ts`). F5 = architect-accept promote
  (existing). F4 = `orchestrator/enqueue-plan-run.ts` (`enqueuePlanRun`, a manifest-move mirror of
  `enqueue-develop-run.ts` repointing to `flow_id: forge-architect`) + `POST /api/initiatives/:id/plan`
  (`cli/ui-bridge.ts`; `exempt-local` in `cli/dry-bridge.ts`'s route-coverage table). Byte-identical single-pipeline
  proof: `orchestrator/project-manager-shared-pipeline.test.ts`. **F4 is a flow-path manifest-move, NOT runAgent**
  (implemented-notes; runAgent-consumption deferred to R4-01-F2).
- **Completeness (F6):** non-blocking `orchestrator/phases/decompose-completeness.ts` emitting the
  `plan.completeness` event `{ stated_units, covered_units, uncovered, flagged }` (the R4-11-F4 attention-strip
  contract) on the PM success path — never affects the pass outcome or dispatch.

### R4-B11 Roadmap & attention surface (implemented)

R4-11 landed 2026-07-19 (wave 2, branch `feat/r4-11-roadmap-attention`). The operator roadmap/attention surface:

- **`merged` lifecycle state (F1):** a sixth queue directory `_queue/merged/` — a **transient pass-through** between
  `ready-for-review` and `done`. Closure (`orchestrator/phases/closure.ts`) lands confirmed-merge there via
  `terminalMove`; the finalize sweep (`finalize-merged.ts`) + the flow-runner reflect node promote `merged → done`
  in the SAME sweep (never parks; reflection-lost still reaches `done`). **Closure is the single terminal-move
  authority** (`promoteMergedToDone`). ~17 queue-state sites learned it. Dep gate accepts **`merged ∪ done`**
  (`scheduler.ts:checkInitiativeDeps`). Distinct from the pre-existing `CycleOutcome` value `'merged'`.
- **Plan trigger + blocked-until-planned lock (F2):** `InitiativeCard` (`forge-ui/app/projects/[id]/page.tsx`)
  gains `data-action="plan-initiative"` + `data-plan-state` + a blocked-until-planned lock (gates
  `start-development` until planned), wiring R4-05's `POST /api/initiatives/:id/plan`; `buildProjectRoadmap`
  computes `workItems` status-independent (= the planned signal). (Server-side develop gate = deferred
  defense-in-depth follow-up, known-gaps.)
- **Recovery folded in (F3):** inspect/requeue/abandon affordances (API unchanged) on the roadmap card via
  `forge-ui/lib/recovery-attrs.ts`; `/recovery` → redirect stub (`data-page="recovery-redirect"`); nav item removed.
- **Cross-project attention strip (F4):** `GET /api/studio/projects/attention` (`cli/bridge-studio.ts`, shared
  `scanProjectManifests`) + a slim `data-section="attention-strip"` on `/` with per-project counts
  (planned/in-flight/gated/merged/completeness-flagged) linking through to `/projects/<id>`.
- **Architect re-run (F5):** `POST /api/architect/rerun` (`cli/ui-bridge.ts`, re-spawns the stalled session via
  `spawnAgentTurn`, `isSafeRunId`-guarded, dry-bridge `stub-actions`) + a `data-action="architect-rerun"` button on
  `StuckWarning`.

### R4-B12 Declared dispatch — the phase agents as artifacts (F1–F3 as-built)

R4-01 F1–F3 landed 2026-07-24 (wave-4 session 1, branch `feat/r4-01-artifact-migration`):

- **ADR-039** (`docs/decisions/039-ships-as-artifact.md`) — the ships-as-artifact principle +
  the declared-dispatch seam; amendments on ADR-024/027/028.
- **`orchestrator/run-agent.ts`** — the one-shot runtime: `loopStrategy: 'one-shot'` direct
  pinned-stream spawn (options from the derived spec + declared `budgets` caps;
  `resolveOneShotBudgetUsd` = `max(flat, share × initiative budget)`), `lifecycle: 'caller'`
  (caller owns events/cost — no double emission), `streamGuard` (idle-deadline + abort chain),
  `onMessage` observer (telemetry stays caller-side, ADR-036), scratch
  `.forge/agent-run/PROMPT.md` on the legacy path. Shared `StreamQueryFn` seam in
  `orchestrator/pinned-sdk-query.ts` (`pinnedStreamQuery`, the one structural cast).
- **`orchestrator/agent-bands.ts`** — band-hook registry (`wi-contract`, `reflection-close`);
  flow-runner's `AGENT_BAND_EXECUTORS` maps them onto the unchanged `execPm`/`execReflect`
  bands; `execAgent` routes band hooks first, then `loopStrategy: 'ralph'` → the dev-loop
  pipeline (lint + runtime-guard restricted to `developer-ralph`).
- **Pipelines** (`orchestrator/phases/project-manager.ts` / `reflector.ts`) spawn via
  `runAgent(lifecycle:'caller')`; every judgment band (brain-gate, WI validation/compile,
  checkpoints, retention/lint/recap, `promoteMergedToDone`) unchanged. Prompt builders +
  tallies live in `orchestrator/phases/{pm,dev,reflector}-binding.ts`.
- **Parity evidence** — golden spawn-capture suite (`orchestrator/pm-spawn-capture.test.ts`,
  `orchestrator/phases/reflector-spawn-capture.test.ts`, fixtures under
  `orchestrator/test-fixtures/spawn-capture/`): {prompt, options} byte-identical pre/post;
  systemPrompt deltas = the SKILL.md frontmatter edits only. `runtime/loop-strategy` lint
  (`orchestrator/studio/validate.ts`); journey evidence in the `agents` journey
  (builder-save preserves declared dispatch).

## Planned initiatives

### R4-01 Platform→artifact migration

- **Status:** **in-progress** — F1–F3 built 2026-07-24 (wave-4 session 1, branch
  `feat/r4-01-artifact-migration`, as-built baseline **R4-B12**); PR held open
  pending the operator-gated frozen-SHA `verify:cycle` routine run (the F2
  no-behavioural-delta AC's real-run half — free gates all green). **F4 stays
  planned** (end of wave 4, after R4-10-F2).  ·  **Wave:** 4 — first item of wave 4, before the agent
  initiatives; **F4 alone runs last**, after R4-10-F2 (not contiguous with F1–F3)
- **Implemented-notes (2026-07-24, F1–F3):** the seam landed as **declared
  dispatch** (ADR-039): `runtime.loopStrategy` (`one-shot` = a direct pinned
  SDK stream inside `runAgent`; `ralph` = execAgent routes to the dev-loop
  pipeline, lint-restricted to `developer-ralph` until R2-03/R4-06),
  `budgets.maxTurns/maxBudgetUsd/maxBudgetUsdShare` (the PM's
  floor-plus-share cap as frontmatter data), and `composition.hooks` band
  keys (`wi-contract` → PM pipeline, `reflection-close` → reflector pipeline;
  `orchestrator/agent-bands.ts`). Pipelines keep 100% of their judgment bands
  (ADR-036); only the SDK call moved, behind `runAgent`'s
  `lifecycle:'caller'` (no event/cost double-emission). Parity proof: golden
  spawn-capture fixtures (`orchestrator/test-fixtures/spawn-capture/`) pin
  {prompt, options} byte-identical for PM + reflector; systemPrompt deltas =
  the frontmatter edits only. `*-invocation.ts` dissolved into
  `orchestrator/phases/{pm,dev,reflector}-binding.ts` (~950 lines off the
  orchestrator root). `PHASE_EXECUTOR_KINDS` = `['unifier']`. The F2 AC's
  "declared kind-mapping deletion" is done for pm/dev/reflect; the frozen-SHA
  verify:cycle run is the remaining AC evidence (operator-gated). F3
  round-trip: agents-builder journey beat proves the builder save preserves
  the declared dispatch data on the migrated PM. known-gaps §8's PROMPT.md
  rider resolved here (scratch `.forge/agent-run/` path).
- **Depends on:** R2-01 (runnable primitive), R2-02 (def-driven builder
  round-trip); **F4 only:** R4-07, R4-08, R4-10-F2 (retirement cannot start
  before the successor agents and the relocated gate are live)
- **Depended on by:** every later OOTB addition (the ships-as-artifact principle governs them)
- **Context:** Operator doctrine above; ADR-024's north star (skills as the
  single runnable source of phase intent; skills-as-plugins). Also resolves the
  ADR-024 completion double-booking (ADR landed-notes say the five
  PhaseAgentSpec migrations are done; CLAUDE.md says "not yet complete") by
  *defining* completion: PhaseAgentSpec migration was step one; **this**
  initiative — phases as OOTB artifacts on the generic primitive — is the rest.
  R5-07 records that reconciliation in the docs.
- **Features:**
  - **R4-01-F1 ADR: ships-as-artifact principle.** New ADR (next free number)
    codifying: every agentic flow/agent forge ships is an OOTB artifact
    (Scope-2 data on the R2-01 primitive); the platform bakes only execution
    machinery (executors, gates, budgets, guards). ACs: ADR accepted; principle
    cross-linked from ADR-024/027/028 as amendments.
  - **R4-01-F2 Migrate the phase agents.** PM, developer-ralph, reflector (and
    the architect runner's spawn path) move off `orchestrator/*-invocation.ts`
    prose + hardcoded `AGENT_KIND` rows onto registry-driven dispatch via
    R2-01. Orchestrator surface shrinks (the capped-surface rule). ACs: no
    behavioural delta on a frozen-SHA verify:cycle routine run (this AC runs
    pre-retirement — the unifier is still live, so the old-shape harness
    works); the declared kind-mapping R2-01-F2 keeps for the phase slugs is
    deleted **here** (F2 owns that deletion — R2-01-F2 deliberately does not);
    invocation prose relocated into the SKILL.md bodies.
  - **R4-01-F3 Round-trip proof.** Each migrated agent is editable in the agent
    builder and re-runnable standalone; journeys synced (journey-sync skill) in
    the same PR. ACs: builder edit → save → run works for one migrated agent
    per journey evidence; `forge studio lint` green.
  - **R4-01-F4 Unifier retirement mechanics ⚑ FOR OPERATOR REVIEW.**
    Retirement only — building and proving the relocated gate is R4-10-F2's
    job (single owner), and this feature cannot start before R4-10-F2 is live
    and green. Scope: retire the `developer-unifier` slug/`execUnifier`;
    delete the ADR-026 UWI machinery (`orchestrator/unifier-items.ts`,
    `drain-unifier-items.ts`, `appendReviewUnifierItems`) per R4-08-F2's
    successor spec; **drain before cutover** — zero pending UWIs across
    `_queue/ready-for-review/` before the unifier node is removed; migrate the
    `resume_from: 'unifier'` stamp per R4-10-F6. ACs: no flow/skill references
    the retired slug; ADR-026 gains a superseded-by note and ADR-028 an
    amendment in the same PR; send-back demonstrably works on both sides of
    the cutover (journey + verify evidence); a pre-cutover check proves no
    stranded UWIs.
- **Session sizing:** ~3 sessions (ADR + one phase; remaining phases) **plus a
  separate end-of-wave-4 retirement session for F4** (waits on R4-10-F2).
- **Out of scope:** the runnable primitive itself (R2-01); new agent behaviour
  (each agent's own initiative below); SSOT doc edits (R5-07).

### R4-02 Project onboarding agent

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** R3-05 (instructions sourcing), R1-03/R1-04 (contract process
  clauses to tick), R1-01 (KB binding at onboarding), R2-01 (standalone runnable)
- **Context:** Operator diagram (verbatim intent): tailored to onboarding an
  existing project; *"with the added ability to run agents this can utilise
  that function to be standalone without needing to run through a flow"*;
  inputs = local repo or repo URL + a north star; runs an agentic flow ticking
  **all** the forge↔project contract boxes. As-built: R4-B8's skill + form +
  preflight are the raw material.
- **Features:**
  - **R4-02-F1 Standalone runnable onboarding agent.** Agent def (SKILL.md)
    with inputs `{repo: path|url, northStar: text}`; runnable from the agent
    page (R2-01) and from `/projects` onboarding UI. ACs: both entry points
    reach the same runner; events/cost visible.
  - **R4-02-F2 Contract-compliance loop.** Iterative preflight → fix →
    re-check until hard clauses pass and advisory clauses are explicitly
    accepted-or-fixed (reuses the preflight-fix pattern). ACs: a
    deliberately-broken fixture repo reaches contract-green unattended;
    failures surface as an operator-readable report, never silent.
  - **R4-02-F3 KB + binding output.** Onboarding creates the project KB with
    mandatory project scope (Q5-B), writes `kb.yaml`, and sets the
    `project.json` `kb` binding — closing known-gaps §4.3(a)/(d) through
    R1-01's contract rather than ad-hoc. ACs: fresh onboard shows bound KB in
    ContractReadiness.
  - **R4-02-F4 Instructions check.** Sources AGENTS.md/instructions material
    from the R3-05 library (falls back to the instructions-creator interview
    when no seed fits). ACs: onboarded project passes R1-04's instructions
    clause.
  - **R4-02-F5 profile.md constraint tagging.** Onboarding tags Brain-3
    `profile.md` constraint clauses with `applies_to:` selectors (the ADR-037
    load-bearing input R4-05-F3 consumes — this feature is the R4-02-side
    mirror of that handoff). ACs: an onboarded project's profile carries
    tagged clauses; an untagged legacy profile still compiles under the
    ADR-037 as-built default (`all` / `manifest.<field>` globs).
- **Session sizing:** ~2 sessions (agent + loop; KB/instructions integration).
- **Out of scope:** greenfield creation (R4-03); the contract clauses
  themselves (R1-03/R1-04/R1-05); Brain-3 content seeding depth
  (project-brain-builder remains its own agent).

### R4-03 Project creation agent

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** R3-05 (instructions seeds), R1-03/R1-04 (processes to
  scaffold), R4-02 (hands off to the onboarding loop post-scaffold)
- **Context:** Operator diagram: like onboarding *"but without the existing
  repo input"*; must take inputs on language, application type (ui, api, game,
  job/cronjob, etc), and general architecture decisions; *"utilise framework
  templates for these kinds of things we can build out in forge to define good
  practices for agentic development"*. Nothing exists today (R4-B8).
- **Features:**
  - **R4-03-F1 Creation interview.** Structured inputs: language, app type,
    architecture decisions, north star. ACs: interview output is a typed
    creation manifest.
  - **R4-03-F2 Framework template library (research-first).** Survey existing
    scaffolding/template practice for agentic development per app type
    (research spike, per the global research-first rule), then curate
    templates under `studio/starters/` encoding: test/demo/build process
    stubs matching R1 clauses, AGENTS.md seed, CI skeleton. ACs: ≥2 app types
    templated; each template's output passes preflight hard clauses
    unmodified.
  - **R4-03-F3 Scaffold → onboard handoff.** After scaffold, the R4-02 loop
    runs to contract-green and registers the project. ACs: create → first
    architect run possible without manual repo surgery.
- **Session sizing:** ~2-3 sessions (interview+manifest; template spike+curation; handoff).
- **Out of scope:** template *content* beyond the curated set (grows as a
  library over time); onboarding mechanics (R4-02).

### R4-04 Architect agent refinement

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** — (soft: R4-05 fixes the hand-off shape it emits into)
- **Context:** Operator diagram: refined current architect; roadmap-level
  planning for a contract-clean project; generates initiatives filling the
  roadmap; *"must be a solid agentic experience with the user akin to that of
  a plan agent within claude"* — interview questions, rich plan document
  outlining all initiatives with mockups/non-text descriptions where relevant,
  iteration with the operator. Sources: operator-journey gap #6 (explicit
  edge-case stage); brain theme `2026-07-01-architect-coverage-scope-fidelity`
  (completeness-critic pass, scope ledger, brain-constraints→ACs); the
  roadmap-scale ambition (full product roadmaps are the target unit, small
  features are test vehicles). Note: known-gaps §4.4's "architect+PM collapse"
  question is **superseded** by the Q2-B architect/plan split — record that in
  R5-07's reconciliation.
- **Features:**
  - **R4-04-F1 Plan-agent-grade interview UX.** Conversational rounds, design
    forks surfaced as options, iteration on the draft plan, rich PLAN
    artifact with mockups/non-text description support (consumes R2-05's
    dynamic artifact surface once available — soft). ACs: journey evidence of
    a multi-round interview producing a revised plan.
  - **R4-04-F2 Completeness-critic in FINALIZE.** Fold the existing
    `architect-completeness-critic` into the architect's FINALIZE step per the
    brain theme: coverage diff (registered − ⋃ scopes), pairwise-disjoint
    scope assertion, scope ledger (every enumerated answer traces to an
    initiative or explicit deferral), invariant/dependency completeness. ACs:
    a seeded incomplete plan is caught pre-gate; "0 escalations on N
    initiatives" smell is flagged.
  - **R4-04-F3 Registers initiatives without WIs (entry path 1).** Architect
    output = roadmap initiatives with **no** work items (Q2-B); decomposition
    is the plan agent's job, triggered per-initiative from the roadmap screen
    or in batch on accept. ACs: accepted plan yields initiatives in the new
    blocked-until-planned state (R4-11-F2).
  - **R4-04-F4 Edge-case/exploration stage.** An explicit "exploring / edge
    cases" architect stage prompting enumeration (operator-journey gap #6),
    with brain constraints propagated into initiative ACs. ACs: stage visible
    in the interview UI; ACs cite brain-sourced constraints where applicable.
- **Session sizing:** ~2-3 sessions.
- **Out of scope:** decomposition/WI specs (R4-05); the PLAN gate surface
  itself (existing `/artifact` gate); architect-flow retirement (R4-D1).

### R4-05 Plan agent

- **Status:** **implemented** (2026-07-18, wave 2 — as-built baseline R4-B10)  ·  **Wave:** 2 (with R4-11 — the highest-leverage new capability)
- **Implemented-notes (2026-07-18, branch `feat/r4-05-plan-agent`):** F1/F2/F5/F6/F7 landed as specced. **Two
  operator-reviewed scope decisions:** (a) **F3** — ADR-037 accepted at the plan-agent seam, but decision **item 3
  (the bounded sonnet-assist skill) is DEFERRED** — the deterministic core (items 1+2) + ralph-spec-lint (item 4)
  already close the proven failure mode; the assist targets an unproven narrow judgment case (ambiguous
  `applies_to` / novel port-checklist synthesis); building a speculative LLM spawn contradicts the
  simplest-thing/shave-guardrails north star. Re-entry: a real cycle needs a constraint the deterministic selector
  can't express. (b) **F4** — the standalone dispatch was built as a **flow-path manifest-move**
  (`enqueuePlanRun` → the scheduler runs `execPm`→`runProjectManager`, the SAME code path as F5), **NOT** via the
  `runAgent` primitive: the plan agent is still the specialized PM phase runner (a load-bearing budget cap,
  brain-nav system prompt, per-turn telemetry, brain-gate) that the single-shot `runAgent` cannot drive without
  degradation. The literal `runAgent`-consumption is deferred to **R4-01-F2** (the PM→runAgent migration, wave 4).
  **Operator chose this (2026-07-18, Option A).**
- **Depends on:** R2-01 (**hard, for F4** — standalone dispatch = the
  R2-01-F1 runAgent primitive, spawned behind R5-01's guard; no new bespoke
  runner or CLI case), R4-11 *(soft — the standalone entry point lives on the
  roadmap screen and needs its states)*, R1-04 *(soft — reads
  instructions/release/build clauses as planning inputs)*
- **Depended on by:** R4-06 (consumes its specs), R4-10 (first node of the flow)
- **Context:** Operator diagram (verbatim): *"non interactive planner which is
  tailored towards/designed around the architect agent's finalised output;
  decomposes all initiatives into executable work items (each defined as a
  spec) mapping out dependencies between specs as required; once decomposition
  is complete each initiative object is updated to include reference to the
  specs."* Two entry paths (Q2-B): (1) standalone per-initiative trigger from
  the roadmap screen — develop on an initiative **blocks until work items
  exist**; (2) auto-generate WIs for all initiatives immediately after the
  operator accepts architect output. ADR-037 (the only Proposed ADR) **folds
  in here** — its deterministic-first wi-spec-compiler becomes the plan
  agent's spec-compilation step. The PM evolves into this agent. Open issues
  it must answer: decompose-completeness is variable (PM under-planning,
  betterado residue — the unifier completeness gate only caught
  under-*delivery* vs the plan, not under-*planning*); PM never populates
  `domain` (known-gaps §4.6).
- **Features:**
  - **R4-05-F1 Non-interactive planner agent def.** `project-manager` evolves:
    surface `unattended`, tailored to the architect's finalised output,
    **ralph-aware spec design** — the tailoring is expressed entirely inside
    the R4-05-F2 spec schema (the versioned artifact contract is the coupling's
    sole expression; no loop-specific content outside it — the develop agent
    is the reference consumer, per the suite doctrine). ACs: def round-trips
    through the builder; lint green; spec artifacts validate against the F2
    schema with no ralph-loop knowledge required to parse them.
  - **R4-05-F2 Spec-WI format + initiative back-references.** Each WI is a
    spec (ADR-015 schema extended as needed); inter-spec `depends_on` mapped;
    the initiative manifest gains `specs:` references once decomposition
    completes. ACs: schema documented; a decomposed initiative's manifest
    lists its specs; scheduler honours spec dependencies.
  - **R4-05-F3 wi-spec-compiler fold-in (ADR-037).** Deterministic core stays;
    build the bounded sonnet assist (known-gaps §4.1) **[DEFERRED 2026-07-18 — see R4-05 implemented-notes]**; carry ADR-037's named
    risks as explicit specs: `creates:` escape for pure-modification WIs
    (verification_artifact stand-in), `detectHiddenCoupling` reject→compile
    test coverage sized to its quieter-failure risk, `profile.md`
    `applies_to:` tagging becomes part of onboarding (R4-02-F5 owns the
    onboarding side). Interim (until R4-02 lands): untagged profile
    constraints compile under the ADR-037 as-built selector default
    (`all` / `manifest.<field>` globs). ACs: ADR-037 moves Proposed→Accepted
    (amended to live at the plan-agent seam); tagged brain constraint clauses
    compile verbatim into matching WIs.
  - **R4-05-F4 Entry path 1 — standalone per-initiative planning.**
    Roadmap-screen trigger (R4-11-F2) dispatching through the R2-01-F1
    runAgent primitive behind R5-01's guard — explicitly NOT a new bespoke
    runner/CLI case (the R2-B2 pattern ends here). Develop blocked until WIs
    exist — the lock itself is R4-11-F2's; completing standalone planning
    flips the state that lock reads. ACs: an unplanned initiative shows the
    trigger, a planned one doesn't; develop dispatches once planned; the
    dispatch appears in R5-01's route-coverage table. **[implemented flow-path
    per operator Option A 2026-07-18 — a manifest-move (`enqueuePlanRun`) reusing
    `execPm`→`runProjectManager`, NOT the runAgent primitive; see R4-05
    implemented-notes. The R4-11-F2 UI-facing lock/trigger ACs land with R4-11.]**
  - **R4-05-F5 Entry path 2 — batch on architect accept.** Accepting the PLAN
    gate queues planning across all registered initiatives (today's
    behaviour, re-expressed through the same planner). ACs: both entry paths
    invoke the same planner pipeline (single code path, asserted by test) and
    produce schema-identical artifacts; a fixture initiative compiled with the
    deterministic core only (sonnet assist disabled) yields byte-identical
    output through both paths.
  - **R4-05-F6 Decompose-completeness validator.** A coverage check of specs
    against the initiative's stated scope (the under-planning case the
    delivery gate can't see). **Flag disposition (operator decision
    2026-07-17): non-blocking** — findings are logged as events and surfaced
    on the initiative's roadmap node + the R4-11-F4 attention strip; develop
    dispatch proceeds. No plan-output gate exists (deliberate simplification:
    the plan node is interior to the develop cycle in the target state, and
    agent-as-sometimes-gate is functionality forge doesn't need — gates stay
    flow-node data). ACs: a seeded under-decomposed initiative is flagged
    before develop dispatch and visibly surfaced; dispatch is not blocked.
  - **R4-05-F7 `domain` population.** Plan agent populates WI `domain`
    (closes known-gaps §4.6) so ADR-037 constraint selectors can match beyond
    `manifest.<field>` globs. ACs: compiled WIs carry domains; a
    domain-scoped constraint clause lands only in matching WIs.
- **Session sizing:** ~3-4 sessions (def+format; compiler fold; entry paths + validator).
- **Out of scope:** roadmap-screen UI states (R4-11); develop-side spec
  consumption (R4-06); architect-side initiative quality (R4-04).

### R4-06 Develop agent refinement

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** R4-05 (spec format), R2-03 (declared fanout property)
- **Context:** Operator diagram: *"essentially the exact dev agent we have
  today other than any logical refinements with the changes from the rest of
  the agents; designed around autonomous development of specs through a ralph
  loop"* — the plan agent holds this context when writing specs. Fanout is
  selected in the flow builder **only because the def declares it** (R2-02/R2-03).
- **Features:**
  - **R4-06-F1 Spec consumption.** Develop reads plan-agent specs (R4-05-F2)
    as its single source of intent (brain-read policy unchanged: Brain-3
    advisory only). ACs: a cycle runs plan→develop on specs end-to-end.
  - **R4-06-F2 Declared fanout.** `developer-ralph` def declares the R2-03
    fanout capability; per-WI multiplicity remains runtime-derived from specs;
    flow-builder exposes the option only here. ACs: fanout selectable on the
    dev node, greyed on non-declaring agents.
  - **R4-06-F3 Signal hygiene.** Fix misleading per-WI events
    (`dev-loop.delivered`/`branch-pushed` firing for FAILED WIs — 2026-07-11
    reflection note); distinct signal for systematic capture crashes vs
    env-flake. ACs: event names truthful in a failed-WI replay.
- **Session sizing:** ~1-2 sessions.
- **Out of scope:** fanout mechanics (R2-03); merge-resolution of parallel
  branches (R2-D1, deferred); spec quality (R4-05).

### R4-07 Demo agent

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** R1-03 (executes the demo-process clause it types), R2-05
  *(soft — richer dynamic demo surfaces)*
- **Context:** Operator diagram: *"agent designed to take output of a develop
  phase, generate a project's demo from that work, and iterate on fixes if the
  demo does not show that the work has passed acceptance criteria for the
  initiative"* — one of the two Q3-B successors to the unifier,
  initiative-context. Also the diagram's contract note: the demo builder
  *"could likely be improved, simplified, and tied in directly with the UI"*,
  and demo *"should largely build off testing"*. Operator-journey gap #8: the
  demo skill becomes a first-class wrap-up — always produce the page; capture
  live evidence when the project stands up real resources (standing rule:
  demos are visual evidence, not test-name tables).
- **Features:**
  - **R4-07-F1 Initiative-context demo generation.** Composes
    `studio/demo-elements/` against the initiative's ACs from develop output;
    always produces the demo page; live evidence (API GET/portal capture) for
    live-capable projects, orchestrator-executed per ADR-036 (agents author,
    orchestrator captures). ACs: demo.json validates; betterado-tier live-REST
    gate shape preserved.
  - **R4-07-F2 Fix-iteration loop.** When the demo can't show an AC passing,
    fix work is spawned per R4-10-F1's loop-topology spec (the demo agent
    judges and scopes; the develop agent executes the fix — one executor for
    every post-develop fix loop, shared cap). ACs: a seeded AC-miss produces
    a fix iteration through the shared mechanism, not a hand-wave demo and
    not demo-agent-authored code edits.
  - **R4-07-F3 Demo-builder simplification + UI tie-in.** The per-project
    demo-design builder (`/demo/[sid]`) simplifies against R1-03's typed demo
    process and links directly from the roadmap/review surfaces. ACs:
    demo-process clause and builder produce/consume the same descriptor;
    journey synced.
- **Session sizing:** ~2 sessions.
- **Out of scope:** demo-process clause typing (R1-03); verdict/approval
  surface (R4-08 + existing gate); harness fixture re-grounding (R5-06).

### R4-08 Adversarial review agent

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** — (consumes R1-03 test-process results; R2-01-F4's
  `project-scoped-review` wiring is its design feed)
- **Context:** Operator diagram: *"an adversarial review agent to catch
  general issues with the code developed"* — second Q3-B successor,
  initiative-context, driving to the operator approving the PR through forge.
  Operator-journey gap #9: send-back visibly spawns a dev-loop, re-demo,
  re-present — a continuous loop gated only by operator approval. ADR-036
  boundary holds: the agent judges; `acEvaluations[]` remain agent-authored
  claims weighed at the verdict; evidence is orchestrator-produced. The
  dual-boundary full-suite gate does **not** live in this agent — it is
  orchestrator-owned (R1-03-F4 spec, R4-10-F2 home) ⚑ operator review.
- **Features:**
  - **R4-08-F1 Adversarial critique pass.** Initiative-context review of the
    developed diff distinct from the demo's AC-proof: correctness, regression
    risk, contract-fit, convention drift (Brain-3 advisory). ACs: verdict
    artifact with per-finding severity + evidence pointers; runs standalone
    (R2-01) and as the flow's review node.
  - **R4-08-F2 Continuous send-back loop — the ADR-026 successor spec.**
    Send-back from the verdict gate compiles the operator's feedback into
    scoped spec-WIs appended to the initiative's own work-item queue and
    re-dispatches the **develop agent** (the single fix executor per
    R4-10-F1's loop topology), then re-demo (R4-07) → re-present — visibly
    looping until approve. Successor mechanics for what ADR-026's machinery
    does today: (a) **queue substrate** — the initiative WI queue replaces
    `.forge/unifier-items/` typed UWIs; (b) **bound** — a review-round /
    total-fix-WI cap (the `UNIFIER_MAX_TOTAL_ITEMS` analogue, config home
    `forge.config.json` review section) parks the initiative needs-operator
    when exhausted; (c) **mutual exclusion** — the finalize-vs-loop
    arbitration re-implements `finalize-merged`'s pendingUnifierItems check
    against the new queue (a MERGED PR wins; a pending fix loop defers
    finalize); (d) **one cycle identity** preserved across rounds. ACs:
    journey evidence of send-back → fix → re-presented verdict in one cycle
    identity; cap exhaustion parks loudly; **ADR-026 amended/superseded in
    the same change**; a concurrent merge + send-back race resolves per (c).
  - **R4-08-F3 Verdict surface fit.** Existing `/artifact` verdict gate
    consumes this agent's output unchanged where possible; deltas journey-synced.
    ACs: approve path IS the merge (ADR-021 invariant untouched; bridge paths
    remain behind R5-01's guard).
- **Session sizing:** ~3-4 sessions (F2's ADR-026 successor mechanics are a
  session of their own — resized per adversarial review 2026-07-17, B1).
- **Out of scope:** demo generation (R4-07); the dual-boundary gate (
  orchestrator-owned — R4-10-F2); merge mechanics/guards (R5-01).

### R4-09 Reflect agent

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** R1-01 (writes into contract-typed, Q5-B-scoped KBs)
- **Context:** Operator diagram (verbatim intent): the current reflection agent
  *"except runnable as a standalone agent rather than needing a flow with a
  single agent in it; takes an initiative with a current state of **merged**
  (a new state between in progress and done) and generates a review of the PR
  and the cycle logs to generate the questionnaire/interview with the
  operator; focused on generating forge artifacts not project ones —
  entries in either a project brain or cycle brain based on the user's
  responses"* (post-Q5-B: project-KB or **flow-KB**); *"the logical point for
  a triggered brain lint, ingest, and review for consolidation"*; *"an agent
  with both an interactive and an automated mode, with the automated mode
  making the inferences to answer questions about the cycle itself instead of
  crafting questions for the user — using forge logs, demo artifacts, and code
  changes"*. Baseline sharpness (R4-B7) must not regress.
- **Features:**
  - **R4-09-F1 Standalone on `merged`.** Runs as a standalone agent (R2-01)
    triggered by the initiative reaching `merged` (R4-11-F1) — replacing the
    single-node forge-reflect flow wrapper as the *shipped* shape (the flow
    form remains authorable). **Trigger mechanism stays declarative:** the
    state transition emits an event; routing goes through the R2-04 trigger
    registry (which gains an agent-target/state-transition extension for
    this consumer — recorded there), never a bespoke hardcoded dispatch in
    finalize/scheduler. **Cutover is atomic in this feature:** the
    forge-develop `on: merged` declaration is removed/inerted in the same
    change, so exactly one reflect fires per merge at every point in time.
    ACs: merge → reflect fires off the state transition via the registry;
    completion moves the initiative `merged → done`; **a lost, stalled, or
    operator-pending reflect never blocks dependent initiatives**
    (R4-11-F1's `merged ∪ done` dependency rule); exactly one reflect per
    merge, asserted across the cutover.
  - **R4-09-F2 Interactive mode.** PR + cycle-log review generates the
    operator questionnaire (right-sizing, cost-vs-effort, semantic judgements,
    decisions to validate — MVUS phase 5). ACs: questionnaire grounded in
    the actual PR/logs (citations), not generic.
  - **R4-09-F3 Automated mode.** Same questions answered by inference from
    forge logs, demo artifacts and the code diff; operator picks the mode at
    trigger time (or per-schedule). ACs: automated run produces the same
    artifact shape with `inferred: true` provenance per answer.
  - **R4-09-F4 Forge-artifact writes per Q5-B.** Lessons about the project →
    its project KB; lessons about running the flow → the flow's KB (the
    rebound cycles KB). ACs: writes route by lesson subject; brain lint green.
  - **R4-09-F5 Post-cycle KB health trigger.** Reflect completion triggers
    R1-01's lint/ingest/consolidate processes on the touched KBs. ACs: a
    reflect run leaves the KB lint-clean with fresh ingest, evidenced in
    events.
- **Session sizing:** ~2-3 sessions.
- **Out of scope:** KB contract processes themselves (R1-01); the `merged`
  state plumbing (R4-11-F1); read-policy changes (none — Q5-B).

### R4-10 Develop-cycle OOTB flow

- **Status:** planned  ·  **Wave:** 4 (assembles last)
- **Depends on:** R4-05, R4-07, R4-08 (its nodes)
- **Context:** Operator diagram: *"put the chain of automated development
  agents into an out of the box develop cycle that can progress work between
  the two human interaction points (architect and PR review/merge); ship
  valuable agents that can be run in isolation as well as a single flow that
  demonstrates the capability of flows well."* Q2-B: forge-architect flow
  stays alive alongside; retirement is R4-D1.
- **Features:**
  - **R4-10-F1 The flow definition + loop topology.** `plan → develop
    (fanout-capable) → demo → adversarial review → verdict gate`, as pure
    flow data on the R2 engine; human moments: architect accept upstream, PR
    approve at the gate. **Loop topology (owned here; R4-07-F2 and R4-08-F2
    reference it):** every post-develop fix loop — demo AC-miss iteration,
    verdict send-back, and red merge-boundary remediation (F2) — re-dispatches
    the **develop agent** with scoped spec-WIs; one executor, one shared
    round/total cap (config home per R4-08-F2(b)); loops are orchestrator-band
    re-entry, not flow back-edges (the flow stays a DAG as data). ACs:
    `forge studio lint` green; flow runs a real initiative end-to-end on the
    routine verify tier (after F5's harness migration); each loop kind
    demonstrably routes through the single executor.
  - **R4-10-F2 Orchestrator merge-boundary gate ⚑ FOR OPERATOR REVIEW.** The
    relocated dual-boundary full-suite gate (spec: R1-03-F4) executes as an
    orchestrator-owned band at the flow's merge boundary — not an agent node.
    **Sole build+prove owner** (R4-01-F4 only verifies retirement safety).
    **Unattended remediation (the capability ADR-026's unifier provided):** a
    red merge-boundary gate re-dispatches the develop agent with scoped fix
    WIs compiled from `.forge/last-gate-failure.md`, bounded by the F1 shared
    cap — integration breaks that aren't AC-misses get fixed without an
    operator touch. **Precondition:** the operator verdict on the gate
    relocation is recorded in the ADR-036 amendment (R1-03-F4's AC) before
    this feature starts. ACs: red full-suite baseline blocks merge even when
    scoped per-WI gates are green; nothing ships red; a seeded cross-WI
    integration break (dead-shared-helper fixture, the recurring brain-corpus
    class) is fixed and reaches merge without operator intervention.
  - **R4-10-F3 Isolation parity.** Every node agent runs standalone with the
    same artifacts (the diagram's ship-both principle). ACs: per-agent
    standalone runs documented in journeys.
  - **R4-10-F4 Succession mechanics.** Decide forge-develop's fate (supersede
    vs version) — flow-seed residue only; the reflect-trigger cutover itself
    is owned atomically by R4-09-F1 (via the R2-04 registry). ACs: stale flow
    seeds removed or marked (and `forge studio lint` gains whatever
    deprecated-seed treatment "marked" needs); **the cycles KB
    `binding.ref` is updated to the successor flow id in the same change** —
    `forge studio lint` + `forge brain lint` green (R1-01's dangling-ref lint
    would otherwise go red).
  - **R4-10-F5 verify:cycle harness migration.** The standing regression
    harness (ADR-022) structurally encodes the unifier pipeline ("dev →
    unifier → review" spine, `--send-back adds an extra unifier pass`,
    unifier-written demo.json + changelog draft). This feature owns its
    migration: assertion spine moved to the successor shape (demo.json
    producer → R4-07, send-back path → R4-08-F2 mechanics, dev-loop N/N
    unchanged), frozen-SHA routine baseline re-cut on the successor flow —
    sequenced so the old-shape tier stays runnable until the new flow's first
    green verify run. ACs: verify:cycle green on the successor flow;
    old-shape tier retired only after that first green run.
  - **R4-10-F6 Resume semantics re-home (ADR-019 successor).** The
    all-WIs-complete environment-failure resume (`resume_from: 'unifier'`,
    `orchestrator/requeue-resume.ts`) re-targets the successor topology:
    resume from the demo node against the preserved branch (demo node marked
    `resumable: true` in F1's flow data); requeue-resume stamp vocabulary
    migrated; ADR-019 amended in the same change. The standing operator
    requirement holds: unifier-era or successor-era, a post-develop failure
    never discards per-WI work. ACs: a seeded post-develop environment
    failure resumes from demo without re-running WIs; ADR-019 amendment
    merged.
- **Session sizing:** ~4 sessions (flow+topology; gate F2; succession+KB
  rebind; harness migration + resume re-home).
- **Out of scope:** node agents (R4-05/06/07/08); trigger kinds (R2-04, which
  also owns the registry's agent-target extension R4-09-F1 consumes);
  architect-flow retirement (R4-D1).

### R4-11 Roadmap & attention surface

- **Status:** **implemented** (2026-07-19, wave 2 — as-built baseline R4-B11)  ·  **Wave:** 2 (with R4-05)
- **Depends on:** — · **Depended on by:** R4-05 *(soft)*, R4-09 (merged-state trigger)
- **Context:** The operator surface work the suite needs: Q2-B's `merged`
  lifecycle state, the standalone plan trigger, blocked-until-planned, folding
  recovery into the roadmap (known-gaps §4b.4), and Q4's slim cross-project
  aggregate strip / notifications blade (MVUS cross-cutting requirement;
  ADR-031 retired the old pane — this is the deliberate slim re-ship). Plus
  the architect re-run affordance (memory: architect is discrete
  file-checkpointed turns — a small `POST /api/architect/rerun` + button on
  the StuckWarning is all it needs). **Scope-ownership note (adversarial
  review 2026-07-17, D6):** the initiative object + lifecycle is SWE-suite
  domain *hosted in* Scope-1 machinery (queue, scheduler, finalize) — this
  initiative edits Scope-1 paths on the suite's behalf; R4-01-F1's ADR
  records the platform-owned vs suite-owned object split, and the state
  vocabulary extends via one data table (the `status-colors.ts` pattern),
  never scattered string literals.
- **Features:**
  - **R4-11-F1 `merged` lifecycle state.** The real transition is
    **`ready-for-review → merged → done`** (`merged` = PR confirmed merged,
    reflect pending) — NOT the "in-progress → merged" shorthand of the
    original decision text; the as-built lifecycle is a **directory-rename
    state machine** (`_queue/pending → in-flight → ready-for-review → done |
    failed`, `orchestrator/queue.ts`), and `merged` ships as a **sixth queue
    directory `_queue/merged/`** (consistent with the atomic-rename claim
    mechanism). Code that must learn the state — enumerate and touch all of
    it: `queue.ts` (getPaths/counts/QueueState), `finalize-merged.ts`,
    `enqueue-develop-run.ts` state classification, recovery sweeps,
    `run-model.ts` `QUEUE_STATE_TO_RUN_STATUS`, `forge-ui/lib/bridge-client.ts`
    status union + `SerpentineTimeline` vocabulary (via the shared data-table
    pattern). **Dependency rule (operator decision 2026-07-17): dependent
    initiatives gate on `merged ∪ done`** — reflect completion is never a
    prerequisite for downstream work (accepted risk, recorded: brain lessons
    from a pending reflection may not land before a dependent cycle starts).
    **Interim closure rule (waves 2-3, until R4-09):** the existing inline
    finalize→reflector chain transits `merged → done` in the same sweep — the
    state is observable but never parks; the reflection-lost path ALSO moves
    `merged → done` (today's deliberate tolerance is preserved). UI chip +
    DOM attrs; journey synced. ACs: state round-trips through a real merge;
    no initiative skips it; **exactly one component moves manifests into/out
    of `merged/`**; a dependent initiative dispatches while its prerequisite
    sits in `merged`; a reflection-lost run still reaches `done`.
  - **R4-11-F2 Plan trigger + blocked states.** Per-initiative "Plan" action
    for WI-less initiatives (R4-05-F4); `blocked-until-planned` lock badge;
    spec/WI counts once planned. ACs: DOM-as-metrics attrs for each state;
    develop dispatch respects the lock.
  - **R4-11-F3 Recovery folded in.** Stuck-initiative recovery affordances
    (attempt counts, recover/requeue) move onto the roadmap nodes; `/recovery`
    tab removed; redirects preserved. ACs: recovery journey rewritten against
    the roadmap surface; dead-route sweep green.
  - **R4-11-F4 Cross-project attention strip.** Slim aggregate strip /
    notifications blade on the library surface: per-project **planned/queued
    counts** (the MVUS "observe planned work" half), in-flight counts,
    gates-awaiting-operator, merged-awaiting-reflect, and R4-05-F6
    completeness flags. Q4 decision; kept deliberately thin (no full
    portfolio pane) — drill-down is link-through to the owning per-project /
    per-run surfaces (which already carry per-phase/per-WI cost attrs). ACs:
    with ≥2 projects active, one glance answers "what needs me"; every strip
    item links through to its owning surface (asserted in the journey beat);
    strip carries data-* attrs.
  - **R4-11-F5 Architect re-run affordance.** `POST /api/architect/rerun` +
    button on the stalled-turn warning (spawn path behind R5-01's guard).
    ACs: a stalled seeded session resumes from the UI.
- **Session sizing:** ~2-3 sessions (state+plan-trigger; recovery+strip; rerun).
- **Out of scope:** plan agent internals (R4-05); reflect behaviour (R4-09);
  notification *transport* beyond the in-Studio blade (no email/push — YAGNI
  until asked; tracked as **R6-D1**).

## Deferred

### R4-D1 Architect-flow retirement

The diagram's end-state: the plan agent becomes the develop flow's starting
point and the architect runs purely as a standalone agent — *"ultimately
dropping the need for the architect flow entirely"*. **Deliberately deferred
(Q2-B)**: this round ships the plan agent alongside the living forge-architect
flow. **Re-entry condition:** the standalone plan path (R4-05-F4) and the
develop-cycle flow (R4-10) have carried real initiatives end-to-end across
enough cycles that the operator judges the architect-flow wrapper redundant —
then retirement lands as kickoff-surface changes (ADR-031/033 amendments), a
flow-seed removal, and journey rewrites, entering as `planned` with the next
free R4 ID's features.

## Change log

- 2026-07-17 — Roadmap created (initial forge-dev roadmap planning session).
  Locked inputs: Q2-B (plan agent alongside architect; `merged` state; ADR-037
  folds into R4-05), Q3-B (unifier retired → R4-07/R4-08; dual-boundary gate
  relocation ⚑ operator review), Q4 (attention strip in R4-11), Q6-A (waves).
  Cross-roadmap edges recorded: R4-01 ← R2-01,R2-02 · R4-05 ← R4-11(soft),R1-04(soft) ·
  R4-06 ← R2-03,R4-05 · R4-07 ← R1-03,R2-05(soft) · R4-09 ← R1-01 ·
  R4-02/R4-03 ← R3-05(+R1 clauses) · R4-10 ← R4-05,R4-07,R4-08.
- 2026-07-17 — Adversarial-review amendment pass (30 surviving findings + 4
  operator decisions). Headlines: R4-11-F1 rewritten against the real
  directory-rename state machine (`ready-for-review → merged → done`,
  `_queue/merged/`, dependents gate on `merged ∪ done`, reflection-lost never
  blocks — operator decisions 1); R4-08-F2 expanded into the full ADR-026
  successor spec (queue substrate/cap/mutex/one-cycle-identity + ADR-026
  supersede AC); R4-10 gained F5 (verify:cycle harness migration) and F6
  (ADR-019 resume re-home) + the loop-topology spec in F1 + unattended red-gate
  remediation in F2; R4-09-F1 trigger cutover made atomic + routed through the
  R2-04 registry; R4-05 gained the R2-01 hard edge, F6 non-blocking disposition
  (operator decision 2: no plan-output gate — simplification), F5 testable AC;
  R4-02 gained F5 (profile.md tagging); R4-01-F4 reduced to retirement
  mechanics with explicit late sequencing; demo-mechanism dispositions recorded
  in R4-B6; scope-ownership note on R4-11 (D6); doctrine coupling clarified as
  artifact-contract (E11).
- 2026-07-18 — **R4-05 implemented** (wave 2, branch `feat/r4-05-plan-agent`; R4 gains baseline **R4-B10**). Plan
  agent = the evolved `project-manager` in place. F1/F2 (`specs:` back-ref) + F3 (ADR-037 accepted at the
  plan-agent seam; **item-3 sonnet-assist DEFERRED** with re-entry condition) + F7 (`domain`) + F4/F5 (both entry
  paths converge on one `execPm`→`runProjectManager` pipeline; **F4 built as a flow-path manifest-move per operator
  Option A 2026-07-18, NOT the runAgent primitive — literal runAgent-consumption deferred to R4-01-F2**) + F6
  (non-blocking `plan.completeness` event). Wave-2's R4-05 half; R4-11 is the other half.
- 2026-07-19 — **R4-11 implemented** (wave 2, branch `feat/r4-11-roadmap-attention`; R4 gains baseline **R4-B11**).
  The roadmap/attention surface: F1 `merged` transient queue state (`_queue/merged/`; single move-authority in
  `closure.ts`; dep gate `merged ∪ done`; ~17 sites; distinct from the `CycleOutcome` value) + F2 plan trigger +
  blocked-until-planned lock (wires R4-05's plan endpoint) + F3 recovery folded onto the roadmap card (`/recovery`
  → redirect stub) + F4 cross-project attention strip (`GET /api/studio/projects/attention`) + F5 architect re-run
  (`POST /api/architect/rerun`, guarded spawn). Deferred (known-gaps): a server-side `planned` gate on
  `/api/develop/start` (UI lock only — ADR-031 makes the UI the sole surface); the orphan-in-merged SIGKILL edge
  (R4-09). **Wave 2 (R4-05 + R4-11) COMPLETE.**
- 2026-07-24 — **Wave 4 opened: R4-01 F1–F3 built** (branch `feat/r4-01-artifact-migration`; R4 gains baseline
  **R4-B12**). ADR-039 ships-as-artifact + the declared-dispatch seam: `executor:` rows `pm`/`dev`/`reflect`
  retired onto band hooks (`wi-contract`/`reflection-close`, `orchestrator/agent-bands.ts`) + `loopStrategy:
  'ralph'` routing; `runAgent` gains the one-shot runtime (`lifecycle:'caller'`, declared budget caps, streamGuard,
  scratch PROMPT.md — closes the known-gaps §8 rider); pipelines keep their judgment bands, only the SDK call
  moved; `*-invocation.ts` dissolved into `phases/*-binding.ts`. `PHASE_EXECUTOR_KINDS` = `['unifier']` (held for
  F4). Parity: golden spawn-captures pin PM/reflector {prompt, options} byte-identical. **Status in-progress: the
  PR is held open for the operator-gated frozen-SHA `verify:cycle` routine run (the F2 AC's real-run half); F4
  retirement stays planned for end of wave 4.**
