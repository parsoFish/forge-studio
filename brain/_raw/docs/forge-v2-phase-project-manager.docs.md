---
source_type: docs
source_url: docs/phases/project-manager.md
source_title: Forge v2 — Phase: Project Manager
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 3)
cycle_id: pass-a-bootstrap
---

# Phase: Project Manager

> *Unattended.* Breaks initiative features into spec-driven work items the developer loop can execute.

## Purpose

Take the architect's confirmed initiative and decompose its features into **work items** — atomic, dependency-ordered units with acceptance criteria the developer loop can verify. Designed for *iteration* (not one-shotting); designed for *parallelism* (declared dependencies allow safe parallel execution).

## Inputs

- `_queue/in-flight/<initiative-id>.md` (initiative manifest, claimed by scheduler).
- `projects/<name>/` (current project state at worktree's HEAD).
- Brain knowledge (queried via `brain-query`).

## Outputs

- `<worktree>/.forge/work-items/<work-item-id>.md` — one file per work item, frontmatter + spec body. Frontmatter includes work_item_id, feature_id, initiative_id, status, depends_on, acceptance_criteria (Given/When/Then), files_in_scope, estimated_iterations.
- `<worktree>/.forge/work-items/_graph.md` — dependency graph (mermaid) for human review.

## Success signals

- **Atomicity:** each work item touches ≤3 files (target).
- **Verifiability:** each work item has at least one Given-When-Then acceptance criterion.
- **Parallelism:** at least 30% of work items can run in parallel (no dependency edge between them).
- **Downstream completion:** work items emitted by PM have higher developer-loop completion rate than hand-written ones.
- **No clarification asks:** developer loop never has to come back to PM for clarification.

## Known failure modes

- **Over-decomposition** — 50 work items for a 3-day feature. Cap via prompt + benchmark.
- **Under-decomposition** — one giant work item. Same.
- **Vague acceptance criteria** — passes the buck to developer loop. Benchmark explicitly scores criterion specificity.
- **Hidden dependencies** — work items collide at merge time. PM's last step is self-check against the dependency graph.
