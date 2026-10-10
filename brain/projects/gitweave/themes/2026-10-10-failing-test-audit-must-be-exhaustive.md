---
title: Failing test audit must run the full suite before decomposition
description: Initial WI scope driven by architect's partial "known list" missed 13+ test files, causing 3 send-backs; fix is a full pytest scan before PM emits WIs.
category: antipattern
keywords: [failing-tests, audit, decomposition, pm, send-back, pytest, scope, gitweave, i1, pruning]
created_at: 2026-10-10T08:47:25Z
updated_at: 2026-10-10T08:47:25Z
related_themes: [2026-10-10-docs-cleanup-must-accompany-artefact-deletion, 2026-10-10-verbatim-legal-text-needs-url-anchor]
---

# Failing test audit must run the full suite before decomposition

## What happened

I1 initial PM decomposition used the architect's "known failing files include (but may not be limited to)" list — not a live `python3 -m pytest tests/ --tb=no -q 2>&1 | grep FAILED` run. The WI-1 spec listed 9 known failing file families. The actual failing set contained 13+ additional files: `test_apply_overlays_script.py`, `test_apply_overlays_behavioral_contracts.py`, `test_dry_run_summary_table.py`, `test_brownfield_import_structure.py`, `test_recursive_config_discovery.py`, `test_oidc_workflow.py`, and others.

After dev-loop 1 (which faithfully deleted everything in WI-1's explicit list), the adversarial review found 242 still-failing tests. This triggered send-back 1. WI-7 (20 files, -8,551 lines) was added to delete the remainder.

A calver test in `test_copier_schema.py` was also missed — it referenced `modules/example-template/copier.yaml`, which WI-3 deleted. The merge-gate caught this (gate-fix compiler created WI-6).

## Why it matters

Each missed test file = another WI or another send-back round. Three send-backs cost ~$12 in extra adversarial-review and dev-loop overhead. The fix is structural: before the PM emits WIs, run the failing-test command and capture the full set. The architect's "known list" is a starting point, not an audit.

## Fix for gitweave

In every future `tests/`-pruning initiative, the first step in WI-1 must be:
```bash
python3 -m pytest tests/ --tb=no -q 2>&1 | grep FAILED > /tmp/failing_tests.txt
```
Then delete every file in that output. Do not rely on the manifest's enumerated list.

## See also

- [[2026-10-10-docs-cleanup-must-accompany-artefact-deletion]] — companion scope gap (docs not audited alongside tests)
- [[2026-10-10-verbatim-legal-text-needs-url-anchor]] — third send-back root cause

## Sources

- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/events.jsonl` (review-comments C-1, C-2; merge-gate error at 05:06; WI-7 dev-loop.delivered 20 files -8551)
- `brain/cycles/_raw/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline.md`
