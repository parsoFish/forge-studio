# 043 — The generic interactive-surface primitive

- **Status:** Accepted (2026-08-10, operator) — amended 2026-08-11 (migration commitment re-homed to R4-23), 2026-08-14 (R4-23 close: architect never migrates, mirror deleted, net-decrease corrected), 2026-08-15 (wave-6: interaction panel un-deferred, `panel.phases`, kickoff model tier), 2026-08-19 (wave-7 A2: derived lifecycle, universal `cancelled`, reachable write-root fence), 2026-09-03 (M4 ruling 60: the bespoke runners port as registered step-handler variants, not as data)
- **Date:** 2026-08-10
- **Supersedes / amends:** Amends [ADR 042](./042-surface-cap-scope-and-testability.md) (the orchestrator surface cap) by ratifying a single sanctioned extension seam. Builds on [ADR 024](./024-phases-as-subagents-invoking-skills.md) (agent composes skills; `SKILL.md` as runtime prompt) and [ADR 039](./039-ships-as-artifact.md) (the flow-runner executor registry — which this ADR deliberately does **not** extend).
- **Related roadmap:** `docs/roadmaps/R4-ootb-suite.md` — R4-21 (OOTB authoring agent) is consumer #1.

## Context

Forge has grown **four bespoke interactive-turn runners**, one per interactive session kind:

- `orchestrator/architect-runner.ts` — architect (idea → interview → council → draft → promote manifests).
- `orchestrator/instructions-runner.ts` — instructions (compose `AGENTS.md` from vetted seed blocks).
- `orchestrator/demo-builder-runner.ts` — demo-builder (rich-HTML demo + snapshot-restore lock).
- `orchestrator/project-brain-builder-runner.ts` — project-brain (commit themes to the central brain).

They are dispatched through one registry, `AGENT_RUNNERS` in `packages/agents/agent-run.ts:67`, wired by `cmdAgentRun`. Each runner independently re-implements the same spine: the SEC-04 containment preamble (`resolveGuardedPath(projectRoot, [kindDir, sessionId])` → `guardedReadSessionStatus`), the ADR-024 spec/model/prompt derivation (`deriveAgentSpec(skillPathRelative(agent))` → `modelForSpec` → tool grant, `SKILL.md` as the runtime prompt), the near-duplicate helpers (`loadSkillPrompt` cache, a 400-char reasoning sink, `write<X>Status`), telemetry (`makeToolEventSink`, `createLogger`, `flushIteration(1)`), and a per-phase dispatch loop. Only the **finalizer** and a handful of phase transitions genuinely differ per kind.

The read half of an interactive session is **already fully generic** over data. `orchestrator/studio/session-kinds.ts` holds the `SessionKindDescriptor` type (`id`, `agent`, `title`, `stages`, `defaultStage`, `artifact`), authored as rows in `studio/session-kinds.yaml`; the route, the transcript derivation (`deriveSessionTranscript` in `orchestrator/studio/session-transcript.ts`), and the artifact pane all consume the descriptor with no per-kind code. The **producer/state-machine half is the only thing still hand-written per kind** — and it is the half `AGENT_RUNNERS` captures.

This recurrence has surfaced three times as a park against the ADR-042 surface cap: each new interactive kind wants to add a runner (a new orchestrator symbol), and each time the honest answer has been "the cap says don't grow `orchestrator/` — park it, or ask." R4-16 (generation-gallery), R4-17 (contract-buildout), and now R4-21 (authoring agent) have each re-litigated the same disclose-not-park question. The cap is doing its job — it is catching real surface growth — but the growth is **the same shape every time**, which is the signature of a missing generalization, not four separate justified exceptions.

The operator vision (studio end-state mockups, wave-5 batch plan) asks for interactive surfaces that are:

- **operator-authorable** — the operator designs a new interactive kind as data, not by writing a runner;
- **artifact-like** — an interactive surface is an input/output object the same way a produced artifact is (it *derives* its affordances the way the artifact pane *derives* its view);
- **multi-instance** — N sessions of the same kind coexist.

R4-21 is the forcing function: its infrastructure — `skills/creation-agent/SKILL.md`, the `authoring` descriptor row, the `file-package` artifact (reserved→live), the transcript plumbing, and a save route — is **already built and green on `feat/r4-21-authoring-agent`**. What it lacks is a home for its *turn execution* that is not "add a fifth entry to `AGENT_RUNNERS`," i.e. not another per-agent cap park.

## Decision

Ratify, **as a one-time generalization**, a declarative interactive-surface primitive and a single generic runner that together dissolve the per-runner cap park. This ADR is the sanctioned extension seam ADR 042 §"pure function with an explicit error contract may be exported" contemplates — scaled up from one function to one spine — so that **future interactive kinds are authored as data and never re-open the cap question**.

### 1. The primitive — one additive-optional `turnSpec` field

Extend `SessionKindDescriptor` (`orchestrator/studio/session-kinds.ts`) with a single additive-optional field, `turnSpec`, authored as part of the existing yaml row. This is the missing producer/state-machine half; the read half is unchanged.

```yaml
- id: authoring
  agent: creation-agent
  title: Create a Studio Object
  stages: [authoring]
  defaultStage: authoring
  artifact: { kind: file-package, label: "Created object" }   # already reserved→live on R4-21
  turnSpec:
    kindDir: _authoring            # SEC-04 guard root; the one containment segment
    style: agent                   # structured | agent → picks runStructuredTurn vs runAgentTurn
    phases:
      - { phase: analyzing,       step: agent,    writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
      - { phase: committing,      step: finalize, finalizer: copyStagingToLibrary, next: committed }
      - { phase: committed,       step: terminal }
```

Discipline (adopted from the frozen-registry pattern already in `session-kinds.ts` — `SESSION_ARTIFACT_KINDS` / `sessionArtifactKindState`):

- `style`, `step`, `finalizer`-id and `schema`-id each resolve against a **deep-frozen vocabulary with a total lookup fn**. Unknown values are rejected by `validateSessionKinds` with an error that **names the offending value AND the allowed set**.
- `loadSessionKinds` stays **purely structural** (the AT-16 split): it parses `turnSpec` as data and validates nothing semantic. All semantic enforcement lives in `validateSessionKinds` only.
- **Affordances are derived, not authored.** A `structured` interview phase ⇒ a question-form affordance; an `awaiting-*` phase ⇒ a verdict/review affordance; a staging `writes:` ⇒ a staged-file review affordance. One field; the affordances fall out of the phase table — mirroring how the artifact pane derives its view from `artifact.kind`.

### 2. The single generic runner — `orchestrator/interactive-runner.ts`

```ts
runInteractiveTurn(
  descriptor: SessionKindDescriptor,
  ctx: { sessionId; projectRoot; forgeRoot?; queryFn?; logsRoot?; logger? },
): Promise<{ phase: string; wrote: string[]; artifacts: Record<string, string> }>
```

Owns **once** everything the four runners duplicate: the SEC-04 containment preamble, the ADR-024 spec/model/prompt derivation, the shared helpers, the telemetry, and the dispatch loop (read `status.phase` → look up the phase row → run the declared `step` via the `style` primitive or the named finalizer → advance to `next`). This is a **new orchestrator symbol** and is disclosed as such (see Consequences — transient growth).

### 3. Migration-safety keystone — the dispatch **fork**, not deletion

`cmdAgentRun` (`packages/agents/agent-run.ts`) forks on the presence of `turnSpec`:

```ts
const descriptor = loadSessionKinds(forgeRoot).find((d) => d.id === agentId);
if (descriptor?.turnSpec) return runInteractiveTurn(descriptor, ctx);   // new spine
return AGENT_RUNNERS[agentId](ctx);                                     // 4 legacy paths, byte-for-byte untouched
```

`AGENT_RUNNERS` and the four runners stay **byte-for-byte identical** in the bridge scope. Only descriptors carrying `turnSpec` (initially just `authoring`) take the new road. The registry shrinks by one **as each runner migrates in batch E**, and `AGENT_RUNNERS` is deleted only after architect migrates. No big-bang cutover.

### 4. Two hosts, code-enforced twins

`resolveDispatchableAgent` (`orchestrator/agent-dispatch.ts:81`) is **UNCHANGED**: the one-shot generic host must keep refusing interactive agents (`… is interactive (surface: …) — interactive agents run through their bespoke session page, not the generic run host`). Softening that refusal is the single change that would break the boundary this whole design rests on. Add its mirror, `resolveInteractiveAgent(slug, defs)`, which accepts **only** interactive defs and throws the symmetric boundary error otherwise. Two data-driven hosts, each refusing exactly what the other accepts.

### 5. Finalizers — the real bespoke residue (ADR-042's third boundary, verbatim)

A deep-frozen `FINALIZERS` registry of **pure exported functions with explicit error contracts** — the ratified ADR-042 shape (a pure function with an explicit error contract, exported for direct tests). The full set, seeded incrementally:

- `promoteToQueue` — architect (`promoteManifests` + `mintAndPersistManifestCycleId`)
- `writeToRepoRoot` — instructions (`withStudioWrite`)
- `commitToCentralBrain` — project-brain (copy-themes + `regenerateBrainIndex`)
- demo's snapshot-restore lock
- `copyStagingToLibrary` — creation/authoring

Each finalizer **keeps its own realpath/containment guard intact** (`isAllowedSkillRelPath`, `kbId`-as-guarded-segment, the AT-43..45 ratchets). The generalization is of the *shape* only — never the containment ratchet.

### 6. How the vision is honored (as staged capability, not all in the bridge)

- **Function** = author `turnSpec.phases` as data.
- **Look** = pick `artifact.kind` from the frozen registry (reserved→live promotion adds a renderer).
- **Multiple kinds** = multiple yaml rows (the registry is a sequence).
- **Multiple instances** = already free: the bridge resolves `<project>/_<kindDir>/<sessionId>`, so N sessions of a kind coexist today, and `runInteractiveTurn` inherits per-`sessionId` isolation unchanged.
- **Operator-authorable UI** and **multi-instance management** are named here as the *destination* but are **deferred to batch E** (see the plan). The bridge lands the data model and the runner; the authoring UI rides later.

## Consequences

**The cap is dissolved for interactive runners.** After this ADR, a new interactive kind is a yaml row plus (if genuinely novel) one frozen-registry entry — not a new `orchestrator/` symbol. The recurring per-runner ADR-042 park is **replaced by this one ratified generalization**: future interactive kinds cite ADR 043 and add data; they do not re-open the cap question or ask per-agent permission.

**Honest note on transient surface growth.** This ADR does **not** deliver a net surface decrease at bridge time. The bridge *adds* `interactive-runner.ts` + the `FINALIZERS`/schema registries while removing **zero** runners (all four stay untouched). Orchestrator surface therefore **transiently grows**; the net decrease is realized only after the batch-E migrations delete the four runners and finally `AGENT_RUNNERS`. This ADR explicitly commits those batch-E migration steps so the promised shrink is real, and requires the registries to stay closed, small, and frozen. Per-kind fields must not creep onto `turnSpec` — that would re-import the very per-kind surface being dissolved.

**The four runners refactor onto the primitive, staged and regression-safe.** Because of the dispatch fork, migration is one runner per one-concern PR, each shrinking `AGENT_RUNNERS` by one, each gated by a golden-capture of that runner's turn output taken *before* the swap. Order: **instructions first** (it already uses a shared structured turn — the cleanest proof, least new code), then **demo + project-brain** (builder-shape), then **architect last**.

**Architect stays a named structured step-handler variant, not pure data.** Architect carries brain-first planner prompt injection, three *different* structured sub-turns (interview/explore/draft) via a local `runStructured` predating the shared one, a fail-open `exploring` step, a forced-emit retry (`orchestrator/architect-runner.ts` ~L912–943), and a completeness-critic bounce-back. That is branching control flow, not a linear phase table. Tabling it would silently lose the retry and fail-open behaviors. Architect migrates last and remains a **registered step-handler variant** (an honest partial), with golden-capture mandatory before swapping its local `runStructured` for the shared `runStructuredTurn`. Architect also stays outside the ADR-039 flow-runner executor registry.

**Creation-agent is consumer #1, on pure data.** R4-21's descriptor, skill, artifact, and save route already exist on `feat/r4-21-authoring-agent`; this ADR gives its turn execution a home on `runInteractiveTurn` instead of a fifth `AGENT_RUNNERS` entry. Its acceptance is **route-resolves ≠ feature-works**: the gate is a real created package landing in the library via `copyStagingToLibrary` with containment intact, not "`cmdAgentRun` resolved the descriptor."

**The interaction-panel genericization is a declared new sink and is deferred.** A future generic `POST …/sessions/:kind/:sessionId/:affordance` write endpoint turns operator-supplied path segments into filesystem writes — the `adversarial-containment-review` class (SEC-04/05, the request-path-sinks baseline). It also risks the recurring declared-data-fails-open trap: a generic summary payload that drops a field a bespoke panel surfaced. It is **out of the bridge**. When built (batch E), every path routes through the `resolveGuardedPath`/`guardedReadDir` choke point with the `isSafeRunId` ratchet, fails **loud** on an unknown affordance (an `UnhandledAffordanceBody` mirroring the existing `UnhandledArtifactBody`), and is gated by the sessions journey so a dropped affordance breaks the gate rather than rotting the demo (a `journey-sync` obligation).

**`onboarding` is explicitly out of scope.** It runs through `forge agent dispatch` + `writeSessionTerminalPhase` — a different path. This ADR does **not** claim "one runner for all interactive kinds" until onboarding is folded in (as a `session-only` variant) or declared permanently separate. That is a batch-E decision.

## Amendment — 2026-08-11 (batch-E close): the migration commitment is re-homed, not kept

The batch-E migration pass **measured** (probes driving `runInteractiveTurn` against each runner's WI-0 golden-capture scenario — `_wave5/parks/R4-22-F4-runner-migrations.md`) that **none of the four runners is expressible on the primitive as written**: the spine generalises the plumbing, but the majority of each runner is per-kind prompt/state composition for which `turnSpec` has, by this ADR's own discipline, no seam. Consequences, as ruled by the operator:

- A `STEP_HANDLERS`/prompt-builder registry (the shape §Consequences contemplated for architect) was proposed and **refused** — no new orchestrator surface.
- The "batch-E migration steps" this ADR committed are **re-homed to R4-23** (`docs/roadmaps/R4-ootb-suite.md`): re-author each runner's composed prompt into its agent's `SKILL.md` (ADR-024's thesis) and accept **live** per kind — a golden byte-match cannot gate a prompt that changes by design.
- The honest surface accounting: batch E's net production deletion from the migration path was **zero**. The transient growth this ADR disclosed stands; the promised net decrease is **owed via R4-23**, and it is smaller than the original text implied because the spine-owned plumbing is a minority of each runner's lines.
- The dispatch fork and the four untouched runners remain the standing state — verified byte-identical behind the fork at batch-E close (`_wave5/batch-e-exit-disposition.md`).

## Amendment — 2026-08-14 (R4-23): architect is never migrated, the mirror is deleted, and the owed decrease is not what this ADR implied

R4-23 (bead `forge-lt4`, wave-5 batch H) executed the re-authoring the 2026-08-11 amendment re-homed. It re-authored all four legacy runners' composed prompts into their agents' `SKILL.md` files as `<!-- turn: <id> -->` sections behind one shared loader (`loadSkillTurnPrompt` / `splitSkillTurnSections`, `orchestrator/skill-path.ts`), with **live per-kind acceptance** — one real spawn per runner producing a real artifact (`_wave5/gate-logs/R4-23-live-{instructions,demo-builder,project-brain,architect}.log`). Three things this ADR left open are now closed.

### 1. §3 corrected — `AGENT_RUNNERS` is NOT deleted, and architect is NEVER migrated onto the primitive

§3 says *"`AGENT_RUNNERS` is deleted only after architect migrates."* That sentence is retired. Architect is **never** migrated onto `turnSpec`, and `AGENT_RUNNERS` therefore survives, deliberately, with its four entries. The reasoning is the F4 measurement pass's recommendation (`_wave5/parks/R4-22-F4-architect-migration.md` §3), adopted here:

- The cap-dissolution goal §Consequences claims is **already fully achieved without architect**. Since PR #117/#118 a new interactive kind is a yaml row — `authoring` proved it live. Migrating architect adds **zero** cap-dissolution value; it is pure surface accounting.
- Architect's four load-bearing behaviours — brain-first prompt injection (ADR-010 makes it *mandatory* for a planner), the fail-open `exploring` step, the forced-emit retry, and the completeness-critic bounce-back — all fire only on paths a happy-path golden fixture never reaches. A migration's own gate would be structurally blind to exactly what it might break.
- The honest cost of keeping it is one registry with four entries and one legacy branch in `packages/agents/agent-run.ts` — `cli/` is not capped by [ADR 042](./042-surface-cap-scope-and-testability.md) at all.

R4-23 still re-authored architect's *prompts* (the ADR-024 axis is orthogonal to the primitive), and the live run measured no degradation: the brain-navigation index stayed byte-identical and first in all three prompts, the interviewing → exploring → drafting fall-through executed in one invocation, and the plan it produced carried five cited brain themes, seven `source:`-attributed constraints, twelve enumerated edge cases and ten GWT acceptance criteria. The pre-authorised park was **not** taken.

### 2. §4 corrected — `resolveInteractiveAgent` is DELETED, not kept as a twin

§4 says *"Add its mirror, `resolveInteractiveAgent(slug, defs)`."* That mirror never gained a production caller: on main it was referenced only by its own throw strings and its tests (bead `forge-4y7`). ADR-042's cap forbids dead exported orchestrator surface, so R4-23 deleted it. Wiring it was not merely undone but **not dischargeable**, measured: `skills/architect/SKILL.md` declares no `surface:` at all and `skills/project-brain-builder/SKILL.md` declares `surface: unattended`, so an interactive-only host would refuse two of the four session kinds it was meant to admit; and `AGENT_RUNNERS`' keys are session-kind ids, not agent slugs, so there is no 1:1 roster lookup to perform. The sharpest evidence is now pinned in `orchestrator/agent-dispatch.test.ts`: the **real roster contains zero interactive defs**, so the mirror accepted nothing on the live roster for its entire life.

`resolveDispatchableAgent` — §4's one non-negotiable — is left byte-for-byte untouched, and the complement property the pair was meant to guarantee is now asserted directly against the one shared predicate both hosts were required to use, `agentCapabilityDescriptor(def).interactive`. It goes red on purpose if an interactive agent ever enters the roster, which is the trigger to revisit this deletion.

### 3. The owed net decrease — MEASURED, and it is an INCREASE

This ADR's §Consequences promised that the transient orchestrator growth would be repaid by the migrations. The 2026-08-11 amendment already reduced that promise to *"smaller than the original text implied"*. R4-23's measurement closes it honestly: on the prompt-re-authoring axis there is **no net orchestrator LOC decrease at all**. Measured on `orchestrator/` production files, base `c45e3892` → R4-23:

| file | net |
|---|---|
| `orchestrator/architect-runner.ts` | −28 |
| `orchestrator/instructions-runner.ts` | −27 |
| `orchestrator/demo-builder-runner.ts` | −26 |
| `orchestrator/agent-dispatch.ts` (mirror deleted) | −12 |
| `orchestrator/project-brain-builder-runner.ts` | −5 |
| `orchestrator/skill-path.ts` (the shared turn-section loader) | **+208** |
| **net** | **+110** |

Why, plainly: the ~403 lines the F4 park named as realizable were **spine-owned plumbing** on the *migration* axis — and no runner migrated, so none of it was removed. On the *re-authoring* axis what leaves `orchestrator/` is prompt PROSE, and prose leaves TypeScript for markdown (`skills/*/SKILL.md` grew by ~128 lines net) rather than disappearing. The mechanism that makes a `SKILL.md` per-turn selectable — marker splitting with fenced-block awareness and duplicate-id rejection, a fail-loud loader with three named error paths, and a default-path cache — costs more lines than the four runners shed, even though it replaced four private `loadSkillPrompt` copies.

The exported-symbol accounting is the smaller story and is nearly flat: **+2** (`splitSkillTurnSections`, `loadSkillTurnPrompt`) **−1** (`resolveInteractiveAgent`) = **+1**, alongside four private duplicate helpers deleted.

**So the promise is discharged as a correction, not a payment: ADR-043's implied net orchestrator decrease is not collectable, and no future initiative should be planned on the assumption that it is.** What R4-23 actually bought is the thing ADR-024 asked for and the LOC metric does not show — the agents' *intent* now lives in exactly one place. Before this change every one of these four agents was driven by two prompts: its `SKILL.md` and a second, hand-written TypeScript prompt appended after it, with the TypeScript half winning. That duplication is gone.

### 4. One disclosed consequence of the fail-loud contract

The four runner-private `loadSkillPrompt` helpers failed **open** (`catch { return 'You are the forge <x> agent.' }`). That was survivable while the skill file was only a preamble; now that the task instructions live in `SKILL.md`, a fallback would launch an agent with no task and no signal — the declared-data-fails-open antipattern — so the shared loader throws instead, naming the skill, the turn id and the available ids. The disclosed cost: `cmdAgentRun` (`packages/agents/agent-run.ts`) does not wrap the turn call, and the bridge spawns it as a detached child, so a throw on this path leaves the session's `status.json` at its pre-turn phase with the trace only in `_logs/<cycle>/stderr.log`. That wedge mechanism predates R4-23 (the "produced no theme files" throw has the same shape); R4-23 widens the set of triggers rather than creating it. Writing a terminal `failed` phase on this path is tracked separately and is deliberately not folded into this PR.

## Amendment — 2026-08-15 (wave-6 daily-driver): the interaction panel is un-deferred, and the operator picks a model tier at kickoff

Ruled by the operator in the wave-6 planning interview (plan: wave-6 "Daily-Driver", 2026-08-15). Four changes, none of which touch the dispatch fork or the four legacy runners.

### 1. §Consequences "declared new sink … deferred" is un-deferred — to its own spec, verbatim

The generic interaction panel and the `POST /api/studio/sessions/:kind/:sessionId/:affordance` write endpoint are now built (wave-6 batches B3/B4/B6), exactly under the constraints the deferral paragraph pre-committed: every path through the `resolveGuardedPath`/`guardedReadDir` choke point with the `isSafeRunId` ratchet; unknown affordances fail loud via `UnhandledAffordanceBody` (mirroring `UnhandledArtifactBody`); the endpoint lives in `cli/` (not capped, per ADR 042); `adversarial-containment-review` gates the build; the sessions journeys gate every affordance so a dropped one breaks the gate rather than rotting the demo.

Affordances stay **derived, not authored** (§1 discipline): the shell read route computes an `affordances[]` view server-side from the phase table; the client renders what it is handed and never re-derives.

### 2. `panel.phases` — the read-half twin of `turnSpec`, for the legacy kinds

The four legacy kinds (and `onboarding`) have no `turnSpec`, and routing them through one is forbidden by the 2026-08-11 amendment (their backends stay on `AGENT_RUNNERS` / dispatch). But their *panels* need the same derived affordances. `SessionKindDescriptor` gains one additive-optional field, `panel`, whose `phases` rows use the **same deep-frozen phase-row vocabulary** as `turnSpec.phases`:

- Consumed **only** by affordance derivation (the read half). The `cmdAgentRun` fork condition remains `turnSpec` presence — `panel` is invisible to dispatch, by validated exclusivity: `validateSessionKinds` rejects a descriptor carrying both `turnSpec` and `panel` (one error, naming the kind and both fields).
- Same AT-16 split: `loadSessionKinds` parses structurally; all semantic checks live in `validateSessionKinds`.
- This resolves the batch-E open question on `onboarding` at the UI layer only: it gains a `panel` row (its dispatch path is untouched and stays out of this ADR's scope).

### 3. Kickoff model selection — a tier choice *within* the SKILL-declared envelope

New requirement (operator, wave-6): pick the model at session kickoff. The seam honors ADR 024 — `SKILL.md` remains the sole source of intent AND the capability envelope:

- `runtime.strategy: range` derivation already states that escalation is applied at spawn time (`orchestrator/studio/derive.ts`); this amendment ratifies the operator as one source of that spawn-time choice.
- Kickoff writes `modelTier` into the session's `status.json` (the session dir is already the SSOT for session-scoped state; no CLI flag, no argv change).
- One pure exported fn, `resolveSessionModel(spec, requestedTier?)` (beside `modelForSpec` in `orchestrator/phase-agent.ts`), validates `requestedTier` against the SKILL-declared range — or equality with a fixed model — and throws naming the value and the allowed set. This is the ADR-042 ratified pure-function boundary; it is the only orchestrator surface this amendment adds.
- A skill with `strategy: fixed` renders a read-only model chip; widening a skill to `range` is a per-skill SKILL.md edit, not a UI decision.
- Free model override (outside the declared range) was proposed and **refused** — it would make the UI a second source of runtime truth over SKILL.md.

### 4. Architect keeps its bespoke *panel* permanently

The frontend mirror of the 2026-08-14 amendment §1: architect is never migrated onto the generic panel. `SessionArchitectPanel` stays bespoke for the same reasons its runner does (branching control flow, council/interview affordances a linear phase table cannot express without per-kind creep). Every other kind's panel migrates: demo + onboarding first (they render nothing today), then kb-cleanup + authoring, then instructions. The bespoke panels are deleted as each kind migrates — no dual paths.

**STATUS (2026-08-15): DONE.** demo + onboarding — W6-B6 (PR #162); kb-cleanup + authoring — W6-B8 (PR #168, landed inside B11's combined PR); instructions — W6-B9 (PR #170). Architect is now the only kind on its own panel, permanently, exactly as this section describes.

One consequence restated for the panel axis: the wedge disclosed in the 2026-08-14 amendment §4 (a runner throw leaves `status.json` at its pre-turn phase) becomes operator-visible on the generic panel; writing a terminal `failed` phase on that path is in wave-6 scope (bead `forge-poc`) rather than deferred indefinitely.

## Amendment — 2026-08-19 (wave-7 A2): session lifecycle is DERIVED, `cancelled` is one universal reserved terminal phase, and the write-root fence is made reachable

Three decisions from the wave-7 walkthrough's session-lifecycle initiative (W7-A2 — the wave-7 walkthrough findings record (retired M1-A), findings home-sessions-04/05/08/09/21, sessions-kinds-10/11/15/33/V01, community-02/15/20, knowledge-16/17). Two of them touch this ADR's contract; the third is the security park-point the wave pre-authorised.

### 1. `cancelled` — ONE universal reserved terminal phase, outside every per-kind table

The operator-locked decision "every session kind gets cancel/abandon" needed a terminal phase every kind shares. The obvious shape — a `{ phase: cancelled, step: terminal }` row appended to all eight `turnSpec`/`panel` tables (and to `LEGACY_SESSION_TERMINAL_PHASES` for the two table-less kinds) — is refused: "the operator gave up" is the same fact for every kind, and eight copies of one fact in eight authored tables is exactly the drift shape §1's "derived, not authored" discipline exists to prevent (a ninth kind would need to remember it; a forgotten row would leave one kind un-cancellable with no lint to say so).

Decision: `CANCELLED_PHASE = 'cancelled'` (`apps/forge/bridge-studio.ts`) is a **reserved, universal terminal phase** written by exactly one writer — the generic `POST /api/studio/sessions/:kind/:sessionId/cancel` route (`packages/sessions/bridge-studio-session-cancel.ts`) — and read as terminal by `isTerminalPhase` (`packages/sessions/bridge-studio-sessions.ts`) for every kind BEFORE the per-kind tables are consulted. No runner ever writes it; no yaml row ever names it. `deriveSessionAffordances` already yields `[]` for a phase its table does not name, so a cancelled session derives no affordance with no table change; the runner's own "no row for phase" fail-loud contract (§Consequences of the 2026-08-14 amendment §4) is never reached because nothing dispatches a turn for a terminal session. The frozen vocabularies (`TURN_STEPS`, `AWAITS_KINDS`, `VERDICT_VALUES`) are untouched — no new token was needed, so the wave's "ADR-043 amendment if session cancel needs a new frozen token" park-point resolves as: **no frozen token; one reserved phase constant instead**, recorded here because it is a contract decision on the primitive, not a bug fix.

`cancel` also kills a live turn: `spawnAgentTurn` (`apps/forge/ui-bridge.ts`) now records the detached runner's pid in `_logs/_<kind>-<sid>/turn.pid` beside `stderr.log`, and the cancel route SIGTERMs that process group only after `isTurnAlive` proves the pid's own argv carries this session id (fail-closed ownership — a planted `turn.pid` naming a stranger's pid is never signalled). `status.json` gains only the transition's own facts (`cancelled_at`, `cancelled_from`) — nothing derivable.

### 2. Lifecycle state (`working` | `awaiting-operator` | `crashed` | `stalled` | `terminal`) and `needsYou` are DERIVED at read time — nothing is stored

The 2026-08-15 amendment §4 disclosed the wedge: a runner throw leaves `status.json` at its pre-turn phase, and the generic panel reads that as a calm "no operator action". The wave-6 plan (`forge-poc`) was to write a terminal `failed` phase on that path. **This amendment supersedes that plan** with the constructive pattern the wave-5/6 campaigns measured as the only cure for the `declared-data-fails-open` class: *derive the value from its source of truth and give the object no field to hold a stale copy in.* `packages/sessions/bridge-studio-lifecycle.ts`'s `deriveSessionLifecycle` computes, on every read (the aggregate index rows AND the single-session shell payload's new `lifecycle` field), from two sources only:

- the phase row's own declared shape — `awaits: questions|verdict` ⇒ an operator gate is open; `step: agent|finalize` ⇒ the runner is working (the two table-less kinds, architect and project-brain, get `LEGACY_SESSION_AWAITS_PHASES` / `LEGACY_SESSION_WORKING_PHASES`, the twins of `LEGACY_SESSION_TERMINAL_PHASES`);
- on-disk liveness facts — `_logs/_<kind>-<sid>/{stderr.log,.heartbeat,events.jsonl,turn.pid}` mtimes/contents and `status.json`'s own mtime.

Rules, in order: terminal (incl. `cancelled`) → `terminal`; no live tracked turn AND a non-empty `stderr.log` whose mtime is ≥ status.json's → `crashed` (with the runner's last non-stack line as `error`; a crash OLDER than the last successful phase write is history, not state — a later re-run that advanced the phase clears it with no cleanup step); an open operator gate → `awaiting-operator`; a working phase with a log dir but silent past the kind's ceiling (180 s default, 120 s for architect = the UI's own `STALE_THRESHOLD_MS`) → `stalled`; else `working`. **`needsYou` is `awaiting-operator | crashed | stalled`** — an agent that is merely working is never "needs you" (the pre-W7 `deriveSessionAffordances(...).length > 0` counted a `step: agent` row's read-only `staged-review`/`next-turn` affordances and inverted the signal for four of eight kinds). A session with no log dir at all is never `stalled` — no liveness signal is an honest `working (unknown)`, not a guess. Consequence: no `failed` phase is written on the crash path (the `forge-poc` plan is retired), `status.json` stays the runner's own checkpoint, and every surface (Home card, `/sessions` row, the session page's `SessionLifecycleBar`, the generic panel's zero-affordance copy) renders the ONE derived verdict.

### 3. The write-root fence (2026-08-15 §1's `canUseTool`) is made reachable — `permissionMode` and `allowedTools` change when `writeRoots` is set (security park-point, recorded)

The bead forge-eip fence installed `options.canUseTool` but the SDK only consults `canUseTool` for a tool call it would otherwise PROMPT on, and two settings in the same options object short-circuited that prompt for exactly the gated tools: `permissionMode: 'acceptEdits'` (auto-accepts Write/Edit/MultiEdit/NotebookEdit) and `allowedTools` (every turnSpec agent's SKILL.md lists `Write` there). Live evidence: the operator's community-refresh session `2026-08-18T12-54-32` ran with a non-empty `writeRoots` and wrote three files under `studio/community/staging/` — outside every declared root (sessions-kinds-V01). Decision: when `writeRoots` is non-empty, `runAgentTurn` runs the turn in `permissionMode: 'default'` and STRIPS the fence-gated tool names from `allowedTools` (they stay callable — never pushed into `disallowedTools` — the SDK just routes each through `canUseTool`, which allows in-root writes and denies the rest); an unfenced turn keeps the exact prior shape. Pinned by `orchestrator/interactive-session-fence-mode.test.ts`; live-proven once by `scripts/probe-write-fence.mjs` (a real haiku turn: PRE-fix the out-of-root Write landed, POST-fix it was refused and the in-root Write landed — recorded in the W7-A2 PR). Residual, stated plainly: `Bash` is not fenced (creation-agent grants it) — a Bash write outside the root is not caught by this mechanism (bead forge-w08 stays open for that half).

## Amendment — 2026-08-19 (wave-7 FIX-A2): the cancelled phase is STICKY at the status-write seam, and Bash is fenced too

Two contract corrections from the post-land review sweep of W7-A2 (`_wave7/lanes/review-sweep-A2.json`, findings W7A2-01 HIGH and W7A2-03 SECURITY). Both close gaps the 2026-08-19 A2 amendment itself disclosed or implied.

### 1. `cancelled` WINS — the sticky-cancel rule lives at the ONE status-write seam

A2 §1 made `cancelled` a universal reserved terminal phase, but nothing made it *stick*: every terminal-phase writer (`writeSessionTerminalPhase` in `packages/agents/agent-run.ts` for `forge agent dispatch --session-dir`; the generic runner's final `writeStatus` in `orchestrator/interactive-runner.ts`) spread a stale, pre-turn status object over whatever was on disk — so a late turn completion resurrected a cancelled session into `complete`/`failed`/`awaiting-…`. Onboarding was the worst case: its dispatch child was never pid-tracked (`spawnAgentDispatch` wrote no `turn.pid`), so cancel could not kill it AND could not survive it.

Decision: `CANCELLED_PHASE` moves to `orchestrator/interactive-session.ts` (re-exported by `apps/forge/bridge-studio.ts`) and `guardedWriteSessionStatus` — the ONE seam every session-status writer already rides — enforces `cancelledPhaseWins(existing.phase, incoming.phase)`: an on-disk `cancelled` phase refuses any write that would move the session to a different phase (or to no phase); `cancelled → cancelled` and every non-cancelled → X transition stay allowed. The write returns `null` and the file is byte-unchanged; the generic runner tells the two `null` causes apart (re-read + `cancelledPhaseWins`) and throws a NAMED `InteractiveRunnerError` so `stderr.log` records that a turn finished after the cancel — the lifecycle derivation still reads `terminal`, never `crashed`, because terminal is rule 1. `spawnAgentDispatch` now records the child's pid at `_logs/_<kind>-<sid>/turn.pid` (the SAME template `spawnAgentTurn` uses) and `isTurnAlive` accepts the `--session-dir <…/_<kind>/<sid>>` argv element (basename = sid) as an ownership mark — so cancel kills onboarding too. A live tracked pid whose log dir has NO heartbeat/events channel (`turn.pid` only — the dispatch kinds) is `working`, never `stalled`: it has nothing to be silent on (the same honest-unknown rule as "no log dir"). The UI now renders the bridge's `killed` answer as DISTINCT copy (`describeCancelOutcome`, `[data-cancel-outcome="killed"|"unconfirmed"]`) — the parsed-then-discarded value the sweep flagged (W7A2-02).

### 2. Bash is fenced — deny by default, static inspection on ONE authored opt-in (bead forge-w08 closed)

A2 §3 stated the residual plainly: `Bash` survived the `allowedTools` strip and `canUseTool` allowed every non-gated tool, so an authoring/creation-agent turn could `printf x > /outside/root/file`. Decision: on a fenced turn `Bash` is stripped from `allowedTools` too (routed through `canUseTool`, never disallowed) and `makeWriteRootCanUseTool` DENIES it unless the kind opts in through the ONE authored switch `turnSpec.bashFence: inspect` (frozen vocabulary `BASH_FENCE_MODES = deny | inspect`, `orchestrator/studio/session-kinds.ts`; a value outside it is a studio-lint ERROR and the runner refuses to start the turn — declared data never fails open). With `inspect`, `orchestrator/bash-fence.ts` statically inspects every command: read-only utilities pass; every write-shaped operation (redirections, `mkdir`/`rm`/`cp`/`mv`/`tee`/`chmod`/`touch`/`truncate` operands, `dd of=`) must resolve — realpath of the deepest existing ancestor, so an in-root symlink to an outside dir is caught — INSIDE the write roots; `git` is read-only subcommands only; interpreters, `sh -c`, `eval`, `xargs`, `find -delete/-exec`, links, archives, network fetchers, subshells, command/process/arithmetic substitution, brace/tilde/`$VAR` in a path position, unknown commands and unparseable input are DENIED — sound over complete: a tokenizer gap can only cause a false deny (the agent gets the reason and reaches for Write/Edit, which the fence already handles). `cd` is tracked conservatively (`||`/pipeline with a `cd` → deny; after `cd X && …` the chain resolves against X; later segments against {old ∪ X}). `authoring` opts in (creation-agent scaffolds and `chmod +x`); `kb-cleanup` and `community-refresh` do not — Bash is refused outright there. Pinned by `orchestrator/bash-fence.test.ts` (including the REAL descriptors through `runInteractiveTurn` with a captured `canUseTool`). Deliberately hand-rolled rather than a shell-parser dependency because the design is deny-on-doubt; the trade is recorded here.

## Amendment — 2026-08-21 (wave-7 C2): `revise` joins the frozen verdict vocabulary; verdicts carry a recorded rationale; `requires` is approve-scoped; `finalized` is the persisted produce-pointer

Wave-7 walkthrough findings sessions-kinds-09/17/19/23/29/36 and library-22/24 (beads forge-4ei, forge-lzv) all traced to the same shape: the wave-6 migrations onto this primitive narrowed operator branches the underlying runners had always supported. Four contract decisions:

### 1. `revise` — the third member of `VERDICT_VALUES`, declared per row, never defaulted

`VERDICT_VALUES` (`orchestrator/studio/session-kinds.ts`) gains `revise`. The ADR default for a row that declares no `verdicts:` stays `['approve','reject']` — a kind opts into revise by DECLARING it, and every draft kind's gate row now does (`instructions` awaiting-verdict, `demo` awaiting-review, `authoring` awaiting-review, `kb-cleanup` awaiting-approval, `community-refresh` awaiting-review — all `[approve, revise, reject]`; `authoring`/`kb-cleanup` gain a `rejected` terminal row, reusing the existing token — no new phase vocabulary). The write route (`cli/bridge-studio-affordances.ts`) handles revise with ONE generic arm, `handleGenericRevise`: it REQUIRES a non-empty `feedback` body (400 otherwise — a regeneration with no guidance reproduces the same draft), writes it to the session's `feedback.md` (the file every draft runner already reads; `buildTurnPrompt` in `orchestrator/interactive-runner.ts` now carries a feedback section so the generic spine's turn does too), and sends the session back to its DRAFTING phase — **derived from the phase table** (the `step: agent` row whose `next` lands on the verdict row), never a hand-kept per-kind map. `iteration` is bumped when the status tracks one (demo's regenerate semantics, mirroring `POST /api/demo-builder/feedback`).

### 2. Verdicts record their rationale — `verdicts.json`, appended only on acceptance

Every verdict body accepts an optional `notes` string (capped at the shared `MAX_ANSWER_FIELD_BYTES`). After the per-kind handler responds 2xx — and ONLY then — the dispatcher appends `{at, verdict, notes?}` to the session dir's `verdicts.json`; `deriveSessionTranscript` renders each record as an operator turn (fail-closed parse, like answers.json), so a reject is never invisible in the record. A refused verdict (409/422/400, a failed finalize) records nothing. The revise record carries the bare decision — its words live in `feedback.md`, which already renders its own turn (no duplication).

### 3. `requires` is APPROVE-scoped

W6-B9's `meta.requires` names what the approve FINALIZER needs (authoring's library `id`). Enforcing it on every verdict value would block the very exits the three-way gate exists to provide — so the write route checks it only for `verdict: 'approve'`, and the panel gates only its Approve button on it (both sides read the same scoping). The disabled Approve now renders the reason (`[data-requires-hint]`), and the authoring id's SHAPE is validated at the route (SLUG_RE → 400 with the rule spelled out, never a 500 leaking `InteractiveRunnerError` — library-22) with a client-side advisory mirror.

### 4. `finalized` — the persisted pointer at what a committed session produced

`runFinalize` (authoring) and the community-refresh approve arm write `finalized: {kind, id}` onto `status.json` at finalize success (best-effort — the landed package is the truth; a failed pointer write never fails the commit). The shell payload carries it as a REQUIRED field (`null` = produced nothing), and the generic panel renders it as a PERMANENT link (`[data-action="open-finalized"]`) — the durable sibling of the one-shot `onPackageFinalized` redirect, which stays for the immediate navigation.

Also in this amendment's scope, on the read half: the bridge attaches the PENDING interview questions to the question-form affordance's meta at `awaiting-answers` (`attachPendingQuestions`, `packages/sessions/bridge-studio-sessions.ts` — `deriveSessionAffordances` stays pure over the descriptor; the file-backed half is attached at the one place that owns guarded session-dir reads), and the panel renders one control per question by reusing `ArchitectQuestionForm`, posting the REAL question text with each answer — closing the durable-record corruption where a hardcoded placeholder overwrote the questions in `answers.json` (sessions-kinds-19).

### 5. Review round (same day) — five corrections to the four decisions above

The pre-merge review round on this amendment's implementation found each of the four decisions honest in intent but incomplete at its edges. The corrected contract:

- **§2 revise records carry their own words.** "The revise record carries the bare decision — its words live in `feedback.md`" was true only for the LAST round: a revise OVERWRITES `feedback.md`, so a two-round session lost round 1's rationale permanently. A revise record now carries `feedback` alongside `notes`, and the transcript renders it. `feedback.md` is redefined as TRANSIENT — the operator's pending note, CONSUMED (deleted) by the agent turn that folds it into a prompt (`orchestrator/interactive-runner.ts`), because `readOperatorFeedback` runs on every `step: agent` turn and an uncleared file kept re-steering later rounds with corrections already applied.
- **§2 the record is fail-CLOSED on the write side too.** The append used to reset an unparseable `verdicts.json` to `[]`, so the next accepted verdict silently destroyed the audit history, 200 OK. The history is now pre-flight parsed BEFORE dispatch: unparseable ⇒ the verdict is refused (409, naming the file), nothing half-applied, nothing overwritten. The 2xx gate reads `headersSent` as well as the status code — Node defaults `statusCode` to 200, so a handler returning without responding would have recorded a decision that never happened.
- **The read half's fail-closed refusal is SCOPED.** `deriveSessionTranscript`'s `{ok:false}` used to 409 the entire session GET, so a corrupt `verdicts.json` made the page unrenderable and the operator could not approve, reject or revise their way out of the state that produced it. The payload now carries a REQUIRED `transcriptError` (verbatim reason) with `turns: []` — nothing silently dropped, nothing partial, and the affordances still render.
- **§4 all five finalizing kinds write the pointer, and liveness is derived.** Only authoring and community-refresh wrote `finalized`; instructions, demo and kb-cleanup produced none, so 3 of 5 committed sessions rendered no permanent link — declared data with 40% of its producers. All five write one now (`agents-md`/`demo` naming the project, `kb` naming the KB). The pointer's `exists` is DERIVED from the filesystem on every read, never stored: a deleted or renamed object renders the honest record without a link instead of a dead one.
- **Answers correlate by ID, not by text.** `questions.json` declares no id, so the bridge derives a stable positional one per pending question (`q1`, `q2`, …) and attaches it to `meta.questions`; the panel posts it back and the write route re-derives the same ids to cross-check, refusing an unknown id or a text mismatch. Correlating by question text alone mis-binds the moment a round repeats or rewords a question. The requirement is derived from live state (it applies exactly when a pending questions.json exists), never a flag.

**Amendment (2026-09-03, M4).** The statement that instructions migrates first as "the cleanest proof, least new code" was written before the structured-style path existed and does not survive the code: `style: structured` is an unimplemented stub behind an empty `SCHEMA_IDS`; the dispatchable finalizer set is `copyStagingToLibrary` alone; the finalize step slug-gates a package id that instructions sessions never carry; and `FinalizerContext` cannot reach `status`. Four instructions behaviours (the interview ceiling, the interview→draft same-turn fall-through, seed matching with its provenance footer, mode-conditional turn selection) have no phase-table form — the class this ADR reserved for architect encloses at least two runners. Consequence: the bespoke runners port as registered step-handler variants (the architect precedent), dissolving shared turn/transcript/lifecycle/finalize plumbing while each kind keeps its composition in a kind module; `AGENT_RUNNERS` shrinks by one per port and may not empty within M4. The full spine machinery is tracked as bead `forge-8vfn.6.6` with the five blockers as its acceptance list; `SCHEMA_IDS`'s stated expiry condition stands until that lands.
