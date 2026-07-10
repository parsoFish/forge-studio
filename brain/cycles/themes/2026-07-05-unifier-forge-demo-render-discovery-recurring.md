---
title: Unifier forge demo render discovery — 7 Bash calls per cycle, unfixed after 6+ cycles
description: The unifier re-discovers the correct `forge demo render --project-dir` invocation via 7 Bash probes every initiative; the fix (documenting it in the unifier SKILL.md) has not landed.
category: antipattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

## Observation

In UWI-1 of INIT-2026-07-01-new-api-pipelinesapproval, the unifier spent 7 Bash calls re-discovering the `forge demo render` command:

```
seq=39: forge demo render INIT-2026-07-01-new-api-pipelinesapproval 2>&1
seq=40: forge demo render INIT-2026-07-01-new-api-pipelinesapproval 2>&1 || forge demo render ...
seq=41: ls skills/
seq=42: ls forge/skills/ | head -20; ls projects/...skills/
seq=43: which forge; forge demo render --help 2>&1 | head -30
seq=44: ls projects/terraform-provider-betterado/skills/
seq=48: cat forge/skills/demo/SKILL.md | head -80
seq=53: forge demo render INIT-... --project-dir /home/parso/forge/_worktrees/...
```

The final working form was `forge demo render <initiative-id> --project-dir <abs-worktree-path>`.

## Prior cycles documenting the same antipattern

- `2026-06-05-forge-demo-render-cwd-sensitivity` — first documented; needed `--dir`.
- `2026-06-06-unifier-forge-cli-cwd-confusion` — ran forge CLI from wrong cwd.
- `2026-06-16-unifier-demo-render-undiscoverable` — 40 Bash calls.
- `2026-06-21-unifier-demo-render-discovery` — fell back to manual file copy.
- `2026-06-22-demo-capture-missing-from-unifier-prompt` — capture vs render confusion.

This is at minimum the 6th cycle with this exact re-derivation.

## Fix (not yet applied)

Add to `skills/developer-unifier/SKILL.md` (or its AGENT.md in the worktree):

```
## Demo render invocation
forge demo render <initiative-id> --project-dir <abs-path-to-worktree>
# Run from forge root (not from worktree). initiative-id = manifest filename without .md.
```

The fix is one sentence. Cost of not fixing: ~7 Bash calls × $9.22 unifier cost per initiative.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval/events.jsonl` — unifier tool_use events seq=39–53 (UWI-1, no work_item_id tag)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval.md`
