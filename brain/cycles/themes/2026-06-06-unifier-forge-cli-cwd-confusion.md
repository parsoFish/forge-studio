---
title: Unifier probes forge CLI from worktree cwd, not forge root
description: The unifier runs inside the project worktree but forge CLI commands (e.g. `forge demo render`) must be invoked from the forge root — the unifier wastes Bash calls probing the wrong cwd before resolving.
category: antipattern
created_at: 2026-06-06T02:36:29Z
updated_at: 2026-06-06T02:36:29Z
---

# Unifier probes forge CLI from worktree cwd, not forge root

## Antipattern

The `developer-unifier` skill runs with `cwd` set to the project worktree
(`/home/parso/forge/_worktrees/<initiative-id>/`). When it needs to invoke forge
CLI commands (e.g. `forge demo render <initiative-id>`), it issues the command from
the worktree cwd — which fails because `forge` is a forge-root binary and `demo render`
expects to find the initiative state in the forge root's `_worktrees/` layout.

Observed in this cycle: the unifier ran `forge demo render INIT-2026-06-05-release-folder`
4 times from incorrect cwds before resolving via `cd /home/parso/forge && forge demo render ...`.
This consumed 7 extra Bash calls and ~70s of wall time.

## Fix

The unifier SKILL.md should explicitly state that `forge` CLI commands must be run
from `$FORGE_ROOT` (i.e. `/home/parso/forge`), not from the worktree. The skill
already knows `$FORGE_ROOT` from the env — the fix is one sentence in the instructions.

Alternatively, the `forge demo render` command could accept a `--dir` flag that
points to the demo artifact directory directly, bypassing the cwd dependency.

## Evidence

From `events.jsonl` (cycle `2026-06-06T02-00-02_INIT-2026-06-05-release-folder`),
unifier iteration 1 bash_commands include:
```
forge demo render INIT-2026-06-05-release-folder 2>&1           # (worktree cwd — fails)
forge demo render INIT-2026-06-05-release-folder 2>&1           # repeat
which forge && forge --version 2>&1 || echo "forge not in path"
cd /home/parso/forge && forge demo render INIT-2026-06-05-release-folder 2>&1  # succeeds
```

## Scope

This lesson applies to **any project** — the cwd mismatch is a forge machinery issue,
not a betterado-specific issue.

## Sources

- `_logs/2026-06-06T02-00-02_INIT-2026-06-05-release-folder/events.jsonl`
  (iteration event EV_mq1pkmhj_k3b2skta, `bash_commands` array, unifier seq 21–25)
- `brain/cycles/_raw/2026-06-06T02-00-02_INIT-2026-06-05-release-folder.md`
