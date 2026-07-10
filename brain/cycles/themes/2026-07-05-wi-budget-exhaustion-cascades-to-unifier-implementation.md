---
title: WI iteration-budget exhaustion cascades downstream skips and forces unifier into first-time implementation
description: When a WI with downstream dependents exhausts its iteration budget, all dependent WIs are skipped (prerequisite-failed), and the unifier absorbs first-time implementation work — far beyond its designed scope of integration + polish.
category: antipattern
created_at: 2026-07-05
updated_at: 2026-07-05
---

# WI iteration-budget exhaustion cascades downstream skips and forces unifier into first-time implementation

## What happened

In the core framework migration, WI-3 (`betterado_project_features`) exhausted its 5-iteration budget (gate failure: `Missing Configuration for Required Attribute project_id`). WI-3 was the dependency root for WI-4, WI-5, WI-6, WI-7, WI-8, WI-9 — all skipped with `prerequisite-failed`.

The unifier (UWI-2 through UWI-9) then implemented all of these resources from scratch: betterado_project_features, betterado_project_pipeline_settings, betterado_project_tags, betterado_team, betterado_team_administrators, betterado_team_members, data.betterado_client_config, plus docs/CHANGELOG.

The unifier completed this successfully (all UWIs status=complete), but:
- Required 9 UWI sessions across multiple cycle restarts
- Triggered the live-capture spin (see `2026-07-05-live-capture-missing-unifier-spin.md`)
- Cost and calendar time significantly exceeded budget

## Root cause

WI-3's 5-iteration budget was insufficient for the actual complexity (framework resource + test rewrite + live evidence capture), and the HCL fixture error consumed all 5 iterations without the agent diagnosing the root cause (missing `project_id`).

## Design tension

The unifier is designed as a **final-integration and polish** agent (demo, docs, PR description, CI gate). Placing 6 WIs of first-time implementation on it works but is expensive and slow — the unifier is single-threaded, context-limited, and lacks the ralph loop's structured retry model.

## Direction

- Increase iteration budget for live-acc WIs (currently 5; may need 7-8 for this project given the ADO API complexity).
- The ralph loop should detect `Missing Configuration for Required Attribute` plan errors and specifically diagnose which attribute is missing from the HCL fixture — this class of error is fixable in 1 edit.
- Consider making downstream WIs not immediately skip on prerequisite-failed, but instead attempt without the prerequisite's committed state (i.e. try the WI independently); the unifier's ability to fix this suggests the dependency graph was overly strict.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core/events.jsonl` — `ralph.end` for WI-3 at 2026-07-02T09:17:13 with `status=failed, stop_reason=iteration-budget`; `ralph.skipped` for WI-4 through WI-9 at 2026-07-02T09:17:15
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core.md`
