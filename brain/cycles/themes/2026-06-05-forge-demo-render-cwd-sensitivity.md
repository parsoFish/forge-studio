---
title: forge demo render requires --dir flag when invoked outside worktree root
description: The unifier's `forge demo render <id>` call fails silently when cwd is not the worktree root containing `demo/<id>/demo.json`; requires explicit `--dir <abs-path>` to resolve correctly.
category: antipattern
created_at: 2026-06-06T00:00:00Z
updated_at: 2026-06-06T00:00:00Z
---

# forge demo render requires --dir flag when invoked outside worktree root

## Antipattern

`forge demo render <initiative-id>` resolves `demo/<id>/demo.json` relative to the current working directory. When the unifier is invoked with `cwd` set to the forge root (not the project worktree), the path does not resolve and the command fails or produces no output.

Multiple failed invocations observed in the unifier pass for INIT-2026-06-05-complete-release-definition:
- `forge demo render INIT-2026-06-05-complete-release-definition` → NOT FOUND (cwd = worktree, but demo/ was at worktree root, not parent)
- `cd /home/parso/forge && forge demo render ...` → FOUND (forge root doesn't have demo/ dir)

Resolution: the `--dir` flag specifying the absolute path to the `demo/<id>/` directory works regardless of cwd.

```bash
forge demo render INIT-2026-06-05-complete-release-definition \
  --dir /home/parso/forge/_worktrees/INIT-2026-06-05-complete-release-definition/demo/INIT-2026-06-05-complete-release-definition
```

## Impact

Unifier spent ~5 tool calls (seq 24–31) debugging the invocation. No functional impact on delivery (demo eventually rendered), but wasted token budget and introduced unifier confusion.

## Fix candidates

1. `forge demo render` should resolve the demo dir from the initiative ID (look in known worktree paths) automatically.
2. Unifier SKILL.md should document the correct invocation pattern with the `--dir` flag.

## Sources

- `_logs/2026-06-05T15-06-02_INIT-2026-06-05-complete-release-definition/events.jsonl` (tool.Bash seq 24–31: forge demo render invocations)
- `brain/cycles/_raw/2026-06-05T15-06-02_INIT-2026-06-05-complete-release-definition.md`
