# Phase: Project Manager

> *Unattended.* Breaks initiative features into spec-driven work items the developer loop can execute.

## Purpose

Take the architect's confirmed initiative and decompose its features into **work items** — atomic, dependency-ordered units with acceptance criteria the developer loop can verify. Designed for *iteration* (not one-shotting); designed for *parallelism* (declared dependencies allow safe parallel execution).

## Inputs

- `_queue/in-flight/<initiative-id>.md` (the initiative manifest, claimed by the scheduler).
- `projects/<name>/` (current project state at the worktree's HEAD).
- Brain knowledge (queried via `brain-query`).

## Outputs

- `<worktree>/.forge/work-items/<work-item-id>.md` — one file per work item, frontmatter + spec body:
  ```yaml
  ---
  work_item_id: WI-<n>
  feature_id: FEAT-<n>
  initiative_id: INIT-<...>
  status: pending
  depends_on: [WI-1, WI-3]
  acceptance_criteria:
    - given: ...
      when: ...
      then: ...
  files_in_scope:
    - src/...
  estimated_iterations: 3
  ---
  ```
- `<worktree>/.forge/work-items/_graph.md` — dependency graph (mermaid) for human review.

## Skills

- [`skills/project-manager/SKILL.md`](../../skills/project-manager/SKILL.md)

## Success signals

- **Atomicity:** each work item touches ≤3 files (target; not absolute).
- **Verifiability:** each work item has at least one Given-When-Then acceptance criterion.
- **Parallelism:** at least 30% of work items can run in parallel (no dependency edge between them).
- **Downstream completion:** work items emitted by the PM have a higher developer-loop completion rate than hand-written ones.
- **No clarification asks:** the developer loop never has to come back to the PM for clarification (self-sufficient specs).

## Benchmark suite

[`benchmarks/project-manager/`](../../benchmarks/project-manager/)
- `initiatives.json` — sample initiative → expected work-item count, dependency shape, acceptance-criteria presence.
- `score.ts` — invokes the PM skill against fixtures and scores structure.

## Known failure modes (to defend against)

- **Over-decomposition** — 50 work items for a 3-day feature. Cap via prompt + benchmark.
- **Under-decomposition** — one giant work item. Same.
- **Vague acceptance criteria** — passes the buck to the developer loop. Benchmark explicitly scores criterion specificity.
- **Hidden dependencies** — work items collide at merge time. PM's last step is a self-check against the dependency graph.

## TODO (post-scaffold)

- [ ] Decide work-item-id scheme (per-initiative numbering vs global ULID).
- [ ] Define the `_graph.md` mermaid format.
- [ ] Populate `benchmarks/project-manager/initiatives.json`.
