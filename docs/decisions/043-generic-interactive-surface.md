# 043 — The generic interactive-surface primitive

- **Status:** Accepted (2026-08-10, operator) — amended 2026-08-11 (migration commitment re-homed to R4-23; see Amendment)
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
