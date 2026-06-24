---
title: forge demo render resolves demo.json from forge binary's cwd, not the caller's cwd — --dir required in unifier context
description: "forge demo render without --dir resolves demo.json relative to the forge binary's process cwd (forge root), not the invoker's cwd. When the unifier's cwd is a worktree, the command silently finds the wrong demo.json or none. Fix: always pass --dir <absolute-worktree>/demo/<initiative-id>."
category: antipattern
created_at: '2026-06-07'
updated_at: '2026-06-07'
---

# `forge demo render` cwd trap — `--dir` required

## Root cause

`forge demo render <id>` resolves the `demo.json` path relative to the forge binary's own process cwd — not the calling shell's cwd. The unifier runs inside a worktree (`/home/parso/forge/_worktrees/<id>/`). When it invokes `forge demo render <id>` from there, forge looks for `demo.json` in the forge root, not in the worktree's `demo/<id>/` directory.

## Evidence

Cycle `2026-06-07T21-20-42_INIT-2026-05-30-claude-trail-compact-flag` — unifier iteration 1. AGENT.md note written by the unifier:

> `forge demo render` resolves `demo.json` relative to its own cwd by default; always pass `--dir <absolute-path-to-initiative-demo-subdir>` from a unifier running in a different cwd.

Unifier worked around it by passing:
```
forge demo render INIT-2026-05-30-claude-trail-compact-flag \
  --dir /home/parso/forge/_worktrees/INIT-2026-05-30-claude-trail-compact-flag/demo/INIT-2026-05-30-claude-trail-compact-flag
```

This produced `DEMO.md` + `DEMO.html` correctly.

## Fix for unifier SKILL.md

Add to unifier demo-rendering guidance:

> Always pass `--dir <abs-path>` to `forge demo render`. The forge binary's cwd is the forge root; the unifier's cwd is the worktree. These differ, so omitting `--dir` will silently find the wrong demo directory.

## Generalises beyond claude-harness

This trap applies to any project whose unifier runs inside a worktree and invokes `forge demo render`. It is a forge tooling behaviour, not a project-specific issue.

## Sources

- `_logs/2026-06-07T21-20-42_INIT-2026-05-30-claude-trail-compact-flag/events.jsonl` — unifier iteration 1, tool.Write event for AGENT.md
- `brain/cycles/_raw/2026-06-07T21-20-42_INIT-2026-05-30-claude-trail-compact-flag.md` — cycle archive
