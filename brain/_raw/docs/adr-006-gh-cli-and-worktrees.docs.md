---
source_type: docs
source_url: docs/decisions/006-gh-cli-and-worktrees.md
source_title: ADR 006 — gh CLI + git worktrees + GitHub Actions instead of self-baked git/job runners
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 2)
cycle_id: pass-a-bootstrap
---

# ADR 006 — gh CLI + git worktrees + GitHub Actions

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

V1 hand-rolled a git workflow module (`src/git/`) and a job runner (`src/jobs/`) — branch naming, deterministic operations, cleanup, topological sort, claim/execute loop. Both correct but heavy, and both shadowed mature equivalents:

- **`gh` CLI** — official GitHub tool for branch/PR ops, well-supported, scriptable.
- **`git worktree`** — native git for parallel checkouts; perfect filesystem isolation per parallel work unit.
- **GitHub Actions** — CI execution we don't have to maintain.

## Decision

Use the existing tools, not the hand-rolled ones:

- Branch ops, PR creation, PR comments, merging — `gh` CLI invoked via Bash from skills, or shelled from `orchestrator/`.
- Parallel work units — `git worktree add` per claimed initiative; `git worktree remove` on completion or recovery.
- CI / quality gates — GitHub Actions workflow (TBD per managed project, not forge itself).
- Topological sort of stacked PRs — the human reviewer or an explicit skill (TBD); not baked into orchestrator code.

Thin TS wrappers in `orchestrator/worktree.ts` exist only because the scheduler needs to track lockfiles and heartbeats per worktree — they shell out to `git worktree`, they don't reimplement it.

## Consequences

- Zero maintenance on git internals.
- Battle-tested across millions of users.
- Worktrees give native filesystem isolation — no need for v1's process-isolation module.
- Trade-off: skills shell to `gh` rather than calling a typed library. Errors come back as exit codes / stderr. `git worktree` quirks (locked worktrees, nested git dirs) handled in `orchestrator/worktree.ts` per-case.

## Alternatives considered

- Continue v1's hand-rolled git module — pure maintenance liability.
- `@octokit/rest` for GitHub ops — possible, but skills and orchestrator both want CLI invocation for portability and shell composition.
- No CI (rely on local quality gates only) — fragile for unattended operation.

## References

- https://cli.github.com/
- https://git-scm.com/docs/git-worktree
- v1's `src/git/workflow.ts` (lessons folded into this ADR; module not ported)
