---
title: Unifier re-discovers forge demo render every cycle
description: Unifier spent ~40 Bash calls finding the correct forge demo render invocation and demo.json schema because PROMPT.md/AGENT.md in the worktree don't document it — a recurring friction cost.
category: antipattern
created_at: 2026-06-16T00:00:00.000Z
updated_at: 2026-06-16T00:00:00.000Z
---

## Antipattern

In the unifier phase, the agent attempted multiple invocation paths for `forge demo render`:

1. `forge demo render INIT-...` (failed — wrong cwd)
2. `cd /home/parso/forge && forge demo render INIT-...` (failed)
3. `NODE_OPTIONS="" forge demo render INIT-...`
4. `node /home/parso/forge/bin/forge.mjs demo render INIT-... --dir <worktree>`
5. Read `forge/orchestrator/cli.ts`, `forge/cli/demo-model.ts`, `forge/cli/demo-html.ts` to discover `demo.json` schema

This consumed ~40 Bash calls and read multiple forge source files before the correct invocation was found and the `demo.json` schema was understood.

The root cause: the unifier `SKILL.md` / `PROMPT.md` / `AGENT.md` in the worktree does not include:
- The exact CLI invocation for `forge demo render`
- The `demo.json` schema (which fields are required, what `deltaPct` means)

This is a **forge machinery** antipattern — the same re-discovery cost applies regardless of which project the unifier is running against.

## Fix

Add a `## Demo render` section to the unifier SKILL.md (or a unifier-specific section of `AGENT.md`) that documents:
- The correct invocation: `node /home/parso/forge/bin/forge.mjs demo render <initiative-id> --dir <worktree-path>`
- The `demo.json` schema with required fields
- Where to find examples (e.g., `demo/*/demo.json` in the worktree)

## Sources

- `_logs/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source/events.jsonl` (unifier iteration event at `2026-06-16T10:37:44.016Z`, bash_commands array showing 40+ forge CLI exploration calls)
- `/home/parso/forge/brain/cycles/_raw/2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source.md`
