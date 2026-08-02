---
id: wi-branches
name: WI Branches
kind: git-state
producer: developer-ralph
consumer: demo-agent
schema:
  gitInvariants:
    - commitsAhead>0
    - all-wi-branches-pushed
---

# WI-branches artifact contract

The least-explicit handoff: the artifact is **git state, not a file** — each work item leaves
commits on its own branch/worktree. The contract is that every dispatched WI produced real
delivery (`commitsAhead > 0`) and pushed its branch, so the demo node has something to
demonstrate. Today the delivery truth is the `dev-loop.delivered` event (git diff-stat); the
`assertNonEmptyDelivery` check runs in the demo node (R4-10-F1 — `execDemo`, formerly the
unifier) — the `flow-runner` pre-node guard (ADR-027 amendment) moves a zero-commit dev phase
to a clean boundary error.

- **Producer:** developer-ralph (per-WI Ralph loop).
- **Consumer:** demo-agent (composes the initiative demo + the PR body from the WI branches;
  R4-10-F1 — was developer-unifier).
