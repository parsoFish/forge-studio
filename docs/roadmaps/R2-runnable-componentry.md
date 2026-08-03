# R2 — Runnable componentry

> Make agents and flows true runnable primitives: any authored agent definition can execute — standalone or inside a flow — with its capabilities (fanout, interactivity, triggers, artifact surfaces, runtime adapter) driven from the definition itself, not hardcoded orchestrator tables. Scope: `docs/repo-map.md` Scope 1 (framework/seams/orchestration — flow engine, runners, adapter seam) plus the shipping of Scope 2 OOTB flow/agent content those seams carry; Scope 3 (managed projects) is out — see the roadmap index's out-of-scope register.

**Status vocabulary:** implemented | in-progress | planned | deferred. All initiatives in this file are planned/deferred as of 2026-07-17.

This is a **living roadmap** (session decision Q1): IDs are stable and never reused; changes are append-only in the change log; a genuinely new focus area mints a new roadmap (R6+), it does not renumber this one.

## As-built baseline (implemented)

### R2-B1 Flow engine (flows-as-data + data-table dispatch)

`orchestrator/flow-runner.ts` executes flow definitions from `studio/flows/<id>/flow.yaml` (ADR-028): node-kind resolution via the `GATE_KIND`/`AGENT_KIND` data tables + `DEFAULT_NODE_EXECUTORS` registry (injectable via `FlowRunArgs.nodeExecutors`), per-flow budgets (`orchestrator/flow-budgets.ts`), wedge-kill deadline (`orchestrator/stream-deadline.ts` — SDK abort threaded into PM but **not yet chained into per-WI Ralphs**, ADR-028 open note), unifier-resume (ADR-019), run model derived not stored (`orchestrator/run-model-derive.ts`). Three seed flows: `forge-architect` → `forge-develop` → `forge-reflect` chained by flowLineage.

### R2-B2 Bespoke interactive runners (the pre-primitive state)

There is **no generic run-agent primitive**. Each interactive agent has a hand-built runner + CLI subcommand pair spawned by the bridge per operator turn: `orchestrator/architect-runner.ts` (`forge architect run <sid>`), `orchestrator/instructions-runner.ts`, `orchestrator/demo-builder-runner.ts`, `orchestrator/project-brain-builder-runner.ts`, all over the shared `orchestrator/interactive-session.ts` file-checkpointed session machinery, dispatched from `orchestrator/cli.ts` (cases `architect | instructions | demo-builder | project-brain`). Unattended agents run only as flow nodes via R2-B1's executors + `orchestrator/phase-agent.ts` (`PhaseAgentSpec`, ADR-024 injection seam).

### R2-B3 Agent definitions as skills (ADR-024 / ADR-027)

An agent IS a skill directory: `skills/<name>/SKILL.md` frontmatter is parsed by `orchestrator/studio/registry.ts` + `derive.ts` into `AgentDefinition` (`orchestrator/studio/types.ts`): `surface`, `interactivity`, `composition {skills,tools,mcps,hooks}`, `runtime {sdk, strategy, model}`, `allowedTools`/`disallowedTools`. Authored in Studio at `/agents/[id]` (`[data-page="agents"]`, catalog palette from `studio/catalog.yaml`), starters under `studio/starters/agents/` (ADR-033). Enforcement today: only `allowed-tools`/`disallowed-tools` reach the spawn; `composition.tools` is decorative; `surface:`/`interactivity:` are unvalidated free text duplicated in prose.

### R2-B4 Trigger machinery (Stage C, declaration-driven)

`orchestrator/flow-trigger.ts` — flows declare `triggers: [{on, flow}]`; `FLOW_TRIGGER_EVENTS = ['complete','merged']` is the entire closed vocabulary. `on: merged` is live (fired async by `orchestrator/finalize-merged.ts`; single source of "merge fires reflect" is `studio/flows/forge-develop/flow.yaml`). `on: complete` stages a claimable request in `_queue/flow-runs/`; the **consumer is live** (`runFlowTriggerSweep`, `orchestrator/scheduler.ts:555` — called at daemon startup and on the recover timer, draining via `drainFlowRunRequests`) but there is **no producer** (no seed flow declares `on: complete`) and dispatch handles **only `forge-develop` targets** (`orchestrator/flow-run-requests.ts` `defaultStartFlowRun` throws for any other flow — corrected 2026-07-17, adversarial review A2). Kickoff kinds (launch surface): `idea | initiative-select | trigger-only` (`orchestrator/studio/types.ts`).

### R2-B5 Runtime-adapter seam (ADR-029, proof pending per ADR-032)

`loops/_adapters/` — `registry.ts` + `conformance.ts` contract tests over `claude` (live; wraps `loops/ralph/claude-agent.ts`, wrap-not-move), `gemini` and `aider` (registered, `available: false` — deps/creds unprovisioned; Gemini tool executor missing), plus `example`. Tier escalation (haiku→sonnet→opus by catalog cost) resolves **Claude tiers only** (`orchestrator/model-range.ts`). ADR-032 names the realization gap: no *running* non-Claude cycle exists yet — also operator-journey gap #12 and the differentiation proof (`docs/forge-studio-market-and-differentiation.md`).

### R2-B6 Fanout as a static topology hint

`fanOut?: string` on a flow node names the upstream artifact driving multiplicity (`orchestrator/studio/types.ts:61`); `findFanOutViolations` (`orchestrator/studio/validate.ts:68`) lints that it matches an inbound edge artifact. Real WI multiplicity is **runtime-derived** — `runDeveloperLoop` walks the WIs PM wrote; WI hexes derive from dev-loop events, not the static hint (`studio/flows/forge-develop/flow.yaml` comment). Fanout is not an agent-definition property: nothing stops authoring `fanOut` on any node.

### R2-B7 Artifact templates + advisory ref validation

`studio/artifact-templates/` (plan, work-items, pr, verdict, wi-branches) with `validateArtifactRef` (ADR-027 amendment, `orchestrator/studio/validate.ts:331-355`) — currently **advisory**, promotion to error pending. `studio/demo-elements/` (6 element types) is the existing precedent for agent-composed rich output. The unified viewer is `/artifact` (`[data-page="flows"]`, ADR-031).

### R2-B8 Agent-as-runnable primitive shipped (R2-01, 2026-07-18)

Agents are true runnable primitives. **F1** `runAgent(def, RunContext)` (`orchestrator/run-agent.ts`) — one orchestrator entry point over an extensible `RunContext` (artifact refs + named domain bindings; `project`/`initiative` the OOTB SWE kinds), works with zero bindings; composes the `PhaseAgentSpec` seam via `deriveAgentSpec`; one-shot SDK spawn through the runtime adapter + `pinnedSdkQuery` (R5-02 env-pin); born inside the R5-01 dry-bridge / `FORGE_ARCHITECT_NO_SPAWN` suppression (skips the real spawn, emits a typed `run-agent.spawn-suppressed` event); `runId` path-traversal guard (`SAFE_RUN_ID_RE`); emits standard JSONL start/end + `cost_usd` (`phase:'orchestrator'`, `skill:<slug>`, `metadata.agent_slug`) via its own logger or an injected one; ADR-036 preserved (imports no gate/CI/capture machinery). **F2** definition-driven flow-node resolution (`orchestrator/flow-runner.ts`): the hardcoded `AGENT_KIND` literal is gone — the four phase slugs declare `executor:` frontmatter (`pm`/`dev`/`unifier`/`reflect`, validated by an `executor/enum` lint in `validate.ts`), any other roster agent resolves to the generic `'agent'` kind → `execAgent` → `runAgent` (cost threaded through the flow's cost-wrapped node logger into `CostTracker`), and `execUnknown` logs at `error` severity for genuinely-unresolvable refs only. `developer-unifier`'s special executor is preserved until R4-01-F4. A `node-executor` lint rejects an interactive-surface agent on a flow node (surface-derived — see known-gaps §8). **F4** the flow monitor attributes a generic-agent node's `phase:'orchestrator'`+`agent_slug` events to its flow node (`buildAgentSlugToNodeId` + the extended `eventToNodeId`, `orchestrator/run-model.ts` / `run-model-derive.ts`; also wired into the bridge node-detail drawer) so its hex shows real status + cost — proof: `project-scoped-review` on a synthetic flow node (+ standalone via F1). **F5** `surface:` is a validated enum (`SURFACE_KINDS`, `registry.ts`) consumed by `executionPathForSurface` (`derive.ts`); `interactivity:` stays descriptive prose (F5 AC note). **F3 (partial)** a generic `forge agent run <agent-id> <sid>` CLI path (`cli/agent-run.ts`, the four legacy verbs delegate) + a single `spawnAgentTurn` (`cli/ui-bridge.ts`); the deep per-runner phase-machine convergence is deferred (F3 AC note). No `journey-sync` (no forge-ui `data-*` change — no seed flow uses a generic-agent node). As-built follow-ups: known-gaps §8.

### R2-B9 Agent-def-driven builder shipped (R2-02, 2026-07-18)

The flow/agent builders read a server-computed capability descriptor instead of client heuristics. **F1** `agentCapabilityDescriptor(def)` (`orchestrator/studio/derive.ts`) — a typed per-agent descriptor `{interactive, runtimeSdks}` computed **server-side** from the F5-validated `surface` (via `executionPathForSurface`) + declared `runtime.sdk`; threaded onto the wire as the `capability` field of `GET /api/studio/agents` **and** `/api/studio/starters` (`cli/bridge-studio.ts`), parsed verbatim client-side (`parseCapability`, `forge-ui/lib/studio-client.ts`) — no capability fact re-derived in UI code (AC). The `node-executor` lint (`validate.ts`) was rerouted through `agentCapabilityDescriptor(def).interactive` (DRY — one derivation, behaviour-identical). **F3** the BUILD tab (`/flows/[id]`) gates interactive-agent placement from the descriptor: `AgentPalette` chips carry `data-chip-placeable` (interactive agents greyed/undraggable), `FlowBuilderCanvas` onDrop rejects an interactive agent with `[data-component="canvas-drop-reject"][data-drop-reject-message]`; the server-side `node-executor` save-lint (R2-01-F2) remains the enforcement backstop. **F4** `/agents/[id]` `[data-ready-count]`'s runtime check is descriptor-sourced (`capability.runtimeSdks.length > 0`, `forge-ui/lib/agent-readiness.ts`, replacing the client `runtimeConfigured` heuristic); the `interactive` fact surfaces as an informational (non-gating) `[data-capability-interactive]` chip; content-completeness checks retained (skill-resolvability not-ready deferred — F4 note). `journey-sync` run: flows-author (F3 interactive-placement beat, honest capability-injection fixture — no shipped agent is interactive) + agents (readyCount re-derived + descriptor assertion). **F2 (composition-single-source) split to R2-07** — `composition.tools` and `allowed-tools` are disjoint vocabularies, an ADR-027 object-model change, not a rename. Unit coverage: `agent-readiness.test.ts`, `studio-client.test.ts` (`parseCapability`), a starters-descriptor test.

## Planned initiatives

### R2-01 Agent-as-runnable primitive

- **Status:** implemented (2026-07-18 — as-built in R2-B8; F1/F2/F4 met ACs, F5/F3 with noted scope)  ·  **Wave:** 1
- **Depends on:** R5-01 dry-bridge (safety — wave 0 precedes; new spawn surfaces must be born inside the dry-bridge seam), R5-02 G8 env-pin (spawn-seam hygiene).
- **Depended on by:** R4-01 (platform→artifact migration needs the generic primitive), R4-02 (standalone onboarding agent), R4-05 (hard, for its F4 standalone-planner dispatch), R2-02, R2-04, R2-05 (dynamic surfaces render runnable output), R2-06 (adapter realization exercises the primitive), R2-10 *(wave 5 — F3's generic host is the sessions-surface substrate)*, R6-04 *(wave 5 — F3's dispatch host behind the one Run button)*.
- **Context:** Operator diagram (verbatim intent): *"today agents cannot run on their own — update them to be a runnable component WITHOUT forcing integration with a flow."* As-built: R2-B2 bespoke runners per interactive agent; `AGENT_KIND` hardcodes 4 slugs (`project-manager`, `developer-ralph`, `developer-unifier`, `reflector` — `orchestrator/flow-runner.ts:233`); an unknown agent on a flow node hits `execUnknown` and is **silently skipped** (`flow-runner.ts:701-713`) — the agent builder can author agents the engine cannot execute; `project-scoped-review` is a roster agent with zero dispatch wiring (only hit: `orchestrator/studio/seed-data.test.ts`). Q3-B ripple: the `developer-unifier` slug/`execUnifier` retire with the unifier concept (replacement agents live in R4-07/R4-08); the unifier's dual-boundary full-suite gate — a known-gaps "strength worth preserving" — relocates to **orchestrator-owned gate execution per the ADR-036 pattern (agents judge, orchestrator executes)**; **this relocation is flagged for operator review.**
- **Features:**
  - **R2-01-F1 Generic `runAgent` primitive.** One orchestrator entry point taking an `AgentDefinition` + a typed, **extensible `RunContext`** — artifact refs plus zero-or-more named domain bindings, with `project` and `initiative` as the OOTB SWE binding kinds the shipped suite registers (north-star reframe: the primitive is platform, the SWE bindings are content — adversarial review D3). Composes the existing `PhaseAgentSpec` seam (`orchestrator/phase-agent.ts`, ADR-024) so harness overlays/allowed-tools enforcement are identical in-flow and standalone. ACs: any `library: true` roster agent runs via the primitive; **the primitive executes an agent with no project/initiative binding** (pure research/report fixture); run emits standard JSONL events + cost into `_logs/`; ADR-036 split preserved — the primitive never lets the agent execute its own gate.
  - **R2-01-F2 Definition-driven node-kind resolution; kill the silent skip.** Resolution moves from the closed `AGENT_KIND` table to the agent definition (`surface`/`interactivity` decide interactive-vs-unattended execution path) for definition-resolvable agents; unknown agent on a saved flow becomes a **studio lint/save error**, and at runtime the generic F1 executor handles any definition-resolvable agent — `execUnknown` survives only for genuinely unresolvable refs and logs at `error` severity, never a quiet `log`. **Ownership split (adversarial review A5):** the four phase slugs keep a **declared kind-mapping** (an `executor:` frontmatter field or registry shim onto their bespoke executors — `execPm`/`execDev`/`execUnifier`/`execReflect` have per-phase orchestration a 2-way surface split cannot select); deleting that mapping is R4-01-F2's job when invocation prose migrates; `developer-unifier` keeps its special-cased executor until R4-01-F4. **Gate kinds ride the same principle:** gate-node resolution comes from flow data — the platform primitive is pause-for-operator-verdict on a declared artifact; what approve *executes* (e.g. `openPrInline`+`runClosure`) is a declared closure action supplied by the OOTB flow's gate recipe, with `plan`/`verdict` as the shipped rows (adversarial review D4; gates remain flow-node properties — deliberately NOT an agent capability, operator decision 2026-07-17). ACs: authoring a new unattended agent + placing it on a flow node executes without touching `flow-runner.ts`; `forge studio lint` fails on a node whose agent the engine cannot execute; the four legacy slugs resolve through the declared mapping (not a hardcoded table in `flow-runner.ts`).
  - **R2-01-F3 Interactive-runner convergence.** The four bespoke runners (R2-B2) become thin configurations of one generic interactive-agent host over `interactive-session.ts` (file-checkpointed, one bounded turn, bridge-spawned — ADR-020/023 invariants intact). ACs: `orchestrator/cli.ts` gains one generic `forge agent run <agent-id> <sid>` path; architect/instructions/demo-builder/project-brain reachable through it; per-runner LOC shrinks to config + prompt assembly; no behavior change detectable from the Studio UI (journeys green).
    - **Landed 2026-07-18 (partial, as-built R2-B8):** the generic `forge agent run <agent-id> <sid>` CLI path (`cli/agent-run.ts`; the four legacy verbs delegate to it) + the single `spawnAgentTurn` bridge collapse (`cli/ui-bridge.ts`, four byte-identical spawns unified) landed — meeting the CLI-path, all-four-reachable, boilerplate-collapse, and no-behavior-change ACs (each legacy verb byte-identical; journeys unaffected). **Deferred (documented scope decision):** the deeper "become thin configurations of one generic host" — extracting the shared turn machinery and converging the four genuinely-incompatible phase-machines/status-shapes/commit-strategies — is left as a follow-on: it is a risky rewrite of production runners (bridge-spawned per operator turn) whose value the runnable-primitive foundation (F1/F2/F4) does not require. A first full-scope attempt exceeded a single worker's context, confirming its size. Tracked for a future R2/R4 pass.
    - **Landed 2026-07-26 (generic non-interactive run surface, branch `feat/r2-01-f3-generic-run-host`, wave-4 tail):** a NEW capability adjacent to this feature — **not** F3's interactive-runner convergence (that stays deferred; this touches none of the four bespoke phase-machines), and distinct from F4's `project-scoped-review` proof — realizing the same **"executes standalone; events/cost visible"** shape F4 named, but generalised to the whole non-interactive roster (project-scoped-review, adversarial-review, doc-updater, the R4-02 onboarding agent, …), which previously had **no** run surface at all. Built additively over the F1 `runAgent` primitive. Pieces: `orchestrator/agent-dispatch.ts` (`dispatchAgentRun` + `resolveDispatchableAgent` — resolves a def by slug, **refuses interactive agents and unknown slugs at the boundary**, assembles a standalone prompt with operator inputs as JSON-encoded DATA, runs one shot through `runAgent`); the generic `forge agent dispatch <slug> --run-id <id> [--project] [--input k=v]` CLI (`cli/agent-run.ts`, sibling to the four-interactive `agent run`; writes an `agent-dispatch.failed` marker on crash so a dead run reports `failed`, not perpetual `running`); bridge `POST /api/agents/:slug/run` (validates slug+project+input-keys against the live roster → spawns `agent dispatch` detached via `spawnAgentDispatch`, dry-bridge guarded — mirrors `spawnAgentTurn`) + `GET /api/agents/runs/:runId` (reads `_logs/<runId>/events.jsonl` → `{state, costUsd, events}`); and the `/agents/[id]` **RunPanel** (`data-section="agent-run"`, `data-run-dispatchable`/`data-run-id`/`data-run-status`/`data-run-cost`) + `studio-client` `dispatchAgentRun`/`getAgentRunStatus`, which polls (bounded) so **events/cost are visible in the UI**. This is the agent-page run host **R4-02-F1** plugs its onboarding agent into (operator decision 2026-07-26: R4-02-F1 = generic run surface, not a bespoke onboarding page). Delivered: `forge studio lint` green; a dispatchable agent runs from `/agents/[id]` and standalone via the CLI; interactive agents refused server-side, not just hidden. (Run-INPUT authoring in the panel — repo/north-star fields — lands with R4-02; the CLI/bridge already accept `inputs`.) Tests: `orchestrator/agent-dispatch.test.ts`, `cli/ui-bridge-agent-run.test.ts`.
  - **R2-01-F4 First proof: wire `project-scoped-review`.** Dispatch the orphaned roster agent through F1/F2 as the smallest real proof (also feeds R4-08 adversarial-review design). ACs: it executes on a flow node and standalone; events/cost visible in the flow monitor.
  - **R2-01-F5 Surface/interactivity promoted to validated schema.** `surface:` and `interactivity:` frontmatter become validated enums the runtime actually consumes (they currently duplicate prose, unvalidated). ACs: `forge studio lint` rejects unknown values; `derive.ts` maps them onto F2's execution-path choice; roster SKILL.md files migrated in the same change.
    - **Landed 2026-07-18 (as-built R2-B8) — AC amended:** `surface:` is the validated enum (`SURFACE_KINDS` in `registry.ts`) that `executionPathForSurface` (`derive.ts`) consumes for F2's interactive-vs-unattended path; `forge studio lint` rejects unknown `surface` values. **`interactivity:` was deliberately NOT enum'd** — every roster value is a unique descriptive sentence (no shared token vocabulary), and only `surface` drives the execution path. The AC is amended: `surface` is the validated categorical; interactivity-as-enum is dropped (no runtime consumer needs it), not tracked as a follow-up. Roster `surface` values were already valid (no migration); the 4 phase agents gained `executor:` (F2).
- **Session sizing:** ~3 sessions — (1) F1+F5 primitive + schema, (2) F2+F4 dispatch rewiring + proof, (3) F3 runner convergence.
- **Out of scope:** builder-side capability exposure (R2-02); fanout semantics (R2-03); new trigger kinds (R2-04); replacement post-develop agents themselves (R4-07/R4-08); gate-recipe content changes (ADR-036 execution stays where it is — only the unifier-gate *relocation decision* is noted here, for operator review).

### R2-02 Agent-def-driven builder

- **Status:** implemented (2026-07-18 — as-built in R2-B9; F1/F3/F4 met wave-1 ACs, F2 split to R2-07)  ·  **Wave:** 1
- **Depends on:** R2-01 (definition-driven execution is what makes builder-declared capabilities real, not decorative).
- **Depended on by:** R4-01 (migration of platform agents to artifacts needs the capability schema), R2-03-F3, R2-09 *(wave 5 — `materials:` rides the descriptor)*, R6-04 *(wave 5 — descriptor routes session-vs-kickoff)*.
- **Context:** Operator diagram (verbatim intent): *"EVERYTHING configurable in the flow builder should be driven from the agent definitions themselves"* — today *"fanout can be set on anything, same story with interactive-or-not."* As-built decision point: `composition.tools` is decorative while `allowed-tools` is enforced (R2-B3) — two sources for one fact. Sources: operator diagram R2 notes; ADR-027 (object model); ADR-024 (composition seam).
- **Features:**
  - **R2-02-F1 Capability schema derived from `AgentDefinition`.** `derive.ts` exports a **typed** per-agent capability descriptor (named fields, unit-tested schema): wave 1 ships the facts computable from today's definition — `{interactive}` (from the F5-validated `surface`/`interactivity`) and `{runtimeSdks}` (from `runtime`) — with recorded schema extensions landing where their authoring source lands: `{fanoutCapable}` in R2-03-F2, `{artifactOutputs}` in R2-05-F2. **Dropped (operator decision 2026-07-17, simplification):** `gate-emitting` and `trigger-compatible` — gates are flow-node data (R2-01-F2) and triggers are flow-level declarations (R2-04); neither is an agent capability, and agent-as-sometimes-gate is functionality forge doesn't need. ACs: descriptor covered by unit tests for every roster agent; no capability fact exists only in UI code; extension points documented in the schema.
    - **Wave-1 scope clarified (2026-07-18):** the descriptor is **server-computed** (in `derive.ts`) and threaded onto the wire (extend the bridge's agent GET payload) so no capability fact lives only in UI code (per the AC). `{interactive}` = `executionPathForSurface(surface)` (R2-01-F5, landed). `{runtimeSdks}` = the agent's declared runtime sdk(s) surfaced as a descriptor **fact, not a new gate** (today `runtime.sdk` is a single value → a one-element set; extensible when R2-06 lands multi-adapter) — the builder's SDK picker stays gated by the global adapter-registry `available` flag.
  - **R2-02-F2 Resolve the composition-vs-allowed-tools double-booking.** Decision (spec here, execute in-session): `composition` becomes the single authored source; the enforced allowed/disallowed tool set is **derived** from composition at spawn (via `PhaseAgentSpec`), and `forge studio lint` errors on any SKILL.md where hand-written `allowed-tools` disagrees with the derivation (migration: regenerate, then forbid hand-edits). ACs: one authoring surface in `/agents/[id]`; enforcement provably equals the derivation (conformance test); roster migrated.
    - **MOVED to R2-07 (2026-07-18, operator-approved re-scope).** The wave-1 R2-02 understand pass found `composition.tools` (catalog CLI ids: `git`/`node`) and `allowed-tools` (SDK tool tokens: `Read`/`Bash`/`Edit`) are **disjoint vocabularies** with no translation anywhere — so "derive allowed-tools from composition" is not a rename but a net-new catalog-id→SDK-token model + a roster migration + an **ADR-027 object-model / authoring-contract change**. Per the escalation contract (ADR change not pre-locked), this splits out as its own initiative **R2-07** (ADR-027 amendment first), rather than a rushed wave-1 slice. F2's ID is retained here with this terminal pointer (IDs never reused).
  - **R2-02-F3 Builder constrained by capabilities.** The flow builder (`/flows/[id]` BUILD tab) and agent builder only offer options the agent's descriptor declares: fanout toggle only on fanout-capable agents, interactive placement only where declared, artifact pickers limited to declared outputs (gate placement stays a flow-authoring concern, not descriptor-constrained — see R2-02-F1's dropped bits). `forge studio lint` errors when a saved flow node exceeds its agent's capabilities. ACs: lint fixture proving the violation class; `data-*` attributes updated + `journey-sync` run (flows-author + agents journeys).
    - **Wave-1 scope (2026-07-18, post-F2-split):** the composition/tool-palette constraint moves out with F2 (→ R2-07). Wave-1 F3 = gate/warn **interactive-agent placement** on a flow node from the descriptor's `{interactive}` — the server-side `node-executor` lint (R2-01-F2, `validate.ts`) already enforces this; F3 surfaces it in the BUILD UI (client-side warn + the descriptor on the wire) and refactors that lint to read the F1 descriptor function rather than an inline `executionPathForSurface` call. Fanout/artifact-picker gating stay deferred (R2-03/R2-05).
  - **R2-02-F4 Readiness panel truthfulness.** `/agents/[id]` `[data-ready-count]` reflects the derived descriptor (an agent missing a runtime or with an unresolvable skill ref reads not-ready), replacing any hardcoded readiness heuristics. ACs: readiness computed from F1 descriptor only.
    - **Landed 2026-07-18 (as-built):** `[data-ready-count]` reflects the descriptor for the CAPABILITY facts — the `runtime` check is `capability.runtimeSdks.length > 0` (server-computed, F1; the client `runtimeConfigured` heuristic was removed), and the descriptor's `interactive` fact surfaces as its own informational (non-gating) `[data-capability-interactive]` chip. The CONTENT-COMPLETENESS checks (purpose/skill/hook/process/interactivity) are retained as-is — they're independent did-the-operator-fill-this-in signals, not the hardcoded heuristic the AC targets, and a literally descriptor-only panel would drop useful checks. **Note:** the AC's "unresolvable skill ref reads not-ready" example is **NOT implemented in wave 1** — the `skill` check stays presence-only (`skills.length > 0`); a skill-resolvability signal is deferred as a follow-up.
- **Session sizing (re-scoped 2026-07-18, F2 → R2-07):** ~2 tasks — (1) F1 server-computed capability descriptor + on-the-wire, (2) F3+F4 builder gating (interactive placement) + readiness truthfulness + journey-sync (flows-author + agents).
- **Out of scope:** composition-as-single-source / allowed-tools derivation (**moved to R2-07**); the fanout *semantics* behind the toggle (R2-03); skill library management surfaces (R3-01); OOTB agent content changes (R4).

### R2-03 Fanout capability (research spike first)

- **Status:** **F1–F4 implemented** (F1 spike 2026-07-25; F2/F3/F4 2026-07-25 wave-4 S7, branch `feat/r2-03-fanout-capability`)  ·  **Wave:** 3 (unblocks R4-06 develop-agent refinement)
- **Implemented-notes (F2/F3/F4, 2026-07-25):**
  - **F2 — built.** `AgentDefinition.fanout` block `{drivingArtifact, isolation
    (worktree|none|<provider>), concurrencyCap?, perItemGate?}` (parse/serialize
    in registry.ts); `agentCapabilityDescriptor` folds a derived `fanoutCapable`
    fact (wire-threaded, client optional-tolerant); `validateFlow`'s new
    `fanout-capability` ERROR check rejects a node whose `fanOut` targets a
    non-fanout-capable agent — same descriptor the BUILD tab reads. developer-ralph
    declares its existing per-WI fan-out (cap 1 = byte-compat). ZERO runtime change.
  - **F3 — built.** The NodeMiniPanel fanout toggle is capability-gated
    (`data-fanout-capable`, disabled + greyed otherwise) and binds the node
    `fanOut` to the agent's declared `drivingArtifact`, not a hardcoded string.
    flows-author journey asserts both states (developer-ralph on / developer-unifier off).
  - **F4 — built (scoped).** The extraction was **already done** (generic
    `wi-dispatch-scheduler.ts` vs the SWE provider `wi-worktree.ts`+`wi-merge-back.ts`).
    Closed the ADR-028 abort-chain TODO: `ClaudeAgentOptions.externalSignal`
    chains the node wedge-kill into each per-WI Ralph iteration (kill test) — no
    more zombie work. `resolveDevWiConcurrency` gains a definition-level source
    (the agent's `fanout.concurrencyCap`; env still overrides; clamped to the
    ceiling). A toy-provider (isolation:none, non-WorkItem) test proves the
    generic dispatcher is reusable with no new dispatcher code. Byte-compatible
    at concurrency 1 (existing behavior-lock tests green).
  - **Review fixes (2026-07-25, whole-branch adversarial review).** Precedence
    of `resolveDevWiConcurrency` corrected to **env > config > definitionCap >
    default** (the agent's declared cap is a *default* below the ADR-009 operator
    lever, not above it). Fixed an external-abort listener leak (`{once:true}`
    never self-removes on normal completion → accumulated on the shared node
    signal). Scoped the ADR-028 "no zombie work" guarantee to the reference
    `claude` adapter (gemini/aider/example accept but don't honor `externalSignal`
    yet — known-gaps §4.12). Added a SOFT `fanout/isolation` lint (open provider
    ref; `FANOUT_ISOLATION_KINDS = worktree|none`). Wedge-kill firing MID-attempt
    now reclassifies to `aborted` instead of routing through crash-retry.
    - **Deferred within F4 (residual):** parameterizing `runDeveloperLoop` by the
      NODE's agent def so a 2nd fanout-capable agent runs its OWN behaviour as a
      real flow node (today `makeAgentWithTelemetry` hardcodes `developer-ralph`'s
      identity + the flow-runner `loopStrategy:'ralph'` dispatch is slug-restricted).
      That is a substantial hot-path refactor best folded into **R4-06** (which
      refines the develop agent). The generic dispatcher seam IS provider-agnostic
      (proven); the residual is the SWE dev-loop pipeline's hardcoded agent identity.
- **F1 spike result (2026-07-25):** [`docs/investigations/R2-03-fanout-merge-resolution-spike.md`](../investigations/R2-03-fanout-merge-resolution-spike.md)
  — **NO-GO on R2-D1.** 76 external sources across 6 angles (merge queues,
  agent-swarm frameworks, worktree-fanout, decomposition-vs-resolution,
  LLM-merge-resolution maturity, alt-VCS). Every surveyed system converges on
  isolate/order/decompose-then-retest, NOT semantic merge-resolution (LLM
  conflict-resolution ceiling <60% correct — kept behind a human/test gate
  everywhere). Forge's scheduler merge-gate ordering (dependent waits in
  `done/`, branches fresh from post-merge main, ADR-011) already matches the
  most rigorous pattern found. The one real gap the survey surfaced is a
  same-wave-sibling **decomposition/detection** gap (no computed file-overlap
  guarantee), NOT a resolution gap — cheapest fixes (a static overlap preflight
  / a `git merge-tree` dry-run) are additive to ordering and out of scope here
  (Q3-B). R2-D1 closes per its own re-entry clause as rejected.
- **Depends on:** R2-02 (capability schema is where fanout-capability is declared).
- **Depended on by:** R4-06 (develop refinement), R2-D1 (merge-resolution — **NO-GO per F1**; re-entry only on the 3 preconditions the spike names).
- **Context:** Q3-B locked: fanout gets a **research-first spike** — survey parallel-agent/merge best practices **outside forge** — before any merge-resolution capability is designed. Operator diagram: fanout needs *"explicit baking into agent definitions so the option is selectable in the flow builder."* As-built: `fanOut` is a static topology hint (R2-B6, `findFanOutViolations`); real WI multiplicity is runtime-derived inside the dev-loop only; `FORGE_DEV_WI_CONCURRENCY` defaults to 1 pending soak (known-gaps §4.2); ADR-028 open note — wedge-kill AbortSignal not chained into per-WI Ralphs.
- **Features:**
  - **R2-03-F1 Research spike (mandatory first; the gate for R2-D1).** Survey how the wider ecosystem handles parallel-agent execution + worktree/branch merging: merge queues, agent-swarm frameworks, worktree-fanout patterns, conflict-avoidance-by-decomposition vs conflict-resolution-by-agent. Deliverable: a cited evidence report in `docs/investigations/` with an explicit recommendation on whether forge needs a merge-resolution capability at all (the current scheduler merge-gate ordering — dependent waits in `done/`, branches fresh from post-merge main — may remain sufficient). ACs: report exists with ≥5 external sources; names the R2-D1 go/no-go recommendation; **no merge-resolution code is designed or written in this initiative** (Q3-B).
  - **R2-03-F2 Fanout as an agent-definition property.** SKILL.md frontmatter gains a `fanout:` block — {driving artifact kind, per-item **isolation: `worktree | none | <provider>`** (an enum/provider reference — worktree is the only shipped provider, and result-integration is part of the provider, not the generic primitive; adversarial review D5), concurrency cap, per-item gate contract} — replacing "fanOut settable on any node". The node-level `fanOut` artifact binding survives as the flow-side half (capability in the def, policy/binding on the node). `derive.ts` folds it into the R2-02 capability descriptor; `findFanOutViolations` extends to error when a node's `fanOut` targets a non-fanout-capable agent. ACs: `developer-ralph` declares the existing WI fan-out through this block with zero runtime behavior change; lint fixture for the violation.
  - **R2-03-F3 Builder exposure.** Fanout becomes selectable in the flow builder only on fanout-capable agents (delivered through the R2-02-F3 mechanism; recorded here because the property originates in this initiative). ACs: flows-author journey beat updated.
  - **R2-03-F4 Runtime generalization.** Extract the dev-loop's per-WI dispatch behind the definition-declared fanout so a second fanout-capable agent needs no new orchestrator code — **with the extraction seam named explicitly (adversarial review D5):** the generic fanout dispatcher (items from driving artifact, concurrency, per-item budget/abort, gate contract — `orchestrator/wi-dispatch-scheduler.ts`) is separate from the SWE isolation+integration *provider* (wrapping `wi-worktree.ts` + `wi-merge-back.ts`), so a future non-repo fanout consumer swaps the provider, not the dispatcher. Fold the ADR-028 TODO here where sensible: chain the wedge-kill AbortSignal into per-WI Ralph loops. Surface `FORGE_DEV_WI_CONCURRENCY` as the definition's concurrency cap (config, not env-only — known-gaps §4.2's raise-after-soak lands as a data change). ACs: dev-loop behavior byte-compatible at concurrency 1; abort chained (kill test); a toy second fanout agent runs in a test flow.
- **Session sizing:** ~3 sessions — (1) F1 spike (research-only), (2) F2+F3 definition + builder, (3) F4 runtime extraction.
- **Out of scope:** merge-conflict resolution of parallel branches (R2-D1, gated on F1); PM decomposition quality (R4-05 plan agent); raising the concurrency default itself (operational decision post-soak, known-gaps §4.2).

### R2-04 Trigger expansion

- **Status:** **implemented** (2026-07-25, wave-4 session 4, branch
  `feat/r2-04-triggers` — pulled forward from wave 3 as the S4 pairing; ADR-041
  + ADR-027 amendment)  ·  **Wave:** 3 (opportunistic slice-able)
- **Implemented-notes (2026-07-25, ADR-041):**
  - **F1 — built.** `orchestrator/enqueue-flow-run.ts` = the generic per-flow
    claimable enqueue (state guards generalized; the develop-only
    decomposition gate stays keyed to `forge-develop`; `enqueue-develop-run.ts`
    is a thin delegate preserving its `already-developing` vocabulary).
    `defaultStartFlowRun` dispatches ANY flow target; non-enqueued outcomes are
    dispatch errors (request retained, never silently dropped). The declaring
    proof is a fixture, not a committed seed (no production-dead flows).
  - **F2 — built.** `TRIGGER_KINDS` registry rows-as-data
    (`flow-complete | agent-complete | merged | manual | cron | webhook |
    feed`; `merged` = OOTB row; reserved kinds parse but lint-error —
    `trigger-kind-reserved` — zero runtime stubs; `complete` renamed
    `flow-complete`). `FlowTrigger` reshaped to `{on, target:{kind: flow|agent,
    ref}, …per-kind config}` — seed migrated one-shot, stale `flow:` key fails
    loud. **Cron**: `orchestrator/cron-triggers.ts`, scheduler-armed `croner`
    jobs (protect, diff-sync per recover tick, stopped on shutdown); fire =
    stage-only. **Webhook**: `POST /api/hooks/:hookId` on the bridge
    (`cli/bridge-hooks.ts`) — raw-body HMAC before parse
    (`@octokit/webhooks-methods` for github/gitea `X-Hub-Signature-256`;
    gitlab `timingSafeEqual` static token; rotation via `secretEnvPrevious`),
    **fail-closed 503 on a missing secret**, mandatory `sources` allowlist
    (403), typed extraction, 202 = staged; mounted BEFORE the CSRF guard
    (signature is the trust boundary); dry-bridge row `exempt-local`.
    Origination (no source initiative) mints a fresh `origin: 'triggered'`
    manifest for the target flow's lint-required project with conservative
    config budgets (`triggers` section, $10/30 defaults ⚑ operator-tunable).
    Agent targets = schema + lint + a dispatch seam that throws
    (request retained) until R4-09.
  - **F3 — built.** Queue-only dispatch invariant (staging is a file write;
    dispatch only in the daemon sweep behind `runAgent`'s NO_SPAWN/dry-bridge
    enforcement) pinned by `trigger-harness-guard.test.ts` (origination's
    COMPLETE effect set = one pending manifest + one payload artifact; no run
    dir, no events). `TriggerPayload` union: strict-charset structured fields,
    free text capped + control-stripped, carried verbatim as data via the
    `trigger-payload.json` artifact; `buildAgentPrompt` interpolates ONE
    strict-token line only; the injection fixture (malicious commit message)
    proves confinement. `journey-daemon-guard` refuses stray
    `_queue/flow-runs/` requests. Known-gaps §8 `buildAgentPrompt` rider
    CLOSED.
  - **F4 — built.** FlowHeader kind selector (4 shipped kinds) + per-kind
    fields (cron schedule with croner client-validate + `data-schedule-invalid`;
    webhook id/provider/events/secretEnv/sources + `data-hook-url`); chips
    gain `data-trigger-kind`; library cards `data-trigger-badge`. The
    flows-author journey now AUTHORS the `merged` trigger (the previously
    unauthorable seed shape) and exercises cron validation transiently
    (UI-authored flows have `project: null`, so a cron trigger would be
    lint-invalid — saved triggers stay `merged`-only; noted as a follow-up
    for when flows gain UI project binding). `data-*` contract added to
    `docs/forge-ui-dom-and-harness.md`.
  - **Deps added (research-first):** `croner` (0-dep cron runner + the lint
    validator — one grammar) and `@octokit/webhooks-methods` (0-dep audited
    constant-time HMAC). ⚑ Operator notes: the bridge binds `0.0.0.0`, so the
    webhook endpoint is LAN-reachable day one (fail-closed verification
    covers it; public exposure = operator ops); minted-run budget defaults
    are a spend-policy proposal.
- **Depends on:** R5-01 dry-bridge (every new trigger is a new unattended-spawn surface — must route through the guarded seam), R2-01 (agent-complete events exist only once agents are runnable primitives).
- **Depended on by:** R2-08 *(wave 5 — extends the kind registry + webhook machinery)*. (R4-10 develop-cycle OOTB flow consumes but does not require new kinds.)
- **Context:** Operator diagram (verbatim intent): *"triggers = user action, completion of other flows/agents, real-world events (git commits, releases, RSS feeds, etc)."* As-built: closed vocabulary `['complete','merged']` (`orchestrator/flow-trigger.ts`); the `on: complete` **drain is live** but has no producer and only `forge-develop` dispatch (see the corrected R2-B4); kickoff kinds `idea | initiative-select | trigger-only`. The 2026-07-16 bridge incident (memory: bridge real-agent surfaces; known-gaps §4.10) is the standing warning: uncovered trigger surfaces run real agents.
- **Features:**
  - **R2-04-F1 Close the on:complete loop (re-scoped 2026-07-17, adversarial review A2).** The drain already exists and runs (`runFlowTriggerSweep`, `scheduler.ts:555` — startup + recover timer); the real work is the **generic per-flow claimable enqueue**: generalize `orchestrator/flow-run-requests.ts` `defaultStartFlowRun` beyond its forge-develop-only dispatch so any target flow can be enqueued, and ship a declaring test flow proving the existing produce→stage→drain→dispatch pipeline end-to-end under `forge serve`. This is also where operator-authored flows gain a real enqueue path (cross-ref: R5-04's verification concern). ACs: an `on: complete` trigger targeting a non-forge-develop flow demonstrably starts it under `forge serve`; unit + daemon-level test.
  - **R2-04-F2 Trigger kinds as data.** `FLOW_TRIGGER_EVENTS` opens into a typed trigger-kind registry: `flow-complete | agent-complete | merged | manual | cron | webhook | feed` (domain-event kinds like `merged` are rows the OOTB suite contributes, not platform literals — adversarial review D8). **Targets extend beyond flows to standalone agents** — the R4-09 reflect agent consumes an initiative-state transition through this registry (the state emits the event; routing stays declarative — adversarial review D7/E1; the extension is owned here). First shipped kinds: **cron** and **webhook** (git push/release). Per CLAUDE.md's hand-rolling prohibition: research-first — adopt a battle-tested scheduler/webhook receiver rather than building one; **content-trust is part of the selection criteria** (E6). ACs: trigger schema validated by `forge studio lint`; each shipped kind has an integration test; **webhook kinds verify signatures (HMAC, e.g. `X-Hub-Signature-256`) mandatorily**; trigger declarations carry a **source allowlist** verified against the payload origin; unshipped kinds are schema-reserved, not stubbed.
  - **R2-04-F3 Every trigger path is guard-covered — harness mode AND live content-trust.** All externally-originated dispatches route through the same claimable-request queue and honor the R5-01 dry-bridge / env-guard contract — no new "structurally outside `FORGE_ARCHITECT_NO_SPAWN`" surfaces (the class of the 2026-07-16 incident, known-gaps §4.10). **Live posture (adversarial review E6, OWASP LLM01):** external payloads (commit messages, release notes, feed items) enter the flow as **typed structured fields only — never raw text concatenated into an agent prompt**; prompt assembly treats them as data. ACs: a harness-mode run proves cron/webhook triggers cannot spawn a real agent; guard test added beside `scripts/lib/journey-daemon-guard.mjs` coverage; **a prompt-injection fixture (malicious commit message) demonstrably cannot alter agent instructions**.
  - **R2-04-F4 Trigger authoring surface.** Flow builder exposes trigger declaration (kind + source + target) with the same definition-driven constraints as R2-02; the library `/` flows section surfaces each flow's triggers. ACs: `data-*` contract added; `journey-sync` run.
- **Session sizing:** ~3 sessions — (1) F1 drain, (2) F2 kinds + adopted receiver, (3) F3 guards + F4 UI. F1 is independently shippable early.
- **Out of scope:** the notifications/attention strip that trigger-dense multi-project operation demands (R4-11, Q4); retiring the architect flow's kickoff (R4-D1).

### R2-05 Dynamic artifact surfaces

- **Status:** planned  ·  **Wave:** 3
- **Depends on:** R2-01 (agent output contracts formalize alongside the runnable primitive).
- **Depended on by:** R4-07 demo agent (soft — richer demo surfaces build on this contract; its hard dep is R1-03), R6-01-F5 *(wave 5, soft — typed-output rendering pulls the F2 surface contract at need)*, R3-06 *(wave 5, soft — F1's canonical artifact set is the templates library's substance)*.
- **Context:** Operator diagram (verbatim intent): flows *"must allow creation of various elements for different flows — HTML pages for plans/demos whose layout AND content are defined as agent output and presented by the flow UI (dynamic content support)."* As-built: fixed template set (R2-B7); `validateArtifactRef` still advisory (promotion pending, ADR-027 amendment); flow artifact-set is "messy — reduce the possibilities and solidify what gets presented" (known-gaps §4b.5); `studio/demo-elements/` already proves element-composed agent output.
- **Features:**
  - **R2-05-F1 Artifact-set cleanup (known-gaps §4b.5).** Audit every artifact a flow run can produce; collapse to a canonical set with one owner each; promote `validateArtifactRef` (`orchestrator/studio/validate.ts:355`) from advisory to **error**; delete orphaned template/artifact paths. ACs: `forge studio lint` errors on an unresolvable artifact ref; canonical set documented in `studio/artifact-templates/` README; no flow node emits an artifact outside the set.
    **Enforceable slice landed 2026-08-04 (R3-06, branch `feat/r3-06-templates-library`
    — the two roadmaps share this substance, decided at session start per R3-06's
    own dependency note):** `validateArtifactRef` is now a hard error; the flow
    builder's hardcoded `ARTIFACTS` catalog (`forge-ui/lib/flow-artifact-catalog.ts`)
    had its two orphan entries (`reflection`, `demo` — no on-disk template) deleted
    and its id set is now pinned to the on-disk `studio/artifact-templates/` set by
    a CI-enforced parity test (`forge-ui/lib/flow-artifact-catalog.test.ts`,
    both directions); the canonical 7-template set is documented in
    `studio/artifact-templates/README.md`. **Deliberately NOT landed, stays with
    R2-05:** the broader audit of every artifact a flow RUN can actually produce
    (`_logs/<cycleId>/artifacts/*`, demo dirs) and owner assignment across that
    full surface — R3-06 only audited the DECLARATIVE template set
    (`studio/artifact-templates/`), not run-output artifacts. Also NOT landed: the
    flow builder's `ARTIFACTS` catalog is still hand-kept, not fetched from the
    registry — `AgentPalette`/`FlowBuilderCanvas`/`ArtifactPicker` (three
    flows-pillar components) consume it SYNCHRONOUSLY while rendering, and an
    async registry fetch would rewrite the `flows-author` journey; this is
    tracked as batch-C / R2-05 follow-on work. The CI-enforced parity test is
    what keeps the duplication non-silent in the meantime. **R2-05 (and F1)
    stays `planned`** — only this enforceable slice of F1 landed.
  - **R2-05-F2 Agent-authored surface contract.** An agent definition may declare an output surface: `{artifact: <template-id>}` (layout fixed, content agent-authored — today's model) or `{surface: composed, elements: [...]}` (layout AND content agent-authored from a typed element vocabulary, generalizing `studio/demo-elements/`). Rendering is sandboxed inside the `/artifact` viewer — agent-authored HTML never executes script outside the sandbox. ACs: schema in `orchestrator/studio/types.ts` + validation; one seed agent (demo path) migrated as proof; sandbox test (script injection attempt is inert).
  - **R2-05-F3 Flow-UI presentation of composed surfaces.** `/artifact` renders composed surfaces with a stable `data-*` contract (per-element `data-artifact-element` + kind), so journeys can assert structure not pixels. ACs: viewer handles both contract shapes; `journey-sync` run (flows-run journey).
- **Session sizing:** ~2 sessions — (1) F1 cleanup + promotion, (2) F2+F3 contract + viewer.
- **Out of scope:** re-grounding the dated seeded PLAN.html demo fixture (R5-06, known-gaps §4b.13); the demo agent's evidence policy (R4-07 / R1-03); plan-surface content quality (R4-05).

### R2-06 Runtime-adapter realization

- **Status:** planned  ·  **Wave:** 4 (as deps/provisioning land)
- **Depends on:** R2-01 (soft — the generic primitive should be adapter-agnostic from birth; light-up can start any time provisioning allows).
- **Depended on by:** — (differentiation proof; nothing structurally blocks on it).
- **Context:** ADR-029 built the seam; ADR-032 names the standing **realization gap**: no *running* non-Claude cycle. `gemini`/`aider` registered `available: false` (`loops/_adapters/registry.ts`); the Gemini tool executor is missing; per-adapter tier resolution is Claude-only (`orchestrator/model-range.ts`). A cross-adapter live cycle is operator-journey gap #12 and the "second adapter shipped" differentiation proof (`docs/forge-studio-market-and-differentiation.md`; memory: Forge Studio differentiation).
- **Features:**
  - **R2-06-F1 Gemini adapter live.** Implement the missing tool executor in `loops/_adapters/gemini/`, provision dep + creds, flip `available: true`; conformance suite (`loops/_adapters/conformance.ts`) passes against the real adapter. ACs: conformance green live; `available` truthfully reflects provisioning in CI (stays false there — existing `registry.test.ts` contract).
  - **R2-06-F2 Per-adapter tier resolution.** Generalize `orchestrator/model-range.ts` from Claude-tier escalation to an adapter-declared tier ladder (each adapter names its model tiers + costs in the catalog); strategy `fixed | range` works on any adapter. ACs: tier escalation unit-tested against a mock second adapter; Claude behavior unchanged.
  - **R2-06-F3 Aider adapter live.** Same treatment as F1 for `loops/_adapters/aider/` (binary + model key provisioning per its conformance-test note). ACs: conformance green live.
  - **R2-06-F4 Cross-adapter live cycle (the ADR-032 proof).** One real flow run executing dev iterations on a non-Claude runtime, selected purely by flow/agent data (`runtime.sdk`) — closing operator-journey gap #12; the `swap-runtime` journey gains a live-capable tier annotation (emulated beat stays the CI default). ACs: archived cycle log showing non-Claude adapter events; ADR-032 amended from "realization gap (live)" to proven; journey narration updated via `journey-sync`.
  - **R2-06-F5 subagentModel — note only.** `runtime.subagentModel` was de-cargoed (ADR-027 amendment 2026-06-16); it returns **only** if a measured cost/quality need meets that amendment's reintroduction condition. Recorded so nobody re-adds it casually; not a commitment.
- **Session sizing:** ~3 sessions — (1) F1+F2, (2) F3, (3) F4 live proof + docs. F1/F3 gated on operator provisioning creds (flag at session start).
- **Out of scope:** KB-backend second implementation (R1-02 owns the KbBackend seam); model-routing policy content in OOTB agents (R4).

### R2-07 Composition as the single authored source (split from R2-02-F2)

- **Status:** planned  ·  **Wave:** later (post wave-1; sequenced after R2-02 F1/F3/F4 land)
- **Depends on:** R2-02-F1 (the capability descriptor + on-the-wire schema); an **ADR-027 amendment** (its first feature).
- **Depended on by:** R4-01 *(soft — a single authored tool source simplifies the artifact migration, but R4-01's hard need is the R2-02-F1 descriptor, which lands in wave 1)*.
- **Context:** Split out of R2-02-F2 (operator-approved re-scope, 2026-07-18). The wave-1 R2-02 understand pass established that `composition.tools` (catalog CLI ids, e.g. `git`/`node`) and `allowed-tools` (SDK tool tokens, e.g. `Read`/`Bash`/`Edit`) are **disjoint vocabularies** with no translation function anywhere; `composition.tools` round-trips through save/spawn but drives nothing (`orchestrator/run-agent.ts` passes `spec.allowedTools` straight to the SDK), while `allowed-tools` is the enforced, hand-authored source. Making `composition` the single source is therefore an object-model / authoring-contract change (ADR-027), not a rename — it warrants its own design + ADR. Sources: ADR-027 (object model); ADR-024 (composition seam); the R2-02 understand pass.
- **Features:**
  - **R2-07-F1 ADR-027 amendment (first).** Decide the derivation model: either (a) redefine `composition.tools` to hold the SDK tool tokens directly (making it the single source; `allowed-tools` becomes derived; migrate every roster SKILL.md), or (b) declare, per catalog tool, the SDK tokens it grants (a catalog-id→SDK-token mapping) and derive `allowed-tools` from `composition` through it. Record the choice as an ADR-027 amendment with rationale (the disjoint-vocabulary finding is the motivating context).
  - **R2-07-F2 Derive + enforce.** The enforced allowed/disallowed tool set is **derived** from `composition` at spawn (via `PhaseAgentSpec`/`deriveAgentSpec`); `forge studio lint` (and the bridge PUT save path) errors when hand-written `allowed-tools` disagrees with the derivation (a conformance test proving enforcement == derivation). Migrate the roster (regenerate, then forbid hand-edits). One authoring surface in `/agents/[id]`.
  - **R2-07-F3 Builder single-authoring.** The agent builder authors `composition`; `allowed-tools` is shown as derived (read-only). `data-*` updated + `journey-sync` (agents journey).
- **Session sizing:** ~2 sessions — (1) F1 ADR-027 amendment + F2 derive/enforce/migrate, (2) F3 builder + journey-sync.
- **Out of scope:** the R2-02-F1 descriptor itself (lands wave 1); fanout/artifact capability facts (R2-03/R2-05).

### R2-08 Triggers runtime (per-project scoping + agent-complete + project events)

- **Status:** planned  ·  **Wave:** 5 (module: triggers-runtime) — operator decision 5, 2026-08-03: ONE successor initiative to R2-04, not per-kind slices
- **Depends on:** R2-04 (the 7-kind registry + HMAC webhook machinery this extends). **Depended on by:** R6-04 *(soft — kickoff renders F4's provenance)*, R6-01/R6-05/R6-06 *(soft — same, run detail + ledgers)*, R4-20 *(soft — on-completion chaining)*.
- **Context:** Wave-5 cut. The mockup makes triggers first-class **and per-project** (`TRIGGERS` in `data.jsx`): the same flow/agent triggers differently per project (`demo-runner`: "PR merged → refresh demo artifacts, per-project: betterado, gitpulse"; `issue-triage`: "issue raised → triage sweep, per-project: gitpulse"), agents chain on completion (`adversarial-review`: "auto — when the Developer node completes"; `brain-tune`: "auto — when a forge-develop run completes"), and every builder/kickoff/live-run surface shows what starts a run and what started THIS run. As-built (verified 2026-08-03 review pass; the ADR-041 state lives in R2-04's implemented-notes — R2-B4's original text predates it): `TRIGGER_KINDS` ships **4 kinds live** — `flow-complete | merged | cron | webhook`; `manual`, `agent-complete` and `feed` are **reserved rows** (parse ok, lint-error on use — `trigger-kind-reserved`, `orchestrator/flow-trigger.ts:29-46`). Agent-**target** dispatch is a different seam and is already LIVE — `startAgentRun` in `orchestrator/flow-run-requests.ts:181-183` is the production reflect path (`on: merged → target {kind: agent, ref: reflector}`); the file-header comment "throws until R4-09" (`flow-run-requests.ts:22`) is stale and retires here. Trigger declarations are flow-level with no per-project scoping. **Acceptance references:** mockup journeys `run-agent-demo-runner` (project-hook trigger), `run-agent-reflector` + `run-flow-brain-tune` (on-complete chain), `run-flow` (manual kickoff) — the 27-journey set deliberately covers all three trigger framings. **As-built baseline:** `as-built-inventory.md` §6.
- **Features:**
  - **R2-08-F1 Per-project trigger scoping.** A trigger declaration gains an optional `projects:` scope (list of project ids); dispatch honors it end-to-end — a scoped trigger fires only for events whose resolved project matches, and origination mints manifests only for in-scope projects. **Enforced at the dispatch point, mirrored by lint** (the standing declared-data-fails-open + defense-in-depth rules: the lint must read the same evidence the dispatcher does). ACs: a two-project fixture proves in-scope fires / out-of-scope doesn't; `forge studio lint` errors a `projects:` ref to an unknown project; the sweep never silently drops an out-of-scope request (typed skip event).
  - **R2-08-F2 `agent-complete` lit up.** The reserved trigger KIND becomes live: `runAgent`/`dispatchAgentRun` completion emits the trigger event; the registry routes it through the same claimable-queue + dry-bridge guard contract as every other kind (R2-04-F3 invariants extend, not fork). Agent-*target* dispatch needs nothing — `startAgentRun` is already live (see context). ACs: an `on: agent-complete` declaration targeting a flow demonstrably starts it under `forge serve`; harness-mode proves no real spawn; the stale "throws until R4-09" header comment in `orchestrator/flow-run-requests.ts` is deleted.
  - **R2-08-F3 Project-event kinds ("project hooks").** `pr-merged` / `issue-raised` (extensible provider-event rows) as typed rows over the existing webhook receiver — provider payload → typed event + resolved project, feeding F1's scoping. Corpus-ground the provider fixtures (the R2-04 lesson: invented GitLab shapes hid a 400-every-delivery bug). ACs: a signed PR-merged delivery for an in-scope project stages a run request; the injection fixture extends to the new payload fields; unshipped provider events stay schema-reserved, zero stubs.
  - **R2-08-F4 Trigger provenance recorded (data side only — corrected 2026-08-03 review pass).** A live/archived run records **what started it**: `trigger: {kind, source, scope}` in the run model — derived from the staged request, never free text — plus the standing-triggers read API surfaces need. **Rendering is NOT this feature** (one-module rule): kickoff screens render it in R6-04-F2, run detail in R6-01-F4, monitor ledgers in R6-05/R6-06 (each already cites this edge). ACs: run model exposes trigger provenance for all four shipped kinds + the F2/F3 additions; a documented read contract (`data-*` vocabulary named here, attached by the consuming surfaces); unit-tested derivation.
- **Session sizing:** ~2-3 sessions — (1) F1+F2 scoping + agent-complete; (2) F3 project events; (3) F4 provenance surfaces + journey-sync.
- **Out of scope:** new notification transports (R6-D1); the kickoff/run-consolidation surface itself (R6 wave-5 initiative — it renders what this initiative records); retiring the architect flow (R4-D1).

### R2-09 Agent-builder definition parity (instructions + materials)

- **Status:** planned  ·  **Wave:** 5 (module: agent-builder)
- **Depends on:** R2-02 (capability descriptor — materials ride it to kickoff surfaces). **Depended on by:** R6's kickoff initiative (consumes `materials` for upload validation).
- **Context:** Wave-5 cut. In the mockup **every agent carries operator-visible instructions** (`AGENT_INSTRUCTIONS` in `data.jsx` — the full behavioural charter, e.g. the developer's "never read the forge brain; the planner already encoded it") and an **allowed-input-materials declaration** (`AGENT_MATERIALS`: images | documents | audio | data files) consumed by kickoff upload surfaces. As-built: an agent's instructions live as SKILL.md prose the builder does not surface or edit (the builder authors frontmatter/composition; `as-built-inventory.md` §1), and no materials concept exists anywhere. Round-4/5 mockup rounds also assert instructions *generation* in the builder (draft-from-description assist).
- **Features:**
  - **R2-09-F1 `materials:` as a definition field.** SKILL.md frontmatter gains an optional `materials:` list (closed vocabulary, validated enum); parsed by `registry.ts` into `AgentDefinition`, folded into the R2-02-F1 capability descriptor (wire-visible), lint-validated. **The declaration must be enforced where materials enter** (kickoff upload accepts only declared kinds — the enforcement AC lands with the R6 kickoff surface, but the seam contract is defined HERE so it cannot fail open). ACs: roster agents declare honest materials (or none); lint rejects unknown kinds; descriptor exposes it; a documented enforcement contract names the upload seam as the enforcement point.
  - **R2-09-F2 Instructions surfaced + editable in the builder.** `/agents/[id]` renders the definition's instruction body (the SKILL.md prose) as a first-class editable field with a generation assist (draft instructions from the description + composition — assist output is a draft the operator confirms, never auto-saved). Save round-trips through the existing SKILL.md write path; `forge studio lint` unchanged (prose stays prose). ACs: edit → save → re-open round-trips byte-faithfully outside the edited region; generation produces a draft flagged as such; journey-sync (`create-agent`, `edit-agent` — the mockup journeys author instructions in-builder).
  - **R2-09-F3 Builder statefulness parity sweep.** Diff the as-built builder against the mockup's round-4/5 interaction assertions (click/drag-add, selector dropdowns, hooks zone binding per the R3-03 re-scope) and close what's real — a bounded parity checklist authored at session start from the `create-agent`/`edit-agent` journey scripts, each item either closed or explicitly rejected with a note. ACs: checklist in the PR description; journeys re-captured green.
- **Session sizing:** ~2 sessions — (1) F1+F2; (2) F3 sweep + journey-sync.
- **Out of scope:** kickoff upload UI (R6 wave-5 initiative); composition-single-source (R2-07); hook definition model (R3-03).

### R2-10 Interactive sessions surface (progressive staged-artifact host)

- **Status:** planned  ·  **Wave:** 5 (module: sessions-surface)
- **Depends on:** R2-01-F3 (the generic `forge agent run` CLI path + `spawnAgentTurn`, landed; the DEEP per-runner convergence stays deferred — this initiative re-opens only the **UI half**). **Depended on by:** R4-15/R4-16/R4-17/R4-19 (sessions render through this surface), R6-06 (monitor session-links target it).
- **Context:** Wave-5 cut. The mockup's sessions (`SESSIONS` in `data.jsx`; `views-session.jsx`) are ONE shared surface for every interactive agent: **chat left, living artifact right**, progressive turn-by-turn rendering, and **staged artifacts** — turns carry stage markers (`contract → instructions → secrets → demo → roadmap` in the onboarding/create-project sessions) and the artifact pane switches/accumulates per stage (roadmap draft, generation gallery 1→3, contract build-out, seeded brain structure, hook/skill package tabs). As-built (corrected 2026-08-03 review pass): **three** bespoke session pages — the architect interview, `/instructions/[sid]`, `/project-brain/[sid]` (`as-built-inventory.md` §1/§9); the **demo-builder is NOT a session page** — R1-03-F2 (landed 2026-07-24, operator-approved) folded it into the per-project page as the inline `DemoBuilderPanel`, and this initiative does not reverse that: its entry stays the project page, and its gallery surface is owned by R4-16 (which must render via this shell *in place* or record a reasoned exception — never silently re-detach the route). No stage vocabulary or shared artifact pane exists anywhere. This is the UI-side convergence R2-01-F3 deliberately did not attempt server-side — the phase-machines stay bespoke; the PAGES converge.
- **Features:**
  - **R2-10-F1 Shared session shell.** One session route/component set (chat pane, artifact pane, page-shell header) that all interactive agents render through, driven by the existing per-runner checkpoint files — no phase-machine rewrites; the shell adapts via a per-agent session descriptor (which artifact renderers, which stages). ACs: architect + instructions + project-brain sessions render through the shell with no behaviour change (journeys green); the three bespoke session pages deleted; the demo-builder's inline panel untouched here (R4-16 + the R1-03-F2 note above govern it); `data-*` contract for turns/stages/artifact pane.
  - **R2-10-F2 Staged-artifact contract.** A typed stage vocabulary per session kind (declared in the session descriptor, e.g. onboarding: `contract | instructions | secrets | demo | roadmap`); turns tag their stage; artifacts accumulate per stage and remain navigable after the session (the mockup's "everything you saw here lands on the project page" — the landing itself is owned by the consuming surface). ACs: stage markers render on turns; artifact pane switches with stage; an unknown stage tag is a lint/save error, not a silent default.
  - **R2-10-F3 Artifact renderers.** The artifact pane renders the mockup's artifact kinds: markdown/roadmap draft, contract build-out checklist, file-package tabs (skill/hook packages — shared with R3's detail pages), demo generation gallery, seeded brain structure. Reuse `/artifact` viewer machinery where it fits (ADR-031: one viewer family, not a parallel stack). ACs: each shipped session kind renders its artifact kind; package-tab renderer shared with R3-01-F3 (one component, two surfaces).
- **Session sizing:** ~3 sessions — (1) F1 shell + migration of one session kind; (2) remaining kinds + F2 stages; (3) F3 renderers + journey-sync.
- **Acceptance references:** mockup journeys `onboard-project`, `create-project`, `build-hook`, `build-skill` (session beats); surface `views-session.jsx`, `SESSIONS` + `CONTRACT_STAGES` in `data.jsx`.
- **Out of scope:** the deep phase-machine convergence (stays deferred per R2-01-F3's documented scope decision); session ENTRY consolidation (the one-Run-button initiative in R6); per-agent session content (R4).

## Deferred

### R2-D1 Parallel-work merge-resolution — CLOSED-REJECTED (2026-07-25, R2-03-F1 spike)

The R2-03-F1 research spike returned **NO-GO** (76 sources; every surveyed
system converges on isolate/order/decompose, not semantic merge-resolution) —
this ID closed as rejected per its own re-entry clause. The original
placeholder text is retained below as provenance; its re-entry conditions are
extinguished. (Staleness note added 2026-08-03 review pass.)

**Deferred placeholder (Q3-B locked).** No merge-resolution capability is designed until fanout evidence exists. **Re-entry condition:** the R2-03-F1 research-spike report is published in `docs/investigations/` **and** real fanout runs (post R2-03-F4) produce merge conflicts that the current scheduler merge-gate ordering (dependent initiative waits for prerequisite in `done/`, branches fresh from post-merge main — memory: dev-loop continuity scope) demonstrably cannot absorb, **and** the spike's recommendation is "build". If the spike recommends conflict-avoidance-by-decomposition instead, this ID closes as rejected with the report as rationale. Note: the retired unifier's dual-boundary full-suite gate is NOT this item — that strength relocates to orchestrator-owned gate execution (ADR-036 pattern; **for operator review**, see R2-01 context).

### R2-D2 Plan-band read-only parallelism (branch/join canvas semantics)

**Parked by operator decision 2 (2026-08-03 wave-5 cut).** The
studio-endstate-v2 mockup renders plan-band parallelism — a ⑂ branch after a
node, parallel read-only intake agents (Demo Design ∥ Research), typed
hand-offs, a join node waiting for all inputs, band rule enforced
(plan/develop = any lines, review/reflect = one line). This is explicitly NOT
R2-D1 (no code merge is involved — the parallel outputs are documents joined
as developer inputs), but the operator parked it: the forge-develop flow stays
linear, the mockup's branching beats and the two example agents (`demo-design`,
`research` — `provenance: 'vision'` in the mockup) stay vision-badged.
**Re-entry condition:** the operator re-opens it explicitly; natural evidence
would be a real initiative where pre-developer intake work (demo scripting,
prior-art research) demonstrably bottlenecks the linear flow.

## Change log

- 2026-07-17 — Roadmap created (initial forge-dev roadmap planning session). Locked inputs: Q1 (five living roadmaps), Q3-B (unifier retired; fanout research-first; merge-resolution deferred → R2-D1), Q6-A (wave order: R2-01/R2-02 in wave 1). Cross-roadmap edges recorded: R4-01 ← R2-01,R2-02 · R4-06 ← R2-03 · R2-D1 ← R2-03 evidence.
- 2026-07-17 — Adversarial-review amendment pass. R2-B4 + R2-04 corrected against as-built (drain live, producer/generic-dispatch missing — A2); R2-01-F1 input becomes an extensible RunContext with SWE bindings as OOTB kinds + unbound-run AC (D3); R2-01-F2 gains the phase-slug kind-mapping ownership split (deletion = R4-01-F2, unifier special case until R4-01-F4 — A5) and the gate-kinds-from-flow-data principle (D4); R2-02-F1 descriptor typed, `gate-emitting`/`trigger-compatible` dropped (operator decision 2: gates/triggers are flow-level; no agent-as-sometimes-gate); R2-03-F2/F4 isolation as provider enum + named extraction seam (D5); R2-04-F2/F3 gain agent-target/state-transition extension (D7/E1), domain-event-rows note (D8), and the live content-trust posture (HMAC, source allowlists, typed-payload isolation, injection fixture — E6). Edges added: R2-01 ← dep-by R4-02/R4-05.
- 2026-07-18 — **R2-01 implemented** (branch `feat/r2-01-agent-as-runnable`): the agent-as-runnable primitive shipped — F1 `runAgent` + F2 definition-driven flow-node resolution (`executor:` frontmatter replaces `AGENT_KIND`, generic `execAgent`, `execUnknown`→error) + F4 monitor attribution for generic-agent nodes + F5 `surface` enum + F3a/F3b generic `forge agent run` CLI (`cli/agent-run.ts`) + `spawnAgentTurn` collapse; status planned → implemented, as-built in R2-B8. **F5 AC amended** (surface = the validated categorical; interactivity stays prose). **F3 partial** — the deep per-runner phase-machine convergence deferred with rationale. Six per-task reviews (spec+quality; F1 security) + a 4-lens adversarial whole-branch review (opus) + re-run integration/security lenses: **zero merge-blockers**. As-built follow-ups (all latent, unreachable in shipping content) in known-gaps §8. R2-01's dependents (R2-02, R4-01/02/05, R2-04/05/06) are now unblocked.
- 2026-07-18 — **R2-02 re-scoped (operator-approved) + R2-07 minted.** The wave-1 R2-02 understand pass found `composition.tools` and `allowed-tools` are disjoint vocabularies, making F2's composition-single-source an ADR-027 object-model change (not a rename). Per the escalation contract, **R2-02-F2 splits out to R2-07** (composition as the single authored source; ADR-027 amendment first). **Wave-1 R2-02 = F1** (server-computed capability descriptor on the wire) **+ F3** (builder interactive-placement gating via the descriptor, surfacing the existing `node-executor` lint) **+ F4** (readiness truthfulness). `{runtimeSdks}` clarified as a surfaced fact (SDK picker stays global-adapter-gated); F3 needs no surface-editing UI.
- 2026-07-18 — **R2-02 implemented** (branch `feat/r2-02-def-driven-builder`): the agent-def-driven builder shipped — F1 server-computed `{interactive, runtimeSdks}` capability descriptor threaded onto the agents **and** starters wire (parsed verbatim client-side; the `node-executor` lint rerouted through the same derivation) + F3 BUILD-tab interactive-placement gating (palette `data-chip-placeable` + canvas `canvas-drop-reject`, over the R2-01-F2 `node-executor` save-lint backstop) + F4 descriptor-sourced readiness (`runtimeSdks.length > 0`, informational `[data-capability-interactive]` chip); status planned → implemented, as-built in R2-B9. **F2 split to R2-07** (composition-single-source = an ADR-027 object-model change — disjoint tool vocabularies). `journey-sync`: flows-author + agents. Whole-branch review (opus): zero merge-blockers. Gates green (2157/2157 under `FORGE_ARCHITECT_NO_SPAWN`, forge-ui 91/91 vitest, tsc clean). R4-01's capability-schema dependency is now satisfied by R2-02-F1.
- 2026-07-25 — **R2-04 implemented** (branch `feat/r2-04-triggers`, wave-4
  session 4 pairing, stacked on `feat/r4-08-f2-sendback-loop`; **ADR-041** +
  ADR-027 triggers-schema amendment). F1 generic per-flow claimable enqueue
  (`enqueue-flow-run.ts`; `enqueue-develop-run.ts` delegates); F2 the
  `TRIGGER_KINDS` registry (7 kinds, reserved rows lint-rejected with zero
  stubs; `complete`→`flow-complete`), `FlowTrigger` `{on, target, …config}`
  reshape with one-shot seed migration, shipped **cron** (scheduler-armed
  croner, stage-only fire) + **webhook** (`POST /api/hooks/:hookId`, raw-body
  HMAC via `@octokit/webhooks-methods` / gitlab `timingSafeEqual`, fail-closed
  503, mandatory source allowlist, CSRF-exempt-by-structure, dry-bridge
  `exempt-local`), origination minting `origin: 'triggered'` initiatives with
  config budgets, and the R4-09 agent-target seam (throws, request retained);
  F3 queue-only-dispatch guard tests + typed-payload isolation (known-gaps §8
  `buildAgentPrompt` rider CLOSED) + `journey-daemon-guard` flow-runs stray
  refusal; F4 trigger authoring UI (kind selector + per-kind fields; the seed
  `merged` trigger is now authorable) + library badges + journey-sync. Deps
  added research-first: `croner`, `@octokit/webhooks-methods` (0-dep each).
  Status planned → implemented. ⚑ operator notes: LAN-reachable webhook
  endpoint (fail-closed HMAC covers; public exposure = ops), minted-run budget
  defaults ($10/30) are a spend-policy proposal. **MERGED 2026-07-25 on operator
  close-out — PR #48 @ `06035180` (stacked on #47; rebased conflict-free onto the
  merged base, retargeted to main, merged, branch deleted).** Whole-branch
  52-agent review over the combined branch surfaced 10 confirmed findings (all
  fixed in-branch); banked lessons in memory `project_forge_dev_roadmap_set.md`
  S4 entry: (1) the workflow's aggregated `surviving` set dropped 4 real findings
  after a session-limit resume — reconcile the journal UNION, never trust the
  aggregate alone; (2) model-switch mid-Workflow works (Fable→Opus + resume);
  (3) a defense-in-depth gate must read the SAME evidence as the UI it backstops;
  (4) declared-data-fails-open struck again (cron `concurrency` enforced nowhere);
  (5) corpus-ground provider fixtures (invented GitLab shapes hid a 400-every-delivery
  bug); (6) a pre-auth 0.0.0.0 route must be structurally never-throw.
- 2026-08-03 — **Wave-5 cut (studio-endstate-v2 mockup → modular backlog).**
  **R2-08 minted** (triggers-runtime, operator decision 5: one successor
  initiative — per-project scoping, `agent-complete` lit, project-event kinds
  pr-merged/issue-raised, trigger provenance on run surfaces). **R2-09 minted**
  (agent-builder definition parity: `materials:` frontmatter + descriptor
  threading, instructions surfaced/editable/generatable in the builder,
  round-4/5 statefulness parity sweep). **R2-10 minted** (shared interactive
  sessions surface: one chat+artifact shell, staged-artifact contract,
  artifact renderers — the UI half of the R2-01-F3 convergence, phase-machines
  untouched). **R2-D2 added** (operator decision 2: plan-band read-only
  parallelism + the demo-design/research example agents PARKED, vision-badged;
  distinct from the rejected R2-D1). All wave-5 entries cite mockup journey
  ids + `as-built-inventory.md` baselines.
- 2026-08-03 — **Adversarial-review corrections (PR #71 review pass).**
  R2-08 baseline rewritten to verified state (4 kinds live; `manual`/
  `agent-complete`/`feed` reserved; agent-target dispatch already live via
  `startAgentRun` — stale `flow-run-requests.ts` header comment retires in
  F2); R2-08-F4 shrunk to provenance recording (rendering owned by
  R6-01/04/05/06); R2-10 as-built corrected (3 bespoke session pages; the
  demo-builder is the R1-03-F2 inline panel, not re-detached); R2-D1 marked
  closed-rejected; both-sides reverse edges added on R2-01/02/04/05/08/10.
- 2026-08-04 — **R2-05-F1 enforceable slice landed (R3-06, branch
  `feat/r3-06-templates-library`)** — the two roadmaps share this substance
  per R2-05's own soft-dependency note, decided at session start rather than
  auditing twice. `validateArtifactRef` promoted advisory → error; the flow
  builder's `ARTIFACTS` catalog lost its two orphan entries (`reflection`,
  `demo`) and is now pinned to the on-disk `studio/artifact-templates/` id
  set by a CI-enforced two-way parity test; the canonical 7-template set is
  documented in `studio/artifact-templates/README.md`. **Deliberately NOT
  landed, stays with R2-05:** the broader audit of run-output artifacts
  (`_logs/<cycleId>/artifacts/*`, demo dirs) and their owner assignment; the
  flow builder still hand-keeps `ARTIFACTS` rather than fetching it from the
  registry (`AgentPalette`/`FlowBuilderCanvas`/`ArtifactPicker` consume it
  synchronously — an async fetch would rewrite the `flows-author` journey —
  tracked as batch-C / R2-05 follow-on). **R2-05 and R2-05-F1 both stay
  `planned`** — only part of F1 landed, not the whole feature.
