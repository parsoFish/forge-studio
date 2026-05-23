---
title: 'GitWeave — local dry-run (gw:plan) required for every CLI tool'
description: >-
  Every change-introducing CLI must support a local dry-run. "Trust the agent,
  run the apply" is forbidden — Terraform-style plan-then-apply is the
  discipline.
category: pattern
keywords:
  - gitweave
  - dry-run
  - plan
  - terraform
  - local-reproducibility
  - gw-plan
  - change-discipline
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# GitWeave — local dry-run required

GitWeave principle: *"Local Reproducibility — CLI tools must support local dry-runs (`gw:plan`)."* Every command that *would* change state must be runnable in a "show me what would change" mode first.

The model is Terraform's `plan` + `apply` discipline applied across every GitWeave CLI:

- `gw:plan` — what would happen if I applied this config?
- `gw:apply` — actually do it (after plan was reviewed).

For forge initiatives:

- Any new CLI subcommand that mutates state must ship with a `:plan` variant.
- The PM phase emits this as a paired work-item structure — implement-the-mutation, implement-the-plan-mode, validate-output-equivalence.
- The reviewer phase's demo script should run `:plan` first, *then* `:apply`. Demos that skip `:plan` regress the principle.

The cross-cutting v2 lesson is the same as orchestrator-verified quality gates: don't trust the imperative side without a structural verifier first.

## Sources

- GitWeave README "Constitution & Governance" — "Local Reproducibility: CLI tools must support local dry-runs (`gw:plan`)."
