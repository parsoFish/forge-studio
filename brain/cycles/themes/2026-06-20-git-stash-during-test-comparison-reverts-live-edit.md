---
title: git stash used for branch comparison silently reverts live edits
description: Using git stash to snapshot working tree state for make test branch comparison pops changes lost on pop if the agent forgets to re-apply; manifests as a reverted file with no explicit undo command.
category: antipattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

## Summary

In WI-1 of this cycle, the ralph agent used `git stash` to stash working-tree changes so it could run `make test` on the clean base branch and compare failure counts vs. the branch. After `git stash pop`, the working-tree changes (specifically the `framework_provider.go` TypeName fix) appeared reverted — agent noted "The TypeName reverted to `\"azuredevops\"`!" (event 541).

**Root cause:** `git stash` / `git stash pop` is a destructive round-trip if the agent doesn't explicitly verify the re-application, especially across a long test run where context between the stash and pop is wide.

**Better pattern:** Use `git diff main..HEAD` on the committed state, or a separate worktree for comparison. Never stash live edits when the subsequent re-application is separated by a long-running command.

**Occurrence count:** Applied ×3 total (patch twice in original session + re-patch after stash revert).

## Sources

- `_logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl` — events 541-545
- `/home/parso/forge/brain/cycles/_raw/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples.md`
