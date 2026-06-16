---
title: Work-item dependency ordering and conflict-free fan-out
description: Decompose so parallel work items touch disjoint files; a dependent WI waits for its prerequisite to merge, then branches fresh from post-merge main.
category: pattern
created_at: '2026-06-16'
updated_at: '2026-06-16'
---

# WI dependency ordering

Work items fan out in parallel worktrees, so the decomposition must make them
collision-free:

- **Disjoint file scope.** Two WIs that edit the same file collide at merge. Split
  along module seams; flag a god-file (≥1,600 lines) as a hard collision point.
- **Dependencies are merge-gated, not in-loop.** A dependent WI does not "continue"
  from a prerequisite's branch. It waits for the prerequisite to land in `done/`,
  then branches *fresh from post-merge main*. Write-first/iteration continuity is a
  within-WI property of the dev-loop, never across initiatives.
- **Declare the DAG explicitly.** The PM emits `_graph.md` (mermaid `graph TD`); the
  scheduler orders dispatch by it. A dependent must name its prerequisite, or it
  branches from a base that lacks the prerequisite's work.

The litmus test for a clean decomposition: could five agents build these WIs in
parallel without ever touching the same lines? If not, re-cut the seams.

## Sources

- Cross-cycle themes (dev-loop continuity scope; merge-boundary ordering).
- The forge↔project contract clause C3 (conflict-free decomposability).
