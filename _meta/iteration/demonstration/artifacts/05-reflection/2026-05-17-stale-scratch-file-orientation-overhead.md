---
title: Stale scratch files cause expensive cold-start orientation
description: When AGENT.md or fix_plan.md carry stale worktree paths from a prior run, the dev agent burns tokens on filesystem discovery (26 bash calls, ~$0.29) before any implementation work begins.
category: antipattern
keywords: [cold-start, orientation, stale-context, agent-md, fix-plan, worktree, bash-calls, waste]
created_at: 2026-05-17T02:41:01Z
updated_at: 2026-05-17T02:41:01Z
related_themes: [wedged-loop-detector, agent-stuck-no-detection]
---

# Stale scratch files cause expensive cold-start orientation

## What happened

In cycle `chained-INIT-2025-05-17-slugifier-package-1778984667230`, the dev loop started WI-1 by reading `/AGENT.md` and `/fix_plan.md` at the file system root. These files contained references to a prior bench seed's temp path (`/tmp/forge-bench-chained-tuyNi1/`). The agent then performed a wide filesystem walk to locate the real worktree, issuing 26 bash commands (`find /`, `find /home`, `find /tmp`, `ls` calls, etc.) across iteration 1. The iteration cost $0.29 and produced zero implementation output. Iteration 2 completed the full implementation for $0.26.

## Why it matters

A single cold-start orientation burn-off is ~$0.29 per work item affected. In cycles with many WIs or multiple bench seeds in `/tmp`, the stale path references could affect multiple WIs. The orientation overhead is pure waste: no code written, no tests run, no progress made.

## Pattern to prefer

The orchestrator should reset (or verify) `AGENT.md` and `fix_plan.md` to empty / baseline state before starting each work item. Alternatively, these scratch files should use relative paths only so they remain valid across temp directory renames.

## Sources

- `_logs/chained-INIT-2025-05-17-slugifier-package-1778984667230/events.jsonl` — event `EV_mp95or27_gimgfdi0` (WI-1, iteration 1, 26 bash_commands, cost $0.29)
- `/home/parso/forge/brain/_raw/cycles/chained-INIT-2025-05-17-slugifier-package-1778984667230.md`
