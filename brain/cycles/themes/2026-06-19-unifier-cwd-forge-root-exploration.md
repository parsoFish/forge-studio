---
title: Unifier cwd=forgeRoot causes forge-machinery exploration waste
description: When unifier runs with cwd at forge root rather than the worktree, it reads wrong AGENT.md/fix_plan.md paths and burns ~30 tool calls probing forge CLI internals (forge demo render, orchestrator structure) before finding what it needs.
category: antipattern
created_at: 2026-06-19T00:00:00.000Z
updated_at: 2026-06-19T00:00:00.000Z
---

## Antipattern

In cycle `2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint`, unifier iteration UWI-3 read files from forge root paths:
- `/home/parso/forge/AGENT.md` (not the worktree)
- `/home/parso/forge/fix_plan.md` (not the worktree)
- `/home/parso/forge/work-items/WI-*.md` (not under `_worktrees/.../.forge/work-items/`)

It then spent ~30 sequential `Bash` tool calls trying to invoke `forge demo render` — probing `cli/index.js`, `bin/forge.mjs`, `orchestrator/cli.ts`, `orchestrator/phases/pm-binding.ts`, `orchestrator/flow-runner.ts`, `skills/project-manager/` etc. None of the search paths resolved correctly from the wrong working directory.

Cost: unifier UWI-3 cost $1.74 USD, significant portion in the exploration waste.

## Root cause

The `reactive-constraint-stripback-arc` antipattern (brain/cycles/themes): when `cwd` is `forgeRoot` instead of the worktree, any relative path the agent constructs for project artifacts is wrong. The unifier should receive an absolute `worktree_path` and operate from there, not from forge root.

## Signal

Watch for unifier events with `Bash` summaries like:
- `find /home/parso/forge -maxdepth 3 -type f | sort`
- `ls /home/parso/forge/skills/`
- `grep -rn "pm-invocation" /home/parso/forge/orchestrator/`

These indicate the unifier is searching forge internals, not the project worktree.

## Sources

- `_logs/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint/events.jsonl` (EV_mqlispa8 iteration metadata, `tools_used` list in UWI-3 with 30+ forge-root Bash commands; unifier.end $2.20 at EV_mqliss6u)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint.md`
