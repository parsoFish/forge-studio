---
id: wi-branches
name: WI Branches
kind: git-state
producer: developer-ralph
consumer: developer-unifier
schema:
  gitInvariants:
    - commitsAhead>0
    - all-wi-branches-pushed
---

# WI-branches artifact contract

The least-explicit handoff: the artifact is **git state, not a file** — each work item leaves
commits on its own branch/worktree. The contract is that every dispatched WI produced real
delivery (`commitsAhead > 0`) and pushed its branch, so the unifier has something to integrate.
Today the delivery truth is the `dev-loop.delivered` event (git diff-stat); the
`assertNonEmptyDelivery` check runs after the unifier — the `flow-runner` pre-node guard
(ADR-027 amendment) moves a zero-commit dev phase to a clean boundary error.

- **Producer:** developer-ralph (per-WI Ralph loop).
- **Consumer:** developer-unifier (rebases the WI branches onto main).
