---
title: forge demo render CWD and --dir discovery trap
description: The unifier spent 4 Bash probes (seqs 23–37) discovering that `forge demo render <id>` requires `--dir <absolute-path-to-worktree-demo-dir>` — the command silently fails when cwd is wrong or the path is relative.
category: antipattern
created_at: '2026-06-06T09:41:00Z'
updated_at: '2026-07-10T09:46:00Z'
---

## Antipattern

In INIT-2026-06-06-shared-acceptance-fixture, the unifier tried `forge demo render` in 4 distinct forms before finding the working invocation:

1. `forge demo render INIT-2026-06-06-shared-acceptance-fixture` (from worktree cwd — failed)
2. `which forge; ls /home/parso/forge/scripts/` (discovery probe)
3. `forge demo render INIT-... --dir demo/INIT-.../` (relative path — failed)
4. `cd /home/parso/forge && forge demo render INIT-...` (forge root cwd — failed)
5. `forge demo render INIT-... --dir /home/parso/forge/_worktrees/INIT-.../demo/INIT-.../` (absolute path — **worked**)

The SKILL.md / AGENT.md in the worktree do not document the `--dir` flag or that it requires an absolute path. Each failed attempt costs ~1 Bash round-trip + agent reasoning.

## Fix direction

Document in the unifier SKILL.md:
> `forge demo render <id> --dir <absolute-path-to-worktree>/demo/<id>` — the `--dir` flag is mandatory and must be an absolute path. Relative paths and missing `--dir` both silently fail.

Or: make `forge demo render` discover the demo dir from the initiative ID when run from either forge root or the worktree, removing the need for `--dir` entirely.

## Sources

- `_logs/2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture/events.jsonl` (seqs 23–37: tool_use entries for `forge demo render` probes in unifier iteration 1)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture.md`
