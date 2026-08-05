# R4-15-F2 ⚑ — Architect + PM merger: operator decision brief

**Author:** T2 (R4-15 batch orchestrator) · **Date:** 2026-08-06 ·
**Status: RATIFIED 2026-08-06 — approved as recommended.** The runtimes are NOT
merged, no merger initiative is opened, and **R4-D1 stays deferred with its
condition unchanged**. The §6 measurement is adopted as a **batch-F exit rider**
on the wave-exit Scope-3 chunk rather than a separate exercise. Outcome recorded
on R4-D1's note (`docs/roadmaps/R4-ootb-suite.md`).
**Scope:** decision brief only. No code was written for this feature.

---

## 1. The question

The wave-5 mockup's OOTB roster has **eight** agents. `architect-planning` is described, verbatim
(`mockups/studio-endstate-v2/data.jsx:62-64`), as:

> "Interactive exploratory session with the operator: visual aids, interview, project context + roadmap in;
> a generated or updated project roadmap out. **Combines today's Architect and PM.**"

There is **no `project-manager` / plan agent anywhere in that roster.** Should forge merge them?

## 2. What is actually as-built (verified in code, not from memory)

| | `architect` | `project-manager` (= the plan agent, R4-05 / R4-B10) |
|---|---|---|
| Unit of work | a **roadmap**: N initiatives + `depends_on_initiatives` edges | **one** initiative → N work items |
| Interactivity | interactive: `interviewing → awaiting-answers → exploring → drafting → awaiting-verdict → finalizing → committed` (`orchestrator/architect-runner.ts:101-109`) | non-interactive single pass (`orchestrator/phases/project-manager.ts`) |
| Output artifacts | `manifests/<initiative_id>.md` + `PLAN.md` + `PLAN.html` (`architect-runner.ts:916-963`) | work items + `InitiativeManifest.specs` back-refs + `plan.completeness` event |
| Contract machinery | LLM council, edge-case explore, completeness critic | **ADR-037 compiled WI contracts** — `wi-spec-compile.ts`, `constraint-blocks.ts`, ralph-spec-lint |
| Gate | the PLAN gate (`/artifact?…&mode=gate`) | the develop flow's intake; no operator gate of its own |
| Entry paths | `POST /api/architect/start`; now also the project page (R4-15-F1) | TWO, proven byte-identical through ONE pipeline: architect-accept promote (F5) and `POST /api/initiatives/:id/plan` → `enqueuePlanRun` (F4) — `orchestrator/project-manager-shared-pipeline.test.ts` |

They are not two implementations of one job. They sit at **different scales** (portfolio vs single initiative),
have **different interaction models** (operator-in-the-loop vs unattended), and produce **different artifact
types** consumed by different downstream phases.

## 3. What the mockup actually merges — and the hole it leaves

Two pieces of mockup evidence, both load-bearing:

1. `views-flows.jsx:64` types the merged agent `{ sub: 'roadmap session', band: 'plan', out: 'roadmap' }`.
   **Its declared output is a roadmap, not work items.** So even in the mockup, the merged agent does not do
   what the PM does.
2. The mockup's `forge-develop` flow (`data.jsx:19-25`) opens with
   `{ id: 'intake', kind: 'queue', name: 'Initiative intake', sub: 'roadmap → work items', band: null }` —
   a **queue** node, not an agent node.

So the mockup does not merge decomposition INTO the planning agent. It **deletes decomposition as an agent**
and re-labels it a queue transition ("roadmap → work items") owned by nobody. R4-B13's 2026-08-03 alignment
pass already ruled on that same node: *"the mockup's extra 'Initiative intake' queue node is presentation of
the existing queue claim, not a new flow node."* That ruling is right, and it has a consequence the merger
question inherits: **`roadmap → work items` is not a queue move in forge.** It is an LLM pass with compiled
contracts (ADR-037), spec back-refs (ADR-015 as amended), and a completeness signal that R4-11-F4's attention
strip consumes. Adopting the mockup's roster literally would strand all of that behind a label with no owner.

## 4. What "merger" could actually mean — three readings, only one of which is real

- **(a) Roster/naming merger.** One operator-facing agent card called "Architect / Planning" whose sessions
  are roadmap sessions; the PM stays as-built, dispatched by the flow rather than run standalone by the
  operator. **This is what the mockup's own data supports** (`standalone: true, inFlows: []` on
  `architect-planning`; decomposition as a flow-internal step).
- **(b) Runtime merger.** One agent that both interviews at roadmap scale and decomposes to work items.
  Nothing in the mockup asks for this — the merged agent's declared `out` is `roadmap`. It would also fuse an
  interactive, gated, session-shaped phase with an unattended, fan-out-feeding one, which cuts directly
  against the north star's "primarily unattended between human interaction points".
- **(c) Architect-flow retirement.** Distinct question, already owned by **R4-D1**, with its own re-entry
  condition (the standalone plan path R4-05-F4 + the develop flow R4-10 carrying real initiatives end-to-end
  across enough cycles that the operator judges the wrapper redundant). Merging the roster entries neither
  satisfies nor advances that condition.

## 5. Recommendation

**Do not merge the runtimes. Do not open a merger initiative. Record reading (a) as the resolution, and leave
R4-D1 exactly where it is.**

Reasons, in order of weight:

1. **The evidence for a merger does not exist even in the artifact that proposed it.** The mockup's own agent
   typing says the merged agent emits a roadmap; decomposition survives as an unowned queue label. A merger
   justified only by a roster card is a naming change, and forge already has the naming freedom it needs
   (`architect` is a `library: true` Studio agent today, and R4-15-F1 gave it the project-page entry the
   mockup's "trigger: manual, from a project page" was pointing at).
2. **The PM is not a wrapper; it is where ADR-037 lives.** Compiled WI contracts, constraint blocks,
   spec back-refs and the `plan.completeness` event are the entire reason decomposition is a phase and not a
   queue move. Any merger design has to re-home all of it, which is a large initiative bought with no
   demonstrated operator benefit.
3. **It would cost unattended operation.** An interactive session cannot sit on the develop flow's critical
   path without introducing a human interaction point where the north star explicitly does not want one.
   R4-05-F4's `enqueuePlanRun` exists precisely so decomposition can run unattended.
4. **R4-D1's re-entry condition is evidence-based and unmet.** It asks for real cycles, not a roster diff.
   Answering it with a merger decision would substitute a design opinion for the evidence it demands.

**What I recommend recording on R4-D1:** a dated note that the wave-5 mockup's merged `architect-planning`
roster entry was reviewed under R4-15-F2 and does **not** constitute evidence toward the re-entry condition,
because the mockup merges the roster card, not the runtime — its merged agent's declared output is a roadmap
and decomposition survives in it only as an unowned queue label. R4-D1 stays deferred, condition unchanged.

## 6. If the operator disagrees — the cheapest honest next step

Not an initiative: a **measurement**. R4-05-F4's standalone plan path (`POST /api/initiatives/:id/plan`) is
already live and already the same pipeline as the architect-accept path. Run N real initiatives through it and
count how many needed an operator turn during decomposition. If that number is materially non-zero, the
interactive-decomposition case is real and earns an initiative; if it is zero, the merger is a naming question
and reading (a) stands on measured ground rather than argument. That measurement is also, verbatim, most of
what R4-D1's re-entry condition is asking for — so it advances the deferred decision instead of pre-empting it.

## 7. Honest limits of this brief

- It is a **code + mockup** review. No operator interviews, no usage data — nobody has yet run the standalone
  plan path enough times to produce the measurement §6 proposes.
- It does not evaluate whether the **eight-agent roster shape** is right in general; only the
  architect+PM merger inside it.
- The claim "the PM needs no operator turn" is argued from the as-built design (a single non-interactive
  pass), not from a count of real decompositions that stalled. §6 exists because of that gap.
