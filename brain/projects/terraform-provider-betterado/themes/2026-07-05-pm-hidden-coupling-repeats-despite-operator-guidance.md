---
title: PM hidden-coupling violation repeats even with explicit decompose-shape guidance
description: PM produced framework_provider.go shared-file violations in run 3 despite an operator annotation listing the exact rule; only the 4th run succeeded — operator guidance must name the shared file explicitly AND the coupling gate must exist.
category: antipattern
keywords: [hidden-coupling, framework_provider.go, decompose-shape-guidance, coupling-gate, shared-file-ownership, pm-repeated-failure]
related_themes: [pm-decomposition-index]
created_at: 2026-07-05
updated_at: 2026-07-05
---

## Pattern

The operator added a `## Decompose-shape guidance` section to the manifest (2026-07-04) after two prior failures, explicitly stating: "Shape the plan so those shared registration files are touched by exactly ONE work item." Despite this, PM run 3 still put `framework_provider.go` edits into WI-2, WI-3, and WI-4 — triggering 3 hidden-coupling violations.

Only run 4 succeeded, decomposing to: per-resource WIs (no `framework_provider.go` edits) + a final registration WI (sole owner of `framework_provider.go`).

## Root cause

The operator annotation was in the right place (manifest header) and used concrete language, but the PM still explored the worktree, saw the pattern, and reverted to "register each resource in its own WI." The coupling gate (hidden_coupling_violations check) is the load-bearing enforcement; the prose guidance alone is insufficient.

## Cost

5 PM runs total, ~$4.26 in PM costs, ~$2 wasted on rejected runs. PM run 1 (max_turns): $1.08. PM run 3 (coupling violation): $1.35.

## Counterfactual

If the manifest had included a concrete example WI graph (`WI-3: files: [...] NO framework_provider.go; WI-4 (registration): files: [framework_provider.go]`) instead of prose, run 3 likely would have passed.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-gallery-extensionmanagement/events.jsonl` — EV_mr56j4pb_wafrgtte (run 3 coupling rejection), EV_mr5k0e1t_h9dg82h0 (run 4 success)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-gallery-extensionmanagement.md`
