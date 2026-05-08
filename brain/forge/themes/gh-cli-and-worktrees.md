---
title: gh CLI + git worktrees + GitHub Actions
description: Use battle-tested git/GitHub tooling instead of hand-rolled equivalents. Worktrees give native filesystem isolation per parallel work unit.
category: pattern
keywords: [gh-cli, git-worktree, github-actions, branch, pr, ci, isolation]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [unattended-scheduler, file-based-state-machine, avoid-hand-rolling-tools]
---

# gh CLI + git worktrees + GitHub Actions

V1 hand-rolled a git workflow module and a job runner. Both correct but heavy, and both shadowed mature equivalents. V2 uses what's already battle-tested:

- **`gh` CLI** — branch ops, PR creation/comments/merging. Invoked via Bash from skills, or shelled from `orchestrator/`.
- **`git worktree`** — parallel work units. `git worktree add` per claimed initiative, `git worktree remove` on completion or recovery. Native filesystem isolation replaces v1's process-isolation module.
- **GitHub Actions** — CI execution we don't have to maintain. TBD per managed project, not forge itself.

Thin TS wrappers in `orchestrator/worktree.ts` exist only because the scheduler tracks lockfiles and heartbeats per worktree — they shell out to `git worktree`, they don't reimplement it.

Trade-off: skills shell to `gh` rather than calling a typed library. Errors come back as exit codes / stderr. `git worktree` quirks (locked worktrees, nested git dirs) handled per-case.

## Sources

- [`adr-006-gh-cli-and-worktrees.docs.md`](../../_raw/docs/adr-006-gh-cli-and-worktrees.docs.md) — decision record.

## Related

- [Theme: Unattended scheduler](./unattended-scheduler.md) — uses worktrees as the parallelism primitive.
- [Theme: Avoid hand-rolling tools](./avoid-hand-rolling-tools.md) — the principle this codifies.
