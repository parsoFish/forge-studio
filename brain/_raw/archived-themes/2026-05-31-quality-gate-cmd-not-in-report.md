---
title: quality_gate_cmd not surfacing in cycle report
slug: 2026-05-31-quality-gate-cmd-not-in-report
description: The cycle report renderer shows "(default: npm test if package.json exists)" even when the manifest declares a custom quality_gate_cmd — the per-WI override is not propagated to the report's "What was asked" section.
category: antipattern
created_at: 2026-05-31T11:30:00Z
updated_at: 2026-05-31T11:30:00Z
---

# quality_gate_cmd not surfacing in cycle report

## Observed

In the `betterado` release_definition cycle (2026-05-31T10-57-52), the cycle
report showed:

> **Quality gate command:** `(default: npm test if package.json exists)`

The actual gate run by the unifier was:

```bash
go test -tags all -count=1 ./azuredevops/internal/service/release/... ./azuredevops/internal/service/taskagent/...
```

(confirmed from the unifier's iteration-1 bash commands in the event log).

The manifest declared `quality_gate_cmd` at the initiative level; WI specs also
carried the per-WI gate. Neither surfaced in `report.md`.

## Impact

The report misleads a reader into thinking the npm default gate was used. For
`betterado` this is especially confusing: there is no `package.json`; if the
default gate ran it would exit 0 (no tests), which is the false-pass antipattern
the team previously burned a cycle on.

## Root cause (hypothesis)

The report generator reads `quality_gate_cmd` from `.forge/project.json` or a
known default, not from the manifest frontmatter. Per-WI / per-initiative
overrides in the manifest YAML are not plumbed through to the report.

## Fix direction

Report generator should read the `quality_gate_cmd` from the manifest (or the
per-WI spec) and display what was actually executed, not the project-level
default fallback.

## Sources

- `_logs/2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests/events.jsonl` (unifier iteration 1 bash commands)
- `brain/cycles/_raw/2026-05-31T10-57-52_INIT-2026-05-31-release-definition-unit-tests.md`
