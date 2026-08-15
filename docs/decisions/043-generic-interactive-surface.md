# 043 — The generic interactive-surface primitive

- **Status:** Accepted (2026-08-10, operator) — amended 2026-08-11 (migration commitment re-homed to R4-23), 2026-08-14 (R4-23 close: architect never migrates, mirror deleted, net-decrease corrected), 2026-08-15 (wave-6: interaction panel un-deferred, `panel.phases`, kickoff model tier)
- **Date:** 2026-08-10
- **Supersedes / amends:** Amends [ADR 042](./042-surface-cap-scope-and-testability.md) (the orchestrator surface cap) by ratifying a single sanctioned extension seam. Builds on [ADR 024](./024-phases-as-subagents-invoking-skills.md) (agent composes skills; `SKILL.md` as runtime prompt) and [ADR 039](./039-ships-as-artifact.md) (the flow-runner executor registry — which this ADR deliberately does **not** extend).
- **Related roadmap:** `docs/roadmaps/R4-ootb-suite.md` — R4-21 (OOTB authoring agent) is consumer #1.

## Context

Forge has grown **four bespoke interactive-turn runners**, one per interactive session kind:

- `orchestrator/architect-runner.ts` — architect (idea → interview → council → draft → promote manifests).
- `orchestrator/instructions-runner.ts` — instructions (compose `AGENTS.md` from vetted seed blocks).
- `orchestrator/demo-builder-runner.ts` — demo-builder (rich-HTML demo + snapshot-restore lock).
- `orchestrator/project-brain-builder-runner.ts` — project-brain (commit themes to the central brain).

They are dispatched through one registry, `AGENT_RUNNERS` in `cli/agent-run.ts:67`, wired by `cmdAgentRun`. Each runner independently re-implements the same spine: the SEC-04 containment preamble (`resolveGuardedPath(projectRoot, [kindDir, sessionId])` → `guardedReadSessionStatus`), the ADR-024 spec/model/prompt derivation (`deriveAgentSpec(skillPathRelative(agent))` → `modelForSpec` → tool grant, `SKILL.md` as the runtime prompt), the near-duplicate helpers (`loadSkillPrompt` cache, a 400-char reasoning sink, `write<X>Status`), telemetry (`makeToolEventSink`, `createLogger`, `flushIteration(1)`), and a per-phase dispatch loop. Only the **finalizer** and a handful of phase transitions genuinely differ per kind.

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

`cmdAgentRun` (`cli/agent-run.ts`) forks on the presence of `turnSpec`:

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
- The honest cost of keeping it is one registry with four entries and one legacy branch in `cli/agent-run.ts` — `cli/` is not capped by [ADR 042](./042-surface-cap-scope-and-testability.md) at all.

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

The four runner-private `loadSkillPrompt` helpers failed **open** (`catch { return 'You are the forge <x> agent.' }`). That was survivable while the skill file was only a preamble; now that the task instructions live in `SKILL.md`, a fallback would launch an agent with no task and no signal — the declared-data-fails-open antipattern — so the shared loader throws instead, naming the skill, the turn id and the available ids. The disclosed cost: `cmdAgentRun` (`cli/agent-run.ts`) does not wrap the turn call, and the bridge spawns it as a detached child, so a throw on this path leaves the session's `status.json` at its pre-turn phase with the trace only in `_logs/<cycle>/stderr.log`. That wedge mechanism predates R4-23 (the "produced no theme files" throw has the same shape); R4-23 widens the set of triggers rather than creating it. Writing a terminal `failed` phase on this path is tracked separately and is deliberately not folded into this PR.

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

**STATUS (2026-08-15): DONE.** demo + onboarding — W6-B6 (PR #162); kb-cleanup + authoring — W6-B8 (`feat/w6-b8-migrate-cleanup-authoring`); instructions — W6-B9 (`feat/w6-b9-migrate-instructions`, this branch). Architect is now the only kind on its own panel, permanently, exactly as this section describes.

One consequence restated for the panel axis: the wedge disclosed in the 2026-08-14 amendment §4 (a runner throw leaves `status.json` at its pre-turn phase) becomes operator-visible on the generic panel; writing a terminal `failed` phase on that path is in wave-6 scope (bead `forge-poc`) rather than deferred indefinitely.
