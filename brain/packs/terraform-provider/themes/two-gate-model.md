---
title: The two-gate model for live-resource providers
description: Split the done-signal into a fast creds-free inner gate and a live merge gate so the dev-loop is fast but the merge is proven.
category: pattern
created_at: '2026-06-16'
updated_at: '2026-06-16'
---

# Two-gate model

A provider's behaviour can only be fully proven against the live API, but a live
test is slow and needs credentials — too heavy to run every dev-loop iteration.
Split the done-signal in two:

- **Inner gate (every iteration):** the fast, creds-free, deterministic unit suite
  scoped to the changed package (`go test -tags all -run <Prefix> ./...service/<pkg>/...`).
  ≤10s. This is the `quality_gate_cmd`. It must fail before the work exists and
  pass only when the unit behaviour is correct.
- **Merge gate (once per cycle):** the live `TF_ACC` acceptance test — a real
  `terraform apply` → API read-back → idempotency re-plan (`ExpectNonEmptyPlan: false`)
  → destroy. Plus the CI-equivalent (`make test` + lint + fmt) with live triggers
  stripped (`ci_gate_unset_env`).

**Why both:** a unit-only gate ships server-side normalisation bugs invisible to
fakes; a live-only gate is too slow to iterate on. The inner gate makes the loop
fast; the merge gate makes the result true.

## Sources

- The forge↔project contract clauses C1/C1b/C7.
- betterado cycles where a unit-green PR reddened GitHub CI (gate-mirrors-CI fix).
