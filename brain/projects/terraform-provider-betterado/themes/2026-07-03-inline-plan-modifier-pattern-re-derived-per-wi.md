---
title: Inline plan-modifier pattern re-derived each migration WI despite AGENT.md handoff
description: The vendored terraform-plugin-framework does not include stringplanmodifier/int64planmodifier sub-packages; ralph re-explores vendor/ for this fact every WI because AGENT.md knowledge doesn't survive between isolated ralph sessions.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build`.

The vendored `terraform-plugin-framework` at `vendor/github.com/hashicorp/terraform-plugin-framework/` does NOT include the convenience sub-packages:
- `resource/schema/stringplanmodifier/`
- `resource/schema/int64planmodifier/`
- `resource/schema/boolplanmodifier/`
- `resource/schema/stringdefault/`

This means every resource that needs `RequiresReplace` or a typed default must implement inline `planmodifier.String` / `planmodifier.Int64` interfaces.

WI-2 (build_folder) discovered this via ~5 bash `ls` calls in vendor/. WI-3 and WI-4 re-ran the same exploration (observed in their tool sequences: `ls vendor/.../schema/`, `grep -rn stringplanmodifier`, `head -5 .../defaults/string.go`).

WI-2 wrote the finding to `AGENT.md` and `fix_plan.md`. WI-3 appeared to pick it up (read `fix_plan.md`, adopted the inline pattern). WI-4 re-ran the vendor probe anyway (~3 extra bash calls) before conforming. WI-5 (data source) did not need plan modifiers.

## Why AGENT.md fails as inter-WI knowledge

Each ralph session starts fresh. AGENT.md/fix_plan.md are in the worktree root; ralph reads them on session start. The knowledge IS there — but ralph still ran the vendor probe, perhaps to verify or because the prompt is "read the gate failure first, then explore". Cost was low (~10 bash calls total across 3 WIs), but signals the pattern.

## Fix

PM should embed the constraint directly in each WI spec as a Required pattern note:
```
NOTE: stringplanmodifier/int64planmodifier sub-packages are NOT vendored.
Use inline interface implementations — see resource_build_folder_framework.go for the pattern.
```

Alternatively: vendor the sub-packages (low effort, eliminates the problem at source).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build/events.jsonl` (WI-2 iteration at line 392, WI-4 iteration at line 760 — `bash_commands` in each show the vendor probes)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build.md`
