---
title: >-
  Ralph loop scratch lives at the worktree root and leaks onto branches — strip
  it at the pre-PR boundary, base-guarded
description: >-
  PROMPT.md / AGENT.md / fix_plan.md are stamped at the WORKTREE ROOT (the dev
  agent references them by relative path), NOT under the gitignored .forge/ dir.
  So autoCommitWorktreeIfDirty's `git add -A` and the agent's own commits sweep
  them onto the initiative branch, where they leak into the PR and re-introduce
  the C2 (scratch-hygiene) contract violation on main after merge — across the
  whole betterADO release chain this forced a manual `git rm --cached AGENT.md
  fix_plan.md` before EVERY merge. Fix (pr.ts b53dfda): stripForgeScratchFromBranch
  now also drops the root Ralph scratch trio at the same pre-PR boundary it strips
  `.forge/`, BASE-GUARDED — it only removes copies this cycle introduced (tracked
  on the branch but absent from the base ref), so a project that legitimately
  ships an AGENT.md keeps it in its PR. A project .gitignore covering the trio
  prevents the `git add -A` path at source; the strip is the belt-and-braces for
  the agent's own/forced adds and for projects without that ignore.
category: decision
created_at: '2026-06-06T00:00:00Z'
updated_at: '2026-06-06T00:00:00Z'
keywords:
  - ralph-scratch
  - AGENT.md
  - fix_plan.md
  - c2-scratch-hygiene
  - stripForgeScratchFromBranch
  - pre-pr-boundary
  - base-guarded
  - worktree-root-leak
---

# Ralph loop scratch leaks onto branches — strip at the pre-PR boundary

## What happened

The Ralph runner stamps `PROMPT.md` / `AGENT.md` / `fix_plan.md` at the **worktree
root** so the dev agent can read/update them by relative path. They are NOT under
the gitignored `.forge/` dir. Two paths sweep them onto the initiative branch:

1. `autoCommitWorktreeIfDirty` → `git add -A` (when the root scratch is untracked
   and the project doesn't gitignore it).
2. The dev/unifier agent's own `git add -A` / `git commit -am`.

Once on the branch tip they reach the PR and, after merge, re-introduce the C2
scratch-hygiene violation on `main`. The entire betterADO release chain needed a
manual `git rm --cached AGENT.md fix_plan.md` before every merge.

## The fix (forge `b53dfda`)

`stripForgeScratchFromBranch` (orchestrator/pr.ts) — already the pre-PR boundary
strip for `.forge/` — now also drops the root Ralph scratch trio, **base-guarded**:
strip a file only when it is tracked on the branch but ABSENT from the base ref
(`origin/main` / `main`). So a project that legitimately tracks an `AGENT.md`
keeps it; only cycle-introduced scratch is removed. The strip runs at
`openPullRequest` right before the push, so the branch tip (and the merged result)
is clean. Net diff base...HEAD shows the scratch never present.

## How to apply

- A project `.gitignore` covering `AGENT.md` / `PROMPT.md` / `fix_plan.md` stops
  the `git add -A` leak at source (betterADO does this). The boundary strip is the
  defense for force-adds and for projects lacking the ignore — keep both.
- When adding new agent-facing scratch files at the worktree root, add them to
  `ROOT_RALPH_SCRATCH` (pr.ts) too, or they will leak the same way.
- The base-guard is load-bearing: never blanket-delete a root file by name — a
  managed project may ship one.
