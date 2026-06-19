# ADR 006 — gh CLI + git worktrees + GitHub Actions instead of self-baked git/job runners

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The earlier build hand-rolled a git workflow module (`src/git/`) and a job runner (`src/jobs/`) — branch naming, deterministic operations, cleanup, topological sort, claim/execute loop. Both were correct but heavy, and both shadowed mature equivalents that already exist:

- **`gh` CLI** — official GitHub tool for branch/PR ops, well-supported, scriptable.
- **`git worktree`** — native git for parallel checkouts; perfect filesystem isolation per parallel work unit.
- **GitHub Actions** — CI execution we don't have to maintain.

## Decision

Use the existing tools, not the hand-rolled ones:

- **Branch ops, PR creation, PR comments, merging** — `gh` CLI invoked via `Bash` from skills, or shelled from `orchestrator/`.
- **Parallel work units** — `git worktree add` per claimed initiative; `git worktree remove` on completion or recovery.
- **CI / quality gates** — GitHub Actions workflow (TBD per managed project, not forge itself).
- **Topological sort of stacked PRs** — the human reviewer or an explicit skill (TBD); we don't bake it into orchestrator code.

Thin TS wrappers in [`orchestrator/worktree.ts`](../../orchestrator/worktree.ts) exist only because the scheduler needs to track lockfiles and heartbeats per worktree — they shell out to `git worktree`, they don't reimplement it.

## Consequences

**Positive:**
- Zero maintenance on git internals.
- Battle-tested across millions of users.
- Familiar to any contributor.
- Worktrees give native filesystem isolation — no need for the prior process-isolation module.

**Negative / accepted trade-offs:**
- Skills shell to `gh` rather than calling a typed library. Errors come back as exit codes / stderr text. Acceptable.
- `git worktree` quirks (locked worktrees, nested git dirs) — handled in `orchestrator/worktree.ts` per-case.

## Alternatives considered

- **Continue the prior hand-rolled git module** — pure maintenance liability; rejected.
- **`@octokit/rest`** for GitHub ops — possible, but skills and orchestrator both want CLI invocation for portability and shell composition. `gh` it is.
- **No CI** (rely on local quality gates only) — fragile for unattended operation; we want GitHub-side verification too.

## References

- [`gh` CLI](https://cli.github.com/)
- [`git worktree` docs](https://git-scm.com/docs/git-worktree)
- The prior `src/git/workflow.ts` (lessons folded into this ADR; module not ported)
