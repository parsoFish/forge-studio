# Phase: Project Manager

> *Unattended.* Decomposes initiative acceptance criteria directly into spec-driven work items the developer loop can execute.

## Purpose

Take the architect's confirmed initiative and decompose its Given/When/Then acceptance criteria into **work items** — atomic, dependency-ordered units with acceptance criteria the developer loop can verify. There is no intermediate feature list: the PM reads the initiative body directly and maps ACs to outcome-sized WIs. Designed for *iteration* (not one-shotting); designed for *parallelism* (declared dependencies allow safe parallel execution).

## Inputs

- `_queue/in-flight/<initiative-id>.md` (the initiative manifest, claimed by the scheduler). The markdown body carries the vision + GWT ACs the PM decomposes.
- `projects/<name>/` (current project state at the worktree's HEAD).
- Brain knowledge (queried via `brain-query`).

## Outputs

- `<worktree>/.forge/work-items/WI-<n>.md` — one file per work item, frontmatter + spec body. **Schema locked in [ADR 015](../decisions/015-work-item-format.md).**
- `<worktree>/.forge/work-items/_graph.md` — dependency graph (mermaid `graph TD`) for human review. **Format locked in [ADR 015](../decisions/015-work-item-format.md).**

Validation enforced by [`orchestrator/work-item.ts:validateWorkItem`](../../orchestrator/work-item.ts) before the orchestrator dispatches work items to the developer loop.

### Optional WI fields (ADR 015 §3a)

Four optional fields tighten the dev-loop signal on larger initiatives. All four are omit-on-undefined — a WI without any of them serialises byte-identically to the legacy shape:

| Field | Type | Purpose |
|---|---|---|
| `quality_gate_cmd` | `string[]` | Per-WI gate command override (e.g. `["npm","test","--","tests/x.test.ts"]`). Eliminates the trivially-green pathology on initiatives where the whole-project gate would pass without the WI's work. |
| `non_goals` | `string[]` | Explicit out-of-scope items pulled forward from the initiative body's non-goals. Rescues over-eager dev-loop. |
| `verification_artifact` | `string` | Path the dev-loop must produce that the gate exercises. Must appear in `files_in_scope`. |
| `creates` | `string[]` | Structured marker for files this WI creates from scratch. Subset of `files_in_scope`. The `one_creator_per_file` validator rule consumes this. |

`demo_hook` is **NOT** a WI field — it's initiative-level only.

## Skills

- [`skills/project-manager/SKILL.md`](../../skills/project-manager/SKILL.md)

## Success signals

- **Atomicity:** each work item touches ≤3 files (target; not absolute).
- **Verifiability:** each work item has at least one Given-When-Then acceptance criterion.
- **Parallelism:** at least 30% of work items can run in parallel (no dependency edge between them).
- **Downstream completion:** work items emitted by the PM have a higher developer-loop completion rate than hand-written ones.
- **No clarification asks:** the developer loop never has to come back to the PM for clarification (self-sufficient specs).

## Sizing band (S3 refinement)

Locked in the `orchestrator/phases/pm-binding.ts` user prompt + `orchestrator/phases/project-manager.ts` derived range:

- **Per initiative:** 2–8 WIs is the target range. Under-decomposed = one giant WI; over-decomposed = >8 WIs (split the initiative instead).
- **Per-file rule:** at most one WI **creates** a given file (listed in its `creates` array). Subsequent WIs extend it and `depends_on` the creator.
- **No invented scope.** PM may not add acceptance criteria or work items not grounded in the initiative's body — scope is locked in the initiative spec.

## Out-of-scope WI recovery

If the PM emits a WI whose acceptance criteria or files_in_scope have no grounding in the initiative body, the validator can detect the mismatch. The recovery flow mirrors the former feature-hallucination flow: the orchestrator wipes the stale `.forge/work-items/` dir and re-invokes the PM once with an augmented prompt pointing to the initiative body. If the retry still drifts, the orchestrator emits a terminal `pm.out-of-scope` event and throws.

> Note (2026-06-04): `feature_id` validation (`knownFeatureIds`) was removed with the feature tier. The `cycle-pm-hallucination.test.ts` test covers the retry mechanics and may be refactored by sibling clusters to match the new model.

## Locked formats

- Work-item file schema, `_graph.md` mermaid format, work-item-id scheme (`WI-<n>` per-initiative): all locked in [ADR 015](../decisions/015-work-item-format.md).
- Validation: [`orchestrator/work-item.ts`](../../orchestrator/work-item.ts) — `parseWorkItem` / `validateWorkItem` / `validateWorkItemSet` / `detectHiddenCoupling`.

## Known failure modes (to defend against)

The prompt guidance and validator-layer guards (`detectHiddenCoupling`, `one_creator_per_file`) are live; `knownFeatureIds` was removed with the feature tier (2026-06-04). Phase quality is judged on real merged cycles.

- **Over-decomposition** — 50 work items for a simple initiative. Capped via sizing-band prompt guidance (2–8 WIs per initiative).
- **Under-decomposition** — one giant work item that covers the whole initiative. Same remedy.
- **Vague acceptance criteria** — passes the buck to the developer loop. Every WI must have ≥1 Given-When-Then criterion; the validator enforces this.
- **Hidden dependencies** — work items collide at merge time. PM's last-step self-check (`detectHiddenCoupling`) detects file-ownership overlaps.
- **Out-of-scope WIs** — PM invents work items not grounded in the initiative body. Retried once with augmented prompt; terminal `pm.out-of-scope` if persistent.
- **Multiple creators for one file** — two WIs implicitly create the same file ⇒ merge conflict. The `creates` field + `one_creator_per_file` enforcement make this deterministically catchable.
- **Trivially-green dev-loops** — initiative-wide gate passes before any WI's work lands ⇒ Ralph exits on iteration 0. Per-WI `quality_gate_cmd` is required on larger initiatives (iteration_budget > 5).
