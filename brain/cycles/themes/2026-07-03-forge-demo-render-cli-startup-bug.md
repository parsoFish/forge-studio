---
title: forge demo render — CLI startup bug causes 60-call unifier discovery loop
description: A module-level import of pm-invocation.ts in the forge CLI resolves skills/project-manager/SKILL.md against process.cwd() before chdir(FORGE_ROOT), making `forge demo render` fail when cwd is the worktree. Unifier falls back to ~60 bash calls and then Node direct invocation of renderDemoBundle.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

## Problem

`forge demo render <initiative-id>` fails when invoked from inside a worktree because the CLI's module-level import of `pm-invocation.ts` resolves `skills/project-manager/SKILL.md` against `process.cwd()` before `chdir(FORGE_ROOT)` is called in the command handler. The import resolution fails with a module-not-found error.

Unifier sequence observed across multiple cycles:
1. `which forge 2>/dev/null && forge demo render ... || echo "FORGE NOT IN PATH"` — fails
2. Probe `forge --help`, `ls forge/skills/`, `ls /home/parso/forge/skills/demo/`, `ls forge/skills/ado-demo/`
3. Walk `ls /home/parso/forge/orchestrator/`, grep 10–15 TS files for `renderDemo`, `DEMO.md`, `demoDir`
4. Read `cycle-helpers.ts`, `brain-paths.ts`, `cli.ts` (2×), `pm-invocation.ts`
5. Invoke `forge demo render` again directly — fails again
6. Fall back to `node --experimental-strip-types --input-type=module` calling `renderDemoBundle` directly

Total: ~60 bash/read calls and ~6 min wall-clock per cycle.

## Pattern (workaround — unifier does this autonomously)

```bash
# Direct Node invocation bypassing CLI startup:
node --experimental-strip-types --input-type=module <<'EOF'
import { renderDemoBundle } from '/home/parso/forge/orchestrator/demo-builder-runner.ts';
// ...
EOF
```

## Fix needed (forge machinery)

Lazy-load `pm-invocation.ts` inside the `demo render` command handler (after `chdir(FORGE_ROOT)`), not at module top-level. Or make the SKILL.md path resolution relative to `FORGE_ROOT` env var rather than `process.cwd()`.

## Observed cycles

- 2026-06-05 (`2026-06-05-forge-demo-render-cwd-sensitivity`) — first observation
- 2026-06-16 (`2026-06-16-unifier-demo-render-undiscoverable`) — ~40 bash calls
- 2026-07-03 (this cycle) — ~60 bash calls, explicit startup bug identified in last_assistant_text

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-featuremanagement/events.jsonl` — unifier iteration 1 `last_assistant_text` (event line 1037): "forge demo render CLI has a startup bug in worktree context (transitive module-level import of pm-invocation.ts resolves skills/project-manager/SKILL.md against process.cwd() before chdir(FORGE_ROOT))"
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-featuremanagement.md`
