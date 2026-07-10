---
title: canOpenPr does not gate on per-WI status
description: The unifier's canOpenPr check lets a cycle open a PR even when a live-acceptance WI closed status:failed — so a failed live-acc gate does not block merge.
category: antipattern
created_at: 2026-06-07
updated_at: 2026-06-07
---

# canOpenPr does not gate on per-WI status

## Pattern

The unifier's `canOpenPr` guard verified code quality (CI gate, lint) but did NOT inspect individual WI `status` fields. When WI-2 exhausted 5 iterations with `status: failed` (live acceptance gate PreChecking on missing creds every time), `canOpenPr` still returned true and the PR opened — and merged.

## Consequence

For terraform-provider-betterado the entire correctness contract is "behaviour proven against live ADO." A green offline unit gate + TF_ACC-stripped CI is not a substitute for live-acc. The data source shipped with live behaviour unverified. The gate gap is the same structural class as `gate-too-loose` — a passing gate that doesn't assert the critical property.

## Fix direction

`canOpenPr` must check that no WI has `status: failed` before opening the PR. A failed live-acc WI should block merge, not silently bypass it.

## Confirmed instance

- betterado `INIT-2026-06-07-release-folder-data-source`, WI-2 `TestAccDataReleaseFolder` failed 5× in PreCheck (creds missing); PR #14 still opened and merged. Operator noted: "should NOT have merged clean."

## Sources

- `_logs/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source.md`
- `_logs/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source/user-feedback.md`
