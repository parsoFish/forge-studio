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
- **`orchestrator/agent-bands.ts`** — band-guard registry (`wi-contract`, `reflection-close`;
  named band-*hook* until R3-03 renamed the vocabulary, 2026-08-04);
  flow-runner's `AGENT_BAND_EXECUTORS` maps them onto the unchanged `execPm`/`execReflect`
  bands; `execAgent` routes band guards first, then `loopStrategy: 'ralph'` → the dev-loop
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

### R4-B13 Wave-5 mockup alignment register (2026-08-03)

The studio-endstate-v2 mockup (`mockups/studio-endstate-v2/`; 27 scripted
journeys) was diffed against the wave-4 as-built suite
(`as-built-inventory.md`). **Verified ALIGNED — baseline material, not
initiatives** — with each agent/flow's mockup run journey adopted as its
standing acceptance reference for future refinements:

- **developer** (`run-agent-developer`) — ralph loop, per-WI fanout,
  write-first continuity, brain-read policy (project-advisory only): all
  as-built (R2-03/R4-06).
- **adversarial-review** (`run-agent-adversarial-review`) — refute-first
  findings, feeds the verdict gate: as-built (R4-08, R4-10).
- **demo-runner** (`run-agent-demo-runner`) — project-demo-skill execution,
  actual-resource evidence: as-built (R4-07); the *showcase page* delta is
  R4-14, the *project-hook trigger* delta is R2-08.
- **reflector** (`run-agent-reflector`) — outside-the-cycle reflection into
  the brains, merged-trigger: as-built (R4-09); the *brain-tune flow*
  packaging delta is R4-20.
- **forge-develop flow** (`run-flow`) — dev→demo→adversarial-review→verdict
  topology, hex nodes, typed hand-off artifacts: as-built (R4-10); the
  mockup's extra "Initiative intake" queue node is presentation of the
  existing queue claim, not a new flow node.
- Also aligned per the cut prompt: hex canvas + ArtifactPicker edges, 4-kind
  triggers, KB force-graph, skills builder, architect interview → unified
  gate.

**Vision items deliberately NOT cut** (recorded so absence ≠ oversight): the
`demo-rest-api` / `demo-web-ui` OOTB demo projects (`provenance: 'vision'`)
ride R3-06-F3 scaffolds + R4-03 creation when those land; the
`demo-design`/`research` parallel-intake agents are parked with **R2-D2**
(operator decision 2).

### R4-B14 Architect planning session as a dependency DAG (implemented)

R4-15-F1 landed 2026-08-06 (wave 5, batch B, **PR #86**, merge commit
`cdefbf8c`). The architect session already rode R2-10's shared shell; what F1
added is the roadmap draft's **dependency edges** and a **shared** DAG renderer:

- **Edges end-to-end.** `RoadmapDraftRow.dependsOn`
  (`orchestrator/studio/session-transcript.ts`) carries the manifest's
  `depends_on_initiatives` **verbatim** — unsorted, undeduplicated; resolving an
  edge against the draft set is the view's job, not the deriver's. The client
  mirror (`forge-ui/lib/session-client.ts`, `parseRoadmapDraftRow`) was a second
  sink and carries it too, fail-closed on a malformed value.
- **The shared renderer** (built for R4-13-F1's roadmap tab to reuse, the R3-01
  `FilePackage` shape): `forge-ui/lib/dependency-dag.ts` — pure, generic over
  `T`, levels delegated to the existing `topoLevels`
  (`forge-ui/lib/dep-layout.ts`), edges directed "from must complete before to",
  unresolved targets and cycles reported — plus
  `forge-ui/components/studio/DependencyDag.tsx`, which takes an
  already-computed view so every surface beside it reads ONE value.
  `SessionArtifactPane` renders **DAG + initiative table**, which IS R4-13-F1's
  stated roadmap-tab layout.
- **Entry from the project page:**
  `forge-ui/components/studio/ProjectArchitectEntry.tsx` mounts the one shipped
  start-a-session path (`NewIdeaBox` → `POST /api/architect/start` →
  `/sessions/architect/<sid>`).
- **Contract + journeys:** `data-*` rows in
  [`docs/forge-ui-dom-and-harness.md`](../forge-ui-dom-and-harness.md); beats
  `flows-run/flows-run-roadmap-dag` (real manifests, real route, real DOM,
  including an out-of-draft edge) and the `roadmap/roadmap-tab` entry
  assertions.
- **Not** a redesign: architect behaviour is unchanged and the architect flow is
  not retired (R4-D1).

### R4-B15 Demo-builder generation gallery (implemented)

R4-16-F1 landed 2026-08-06 (wave 5, batch B). The demo-builder session already
had a real iterate loop (brief → generate → awaiting-review → feedback →
generate → lock); what F1 added is that the generations **survive** and become
choosable:

- **Snapshots are the data source.** Each completed generate turn snapshots into
  the SESSION dir — `projects/<p>/_demo/<sid>/generations/<n>/` = `DEMO.html` +
  `SKILL.md` + `meta.json` (`orchestrator/demo-builder-runner.ts`). The session
  dir, not the project repo: the shell derivation may not read outside
  `sessionDir`, and intermediate generations have no business being committed to
  the project's `forge-studio` branch. Snapshots accumulate; a later generation
  never mutates an earlier one.
- **A fourth session kind, declared as data.** `studio/session-kinds.yaml` gains
  `id: demo` (the id IS the `_<kind>` session-dir segment
  `cli/bridge-studio-sessions.ts` derives, which is why it is not
  `demo-builder`), `agent: demo-builder`, `stages: [demo]`, artifact
  `generation-gallery` — the R2-10 RESERVED row, now **live**, with
  `deriveGenerationGallery` (`orchestrator/studio/session-transcript.ts`)
  reading through the module's existing realpath choke points. Generation
  numbers come from each snapshot's own recorded iteration, so a corrupt
  snapshot leaves a visible gap instead of renumbering its successors; item
  sizes come from the file on disk, never from the metadata beside it.
- **Rendered in place, entry unchanged.** R1-03-F2 is not reversed: the inline
  `DemoBuilderPanel` on `/projects/[id]` mounts the REAL `SessionArtifactPane`
  fed by `GET /api/studio/sessions/demo/<sid>?project=<p>` —
  `forge-ui/lib/session-artifact-view.ts`'s `generationGalleryView` +
  `forge-ui/components/studio/GenerationGallery.tsx`, the same lib-module +
  component shape as R3-01's `FilePackage` and R4-15's `DependencyDag`. The
  generic `/sessions/demo/<sid>` deep link serves the same thing for free.
- **Finalize writes the CHOSEN generation.** `DemoBuilderStatus.selectedGeneration`
  is declared by `POST /api/demo-builder/lock` and ENFORCED in the lock step:
  the chosen snapshot's sample and its generator skill are restored into the
  project repo before the existing lock writes `demo.lock.json`, so the
  `demo_html`/`demo_skill` pair always comes from ONE generation and the file the
  demo-runner executes is the one the operator picked. A `selectedGeneration`
  naming a missing snapshot fails the lock loudly rather than silently locking
  the latest.
- **Contract + journey:** `data-*` rows in
  [`docs/forge-ui-dom-and-harness.md`](../forge-ui-dom-and-harness.md); beats
  `demo-builder/demo-builder-generate` + `demo-builder/demo-builder-lock`.

### R4-B16 Onboarding as a staged session with a contract build-out (implemented)

R4-17-F1 landed 2026-08-06 (wave 5, batch B). Before it, project onboarding had
**no session at all**: `onboarding-agent` was a fire-and-forget roster dispatch
(`POST /api/agents/:slug/run` → `spawnAgentDispatch` → `dispatchAgentRun` →
`runAgent`) whose only on-disk trace was `_logs/<runId>/events.jsonl`. There was
no `_onboarding/` directory anywhere in the repo, no `status.json`, no turns —
so the R2-10 shell could not render it, and nothing recorded which stage of the
contract produced which artifact.

- **The onboarding run now opens a real session.** `POST /api/studio/onboarding/start`
  creates `<projectsRoot>/<project>/_onboarding/<sessionId>/` with `status.json`
  and `prompt.md` (the operator's run-context, verbatim), then spawns the
  **identical** `spawnAgentDispatch(..., 'onboarding-agent', ...)` the generic
  route already spawned — R4-02's behaviour and hand-off are unchanged, and the
  generic route is untouched. The route accepts **no caller-supplied repo path
  at all**: `project` is a slug, and the project directory is derived and
  realpath-contained against `projectsRoot`.
- **`forge agent dispatch --session-dir` writes the terminal phase**, so a
  finished run stops claiming `running`. The phase is written by the process
  that actually observes the run ending, never attributed; without the flag the
  command is byte-identical to before it existed.
- **The contract build-out is a derivation over the project's own artifacts.**
  `deriveContractStages` (`cli/contract-stages.ts`) returns one row per stage for
  all five of `contract · instructions · secrets · demo · roadmap` — always all
  five, because an absent artifact is a row that names its source, and a dropped
  row is indistinguishable from never having looked. Sources are real and were
  verified before the vocabulary was chosen: `.forge/project.json`'s
  `testProcess.local.cmd` (C1), `AGENTS.md`/`CLAUDE.md` (C8), the declared
  `testProcess.acceptance.requiresEnv` NAMES (C7), `demoProcess[]` plus
  `.forge/demo/demo.lock.json`, and `roadmap.md`. **Secrets are names only,
  enforced structurally** — `secrets.env` is never opened, pinned by a
  sentinel-value plant.
- **Presence, never a verdict.** A row says an artifact exists and names where it
  came from; it never says a clause passes. `forge preflight`'s exit code remains
  the only authoritative contract-green signal (the rule comes from
  [`brain/forge-dev/themes/forge-project-onboarding-contract.md`](../../brain/forge-dev/themes/forge-project-onboarding-contract.md)).
  The roadmap row therefore also reports whether `brain/projects/<id>/profile.md`
  exists — C4 requires it alongside `roadmap.md` — as a **fact in the row**,
  rather than folding a hard-clause verdict into a presence signal or hiding the
  divergence.
- **One descriptor, reused by creation.** `studio/session-kinds.yaml` gains
  `id: onboarding` (the id IS the `_<kind>` session-dir segment), stages
  `[contract, instructions, secrets, demo, roadmap]`, artifact
  `contract-buildout` — R2-10's reserved row, now **live**. Creation reuses it
  rather than minting a second descriptor: the mockup gives
  `SESSIONS['project-onboarding']` and `SESSIONS['create-project']` the same
  artifact and the same label, and no creation agent exists for a second
  descriptor's `agent:` field to resolve to.
- **The renderer is stage-aware, and the pane no longer guesses.**
  `contractBuildoutView` (`forge-ui/lib/session-artifact-view.ts`) renders the
  five-row checklist on the `contract` stage and that stage's own detail
  elsewhere, matching the mockup's `contract-full` sub-views.
  `SessionArtifactPane` now DELEGATES its branch selection to that dispatcher —
  its previous ternary ended in an unconditional generation-gallery `else`, so an
  unhandled kind silently misrendered as a gallery instead of failing loudly.
- **The project-page data contract ships now, rendering later.**
  `GET /api/studio/projects/<id>/contract-stages` serves the same rows off the
  same derivation; **R4-12-F1 renders them in batch D**, which is why that
  initiative's "the panel is a VIEW of the artifacts, so it cannot drift"
  requirement is satisfiable without duplicating any parsing.
- **Contract + journey:** `data-*` rows in
  [`docs/forge-ui-dom-and-harness.md`](../forge-ui-dom-and-harness.md); beat
  `stand-up-onboard/su-onboard-session`.

### R4-B17 The onboard-project flow and its orchestrator-owned preflight gate (implemented)

R4-18-F1 landed 2026-08-11 (wave 5, batch E). Before it, onboarding was a
standalone agent path with **no flow packaging** (3 seed flows), and there was
no way to express "run the real contract preflight as a gate node" at all: the
flow-gate dispatch is a closed table, and a `gate:` id in neither `GATE_KIND`
nor an agent def resolves to `NodeKind:'unknown'` → `execUnknown`, which emits
an error event and **silently no-ops**. A naive `gate: preflight` would have
lint-passed and never run the check.

- **The gate runs the REAL preflight, orchestrator-side, with no injection
  seam.** `execOnboardPreflight` (`orchestrator/flow-runner.ts`) calls
  `runPreflight` (`cli/preflight.ts`) directly, exactly as
  `orchestrator/project-create.ts` already does, against
  `CycleInput.projectRepoPath`. It deliberately adds **no `FlowRunnerDeps`
  field** — the absence of a seam is the design: no stub can occupy it, so
  every test of the node exercises real preflight. On a red report it sets
  `state.terminateEarly`, which routes the manifest to `ready-for-review` via
  `runClosure` (the `execDemo` merge-boundary-gate precedent).
- **Dispatch is declared data, on the band-guard path (ADR-039).** The node
  carries BOTH `agent: contract-check` and `gate: contract`. The `agent:` field
  drives dispatch through `composition.guards: [onboard-preflight]` → a new
  `BAND_GUARD_IDS` / `BAND_CANONICAL_SLUG` / `AGENT_BAND_EXECUTORS` row family;
  the `gate:` field satisfies the `zero-gate` lint, and its new
  `GATE_KIND['contract'] = 'agent'` row means a node that LOST its `agent:`
  field fails loud through `execAgent`'s "no agent definition" throw instead of
  no-opping through `execUnknown`. Both fields are load-bearing; neither alone
  gives both guarantees.
- **`skills/contract-check/SKILL.md` is a declaration carrier, not a running
  agent** — it is never spawned on the flow path (the band executor intercepts
  the node before `runAgent`). Its frontmatter states plainly that a
  *standalone* dispatch would spawn it, that this is a pre-existing property
  shared with `project-manager`/`reflector`, and that `maxBudgetUsd: 0` caps
  such a run to at most one turn's spend rather than making it free.
- **Stated limit — the `contract` artifact template ships schema-empty**, so
  the `onboard → contract-check` edge's artifact contract asserts nothing at
  runtime. Harmless today (the gate re-derives everything structurally from the
  real project directory and never depends on it), but the honest fix needs
  `resolveRequiredFile` to learn a `projectRepoPath`-relative convention —
  `ArtifactGuardInput` does not currently carry that field.
- **Contract + journey:** journey `flows-onboard` (3 beats), story
  `run-flow-onboard` 3/8 ported + 5 decision-cited exclusions; the gate beat
  seeds a genuinely real `_logs/<cycleId>/events.jsonl` from a real `runFlow`
  run, never a hand-authored log.

### R4-B18 The authoring session, creation-agent on the generic interactive spine (implemented)

R4-21 landed in two halves: the session/agent/save infrastructure in wave-5
batch D, and its live turn execution in batch E once R4-22 shipped the
`turnSpec` spine. Before it, no roster agent authored an artifact package at
all, so the `file-package` artifact row was reserved and the `build-skill` /
`build-hook` parity stories had no producer to port against.

- **Consumer #1 of ADR-043, on pure data.** The `authoring` descriptor's
  `turnSpec` (`studio/session-kinds.yaml`) is ADR-043 §1's ratified table
  verbatim — `kindDir: _authoring`, `style: agent`, and the four rows
  `analyzing → awaiting-review → committing → committed`. **No fifth
  `AGENT_RUNNERS` entry and no new `orchestrator/` symbol were added**; the
  turn runs on `runInteractiveTurn`, which is exactly the cap-dissolution
  ADR-043 promised. `AGENT_RUNNERS` and the four legacy runners are untouched.
- **The session draft directory is `staging/`**, matching the ADR's own
  `writes: [staging]` row and the finalizer's source dir. It was `package/`
  on the batch-D infra branch — the two literals had already drifted once
  (the finalizer landed `staging` first), which is exactly the class the
  rename closes; a source-text ratchet now fails the suite the moment the
  derivation side and the finalizer side disagree again.
- **A declared `writes:` that produced nothing REFUSES the phase advance.** A
  drafting turn that crashes or writes nothing used to advance to
  `awaiting-review` with an empty package and no error anywhere. It now
  throws a named `InteractiveRunnerError` and leaves the phase at `analyzing`,
  so the session is re-runnable rather than silently empty.
- **Finalize is the operator's ONE commit act, and it is check-then-write.**
  `POST /api/studio/authoring/finalize {project, sessionId, kind, id}` requires
  `phase === 'awaiting-review'` (409 otherwise), advances to `committing`, runs
  the same spine the CLI drives, and installs from the LANDED package —
  package bytes are never taken from the request body, and `upstream` is
  server-minted (`{source:'forge-authoring', ref:<sessionId>}`) rather than
  client-claimed. A hook's `name`/`description`/`on`/`matcher`/`permissions`
  are parsed from the DRAFTED `hook.yaml`, so what the operator reviewed in the
  artifact pane is what ships. **Any failure after the phase advance reverts
  the session to `awaiting-review`**, and an `id` that collides with an
  existing library skill returns 409 instead of the silent 200 that used to
  discard the operator's draft.
- **Finalize NEVER approves.** A finalized skill is library-visible as a
  `draft` with `paletteVisible:false`; palette visibility remains the separate,
  pre-existing `POST /api/studio/skills/:id/approve` act. A finalized hook
  lands unbound.
- **Stated limit:** after a failed install where the package had ALREADY landed
  in `_interactive-library/<id>/`, retrying with the SAME id fails on the
  finalizer's `O_EXCL` destination write until that directory is cleared. The
  session still recovers to `awaiting-review`, and the 409 already tells the
  operator to choose a different id, but the same-id retry path is not clean.
- **Contract + journey:** journeys `skills`/`hooks` gain `skills-agentic-build`
  and `hooks-agentic-build`; the `build-skill` and `build-hook` stories flip
  from pending to ported. The drafting turn cannot spawn under the journey's
  suppressed-spawn env, so its `staging/` seed is the **verbatim output of a
  real recorded Claude turn** (committed under
  `scripts/journeys/fixtures/r4-21-live-capture/`), never hand-invented;
  everything after the seed — the session shell, the artifact pane, the
  finalize route, the draft page, the approve action and the palette source —
  is the real product.

## Planned initiatives

### R4-01 Platform→artifact migration

- **Status:** **implemented (F1–F4)** — F1–F3 built 2026-07-24 (wave-4 session 1, as-built baseline
  **R4-B12**), **MERGED PR #39** (main `0211972`). **F4 (unifier retirement) built 2026-08-03** (end of
  wave 4, after R4-10 live + the tail-of-wave verify run judged the successor flow valid). The F2 AC's
  real-run half rode the tail-of-wave `verify:cycle` (operator decision 2026-07-24), which also serves
  R4-10-F5's harness-migration proof.  ·  **Wave:** 4 — first item of wave 4, before the agent
  initiatives; **F4 alone ran last**, after R4-10 (not contiguous with F1–F3)
- **Implemented-notes (2026-07-24, F1–F3):** the seam landed as **declared
  dispatch** (ADR-039): `runtime.loopStrategy` (`one-shot` = a direct pinned
  SDK stream inside `runAgent`; `ralph` = execAgent routes to the dev-loop
  pipeline, lint-restricted to `developer-ralph` until R2-03/R4-06),
  `budgets.maxTurns/maxBudgetUsd/maxBudgetUsdShare` (the PM's
  floor-plus-share cap as frontmatter data), and `composition.guards` band
  keys (renamed from `composition.hooks` by ADR 027's R3-03 amendment,
  2026-08-04; `wi-contract` → PM pipeline, `reflection-close` → reflector;
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
  rider resolved here (scratch `.forge/agent-run/` path). **F2 scope note:**
  the architect spawn path was audited, not migrated — it already sources
  tools/model/prompts from SKILL.md and stays a deliberate bespoke
  interactive runner (ADR-039 §5); its residual TS prompt prose is R4-04
  material. The whole-branch review hardened the seam post-build: band
  hooks + ralph got matching lint/runtime canonical-slug guards, budget
  caps fail loud (pipelines + `budgets/range`/`composition/band-guard`
  lints), `execAgent` threads the initiative cost budget so declared
  share caps resolve, and the builder renders `loopStrategy` honestly.
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
    `_queue/ready-for-review/` before the unifier node is removed. (The
    `resume_from` stamp is already re-homed to `'demo'` — **R4-10-F6 did this**,
    merged PR #64 — so F4 only removes the held `unifier` executor, not the
    resume marker.) ACs: no flow/skill references
    the retired slug; ADR-026 gains a superseded-by note and ADR-028 an
    amendment in the same PR; send-back demonstrably works on both sides of
    the cutover (journey + verify evidence); a pre-cutover check proves no
    stranded UWIs.
    **— built (2026-08-03, PR #69):** drain check clean (0 pending UWIs in
    `_queue/ready-for-review/`). Deleted `orchestrator/unifier-invocation.ts` +
    `orchestrator/unifier-items.ts` + `skills/developer-unifier/`; excised
    `runUnifierPhase`/`runUnifier`/`unifierItemClassify`/`composedUnifierGate` +
    the whole UWI machinery (~1400 lines) from `developer-loop.ts`; removed
    `execUnifier` + the `runUnifier` dep + the `'unifier'` NodeKind from
    `flow-runner.ts`; emptied `PHASE_EXECUTOR_KINDS` (no phase executors remain —
    `validate.ts` now rejects any `executor:` field); removed the UWI-only
    `WorkItem.kind`; reassigned the catalog `composedBy` refs off `developer-unifier`
    to the successor agents (`adversarial-review`/`demo-agent`). ADR-026 +
    ADR-028 amended. suite 2591/2591, `forge studio lint`/`brain lint` 0 errors.
    (`drain-unifier-items.ts`/`appendReviewUnifierItems` from the original scope
    did not exist as separate artifacts — the drain successor is
    `drain-fix-loop.ts`, R4-10.)
- **Session sizing:** ~3 sessions (ADR + one phase; remaining phases) **plus a
  separate end-of-wave-4 retirement session for F4** (waits on R4-10-F2).
- **Out of scope:** the runnable primitive itself (R2-01); new agent behaviour
  (each agent's own initiative below); SSOT doc edits (R5-07).

### R4-02 Project onboarding agent

- **Status:** **implemented** (F1–F5, 2026-07-26, wave-4 tail) — F1/F2/F3 in
  PR #58 (`feat/r4-02-onboarding-agent`), F4/F5 in the stacked follow-up
  (`feat/r4-02-instructions-constraints`).  ·  **Wave:** 4
- **Implemented-notes (F1–F3, 2026-07-26):**
  - **F1 — built.** `skills/onboarding-agent/SKILL.md` — a non-interactive
    (`surface: operator-triggered`, `phase: onboarding`, `library: true`)
    studio agent with Bash/Read/Grep/Glob/Edit/Write, composing the
    `forge-onboard-project` playbook. Auto-appears in `listAgentDefinitions`
    and is **dispatchable through the R2-01-F3 generic run host with zero new
    dispatch plumbing** (PR #57). **Both entry points reach the same runner**
    (`dispatchAgentRun` → `POST /api/agents/onboarding-agent/run`): the agent
    page `RunPanel` (now with a generic `key: value` inputs surface —
    `data-run-inputs` — carrying `{repo, northStar}`) and the `/projects`
    `OnboardWithAgent` block (`data-section="onboard-with-agent"`,
    `data-action="run-onboarding-agent"`). Events/cost visible via the F1
    `GET /api/agents/runs/:runId` poll. Roster snapshot updated (11 agents).
  - **F2 — built.** `cli/contract-compliance-loop.ts`
    `runContractComplianceLoop` — a **deterministic, bounded, orchestrator-
    authored** preflight→auto-fix→re-check convergence loop, exposed as
    `forge preflight converge --project <p> [--accept <clause>=<rationale>]`
    (writes `<project>/.forge/contract-compliance-report.json`, exits 0 iff
    hard-green). The authoritative "contract-green" signal is
    `runPreflight().ok` computed HERE, never the agent's claim (closes the
    recurring declared-data-fails-open trap); a full per-clause disposition
    ledger (`passed`/`fixed`/`accepted`/`failed`) makes it never-silent. Reuses
    `applyPreflightAutoFixes` (C2/ARTIFACTS/C4) + the exported `AUTO_ORDER`.
    AC proven by a hermetic broken-fixture test reaching hard-green unattended.
  - **F3 — built.** The onboard create route (`cli/bridge-studio-writes.ts`)
    now sets `project.json.kb = <id>` — provably the seeded KB id
    (`buildKbYaml` binds `id`/`ref` to the project id; a fresh create carries
    no divergent kb.yaml). Closes known-gaps §4.3(a)/(d): ContractReadiness
    shows a **bound KB** on a fresh onboard. Tested in `bridge-studio-write.test.ts`.
- **Implemented-notes (F4–F5, 2026-07-26, branch `feat/r4-02-instructions-constraints`):**
  - **F4 — built.** `orchestrator/agents-md-compose.ts` `composeAgentsMd` +
    `forge instructions compose --project <p>` — deterministic, unattended
    AGENTS.md authoring: `detectProjectTags` → `matchInstructionSeeds` (the
    forge-managed seed always matches) → concatenate seed bodies, and — for the
    R1-04-F1 **C8 coverage** clause — name the declared gate command at the top
    (so C8 passes on coverage, not presence). Gate-declared-before-authoring is
    the SKILL.md step order. Idempotent; footer records composed seed ids.
    Tested (incl. C8 passing) in `agents-md-compose.test.ts`.
  - **F5 — built.** `orchestrator/constraint-author.ts` `authorConstraintBlocks`
    + `forge constraints author --project <p>` — reads the project's constraints
    (a `CONSTRAINTS.md`, or a Locked-core/Constraints/Never-do section of
    CLAUDE.md/AGENTS.md), authors ONE live `<!-- forge:constraint id:
    <project>-locked-core applies_to: all -->` block into central profile.md
    under a stable marker section (idempotent upsert), and **validates the whole
    profile via `parseConstraintBlocks` BEFORE writing** — a malformed/duplicate
    block throws loudly, never lands silent (the loud-parse hazard). No source ⇒
    no-op, profile still compiles (ADR-037 default). The onboarding SKILL.md runs
    both after declaring the gate. Feeds R4-05-F3. Tested in `constraint-author.test.ts`.
- **Depends on:** R3-05 (instructions sourcing), R1-03/R1-04 (contract process
  clauses to tick), R1-01 (KB binding at onboarding), R2-01 (standalone runnable).
  **Depended on by:** R4-03 (hand-off pattern), R4-17/R4-18 *(wave 5 — session
  staging + flow packaging wrap this agent)*
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

- **Status:** **implemented** (F1–F3, 2026-08-02, wave-4 tail, branch
  `feat/r4-03-creation-agent`)  ·  **Wave:** 4
- **Implemented-notes (F1–F3, 2026-08-02):**
  - **F1 — built.** `orchestrator/project-create.ts` `CreationManifest` +
    `validateCreationManifest` — the typed creation manifest `{name, appType,
    language, northStar, architecture?}`, produced by the CLI flags
    (`forge create --name … --app-type … --north-star …`) and the UI create
    form. Validates + fails fast on any missing field.
  - **F2 — built (research-first, ≥2 app types).** Curated templates under
    `studio/starters/projects/{typescript-cli,typescript-api}/` — each a
    dependency-light skeleton (package.json with a single-command `npm test`
    gate + tsc build, a `sentinel-…` unit test, `.gitignore` covering scratch
    (C2) + build output (ARTIFACTS), an AGENTS.md that **names the gate** (C8),
    roadmap.md (C4), `.forge/project.json`, a CI skeleton). Grounded in the
    gitpulse/mdtoc reference shape + the R3-05 `cli-project-shape` seed rather
    than a live subagent spike. AC proven: **each template scaffolds to
    preflight HARD-green unmodified** (`project-create.test.ts`).
  - **F3 — built.** `scaffoldGreenfieldProject` copies the template (substituting
    `{{NAME}}` slug / `{{TITLE}}` human / `{{NORTH_STAR}}`) + `seedProjectBrain`
    (the only forge-owned piece not in a template — central Brain-3 + KB) → the
    authoritative `hardGreen` from `runPreflight`. Operable three ways: `forge
    create`, `POST /api/studio/projects/create` (exempt-local), and the
    `/projects/new` **create-from-template** form (`data-section="project-create"`).
    AC met: **create → contract-green → first architect run possible with no
    manual repo surgery**. `stand-up-create` journey drives it end-to-end.
- **Original planned spec:** ~2-3 sessions.
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

- **Status:** **implemented** (2026-07-24, wave-4 session 2, branch `feat/r4-04-architect-refinement`) — largely an
  **as-built reconciliation**: the understand pass found F1/F2/F3 substantially pre-existing (the 2026-07-17 baseline
  text R4-B3 was stale); the genuinely new build is **F4**, the explicit exploration stage.  ·  **Wave:** 4
- **Implemented-notes (2026-07-24):**
  - **F1 — as-built (no change):** the interview is already multi-round (bounded, cap 4; LLM decides `done` per
    round), options + free-text answers round-trip, and the revise loop (`awaiting-verdict → interviewing`)
    iterates the draft. The rich non-text PLAN surface (mockups) stays deferred on R2-05 (soft dep, unbuilt).
  - **F2 — as-built (no change):** the completeness critic already runs INSIDE `runFinalizeStep` (one-shot per
    session, advisory, findings bounce to `awaiting-verdict`, re-approve = ack; `completeness-critic-runner.ts`).
    Its mechanics (findings block promotion; one-shot) are test-pinned in `architect-runner.test.ts`.
  - **F3 — as-built (no change):** architect FINALIZE promotes WI-less manifests; freshly-accepted initiatives
    land `data-plan-state="unplanned"` behind R4-11-F2's blocked-until-planned lock; the scheduler's
    forge-architect decompose (or the per-initiative Plan trigger) flips them planned.
  - **F4 — BUILT:** the `exploring` phase between interview-done and drafting (`ArchitectPhase` + runner
    dispatch): one structured turn (`EXPLORE_SCHEMA`) enumerating edge cases with dispositions
    (`covered`/`needs-initiative`/`deferred` — the scope-ledger discipline) + brain-sourced constraints citing
    theme paths; persisted to `edge-cases.json`; injected into the draft prompt with propagation instructions;
    rendered in PLAN.md/PLAN.html ("Edge cases & constraints"); fail-open (an empty exploration logs + proceeds).
    UI: hex meta + working-phase set + `data-architect-phase="exploring"`; flows-run journey beat asserts the
    stage. `skills/architect/SKILL.md` gains the stage's process section; operator-journey gap #6 closed.
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

- **Status:** **implemented — reconciliation only** (2026-07-26, wave-4 S8;
  all three features landed via prior initiatives + refinement, verified
  as-built end-to-end this session)  ·  **Wave:** 4
- **Depends on:** R4-05 (spec format), R2-03 (declared fanout property)
- **Context:** Operator diagram: *"essentially the exact dev agent we have
  today other than any logical refinements with the changes from the rest of
  the agents; designed around autonomous development of specs through a ralph
  loop"* — the plan agent holds this context when writing specs. Fanout is
  selected in the flow builder **only because the def declares it** (R2-02/R2-03).
- **Implemented-notes (2026-07-26 — the R4-04 stale-baseline pattern: the
  develop agent's declared refinements had all already landed as their
  dependencies + the 2026-07-11 reflection fixes shipped; this initiative is a
  verify-and-reconcile, no new code):**
  - **F1 — as-built (existing pipeline).** Develop's single source of intent is
    the plan agent's per-WI specs at `.forge/work-items/WI-*.md` (dev-binding
    threads each `specRelPath` into the Ralph prompt; brain-read policy
    unchanged — Brain-3 advisory only, dev-loop never reads Brains 1+2). The
    `specs:` manifest back-ref R4-05-F2 persists (`persistManifestSpecs`,
    `project-manager.ts`) is consumed as the **planned-evidence dispatch gate**
    (`enqueue-flow-run.ts` `manifest.specs?.length > 0` → develop may run),
    which is what makes "plan→develop on specs end-to-end" the enforced path.
  - **F2 — as-built (R2-03-F2/F3/F4).** `developer-ralph` declares the fanout
    block `{drivingArtifact: work-items, isolation: worktree, concurrencyCap:
    1, perItemGate: item-declared}`; the flow-builder toggle is capability-gated
    (`data-fanout-capable`, greyed on non-declaring agents — the flows-author
    `a2-3b-fanout-gate` beat asserts developer-ralph ON / developer-unifier
    OFF); per-WI multiplicity stays runtime-derived from the WI specs; the
    declared `concurrencyCap` feeds the dispatcher as a default via
    `DEV_FANOUT_CONCURRENCY_CAP` → `resolveDevWiConcurrency` (env > config >
    definitionCap > default). AC "fanout selectable on the dev node, greyed on
    non-declaring agents" is exactly the shipped R2-03-F3 beat.
  - **F3 — as-built (2026-07-11 "Phase 4/2 honest delivery events" +
    failure-classifier).** `dev-loop.delivered` is SUCCESS-ONLY
    (`wiDeliveryEvent`, `developer-loop.ts`): a failed WI fires
    `dev-loop.discarded` carrying the SAME diff-stat + `outcome: failed`;
    `dev-loop.branch-pushed` is gated on `finalStatus === 'complete'` (no longer
    fires for a 0-commit branch). Systematic-vs-flake is distinct:
    `classifyCrash` splits `deterministic` (context-overflow / identical repeat
    → `dev-loop.crash-deterministic`, terminal) from `transient`
    (rate-limit/OOM/network → `dev-loop.agent-crash-retry`), and
    `classifyCycleFailure` separates environment (gate-timeout, lint-contention,
    rate-limit → transient/retry) from terminal work defects. AC "event names
    truthful in a failed-WI replay" is covered by
    `orchestrator/phases/dev-loop-delivery-outcome.test.ts` (delivered never
    fires for a non-`complete` status) + `failure-classifier.crash.test.ts`.
  - **Deferred (NOT R4-06 — out of scope per the register below):** the R2-03-F4
    residual — parameterizing `runDeveloperLoop` by the *node's* agent def so a
    2nd fanout-capable agent runs its OWN behaviour (today the dev-loop pipeline
    hardcodes `developer-ralph`'s identity via `makeAgentWithTelemetry`). That is
    "fanout mechanics (R2-03)", a hot-path orchestrator refactor with no consumer
    until R4-02/R4-03 mint a second fanout-capable agent; it stays deferred
    (operator decision, wave-4 S8). No behaviour gap for the OOTB develop agent.
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

- **Status:** **implemented** (2026-07-24, wave-4 session 3, branch
  `feat/r4-07-demo-agent`) — F1 + F3 as specced; **F2 delivered as the
  artifact slice only** (see implemented-notes).  ·  **Wave:** 4
- **Implemented-notes (2026-07-24):**
  - **F1 — built.** `skills/demo-agent` (ADR-039 one-shot OOTB artifact, no
    Bash, composes `skills/demo`) + the `orchestrator/phases/demo-agent.ts`
    pipeline: derive (full-stdout `--shortstat` diffStat + head SHA, injected
    — never trusted from an inherited demo.json) → spawn (`runAgent`
    `lifecycle:'caller'`) → validate (schema + injected-diffStat equality +
    **AC-coverage enforcement**, one bounded authoring retry) → in-process
    render → orchestrated capture (reused ADR-036 machinery: producibility
    preflight = hard `tooling-unavailable`, nonce verify = hard
    `nonce-mismatch`, post-capture re-validation = hard `capture-failed`) →
    commit (capture or notes-only path both land demo.json/DEMO.md on the
    branch). A mechanical **scope guard** (pre/post `git status` diff) hard-fails
    any agent write outside the demo dir. Budget-killed spawns
    (`error_max_*`) fail loud, never retried. Prompt builders:
    `orchestrator/phases/demo-agent-binding.ts` (demo-element composition in
    demoProcess step order; unresolved element ids rendered + evented).
  - **F2 — artifact slice.** The judgment band validates agent-authored
    `fix-proposals.json` against the non-met `acEvaluations` (verbatim
    criterion match both directions) and persists the **`demo-fix-spec`
    artifact** (`orchestrator/flow-artifacts.ts`,
    `_logs/<cycleId>/artifacts/demo-fix-spec.json`, ADR-015-shaped
    `acceptance_criteria`/`files_in_scope`; template
    `studio/artifact-templates/demo-fix-spec.md`). **The fix-loop dispatch
    through the shared executor is NOT built here** — R4-10-F1 owns that
    topology; until it lands the artifact is the complete F2 deliverable
    (recorded in the template + pipeline header). The seeded AC-miss AC is
    proven at the artifact level (`demo-agent.test.ts`).
  - **F3 — built.** Descriptor parity test
    (`orchestrator/demo-descriptor-parity.test.ts`: ONE demoProcess fixture
    pinned across the preflight DEMO clause, `demoTaskLines`, and the
    demo-agent briefing — step order asserted); roadmap `InitiativeCard` gains
    `data-link="demo-builder"` → the editor tab's Demo Timeline (journey +
    DOM-contract doc synced). The **review-surface link was dropped** — `Run`
    carries no project id; threading one is a bridge-field change deferred
    rather than ad-hoc added (plan risk 9 fallback). `skills/demo` composer
    swap = dual composition (demo-agent + legacy unifier until R4-01-F4);
    "two faces" §DEMO framing added to the contract skill body.
  - **Not wired into any seed flow** — R4-10 assembles the successor flow;
    the pipeline input shape mirrors the flow-node executors so wrapping it
    as a NodeExecutor is mechanical. 52-agent whole-branch review (4 lenses →
    dedup → 2-skeptic adversarial verify): 15 confirmed/plausible findings,
    all closed in-branch; capture-child env inheritance recorded as
    known-gaps §12.
- **Depends on:** R1-03 ✅ (executes the demo-process clause it types), R2-05
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

- **Status:** **implemented (F1 + F2 + F3)** (F1/F3: 2026-07-24/25, wave-4
  session 3, branch `feat/r4-08-adversarial-review`; F2: 2026-07-25, wave-4
  session 4, branch `feat/r4-08-f2-sendback-loop`)  ·  **Wave:** 4
- **Implemented-notes F2 (2026-07-25, S4 — ADR-040 supersedes ADR-026):**
  - **(a) Queue substrate.** Review send-back compiles the operator's concern
    into an ordinary `WI-<max+1>` on the initiative's own `.forge/work-items/`
    queue, marked with the new WorkItem field `origin: 'review-fix'`
    (`'demo-fix'`/`'gate-fix'` reserved for R4-10's loops; `kind` stays
    UWI-only; packaging-classified concerns map to `behavior_preserving: true`,
    never to `kind`). Compiler seam: `orchestrator/fix-work-items.ts`
    (validate-before-write, H1 shell-pipeline gate guard parity, scope = the
    concern's own `files_in_scope` or the dev-WI union; `depends_on: []`; no
    terminal re-prep WI — see re-entry). Ids appended to `manifest.specs`.
  - **(b) Bound.** `forge.config.json` `review` section:
    `maxSendBackRounds` (default 6) + `maxTotalFixWorkItems` (default 24 — the
    deleted `UNIFIER_MAX_TOTAL_ITEMS`'s analogue), env-overridable
    (`FORGE_REVIEW_MAX_*`). Exhaustion = **reject-then-park**: HTTP 409 with
    `parked: 'needs-operator'`, a greppable `.forge/REVIEW-CAP-EXHAUSTED.md`
    marker (the drain skips marker-bearing manifests without re-notifying),
    a `sendback.cap-exhausted` event (phase `review-loop` — clear of the
    failure-classifier's orchestrator-phase signatures), and a desktop/webhook
    notify. Round counter = manifest `review_rounds`, incremented with the
    `resume_from` stamp in ONE locked write (`persistManifestSendBack`, throws
    on write failure — a send-back the manifest doesn't record would strand
    the fix WIs).
  - **(c) Mutual exclusion.** `finalize-merged` swaps `pendingUnifierItems` →
    `pendingFixWorkItems` with the pinned semantics intact (a confirmed-MERGED
    PR wins unconditionally; the dropped fix WIs are surfaced non-silently);
    the new `orchestrator/drain-fix-loop.ts` cedes on `confirmMerge`
    (`pr-merged`), parks on failed fix WIs / the cap marker, and claims via
    the atomic in-flight rename (the cross-sweep arbiter).
  - **(d) One cycle identity.** Mechanism B carried over verbatim: the drain
    threads `manifest.cycle_id ?? latestCycleId ?? initiativeId` into
    `runCycle({resumeFrom: 'develop'})` — a NEW resume vocabulary member (the
    ADR-026 inversion, recorded in ADR-040 §"the inversion, named"): PM
    rebase-skips, the dev-loop RUNS (prior WIs fast-exit via the iter-0
    already-complete shortcut — the N7 requeue-resume mechanics generalized),
    fix WIs build, then the legacy spine re-presents via the **re-armed static
    UWI-1** (`rearmStaticUnifierItem` — replaces ADR-026's terminal re-prep
    UWI; the unifier queue now holds ONLY UWI-1 until R4-01-F4).
    `drain-unifier-items.ts` + the whole UWI append path DELETED (no
    back-compat). When R4-10 assembles the successor flow, only the drain's
    re-entry target changes.
  - **Riders closed:** known-gaps §9 server-side develop-dispatch `planned`
    gate (`enqueueDevelopRun` → `not-planned` on missing decomposition
    evidence); the bridge response key renamed `appendedWorkItems` (nothing
    consumed the old key). Journeys: `flows-run` send-back beats now assert
    the durable truth (fix-WI file with `origin`, manifest
    `resume_from`/`review_rounds`, verdict.json `round`) + a new
    `flows-run-sendback-cap` beat (409 + marker via the real bridge API);
    review-worktree fixture seeds corpus-grounded WI-1/WI-2 so the real
    compiler mints WI-3.
- **Implemented-notes F1/F3 (2026-07-24/25):**
  - **F1 — built.** `skills/adversarial-review` (ADR-039 one-shot artifact —
    no Bash, no Edit: judges, never edits/runs) + the
    `orchestrator/phases/adversarial-review.ts` pipeline: orchestrator-assembled
    inputs (`.forge/review-input/{diff.patch,diffstat.txt,changed-files.txt}` +
    head SHA, ADR-036) → spawn (`runAgent` caller-lifecycle) → harvest
    (`.forge/review-findings.json`: schema + **identity-echo verification**
    against the injected initiative/cycle/baseRef/headSha, one bounded retry) →
    persist (the `review-findings` artifact,
    `_logs/<cycleId>/artifacts/review-findings.json`; empty findings = an
    explicit clean pass, still written) → scrub (review-input + worktree copy
    deleted, try/finally). Four lenses + severity vocabulary
    (`blocker|major|minor|info`) + evidence-pointer discipline (≥1 file:line
    per finding, schema-enforced) live in the SKILL.md. Brain-3 profile
    inlined as ADVISORY for the convention-drift lens.
  - **Shared mechanical scope guard** (`orchestrator/phases/agent-scope-guard.ts`,
    hardened by this branch's own 37-agent adversarial review): porcelain
    `-uall` + a `.forge/` size:mtime walk close the untracked-dir-collapse and
    gitignored-`.forge/` blind spots; guard integrity fails LOUD on git errors
    (never fail-open/closed). Both the demo-agent and adversarial-review
    pipelines use it. Budget kills (`error_max_*`) fail loud; other `error_*`
    subtypes are spawn failures, never a raise-the-budget misdiagnosis.
    Pipeline error events avoid the failure-classifier's `review`+`failed`
    substring signature (`review.input.derive-error`/`review.spawn-error`).
  - **Flow-node evidence + recorded deferral:** dispatchability + run-model
    attribution proven via the synthetic-node tests (project-scoped-review
    precedent; `agent_phase: 'review'` shown non-colliding). **The BANDED flow
    node (pipeline as NodeExecutor) has zero production callers by design —
    R4-10 wires it**; until then a bare `agent: adversarial-review` flow node
    would run bandless (no assemble/harvest/guard) — do not place it in a flow
    before R4-10. Standalone = the pipeline function (queryFn-tested); the
    generic `forge agent run` isolation surface remains R4-10-F3.
  - **F3 — built.** `ReviewFindingsPanel` renders the findings in BOTH verdict
    modes on `/artifact` (`data-section="review-findings"` +
    per-row severity/category attrs — claims the operator weighs, never a
    gate); `verdictRecordToDoc` (`forge-ui/lib/verdict-doc.ts`) fixes the
    pre-existing raw-shape passthrough that stamped every view-mode verdict
    "Approved" (+ `data-verdict-decision` attr, journey-asserted);
    `VerdictRecord`/`applyReviewVerdict`/dry-bridge table untouched (option-b
    isolation, asserted by test). ArtifactPicker lists the two new templates.
    Bridge `/api/artifact` cycleId segment validated (pre-existing `..`
    traversal closed). Journeys: findings rounds seeded
    (major-finding → clean-pass) + view-mode stamp beat.
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

- **Status:** **implemented (F1–F5)** (F1/F2/F4/F5 2026-07-25 wave-4 S5 @ #50
  `d61157a8`; F3 2026-07-25 wave-4 S6, branch `feat/r4-09-f3-automated-mode`)  ·  **Wave:** 4
- **Implemented-notes (2026-07-25):**
  - **F1 — built.** forge-develop's `on: merged` trigger re-pointed from the
    single-node forge-reflect flow wrapper to the reflect **agent** target
    (`{kind: agent, ref: reflector}`), consuming R2-04/ADR-041's agent-target
    seam with no schema change. `orchestrator/finalize-merged.ts` resolves it
    via the agent's `reflection-close` band guard (`resolveMergeAgentHandler`) —
    registry-driven, no hardcoded slug — and the pre-R4-09 `forge-reflect`
    flow-string match is removed. Atomic cutover (flow.yaml flip + dispatch
    rewrite in one change): exactly one reflect fires per merge (asserted);
    reflection-lost recording + the unconditional `merged→done` promotion
    (R4-11-F1) preserved. `validate-triggers` now errors an `on: merged` agent
    target lacking the `reflection-close` band (lint mirrors dispatch). The
    forge-reflect flow stays authorable (ship-both).
  - **F2 — built.** The reflection questionnaire is grounded in the merged PR
    (`<worktree>/.forge/pr-description.md` + `dev-loop.delivered` diff-stats,
    no `gh`), with a per-question citation requirement. reflector-binding +
    SKILL.md; golden regenerated.
  - **F4 — built.** SKILL.md Stage 4 names the Q5-B routing explicitly (project
    KB / the flow's rebound-cycles KB / forge-dev).
  - **F5 — built.** `orchestrator/kb-health.ts` (`runPostReflectionKbHealth`) —
    the first real consumer of `resolveKbProcesses`. Each touched KB's declared
    `ingest`/`consolidate`/`lint` processes run post-reflect; the builtin lint
    is a REAL, project-aware structural check over exactly the fresh theme files
    (`lintThemeFiles`, `cli/brain-lint.ts`) — so a project KB's own writes are
    validated (the shared `cycle-touched-themes` scan never walks
    `brain/projects/*`) without going repo-wide-red. cmd-shaped processes get
    the R1-01-F1 invocation contract; every process is fail-loud (`failed`
    status at `event_type: error`), never fail-open.
  - **F3 — built (2026-07-25, wave-4 S6).** Automated-inference mode.
    `mode: interactive|automated` on `FlowTrigger` (`TRIGGER_MODES` + lenient
    parse + `trigger-mode` enum / `trigger-shape` lint — mode only on an
    `on: merged` agent target), riding on `CycleInput.mode` (default
    interactive; no runReflector signature change → golden byte-identical by
    default). In automated mode the reflector infers each answer from the
    logs/demo/diff (never fabricated — "insufficient evidence" when silent) and
    self-writes `user-feedback.md`; `deriveUserQuestionsJson` lifts the
    per-question `**Inferred answer:**` line into additive `answer`/`inferred`
    fields. The **resolved mode is persisted durably** (`reflect-mode.json`
    sidecar) — the authoritative signal the bridge GET surfaces to the UI and a
    rerun reads back (not a fragile per-question heuristic; the review's
    top finding). ReflectionGate renders a read-only view
    (`data-reflect-automated`, per-question `data-question-inferred` +
    badge + `data-question-answer`, graceful "not inferred" per question).
    Journey: `flows-run-reflect-automated`. **Deferred within F3:** authoring
    the mode via the Studio FlowHeader UI (blocked on agent-target trigger
    authoring, ADR-041) — mode is authored in flow.yaml data for now.
- **Depends on:** R1-01 (writes into contract-typed, Q5-B-scoped KBs).
  **Depended on by:** R4-20 *(wave 5 — the brain-tune flow packages this
  agent)*
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

- **Status:** **implemented (F1–F6)** (F5 harness migration proven by the operator's real verify:cycle run)  ·  **Wave:** 4 (assembles last)
- **Implemented-notes F1 (2026-08-02 — in-place cutover, ADR-039/040):** the live
  `forge-develop` flow was rewritten IN PLACE `dev→unifier→review` →
  `dev→demo→adversarial-review→verdict` (v2). The two successor agents are wired
  via **band guards** (not new executor kinds): `agent-bands.ts` gains
  `demo-band`/`review-band` + a single-source `BAND_CANONICAL_SLUG` map consumed by
  both `execAgent`'s runtime backstop and `validate.ts`'s band-guard lint;
  `demo-agent`/`adversarial-review` SKILL.md declare the hooks. **`execDemo`** wraps
  `runDemoAgentPipeline` and carries the RELOCATED unifier residual — the demo agent
  authors `.forge/pr-description.md` alongside `demo.json` (hard-required by
  `openPrInline`; a missing/section-less body is a retryable authoring failure, and
  the scope guard admits the one file), plus the four close-contract gates
  (boundary commit / sync invariant / empty-branch guard via `computeDeliveryStats`
  / final CI gate); delivery gate = demo pipeline `ok` (`complete-with-misses` is a
  judgment, not a failure). **`execAdversarialReview`** wraps `runAdversarialReview`
  (fails loud on a pipeline failure — never a blind PR). **Loop topology:** a
  `complete-with-misses` demo compiles the agent's fix proposals into `demo-fix` WIs
  (`demo-fix-loop.ts`) + stamps the manifest send-back; the drain re-enters
  `resume_from:'develop'` and the demo node re-authors (no unifier re-arm — removed
  from `drain-fix-loop.ts`). The round/total caps are SHARED with review-fix
  (`resolveReviewLoopCaps` / `fixWorkItemCount`). `execUnifier`/the
  `developer-unifier` slug **stay** (retired at R4-01-F4) but are off the live flow.
  Journeys (`flows-run` demo+adversarial beat), `forge studio lint`, `npm run build`,
  and the suite (2636/2636) all green. The separate architect/pm "plan node"
  restructure was deferred (not this feature).
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
    demonstrably routes through the single executor. **— built (2026-08-02);
    real end-to-end run rides the tail verify:cycle (F5).**
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
    class) is fixed and reaches merge without operator intervention. **— built
    (2026-08-02):** `runMergeBoundaryGate` (cycle-helpers.ts) runs testProcess.local
    (the relocated `composedUnifierGate.initiative_gate` — full suite, UNSCOPED) +
    testProcess.ci on the integrated branch tip, INSIDE the demo band (execDemo),
    BEFORE the demo (a build-breaking cross-WI break would otherwise fail the demo
    capture, not the gate). Red → `.forge/last-gate-failure.md` + a scoped `gate-fix`
    WI (`gate-fix-loop.ts`, shared caps + reject-then-park) + the DAG walk terminates
    to ready-for-review with NO PR (invariant: no red baseline merges); the drain
    re-enters resume_from:'develop'. Contract doc + ADR-036 amendment marked ENFORCED.
    The seeded cross-WI-break real run rides the tail verify:cycle (F5).
  - **R4-10-F3 Isolation parity.** Every node agent runs standalone with the
    same artifacts (the diagram's ship-both principle). ACs: per-agent
    standalone runs documented in journeys. **— built (2026-08-02):**
    developer-ralph's standalone unit is `runDeveloperLoop` (the dev node);
    `orchestrator/band-agent-run.ts` `runBandAgentStandalone` is the isolation
    surface for the two BANDED one-shot agents — it runs the SAME pipeline the
    flow band runs (`runDemoAgentPipeline` / `runAdversarialReview`), against an
    existing initiative's worktree resolved from the queue, so a standalone run
    yields the identical artifacts (demo.json/DEMO.md, review-findings). Wired
    through the existing R2-01-F3 dispatch surface: `forge agent dispatch
    demo-agent --input initiative=<id>` (CLI routes band agents to the pipeline;
    the bridge `POST /api/agents/:slug/run` + `/agents/[id]` RunPanel forward the
    `initiative` input unchanged). Bare `runAgent` dispatch is bypassed for these
    two (it would skip the pipeline bands). Journey: an `agents` beat drives the
    demo-agent + adversarial-review agent pages' standalone run surface.
  - **R4-10-F4 Succession mechanics.** Decide forge-develop's fate (supersede
    vs version) — flow-seed residue only; the reflect-trigger cutover itself
    is owned atomically by R4-09-F1 (via the R2-04 registry). ACs: stale flow
    seeds removed or marked (and `forge studio lint` gains whatever
    deprecated-seed treatment "marked" needs); **the cycles KB
    `binding.ref` is updated to the successor flow id in the same change** —
    `forge studio lint` + `forge brain lint` green (R1-01's dangling-ref lint
    would otherwise go red). **— reconcile (2026-08-02):** F1's operator-chosen
    IN-PLACE rewrite decided succession = **supersede** — `forge-develop` keeps
    its flow id (version bumped 1→2, F1). So there is NO stale/deprecated flow
    seed to remove or mark (the successor IS the seed; no `forge studio lint`
    deprecated-seed treatment is needed), and the cycles KB `binding.ref`
    (`brain/cycles/kb.yaml`) already points at `forge-develop` — still valid, no
    rebind, R1-01's dangling-ref lint stays green. `forge studio lint` +
    `forge brain lint` confirmed green. Nothing to change beyond recording the
    decision.
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
    **— built (2026-08-03, PR #64):** `scripts/verify-cycle.mjs` migrated —
    the header/spine comments now read `dev → demo → adversarial-review →
    verdict`; the live-evidence gate reads demo.json from the **merged repo**
    (`<repoPath>/<artifactRoot demo dir>/<initiativeId>/demo.json`, mirroring
    `orchestrator/demo-paths.ts`) since the R4-07 demo agent commits it to the
    branch, NOT `_logs/<cycleId>/artifacts/` the retired unifier used, with a
    **legacy `_logs` fallback** so the old-shape tier stays runnable until the
    first green successor run; the changelog-draft note re-attributed to the
    develop flow's release contract; the `--send-back` rationale/ACs re-pointed
    at the ADR-040 review→develop fix-loop. The green successor verify:cycle run
    (the F5 proof + wave gate) is **operator-triggered** (real money).
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
    **— built (2026-08-03, PR #64):** the marker value `resume_from: 'unifier'`
    → `'demo'` end-to-end — manifest parse/serialize guards + type union +
    `persistManifestResumeFromUnifier` → `persistManifestResumeFromDemo`;
    `requeue-resume.ts` stamps `demo` when all WIs are complete; `forge requeue`
    flag `--resume-from=demo` + option `resumeFromDemo`; the bridge wire field
    `resumeFromUnifier` → `resumeFromDemo` (recovery + studio-runs routes +
    forge-ui bridge-client); dev-loop self-no-op keys on `resumeFrom === 'demo'`;
    flow-runner resume comments follow the topology. The held legacy `unifier`
    executor is untouched (R4-01-F4 retires it). ADR-019 amended (banner). Tests
    migrated; a legacy-shaped fixture still proves the generic resume-skip, the
    live forge-develop flow proves the demo node is the target.
- **Session sizing:** ~4 sessions (flow+topology; gate F2; succession+KB
  rebind; harness migration + resume re-home).
- **Out of scope:** node agents (R4-05/06/07/08); trigger kinds (R2-04, which
  also owns the registry's agent-target extension R4-09-F1 consumes);
  architect-flow retirement (R4-D1).

### R4-11 Roadmap & attention surface

- **Status:** **implemented** (2026-07-19, wave 2 — as-built baseline R4-B11)  ·  **Wave:** 2 (with R4-05)
- **Depends on:** — · **Depended on by:** R4-05 *(soft)*, R4-09 (merged-state trigger), R6-07 *(wave 5 — the home dashboard feeds on F4's attention strip)*
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

### R4-12 Project detail alignment

- **Status:** planned  ·  **Wave:** 5 (module: projects-list/detail)
- **Depends on:** R6-01-F4 (soft — completed-run dig-in links land on its
  detail pages). **Depended on by:** R4-13, R4-14 (tab/showcase hang off this
  page's IA).
- **Context:** Wave-5 cut. The mockup's project page (`views-projects.jsx`,
  `PROJECT_CONTRACTS` in `data.jsx`) permanently shows the **contract
  panel** — north star (verbatim), conventions, gates, secrets (**names
  only**, never values) — plus the cycle ledger with **completed-run
  dig-in** (every row → its run detail) and the demo-artifact gallery.
  As-built (`as-built-inventory.md` §1/§8): the project page has NorthStar +
  Instructions + contract-readiness + cycles + demo timeline, but contract
  facts are not one permanent panel, and completed cycles have no dig-in.
  Round-5 rule: what a session stages "lands on the project page" — this is
  the landing surface for R2-10-F2's staged artifacts.
- **Features:**
  - **R4-12-F1 Permanent contract panel.** North star / conventions / gates /
    secrets-names rendered from the project's real contract artifacts
    (AGENTS.md + secrets contract + gate config — parsed, not duplicated;
    the panel is a VIEW of the artifacts, so it cannot drift). ACs: panels
    render for a contract-green project and degrade honestly (explicit
    "missing" states) for a partial one; secrets show names only; `data-*`
    contract; journey beat.
  - **R4-12-F2 Cycle ledger dig-in.** Project cycle rows adopt the shared
    ledger vocabulary (R6-05) and link to run detail (R6-01-F4), completed
    included. ACs: archived real cycle → detail navigation; vocabulary
    shared, not re-implemented.
- **Session sizing:** ~2 sessions.
- **Acceptance references:** mockup journeys `onboard-project`,
  `create-project` (landing beats); surface `views-projects.jsx`.
- **Out of scope:** roadmap tab (R4-13); showcase (R4-14); onboarding session
  content (R4-17).

### R4-13 Project roadmap tab (dependency DAG)

- **Status:** planned  ·  **Wave:** 5 (module: project-roadmap-tab)
- **Depends on:** R4-12 (the Overview | Roadmap tab split lives on its page).
- **Context:** Wave-5 cut, **operator decision 4 (2026-08-03): the dependency
  DAG replaces the serpentine.** Mockup round-7: the roadmap moves to its own
  full-page tab (`Overview | Roadmap`) — big dependency-DAG columns + the
  initiative table; Overview keeps a compact table. Every initiative with a
  run digs straight into its node-by-node breakdown, completed included
  (round-6). As-built: `SerpentineTimeline.tsx` (SVG boustrophedon, dotted
  dependency arcs) inline on the project page (`as-built-inventory.md` §8).
- **Features:**
  - **R4-13-F1 Full-page Roadmap tab with DAG viz.** Dependency-DAG column
    layout (mockup `ROADMAPS` shape: nodes coloured via the shared
    `STATUS_COLOR` tones in `forge-ui/lib/status-colors.ts`, `dep:` edges,
    plus the R4-11-F2 lock affordance — corrected 2026-08-03 review pass:
    `merged`/`blocked-until-planned` are queue/page states, not palette
    entries) + the initiative table; Overview keeps the compact table.
    **`SerpentineTimeline` retires in this feature** — component deleted,
    its click-to-pop detail affordance re-homed on the DAG nodes
    (R4-11-F2/F3's plan-trigger + recovery affordances move with it,
    unchanged in behaviour). Retirement collateral (named so it isn't
    under-scoped): the `roadmap` journey's serpentine-anchored
    narration/frames rewrite, the SerpentineTimeline `data-*` rows in
    `docs/forge-ui-dom-and-harness.md`, and the full `ui:journey` gallery
    regen a beat rename forces (standing lesson). ACs: DAG renders a real
    multi-initiative roadmap with correct edges; serpentine gone,
    `ui:deadpaths` green; the R4-11 roadmap-node affordances (Plan action,
    lock badge, recovery) all reachable on the DAG; journey + DOM-reference
    doc updated in the same PR; gallery regenerated.
  - **R4-13-F2 Per-initiative run dig-in.** An initiative node/row with runs
    links to its run detail (R6-01-F4), completed included. ACs: navigation
    proven on an archived cycle.
- **Session sizing:** ~2 sessions.
- **Acceptance references:** mockup journeys `run-flow` + roadmap beats of
  `create-project`/`onboard-project`; surface `views-projects.jsx`
  (`ROADMAPS`).
- **Out of scope:** roadmap *content*/plan quality (R4-05); attention strip
  (R4-11-F4, done); forge-dev's own `docs/roadmaps/` (not a product surface).

### R4-14 Demo showcase page

- **Status:** planned  ·  **Wave:** 5 (module: demo-showcase)
- **Depends on:** R4-12 (entry from the project page), R1-03 (demo-process
  clause — the artifacts it renders).
- **Context:** Wave-5 cut. Mockup `#/projects/showcase/<id>`
  (`views-showcase.jsx`, `SHOWCASE` in `data.jsx`): a per-project standing
  demo page — latest cycle's stats strip, the live API/CLI transcript, and
  the evidence gallery (screenshot pairs, clips, HTML summaries) — the
  "show someone the project" surface, distinct from per-run evidence.
  As-built: demo artifacts render per-run in `/artifact` + the project demo
  timeline; there is no standing showcase (`as-built-inventory.md` §1).
  Standing feedback: demos must show the ACTUAL resource — the showcase is
  that rule as a page.
- **Features:**
  - **R4-14-F1 Showcase surface.** Route + page rendering the project's
    most recent demo-artifact set (derived from the real demo dir/manifest;
    corpus-grounded fixtures for journeys per the demo-seeds rule), stats
    from the run model, evidence gallery with typed items. Refresh is
    data-driven — a new merged cycle's artifacts appear without page
    changes; the *auto-refresh trigger* (demo-runner on PR-merged project
    hook) is R2-08-F3's row, consumed here. ACs: showcase renders a real
    archived demo set; empty state honest for a project with no demos;
    `data-*` contract; journey beat (`run-agent-demo-runner` ends on the
    refreshed showcase).
- **Session sizing:** ~1 session.
- **Acceptance references:** mockup journey `run-agent-demo-runner`; surface
  `views-showcase.jsx`.
- **Out of scope:** demo generation (R4-07 demo agent, done); demo-capability
  authoring (R4-16); trigger machinery (R2-08).

### R4-15 Architect/Planning session alignment

- **Status:** implemented  ·  **Wave:** 5 (module: per-OOTB-agent —
  architect/planning)  ·  As-built: [R4-B14](#r4-b14-architect-planning-session-as-a-dependency-dag-implemented)
- **Depends on:** R2-10 (session shell + artifact renderers).
- **Context:** Wave-5 cut. The mockup's `architect-planning` agent runs
  interactive **planning sessions**: chat + a living roadmap-draft artifact
  (visual aids, initiative splits folded into the DAG in-session), entered
  from a project page (`SESSIONS['architect-planning']`). The mockup roster
  merges today's architect and PM into this one agent — **that merger is
  R4-D1 territory and stays deferred** (⚑ its re-entry remains an explicit
  operator judgment; this initiative does NOT retire the architect flow).
  As-built: the architect interview is turn-based Q&A with an activity log;
  the plan agent (R4-05) is a separate non-interactive phase; roadmap drafts
  are not a live session artifact.
- **Features:**
  - **R4-15-F1 Planning session through the shared shell.** The architect
    session renders via R2-10: roadmap-draft artifact pane updating per turn
    (mockup: split INIT-14 → 14a/14b with edges kept), interview turns on
    the left, entry from the project page. Behaviour (checkpointed turns,
    council, gate hand-off) unchanged. ACs: `run-agent-architect` journey
    shape reproduced against the real session; roadmap-draft renderer
    shared with R4-13's DAG components; existing architect journeys green.
    **F1 as-built (2026-08-06, branch `feat/r4-15-architect-session`).** The
    shell, the `architect` session-kind descriptor and the `roadmap-draft` LIVE
    artifact row all shipped in R2-10, so F1 is not a re-landing — the three
    real gaps it closed were: (a) `deriveRoadmapDraft`
    (`orchestrator/studio/session-transcript.ts`) parsed
    `depends_on_initiatives` and dropped it, so the mockup artifact's
    load-bearing `depends on` column had no data — `RoadmapDraftRow.dependsOn`
    now carries it verbatim through the route and the client parse
    (`forge-ui/lib/session-client.ts`, the second sink); (b) no shared
    dependency-DAG renderer existed for R4-13 to inherit —
    `forge-ui/lib/dependency-dag.ts` (pure, generic, levels delegated to the
    existing `topoLevels`, unresolved edges and cycles surfaced) +
    `forge-ui/components/studio/DependencyDag.tsx`, the R3-01 `FilePackage`
    shape; the artifact pane now renders DAG + initiative table, which IS
    R4-13-F1's stated roadmap-tab layout; (c) the project page had no architect
    entry at all — `forge-ui/components/studio/ProjectArchitectEntry.tsx`
    mounts the one shipped start-a-session path (`NewIdeaBox` →
    `POST /api/architect/start`). Architect behaviour unchanged; the flow is
    not retired. Journey: `flows-run-roadmap-dag` + the `roadmap-tab`
    additions; DOM contract in `docs/forge-ui-dom-and-harness.md`.
  - **R4-15-F2 ⚑ Merger decision brief.** A short operator brief (in-session
    artifact of the FIRST implementation session, not a doc initiative):
    what the mockup's merged architect-planning implies vs R4-05's plan
    agent + R4-D1's re-entry condition, with a recommendation. No code. ACs:
    brief exists; R4-D1 note updated with its date + outcome.
- **Session sizing:** ~2 sessions.
- **Acceptance references:** mockup journey `run-agent-architect`; surface
  `views-session.jsx`.
- **Out of scope:** architect-flow retirement (R4-D1); plan-agent internals
  (R4-05, done).

### R4-16 Demo-builder generation gallery

- **Status:** implemented  ·  **Wave:** 5 (module: per-OOTB-agent —
  demo-builder)  ·  As-built: [R4-B15](#r4-b15-demo-builder-generation-gallery-implemented)
- **Depends on:** R2-10 (session shell; the gallery is an R2-10-F3 renderer).
- **Context:** Wave-5 cut. Mockup `SESSIONS['demo-builder']`: the
  demo-capability session iterates **generations 1→3** (clip → +stats
  overlay → +HTML summary) in a gallery artifact pane; the operator picks
  one and the chosen demo skill is written into the project. As-built
  (corrected 2026-08-03 review pass): the demo-builder runs as the inline
  `DemoBuilderPanel` on `/projects/[id]` — R1-03-F2 (2026-07-24,
  operator-approved) folded the old standalone route into the project page;
  `demo/[sid]` is a redirect stub. **This initiative does not re-detach it:**
  entry stays the project page, and the gallery renders through the R2-10
  shell *in place* (or records a reasoned exception with an operator nod —
  never a silent reversal of R1-03-F2). No generation-gallery iteration
  surface exists today.
- **Features:**
  - **R4-16-F1 Generation gallery session.** The demo-builder session
    renders candidate generations side-by-side (accumulating, numbered),
    operator feedback drives the next generation, and "finalize" writes the
    chosen demo skill to the project (existing write path). ACs:
    `run-agent-demo-builder` journey shape against a real session; gallery
    renderer registered in R2-10-F3; finalize round-trips to a project demo
    skill the demo-runner can execute.
    **F1 as-built (2026-08-06, branch `feat/r4-16-demo-builder-gallery`) —
    [R4-B15](#r4-b15-demo-builder-generation-gallery-implemented).** The gap was
    that generations did not exist on disk: every generate turn overwrote the
    project repo's `DEMO.html` + generator skill, and `.forge/demo/history/` is
    per-LOCK, not per-generation. F1 snapshots each completed turn into the
    session dir, promotes R2-10's reserved `generation-gallery` row to live with
    a real deriver, mounts the shell's own artifact pane inside the inline panel
    (entry stays the project page — R1-03-F2 not reversed), and makes finalize
    restore the CHOSEN generation's sample **and** its generator skill before
    the existing lock path runs.
- **Session sizing:** ~1 session.
- **Acceptance references:** mockup journey `run-agent-demo-builder`;
  surface `views-session.jsx`.
- **Out of scope:** demo execution (R4-07); showcase (R4-14).

### R4-17 Onboarding session staging

- **Status:** implemented  ·  **Wave:** 5 (module: per-OOTB-agent —
  project-onboarding)  ·  As-built: [R4-B16](#r4-b16-onboarding-as-a-staged-session-with-a-contract-build-out-implemented)
- **Depends on:** R2-10 (staged-artifact contract — onboarding is its
  flagship consumer), R4-02 (the onboarding agent, done). **Depended on
  by:** R4-18.
- **Context:** Wave-5 cut. Mockup `SESSIONS['project-onboarding']` +
  `SESSIONS['create-project']`: the onboarding/creation interview progresses
  through declared stages — `contract → instructions → secrets → demo →
  roadmap` — with the artifact pane building the contract out per stage
  (AGENTS.md north-star verbatim, secrets **names only**, demo shape,
  starter roadmap) and everything landing on the project page (R4-12).
  As-built: R4-02 runs through the generic run surface with no staged
  interview UX (`as-built-inventory.md` §3).
- **Features:**
  - **R4-17-F1 Staged onboarding session.** The onboarding agent's session
    declares the stage vocabulary (R2-10-F2), tags its turns, and stages the
    contract artifacts; completion hands off per the existing R4-02 flow.
    Creation (R4-03) reuses the same stages + the scaffold picker (R3-06-F3).
    ACs: `onboard-project` + `create-project` journey shapes against real
    sessions; staged artifacts land on the project page (R4-12-F1 renders
    them); no-regression on the R4-02/R4-03 hand-offs.
    **F1 as-built (2026-08-06, branch `feat/r4-17-onboarding-staging`) —
    [R4-B16](#r4-b16-onboarding-as-a-staged-session-with-a-contract-build-out-implemented).**
    The gap was that onboarding had no session on disk at all — a fire-and-forget
    dispatch whose only trace was a run log — so there was nothing for the R2-10
    shell to render and no record of which stage produced which artifact. F1 opens
    a real session at `<projectsRoot>/<project>/_onboarding/<sid>/` from a new
    `/start`-family route that accepts no caller-supplied repo path, promotes
    R2-10's reserved `contract-buildout` row to live with a real deriver over the
    project's own contract artifacts (secrets by NAME only, enforced
    structurally), and serves the same five staged rows on
    `GET /api/studio/projects/<id>/contract-stages` as the data contract R4-12-F1
    renders in batch D. R4-02's agent behaviour and hand-off are unchanged; the
    generic dispatch route is untouched. **Honest limit, stated not implied:** the
    shipped onboarding agent "asks no questions and never blocks mid-run"
    (`skills/onboarding-agent/SKILL.md:9`), so the session's transcript is
    honestly ONE operator turn from a real `prompt.md` — the mockup's
    interview-with-push-back does not exist in the product and was not
    fabricated. That is why `onboard-project` / `create-project` /
    `run-agent-onboarding` stay **pending** in the parity registry, with per-beat
    evidence recorded there.
- **Session sizing:** ~1-2 sessions.
- **Acceptance references:** mockup journeys `onboard-project`,
  `create-project`, `run-agent-onboarding`; surface `views-session.jsx`
  (`CONTRACT_STAGES`).
- **Out of scope:** contract clause typing (R1-03/R1-04, done); the
  onboard-project FLOW packaging (R4-18).

### R4-18 Onboard-project OOTB flow

- **Status:** implemented  ·  **Wave:** 5 (module: per-OOTB-flow —
  onboard-project)  ·  As-built: [R4-B17](#r4-b17-the-onboard-project-flow-and-its-orchestrator-owned-preflight-gate-implemented)
- **Depends on:** R4-17 (the session it wraps), R4-02 (agent, done).
- **Context:** Wave-5 cut. The mockup ships `onboard-project` as an OOTB
  FLOW (interview → contract author → **contract-check gate** on preflight
  green), peer of forge-develop on the flows surface with its own ledger
  (`FLOWS` in `data.jsx`). As-built: onboarding is a standalone agent path
  only — no flow packaging (`as-built-inventory.md` §2: 3 seed flows).
- **Features:**
  - **R4-18-F1 Flow definition + gate.** A `studio/flows/onboard-project/`
    seed chaining the onboarding session and contract authoring with a gate
    node executing the REAL preflight (orchestrator-owned gate execution,
    ADR-036 pattern — the agent judges readiness, the orchestrator runs
    preflight); interactive-node placement respects the R2-01-F2 lint
    (verify the interactive-session-in-flow model at session start — if the
    lint forbids it, the flow starts at the post-interview hand-off and the
    session stays the entry point, mirroring how forge-architect chains
    today). ACs: `forge studio lint` green; flow visible with ledger on the
    flows surface; a real onboarding run reaches the gate with real
    preflight output; `run-flow-onboard` journey shape reproduced.
    **F1 as-built (2026-08-11, batch E) —
    [R4-B17](#r4-b17-the-onboard-project-flow-and-its-orchestrator-owned-preflight-gate-implemented).**
    Landed on the band-guard path, not a bare `GATE_KIND` executor: the
    park file's literal design (`{gate: <band-guard-id>}`) does not work,
    because `resolveNodeKind` consults `GATE_KIND` for a `gate:` field and
    never consults `BAND_GUARD_IDS`. **Honest limits, stated not implied:**
    (1) the flow does NOT wrap R4-17's independently-dispatched onboarding
    session — it is a separate, flow-shaped way to run a fresh onboarding
    pass, and beat parity with `stand-up-onboard` is not claimed; (2) the
    R2-01-F2 interactive-node lint was never in tension here —
    `onboarding-agent` declares `surface: operator-triggered`, so it is not
    `interactive` and the lint does not forbid it as a flow node (measured,
    not assumed); (3) the closure journey's gate beat drives a REAL `runFlow`
    against a REAL preflight-RED project with only the `onboard` node's agent
    spawn suppressed — so "a real onboarding run reaches the gate" is proven
    for the GATE half against real `runPreflight` output, while the agent
    half stays covered by R4-02/R4-17's own paths.
- **Session sizing:** ~1-2 sessions.
- **Acceptance references:** mockup journey `run-flow-onboard`; surfaces
  `views-flows.jsx`, `FLOWS` in `data.jsx`.
- **Out of scope:** onboarding content (R4-02/R4-17); contract machinery
  (R1).

### R4-19 Brain creation & maintenance agents

- **Status:** planned  ·  **Wave:** 5 (module: per-OOTB-agent —
  brain-creation/maintenance)
- **Depends on:** R2-10 (session shell), R1's wave-5 KB entry (band-scoped
  binding — the cycle-scope creation needs the binding kind to exist).
- **Context:** Wave-5 cut. Mockup: **brain-creation** seeds a KB for a
  scope — project (`SESSIONS['brain-creation']`: themes + index hub + links
  from real history, lint 9/9 on creation) or **cycle band**
  (`SESSIONS['brain-creation-cycle']`: `review-insights` seeded from 41
  runs of adversarial-review findings, bound to forge-develop's review
  band) — and **brain-maintenance** runs cleanup sessions
  (`SESSIONS['kb-cleanup']`: duplicate-merge, edge relink,
  needs-multi-project-evidence tagging, re-lint). As-built: the
  project-brain-builder covers project-scope creation
  (`as-built-inventory.md` §1); no cycle/band-scope creation, no
  maintenance agent (guided lint-resolution exists as a UI, not an agent
  session).
- **Features:**
  - **R4-19-F1 Creation agent alignment.** Project-scope creation renders
    through the R2-10 shell (seeded-structure artifact); cycle/band-scope
    creation added once the binding kind exists — seeded from REAL run
    evidence (finding clusters, cycle archives), never speculation (the
    agent instruction in the mockup is explicit). ACs: `create-kb-project` +
    `create-kb-cycle` journey shapes against real sessions; created KB
    passes `forge brain lint` 9/9 on creation; band-scoped KB binding
    validates.
  - **R4-19-F2 Maintenance agent.** A brain-maintenance session (cleanup
    plan artifact → operator-approved actions → re-lint) wrapping the real
    lint findings; complements — does not replace — the guided
    lint-resolution UI. Ingest stays reflection-only (operator decision 3):
    maintenance edits structure/links, it does not ingest new content. ACs:
    `kb-maintain` journey shape; a seeded lint-warning KB round-trips to
    green through a session; no ingest capability in the agent's tools.
- **Session sizing:** ~2 sessions.
- **Acceptance references:** mockup journeys `create-kb-project`,
  `create-kb-cycle`, `kb-maintain`, `run-agent-brain-creation`; surface
  `views-session.jsx`.
- **Out of scope:** binding contract (R1); KB explore surface (R6-08);
  reflection/ingest content (R4-09, done).

### R4-20 Brain-tune OOTB flow

- **Status:** resolved — keep-as-is  ·  **Wave:** 5 (module: per-OOTB-flow —
  brain-tune)
- **Depends on:** R4-09 (reflect agent, done), R2-08-F2 (soft —
  `agent-complete`/on-completion chaining it's triggered by).
- **Context:** Wave-5 cut. Mockup `brain-tune` flow (`provenance: 'vision'`):
  reflector → brain-ingest → **brain-lint gate** as a visible OOTB flow with
  its own ledger, auto-triggered when a forge-develop run completes.
  As-built: `forge-reflect` exists as a seed flow triggered `on: merged`;
  ingest/lint run inside the reflect pipeline, not as visible flow nodes
  with a gate (`as-built-inventory.md` §2).
- **Decision (2026-08-10, T1 keep-as-is):** R4-20-F1 resolves KEEP-AS-IS, not
  evolve. (1) The brain-tune loop already runs orchestrator-owned on EVERY
  merge — the reflector post-run pipeline
  (`orchestrator/phases/reflector.ts` S6A brain-lint trigger ~:452-464,
  REF-4 ingest ~:475-476), dispatched via forge-develop's `{on: merged,
  target: {kind: agent, ref: reflector}}` standing trigger
  (`studio/flows/forge-develop/flow.yaml`), resolved through
  `orchestrator/finalize-merged.ts`'s reflection-close band hook.
  (2) Evolve's "a lint gate node executing the real `forge brain lint`
  (ADR-036 orchestrator-owned)" would need a NEW row in
  `orchestrator/flow-runner.ts`'s closed `GATE_KIND` dispatch table
  (currently only `{plan, verdict}`, ~:299-302) — an ADR-042
  orchestrator-surface increase, ask-first/PARK, the same class as
  R4-18/R4-19-F2. (3) R4-09-F1 already RETIRED the single-node
  `forge-reflect` flow wrapper as the *shipped* shape
  (`studio/flows/forge-reflect/flow.yaml` itself carries a comment saying
  so; its `kickoff` is `trigger-only`) — evolving would re-introduce
  exactly what R4-09 deliberately removed. (4) Simplest-thing-that-works
  (PRINCIPLES.md #3): the learning loop already works and is already
  surfaced via `/agents/reflector`'s real standing trigger; a re-badged
  visible flow adds orchestrator surface for marginal operator-visibility
  gain. **Disclosed follow-up:** evolve remains an operator-authorizable
  follow-up — it would need ADR-042 sign-off for the `GATE_KIND` gate node.
  The loop's outcomes ARE observable today (reflect artifacts + the brain
  accumulation + the `/agents/reflector` standing-trigger view). Mockup
  corrected in the same pass
  (`mockups/studio-endstate-v2/journeys-data.jsx`'s `run-flow-brain-tune`
  entry); the `run-flow-brain-tune` journey ported onto the real
  `/agents/reflector` standing-trigger surface
  (`scripts/journeys/story-registry.mjs`).
- **Features:**
  - **R4-20-F1 Flow alignment decision + packaging.** Diff `forge-reflect`
    against the mockup topology and either evolve it (rename/re-badge +
    expose ingest + a lint gate node executing the real `forge brain lint`,
    ADR-036 orchestrator-owned) or record a reasoned keep-as-is with the
    mockup corrected — one decision, dated here. Whichever lands, the flow's
    ledger shows ingest outcomes (themes/edges/lint per run — the mockup's
    `FLOW_HISTORY['brain-tune']` rows). ACs: decision recorded; lint green;
    `run-flow-brain-tune` journey shape or its recorded correction.
- **Session sizing:** ~1 session.
- **Acceptance references:** mockup journey `run-flow-brain-tune`; `FLOWS`
  in `data.jsx`.
- **Out of scope:** reflect content (R4-09); trigger machinery (R2-08).

### R4-21 OOTB authoring agent (skill/hook package producer)

- **Status:** implemented  ·  **Wave:** 5, batch D infra + batch E live proof
  (module: per-OOTB-agent — authoring)  ·  As-built:
  [R4-B18](#r4-b18-the-authoring-session-creation-agent-on-the-generic-interactive-spine-implemented)
- **Depends on:** R2-10 (session shell, implemented — authoring sessions
  render through it), R3-01-F3/F4 (FilePackage renderer + install/palette
  pipeline, implemented — the package surface + library landing).
- **Depended on by:** — (parity closure: the `build-skill` / `build-hook`
  stories + the `file-package` reserved artifact row).
- **Context:** Minted at batch-C planning (2026-08-07, T1 ruling — see the
  README §4 change log) on the batch-B exit measurement: the `build-skill`
  and `build-hook` parity stories cannot flip because forge has no
  **producer** — no agent that authors an artifact package (measured at
  batch-B exit: 16 roster agents carry `runtime:`, none authors one). R4-17
  proved a new session kind plugs into the R2-10 shell with no route code;
  the missing piece is the agent itself. The `file-package` artifact row
  stays RESERVED until a producer exists — a renderer with no producer is
  the stub the reserved-row convention forbids. One authoring agent plus its
  save path is an initiative, not a rider on a story flip.
- **Features:**
  - **R4-21-F1 The authoring agent.** One OOTB interactive agent that
    authors a skill or hook file-package (SKILL.md / hook manifest + files)
    through an R2-10 session: describe the job → draft package accumulates
    in the artifact pane (FilePackage tabs) → operator iterates → save.
    Drafts are never auto-saved. ACs: session descriptor + stage vocabulary
    declared (R2-10-F2 — an unknown stage fails closed); the artifact pane
    renders the draft via the shared FilePackage component (one component,
    now three surfaces); the agent declares honest `materials:` (R2-09-F1).
  - **R4-21-F2 Save path to the library.** Finalize writes the package
    through the existing library write/validation path; `forge studio lint`
    validates the landed package; the install/palette pipeline picks it up
    with no restart (the R3-01-F2 invariant). ACs: an authored skill is
    library- and palette-visible; a malformed draft is refused at save with
    named errors, never half-written (check-then-write — the save path
    takes operator-influenced file names, so it gets a full containment
    review); hook packages land under the R3-03 lifecycle rules.
  - **R4-21-F3 Journey + parity closure.** `build-skill` + `build-hook`
    beats run against the real surfaces; the `file-package` reserved row is
    promoted to live. ACs: both journeys green in the real gallery; parity
    flips only if every beat is real (honest-parity rule).
- **Session sizing:** ~2 sessions — (1) F1 agent + session; (2) F2 save
  path + F3 journeys.
- **Acceptance references:** mockup journeys `build-skill`, `build-hook`;
  `SESSIONS` in `data.jsx`, `views-session.jsx`.
- **Out of scope:** conversational agent drafting (`create-agent` steps 3-4
  — excluded, T1 ruling 2026-08-06, README §4); the creation agent's
  project scope (R4-03); marketplace publishing (R3-07).

### R4-22 Generic interactive-surface primitive

- **Status:** implemented (bridge complete; F4 re-homed to [R4-23](#r4-23-runner-prompt-re-authoring-onto-skillmd)) — **F1 + F2 implemented** (2026-08-10, PR #117: `turnSpec` + `orchestrator/interactive-runner.ts` + the `cmdAgentRun` fork, 4 legacy runners byte-for-byte green behind it); **F3 implemented** (2026-08-11, with R4-21 — the `authoring` descriptor carries ADR-043 §1's `turnSpec` table verbatim and creation-agent drafted a real skill AND a real hook package live on the spine; see [R4-B18](#r4-b18-the-authoring-session-creation-agent-on-the-generic-interactive-spine-implemented)); **F4 resolved by operator ruling** (2026-08-11 — a measurement pass established that none of the four runners is expressible on the primitive as it stands; no runner migrated; the operator refused a `STEP_HANDLERS` registry, so the migrations are re-homed as R4-23's SKILL.md re-authoring — see the F4 bullet below) · **Wave:** 5 (batch E — interactive-runtime bridge) · **ADR:** [043](../decisions/043-generic-interactive-surface.md) (Accepted 2026-08-10)
- **Depends on:** R2-10 (session shell — the read half is already generic), R4-21 (its infra is consumer #1, built + green on `feat/r4-21-authoring-agent`).
- **Depended on by:** R4-21 (live drafting), R4-18 (onboard-flow — a consumer once generalised), R4-19-F2 (brain-maintenance — a consumer, deferred-large).
- **Context:** The interactive-session **read** half is already generic over data (the `SessionKindDescriptor` yaml row drives route + transcript + artifact pane with no per-kind code). The **producer/state-machine** half is still four hand-written `orchestrator/*-runner.ts` behind `AGENT_RUNNERS` — and a fifth (creation-agent) parking against the ADR-042 surface cap is the third time the same shape parked in batch D (R4-18, R4-19-F2 [mislabelled], R4-21). Same shape three times ⇒ a missing generalisation, not three exceptions. Operator directive (2026-08-10): make the interactive surface a **generic, operator-authorable, artifact-like, multi-instance** primitive.
- **Features (the tight D→E bridge; full WI plan in `_wave5/plans/generic-interactive-surface-plan.md`):**
  - **R4-22-F1 The `turnSpec` primitive + generic runner.** One additive-optional `turnSpec` field on `SessionKindDescriptor` (the producer half, authored as yaml data: kindDir, style structured|agent, a phase table with step/writes/next/finalizer, resolved against a deep-frozen vocabulary; structural-load / semantic-validate split; affordances **derived** from the phase table, not authored) + one generic `orchestrator/interactive-runner.ts` owning once the SEC-04 preamble + ADR-024 spec/model/prompt derivation + telemetry + the dispatch loop.
  - **R4-22-F2 Dispatch fork (migration-safe keystone).** `cmdAgentRun` forks on `turnSpec` presence: present → the generic runner; absent → the existing `AGENT_RUNNERS` (the 4 bespoke runners keep working, untouched).
  - **R4-22-F3 Consumer #1 — creation-agent on pure data.** The `authoring` descriptor gains its `turnSpec`; R4-21's creation-agent drafts a real skill/hook package **live end-to-end** on the shared spine (closes R4-21 exit rows build-skill/build-hook for real, not emulated).
  - **R4-22-F4 (RESOLVED 2026-08-11 by operator ruling — slipped to R4-23) The 4-runner refactor.** Migrate architect/instructions/demo-builder/project-brain onto the primitive incrementally behind the fork; each migration was to be a no-regression WI gated on the WI-0 golden capture. **A 2026-08-11 measurement pass established that none of the four is expressible on the primitive as it stands**, so the feature is blocked rather than queued. The primitive generalises the *plumbing* (SEC-04 preamble, spec/model derivation, telemetry, dispatch, finalize); the four runners are mostly *prompt and state composition*, for which there is no seam. Measured, by driving the spine against each runner's own golden-capture scenario: `instructions` is refused before the LLM is ever called (`style: structured` with an empty schema registry — `validateSessionKinds` rejects the row too) and needs two schemas where `turnSpec.schema` is one top-level field; `demo-builder`'s agent runs with `cwd` = the project repo and writes its outputs there, which `writes:` cannot enumerate and the containment guard forbids by design; `project-brain`, the closest fit, still differs in prompt, `cwd`, `maxTurns` and a lost `themes` result field. `instructions` and `architect` also traverse multiple phases in one turn, conditionally, against a phase row that carries one static `next`. Closing the gap needs either a registered step-handler/prompt-builder registry (**a new `orchestrator/` export — ask-first**) or per-kind prompt fields on `turnSpec` (**ADR-043 forbids: "per-kind fields must not creep onto `turnSpec`"**); the third option, re-authoring each agent's prompt into its `SKILL.md` (ADR-024's own thesis, no new surface), changes the prompt by design and so needs a live acceptance rather than a golden byte-match — a different, larger initiative. **The promised orchestrator-surface decrease is therefore still owed, and is smaller than the ADR implies**: the spine-owned plumbing is a minority of each runner's lines. **Operator ruling 2026-08-11:** the step-handler registry was **refused** (no new orchestrator surface) and the migrations **slipped to R4-23** — the re-authoring path, live-gated, seeded by the two `_wave5/parks/R4-22-F4-*.md` measurement records. The architect park additionally recommends never migrating architect (keep its one `AGENT_RUNNERS` entry; amend ADR-043 §3) — R4-23 rules on that. **Operator-authorable UI + multi-instance management are batch-E-proper follow-ons, not the bridge.**
- **ADR-042 note:** R4-22 is the **one-time ratified generalisation** ADR-043 sanctions — the generic runner is disclosed new orchestrator/ surface once, so future interactive kinds are authored as data and never re-open the cap question.
- **Acceptance references:** mockup journeys `build-skill` / `build-hook` (real, live); the 4 legacy runners stay green behind the fork.

### R4-23 Runner prompt re-authoring onto SKILL.md

- **Status:** **implemented** (2026-08-14, wave 5 batch H — all four runners re-authored, LIVE-proven per kind; architect SHIPPED, the H-3 park not taken) · **Wave:** 5 (batch H) · **Bead:** `forge-lt4` (folds `forge-4y7`) · **Origin:** the R4-22-F4 slip (operator ruling 2026-08-11).
- **Depends on:** R4-22 (the spine, done); the two F4 park files (`_wave5/parks/R4-22-F4-runner-migrations.md`, `R4-22-F4-architect-migration.md`) are its seed evidence.
- **Context:** F4's measurement pass established the four legacy runners are mostly per-kind **prompt/state composition**, not plumbing — golden byte-match migration is unreachable without a step-handler registry the operator refused. The remaining honest path is ADR-024's own thesis: re-author each runner's composed prompt into its agent's `SKILL.md` (single source of intent), migrate the runner onto the spine, and accept **live** per kind — the prompt changes by design, so a golden byte-match cannot be the gate. This is where ADR-043's promised net orchestrator-surface decrease is actually realized (batch E's net production deletion from the migration path was zero).
- **Features (sketch, sized per park files):** instructions first (needs a two-schema answer for `turnSpec.schema`); demo-builder (needs a `cwd`/writes model decision — its agent writes into the project repo by design); project-brain (closest fit); architect **decision, not migration** — the park recommends keeping its `AGENT_RUNNERS` entry permanently and amending ADR-043 §3 to say so.
- **Acceptance references:** per-runner live acceptance runs (the R4-21 live-proof pattern); `AGENT_RUNNERS` shrink per migration; net orchestrator line-delta reported per PR.
- **As built (2026-08-14).** Each runner's task prose moved into its agent's `SKILL.md` as `<!-- turn: <id> -->` sections behind one shared loader (`loadSkillTurnPrompt` / `splitSkillTurnSections`, `orchestrator/skill-path.ts`), fail-LOUD where the four runner-private `loadSkillPrompt` helpers failed open. Turn ids: instructions `interview` / `interview-edit` / `draft` / `draft-edit`; demo-builder `generate-element` / `generate-composed` / `generate-legacy`; project-brain `analyze-project-repo` / `analyze-cycle-archives`; architect `interview` / `explore` / `draft` / `draft-force-emit`. **LIVE acceptance, one real spawn per kind** (`_wave5/gate-logs/R4-23-live-*.log`): a grounded `AGENTS.draft.md` for mdtoc; 6 real theme pages honouring the operator's focus; a real before/after `DEMO.html` of gitpulse's most recent feature initiative with captured CLI output; and an architect PLAN with 5 cited brain themes, 7 `source:`-attributed constraints, 12 edge cases and 10 GWT ACs.
- **Three rulings this initiative closed, all recorded in the [ADR-043](../decisions/043-generic-interactive-surface.md) 2026-08-14 amendment.** (1) **Architect is NEVER migrated onto the primitive** and `AGENT_RUNNERS` is NOT deleted — the park's recommendation, adopted; architect's prompts were re-authored anyway (the ADR-024 axis is orthogonal) with no measured degradation. (2) `resolveInteractiveAgent` **DELETED** (bead `forge-4y7`) — zero production callers, and its wiring preconditions are not dischargeable (architect declares no `surface:`, project-brain declares `surface: unattended`, and `AGENT_RUNNERS` keys are session-kind ids not agent slugs); the real roster contains zero interactive defs, so the mirror accepted nothing for its entire life. (3) **The owed net orchestrator decrease is not collectable and is reported honestly as an INCREASE of +110 lines** (runners −86, dead mirror −12, shared loader +208). The F4 park's ~403 was the plumbing-dedup ceiling on the *migration* axis, which no runner took; on the *re-authoring* axis the prose leaves TypeScript for markdown rather than disappearing. Exported-symbol delta is +2/−1 = +1, with four private duplicate helpers deleted. What was actually bought: each agent's intent now lives in ONE place instead of two.

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

**Note — 2026-08-06 (R4-15-F2 ⚑ merger brief, operator-ratified). Outcome: R4-D1
STAYS DEFERRED, condition unchanged; the runtimes are NOT merged and no merger
initiative is opened.** The wave-5 mockup's roster describes `architect-planning`
as *"Combines today's Architect and PM"* and contains no plan agent at all, which
raised the merger question. Reviewed against the mockup itself, **it does not
contain the merger it proposes**: `views-flows.jsx:64` types that agent
`out: 'roadmap'`, and the mockup's `forge-develop` opens with
`{ id: 'intake', kind: 'queue', sub: 'roadmap → work items' }` — a queue node, not
an agent. So the roster deletes decomposition as an agent rather than merging it,
stranding ADR-037's compiled WI contracts, ADR-015's spec back-refs, and the
`plan.completeness` signal R4-11-F4's attention strip consumes. Ratified
alongside: the two differ on every axis that matters (roadmap scale vs single
initiative, interactive vs unattended, manifests+PLAN vs work items+specs); the
PM is where ADR-037 lives, so any merger must re-home it; an interactive session
on the develop critical path costs unattended operation; and answering an
evidence-based re-entry condition with a design opinion substitutes argument for
the evidence it demands.
**Next step, so this deferral carries its own:** the re-entry evidence is a
MEASUREMENT, adopted as a **batch-F exit rider** rather than a separate exercise
— during the wave-exit Scope-3 chunk driven end-to-end through forge, count
operator turns required during decomposition via the already-live
`POST /api/initiatives/:id/plan` path (R4-05-F4; proven byte-identical to the
architect-accept path by `orchestrator/project-manager-shared-pipeline.test.ts`).
Materially non-zero ⇒ the interactive-decomposition case is real and earns an
initiative; zero ⇒ it was a naming question. Brief (committed, not in the
gitignored campaign dir):
[`docs/architect-pm-merger-brief.md`](../architect-pm-merger-brief.md).

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
  retired onto band guards (`wi-contract`/`reflection-close`, `orchestrator/agent-bands.ts`) + `loopStrategy:
  'ralph'` routing; `runAgent` gains the one-shot runtime (`lifecycle:'caller'`, declared budget caps, streamGuard,
  scratch PROMPT.md — closes the known-gaps §8 rider); pipelines keep their judgment bands, only the SDK call
  moved; `*-invocation.ts` dissolved into `phases/*-binding.ts`. `PHASE_EXECUTOR_KINDS` = `['unifier']` (held for
  F4). Parity: golden spawn-captures pin PM/reflector {prompt, options} byte-identical. **Status in-progress: the
  PR is held open for the operator-gated frozen-SHA `verify:cycle` routine run (the F2 AC's real-run half); F4
  retirement stays planned for end of wave 4.**
- 2026-07-24 — **Waves-4 S1+S2 MERGED**: R4-01 F1–F3 PR #39 (main `0211972`), R1-03 PR #42 (`05addf7` —
  reopen of the cascade-closed #40), R4-04 PR #41 (`4f530ba`). Verify disposition superseded: ONE
  tail-of-wave `verify:cycle` run covers the whole wave (operator decision). The R1-03-F4 merge-boundary
  gate relocation verdict is **APPROVED as specced + recorded in the ADR-036 amendment** — R4-10-F2 unblocked.
- 2026-07-25 — **Wave-4 S3 MERGED**: R4-07 PR #44 (merge commit `302643b`) + R4-08 F1/F3 PR #45
  (merge commit `63f550e`, main tip). Stacked merge executed base-first without branch deletion,
  #45 retargeted to main, branches deleted after both merges (the S1 stacked-PR discipline).
  Post-merge main: suite 2354/2354 under `FORGE_ARCHITECT_NO_SPAWN=1`, studio/brain lint 0 errors.
  Wave-4 remaining: S4 = R4-08-F2 + R2-04; then R4-09 …; the single tail-of-wave
  `verify:cycle --project gitpulse` run stays the wave's real-money gate.
- 2026-07-25 — **Wave-4 session 3 (cont.): R4-08 F1+F3 implemented** (branch `feat/r4-08-adversarial-review`,
  stacked on the R4-07 branch). Adversarial-review agent (four lenses, severity + evidence-pointer discipline,
  identity-echo harvest) + the `review-findings` artifact (option-b: verdict.json untouched) + verdict-surface
  findings panel + the `verdictRecordToDoc` view-mode stamp fix. The branch's own 37-agent adversarial review
  hardened the shared `agent-scope-guard` (porcelain `-uall` + `.forge/` walk, fail-loud integrity) for BOTH
  wave-4 pipelines, split `error_max_*` from other spawn errors, dodged the failure-classifier's reviewer
  substring signature, closed a pre-existing `/api/artifact` cycleId traversal, and recorded the banded-node
  deferral (R4-10 wires the pipeline as a NodeExecutor; bare nodes stay out of flows until then). **F2 = S4.**
- 2026-07-24 — **Wave-4 session 3: R4-07 implemented** (branch `feat/r4-07-demo-agent`). The demo agent as an
  ADR-039 one-shot OOTB artifact + the `demo-agent.ts` orchestrator pipeline (derive/spawn/validate/render/
  orchestrated-capture/judgment bands; AC-coverage + mechanical scope guard + hard env-failure classes). **F2 =
  artifact slice**: the `demo-fix-spec` artifact (ADR-015-shaped proposals) ships; dispatch waits on R4-10-F1's
  loop topology. F3 descriptor-parity test + roadmap-card demo tie-in (review-surface link deferred — no project
  id on `Run`). Dual composition of `skills/demo` until R4-01-F4. Whole-branch adversarial review: 15 findings
  closed; capture-env inheritance → known-gaps §12.
- 2026-07-24 — **Wave-4 session 2: R4-04 implemented** (branch `feat/r4-04-architect-refinement`). Reconciliation:
  F1 (multi-round interview + revise loop), F2 (completeness critic in FINALIZE), F3 (WI-less registration +
  blocked-until-planned) were already as-built — the stale R4-B3 framing corrected in the implemented-notes. New
  build: **F4 exploring stage** (edge-case enumeration with dispositions + brain-constraint→AC propagation,
  `edge-cases.json`, PLAN section, fail-open; operator-journey gap #6 closed). R1-03 rides the same session
  (branch `feat/r1-03-contract-processes`): F1 typed `testProcess` (+ real preflight C1b/C7 + DEMO-ALIGN F3),
  F2 demo-builder folded into the project page, F4 merge-boundary-gate relocation spec ⚑ awaiting the operator
  verdict in the ADR-036 amendment.
- 2026-07-25 — **Wave-4 session 4 (S4): R4-08-F2 implemented** (branch
  `feat/r4-08-f2-sendback-loop`). **ADR-040 supersedes ADR-026**: review
  send-back compiles `origin: 'review-fix'` work items onto the initiative's
  own `.forge/work-items/` queue (`fix-work-items.ts` compiler seam — shared
  with R4-10's future demo-fix/gate-fix loops) and the fix-loop drain
  (`drain-fix-loop.ts`, replacing the deleted `drain-unifier-items.ts`)
  re-enters the SAME cycle with the new `resume_from: 'develop'` (PM
  rebase-skips, dev-loop runs, prior WIs fast-exit, fix WIs build, re-armed
  UWI-1 re-preps demo/PR). Caps moved to `forge.config.json` `review`
  (rounds 6 / total fix WIs 24, env-overridable); exhaustion
  reject-then-parks needs-operator loudly (409 + `.forge/REVIEW-CAP-EXHAUSTED.md`
  + `sendback.cap-exhausted` + notify). Merge-wins arbitration re-implemented
  on the new queue with pinned semantics. Riders: known-gaps §9 develop-dispatch
  `planned` gate closed (`not-planned` status); flows-run journey rewritten to
  the durable truth + a cap beat. Status F1+F3 → F1+F2+F3. **MERGED 2026-07-25
  on operator close-out — PR #47 @ `6b72ef92` (stacked base for R2-04 #48; merged
  base-first, no branch delete, then deleted post-#48). Post-merge main verified:
  2496/2496, tsc clean, studio/brain lint 0, ui:journey 337/337 CLEAN.** 52-agent
  whole-branch review (4 lenses → dedup → 2-skeptic verify) run over the combined
  R4-08-F2+R2-04 branch; findings fixed in-branch (see the R2-04 change log for the
  banked lessons — the review + fixes spanned both stacked initiatives).
- 2026-08-03 — **Wave-5 cut (studio-endstate-v2 mockup → modular backlog).**
  Baseline **R4-B13** added: the mockup-vs-as-built alignment register —
  developer / adversarial-review / demo-runner / reflector / forge-develop
  verified aligned, their `run-agent-*`/`run-flow` journeys adopted as
  standing acceptance references; vision non-cuts recorded (demo projects
  ride R3-06/R4-03; demo-design/research parked with R2-D2). **Minted:**
  R4-12 project detail alignment (permanent contract panel, cycle-ledger
  dig-in), R4-13 project roadmap tab (operator decision 4 — dependency DAG
  replaces SerpentineTimeline), R4-14 demo showcase page, R4-15
  architect/planning session alignment (⚑ merger brief; R4-D1 untouched),
  R4-16 demo-builder generation gallery, R4-17 onboarding session staging,
  R4-18 onboard-project OOTB flow, R4-19 brain creation & maintenance
  agents, R4-20 brain-tune OOTB flow. Every entry cites mockup journey ids +
  `as-built-inventory.md` baselines; one module per initiative.
- 2026-08-03 — **Adversarial-review corrections (PR #71 review pass).**
  R4-16 as-built corrected (demo-builder = R1-03-F2 inline panel; gallery
  renders through the R2-10 shell in place — no silent re-detach); R4-13-F1
  status-colors claim fixed (STATUS_COLOR tones + R4-11-F2 lock affordance)
  + retirement collateral named (roadmap journey rewrite, DOM-reference doc
  rows, full gallery regen); reverse edges added on R4-02/R4-09/R4-11.
- 2026-08-06 — **R4-15 → in-progress (F1 landed).** The architect planning
  session now renders its roadmap draft as a dependency DAG on the R2-10 shell:
  `dependsOn` carried end-to-end (deriver → route → client parse → view → DOM),
  a shared `dependency-dag` view model + component built for R4-13-F1's roadmap
  tab to reuse, and a project-page entry into the session (the mockup's
  "trigger: manual, from a project page"). Architect behaviour unchanged; R4-D1
  untouched. **F2 ⚑ (the architect+PM merger brief) is parked with the
  operator** — its outcome updates R4-D1's note with a date + outcome, and the
  initiative flips to `implemented` then.
- 2026-08-06 — **R4-15 → implemented; R4-D1 note updated (⚑ F2 ratified).**
  F2's architect+PM merger brief was reviewed and approved as recommended: the
  runtimes are NOT merged, no merger initiative is opened, and R4-D1 stays
  deferred with its condition unchanged — because the mockup does not contain
  the merger it proposes (its merged agent declares `out: 'roadmap'` and
  decomposition survives only as an unowned `kind:'queue'` label). The re-entry
  evidence is now a named next step rather than an open question: an
  operator-turn count during decomposition via `POST /api/initiatives/:id/plan`,
  adopted as a **batch-F exit rider** on the wave-exit Scope-3 chunk. F1's
  as-built facts absorbed into new baseline entry **R4-B14**.
- 2026-08-06 — **R4-16 → implemented** (wave 5, batch B). The demo-builder's
  generations now persist as session-dir snapshots, render through R2-10's
  shell renderer stack **in place** on the project page (R1-03-F2 not
  reversed), and "finalize" restores the chosen generation's sample AND its
  generator skill before the existing lock, so `demo.lock.json` can no longer
  pair one generation's demo with another's skill. `generation-gallery` is
  promoted from a reserved artifact row to a live one, and
  `studio/session-kinds.yaml` gains its fourth descriptor (`id: demo`).
  As-built facts absorbed into new baseline entry **R4-B15**.
- 2026-08-06 — **R4-17 → implemented** (wave 5, batch B — the batch's last
  initiative). Project onboarding had no session on disk at all; it now opens a
  real one from a `/start`-family route that accepts no caller-supplied repo
  path, and `contract-buildout` is promoted from a reserved artifact row to a
  live one with a deriver over the project's own contract artifacts —
  `contract · instructions · secrets · demo · roadmap`, all five rows always
  returned, secrets by NAME only, presence never a verdict. The same rows are
  served on `GET /api/studio/projects/<id>/contract-stages` as the data contract
  **R4-12-F1** renders in batch D. `studio/session-kinds.yaml` gains its fifth
  descriptor (`id: onboarding`), reused by creation rather than duplicated.
  R4-02/R4-03 hand-offs unchanged, pinned by no-regression ATs. As-built facts
  absorbed into new baseline entry **R4-B16**.
- 2026-08-07 — **R4-21 minted** (batch-C planning session, T1 ruling): OOTB
  authoring agent — the skill/hook package producer — plus its library save
  path and the `build-skill`/`build-hook` journey closure; scheduled into
  wave-5 **batch D** (module per-OOTB-agent). Grounds: the batch-B exit
  measurement — three parity stories share one blocker, forge has no agent
  that authors an artifact package (16 `runtime:` roster agents, none
  authors), so the `file-package` artifact row stays RESERVED until a
  producer exists. Deps R2-10 + R3-01-F3/F4 (both implemented) — the
  initiative is unblocked on arrival.
- 2026-08-11 — **R4-18 implemented** (wave 5, batch E): the `onboard-project`
  OOTB flow whose `contract-check` gate node executes the REAL `runPreflight`
  orchestrator-side, on a new `onboard-preflight` band-guard row family plus a
  `GATE_KIND['contract'] = 'agent'` row (the ADR-042 surface increase signed
  off at batch-E open). Status `planned → implemented`; as-built absorbed into
  new baseline entry **R4-B17**. Closure journey `flows-onboard` flips the
  `run-flow-onboard` story from pending to ported (3/8 steps, 5 decision-cited
  exclusions). Corrects the parked design on the record: the park file proposed
  `{gate: <band-guard-id>}`, which cannot dispatch — `resolveNodeKind` consults
  `GATE_KIND` for a `gate:` field and never `BAND_GUARD_IDS`.

- 2026-08-10 — **R4-22-F1 + F2 implemented** (PR #117, batch E lane 1). Landed the producer half as data:
  additive-optional `turnSpec` on `SessionKindDescriptor` with four deep-frozen vocabularies + eleven
  `validateSessionKinds` checks (vocabulary membership AND phase-graph coherence — dangling `next`,
  finalize-without-finalizer, no-terminal, duplicate phases, empty phases, unsafe `kindDir`);
  `orchestrator/interactive-finalizers.ts` (frozen `FINALIZERS`, seeded `copyStagingToLibrary` only);
  `orchestrator/interactive-runner.ts` (the spine — SEC-04 preamble, ADR-024 derivation, phase dispatch);
  `resolveInteractiveAgent` as the code-enforced twin of an untouched `resolveDispatchableAgent`; and the
  `cmdAgentRun` dispatch fork, evaluated before the unknown-agent bail. Purely additive — no runner migrated,
  no deletion; the promised orchestrator-surface *decrease* is still owed by F4, exactly as ADR-043 discloses.
  Two reproduced escapes closed (a staged-file TOCTOU and its symmetric destination-side twin; root-folding via
  `--project` on the new road only). Two tripwires stand: the WI-0 golden byte-capture, and a new standing
  invariant failing if any legacy-colliding session-kind id gains a `turnSpec` — added because the golden suite
  provably cannot see that (verified by mutation).

- 2026-08-11 — **R4-21 implemented + R4-22-F3 implemented** (wave 5, batch E phase 2). The `authoring`
  descriptor gains ADR-043 §1's `turnSpec` table verbatim, making creation-agent **consumer #1 of the
  generic interactive spine on pure data** — no fifth `AGENT_RUNNERS` entry, no new `orchestrator/`
  symbol, the four legacy runners untouched. Status `planned → implemented`; as-built absorbed into new
  baseline entry **R4-B18**. The session draft dir is renamed `package/ → staging/` to match the ADR's
  own `writes:` row and the finalizer's source (the two literals had already drifted once; a source-text
  ratchet now closes the class). `runInteractiveTurn` gains a fail-loud refusal when a declared `writes:`
  produces no files — a crashed drafting turn no longer advances a session to review with an empty
  package. The finalize route becomes the operator's single commit act: it requires `awaiting-review`
  (409 otherwise), drives the committing turn on the same spine the CLI uses, installs **from the landed
  package rather than from the request body**, mints `upstream` server-side, parses hook metadata from the
  DRAFTED `hook.yaml`, reverts the session to `awaiting-review` on ANY failure, and surfaces an id
  collision as 409 instead of a 200 that discarded the draft. Finalize never approves — palette
  visibility stays the separate existing act. `runTurnSpecAgent` now resolves the projects root through
  `resolveProjectsDir` so the CLI and the bridge agree under a non-default `projectsDir`. Closure
  journeys `skills`/`hooks` gain `skills-agentic-build` / `hooks-agentic-build`, flipping **`build-skill`
  and `build-hook` from pending to ported**, seeded with the verbatim output of a real recorded Claude
  turn. **Batch-E ruling 45 discharged live, not emulated:** a real (non-dry-bridge) `forge agent run
  authoring` drafted a real skill package in 21 s and a real hook package in 31 s, both landed
  byte-identical via `copyStagingToLibrary`, the skill installed as a draft and then approved to
  palette-visible, and seven traversal shapes (including a raw percent-encoded one) were refused with the
  attack artifacts provably absent.

- 2026-08-11 — **R4-22 spine defect fixed; R4-22-F4 `staged → blocked`** (wave 5, batch E phase 3). The
  generic interactive spine wrote its event log to `_logs/_interactive-<kindId>-<sid>/`, a directory no
  consumer derives. For `authoring` — the one kind on the spine — that split a single turn across three
  places: its events in `_interactive-authoring-<sid>`, its own `stderr.log` in `_authoring-<sid>` (written
  by the bridge's `spawnAgentTurn`), and the session page's `useCycleEvents` subscribed to
  `` `_${kind}-${sessionId}` `` where no events file existed at all. The descriptor id was already every
  consumer's convention (`_architect-`, `_instructions-`, `_demo-`, `_project-brain-`, `_authoring-`);
  `runInteractiveTurn`'s `cycleId` is now `_<descriptor.id>-<sid>` to match, so a turn's events and its
  stderr are co-located and a future runner migration inherits its kind's existing log directory instead of
  breaking three production files per kind. A source-text ratchet fails the suite if the spine's template and
  the bridge's `spawnAgentTurn` `logDir` template ever resolve differently again. The dispatch fork's
  "which road did it take" test discriminator moved off the directory NAME (which now legitimately collides
  with a legacy runner's own) onto the emitted event's `skill: 'interactive-runner'`, which no legacy runner
  emits — strictly stronger, and proven by mutation. **The four legacy runners are byte-for-byte untouched
  and the WI-0 golden capture stayed 4/4**; `AGENT_RUNNERS` still has its four entries and no migration
  landed. **F4 is re-stated `staged → blocked`** on the measurement recorded in its own bullet above: it
  needs an operator ruling (a new `orchestrator/` step-handler registry, or prompt re-authoring with a live
  acceptance) rather than a slot in a batch. Separately filed, deliberately NOT fixed here: the bridge never
  starts a tail for `authoring` at all (there is no `ensureAuthoringTail`), so the live panel stays empty
  even with the directories now agreed — one concern per PR.
