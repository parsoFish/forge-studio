---
title: forge demo render must run from forge root, not worktree — DEMO.md path conflict
description: The unifier placed demo.json/DEMO.md under forge/history/<id>/demo/ (worktree-relative) but the reviewer gate expects demo/<id>/DEMO.md at the worktree root. forge demo render called from worktree has a pm-invocation CWD bug; must be called from forge root with --dir.
category: antipattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

# forge demo render — worktree vs. root path conflict

## What happened

Unifier iteration 1 wrote `demo.json` to `forge/history/INIT-2026-06-19-framework-state-upgraders/demo/demo.json` (inside the `forge/` project subdirectory of the worktree). The reviewer gate checked for `demo/INIT-2026-06-19-framework-state-upgraders/DEMO.md` at the worktree root:

```
"missing": ["demo/INIT-2026-06-19-framework-state-upgraders/DEMO.md"]
"demo_md_path": "/home/parso/forge/_worktrees/INIT-2026-06-19-framework-state-upgraders/demo/INIT-2026-06-19-framework-state-upgraders/DEMO.md"
```

The reviewer rejected the PR; the orchestrator resumed the cycle. On resume, the DEMO.md was already present from the first unifier run (in the right location after the render), so the second unifier iteration completed immediately and PR #31 opened.

## Root cause (from unifier notes)

`forge demo render` invoked from inside the worktree triggers a `pm-invocation.ts` CWD resolution bug that misroutes the artifact root. Must be called:

```bash
cd /home/parso/forge && forge demo render <INIT-ID> --dir /path/to/worktree/forge/history/<INIT-ID>/demo
```

## Standing rule

Unifier MUST invoke `forge demo render` from the forge root (`/home/parso/forge`), not from the worktree directory. Pass `--dir` pointing at the worktree demo directory. Verify the DEMO.md lands at `<worktree>/demo/<INIT-ID>/DEMO.md` before committing.

## Sources

- `_logs/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders/events.jsonl` (EV_mqlw4aja_khjn4j7i unifier.prerequisite-missing, EV_mqlw4aja_6zrq3fkm review-router end failed)
- `brain/cycles/_raw/2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders.md`
