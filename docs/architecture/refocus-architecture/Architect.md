# Architect

> **Intent.** The interactive human-moment that turns operator ideas (any detail level)
> into a small set of **releasable initiatives**, grounded in the project + brain,
> sharpened by a one-shot LLM council, and approved through a rich PLAN gate.
>
> **Type:** interactive (operator-initiated, never auto-started, never auto-approved).
> **Realized via:** a file-checkpointed turn-runner hosted by the UI bridge
> ([orchestrator/architect-runner.ts](orchestrator/architect-runner.ts), ADR 020/023),
> composing [skills/architect/SKILL.md](skills/architect/SKILL.md) +
> [skills/architect-llm-council/](skills/architect-llm-council/SKILL.md).

## Responsibilities

1. Host a bounded, multi-round **interview** (≤4 rounds) that resolves the ambiguities a
   plan cannot proceed without — then freezes scope. *(Front-loading ambiguity is the
   single highest-leverage autonomy lever; mid-run scope change is the dominant failure
   mode of unattended agents.)*
2. Draft one or more **coherent, releasable initiatives** as **coarse capability-features**
   with Given-When-Then acceptance criteria and an explicit cross-initiative build order
   (`depends_on_initiatives`). It does **not** size work items or set per-feature gates —
   that is the PM's job (one decomposition, downstream).
3. Run each planning round through the **LLM council once** (parallel critics: CEO / eng /
   design / DX), fold mechanical fixes in automatically, and surface only taste decisions
   as operator escalations.
4. Render the operator review artifacts: **PLAN.md** (parse target) + **PLAN.html** (rich,
   read-only: feature dependency graph, comparative pros/cons decision cards, mocked
   options for visual changes).
5. On approve, **deterministically** bake the operator's resolved decisions into the
   approved manifests and promote them to `_queue/pending/` — no second LLM draft.

## Inputs → Outputs

**Consumes:** operator idea + interview answers + plan verdict (via the UI bridge);
the project tree + its brain (Brain 3) for grounding; `skills/architect/SKILL.md`.
**Produces:** `_queue/pending/INIT-*.md` (initiative manifests); session artifacts under
`_architect/<sid>/` (PLAN.md, PLAN.html, council transcript, escalations); architect
phase events.

## Relationships

- **Upstream:** operator (via [forge-ui](docs/architecture/refocus-architecture/forge-ui.md) → bridge).
- **Downstream:** the queue → [Orchestrator](docs/architecture/refocus-architecture/Orchestrator.md) claims the manifest → [Project Manager](docs/architecture/refocus-architecture/Project-Manager.md).
- **Reads:** the cycle brain + the project's Brain 3 (mandatory for planners).
- **Composes skills:** `architect`, `architect-llm-council`.

## Boundaries (what this is NOT)

- Not a work-item sizer or gate-setter — emits **coarse features only**.
- Not a roadmap-file author — **the roadmap is a derived view** of the queued initiatives
  + their dependency chain (rendered by the UI), not a `roadmap.md` it writes.
- Not auto-invoked and not wired into `runCycle` — it is a deliberate human moment whose
  only handoff is the files it writes.

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[ARCH-1 · high]** Brain grounding is faked (`brain_context: []` hardcoded); the
  architect never calls `brain-query` despite the planner brain-first mandate.
- **[ARCH-2 · high]** Drop the unwritten `roadmap.md` output claim from SKILL.md + phase
  doc (roadmap = derived view, per locked decision).
- **[ARCH-3 · med]** Architect emits features at WI granularity and may set per-feature
  gates — must emit **coarse capability-features, no gates** (locked decision).
- **[ARCH-4 · med]** Dead render paths: C27 exploration + C26 project-metrics blocks are
  unreachable (runner never sets them); terminal-era PLAN.md annotation machinery
  (`VERDICT_PLACEHOLDER`, "edit the inner text") is obsolete under the bridge verdict flow.
- **[ARCH-5 · med]** Not on the `PhaseAgentSpec` seam; inline prompt assembly + no model
  tier set (see [Skill-Model.md](docs/architecture/refocus-architecture/Skill-Model.md)).
- **[ARCH-6 · low]** `reject` never calls `archiveSessionDir` (dead helper); SKILL
  frontmatter `surface`/`model` are stale/no-op; hand-rolled SVG dep-graph duplicates the
  UI roadmap layout.
- **[ARCH-7 · low]** Council runs over the *combined* body of all initiatives; consider
  per-initiative critique + parallelized critics + a consensus/disagreement taxonomy.
