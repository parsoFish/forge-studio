---
title: Per-WI CHANGELOG edits before a dedicated docs WI cause redundant file churn
description: >-
  When WIs 1-3 each independently edit CHANGELOG.md and a later docs WI owns
  the final entry, the shared file is touched 4+ times for overlapping content;
  the docs WI either reconciles or overwrites the earlier entries.
category: antipattern
keywords:
  - CHANGELOG
  - docs-wi
  - shared-file
  - churn
  - per-wi
  - release-contract
created_at: 2026-07-10T11:08:20.000Z
updated_at: 2026-07-10T11:08:20.000Z
---

# Per-WI CHANGELOG edits before a dedicated docs WI cause redundant file churn

## Pattern observed

In the gitpulse code-churn initiative, WI-4 was explicitly tasked with writing the `## [Unreleased]` CHANGELOG entry for all three features. However, WI-1, WI-2, and WI-3 each also modified `CHANGELOG.md` during their sessions (WI-1 edited it twice at seq 24 and seq 26). This caused:

- CHANGELOG.md touched 5+ times across the initiative
- WI-4 reconciled or extended entries written by prior WIs
- No merge conflict (sequential WIs, not parallel) but redundant file-modify events

The standing acceptance criteria embedded in the WI spec includes "Release draft step — Draft a changelog entry under `## [Unreleased]`" — this instruction appears in **every WI's standing AC**, causing each agent to comply.

## Root cause

The standing AC boilerplate appended to every WI says:
> "Release draft step — Draft a changelog entry under `## [Unreleased]` in CHANGELOG.md describing the change."

This applies unconditionally. When a separate docs WI owns the changelog, the earlier WIs' edits are premature and create duplication risk. Parallel WIs would conflict; sequential WIs just waste effort.

## Fix

Two options:
1. **Suppress the CHANGELOG step in non-docs WIs** — when a WI's `files_in_scope` doesn't include `CHANGELOG.md`, the standing AC's "Release draft step" should be omitted or marked deferred-to-docs-WI.
2. **Accept the redundancy** — if WIs are sequential, each agent reads the current CHANGELOG and appends correctly; WI-4 only needs to polish. Cost: 4-5 redundant Edit calls across the initiative.

Option 1 is cleaner for large initiatives. Option 2 is harmless for small sequential chains.

## Sources

- `_logs/2026-06-21T02-08-23_INIT-2026-06-21-gitpulse-code-churn/events.jsonl` — `file.modify` events on `CHANGELOG.md` for WI-1 (2x), WI-2, WI-3, WI-4
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T02-08-23_INIT-2026-06-21-gitpulse-code-churn.md`
