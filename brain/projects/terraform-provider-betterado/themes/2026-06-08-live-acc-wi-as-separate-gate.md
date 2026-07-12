---
title: Live acceptance WI as separate gate — passes iteration 0 when implementation already complete
description: For betterado data sources, separating live TF_ACC acceptance into its own WI (after the implementation WI) is the correct two-gate pattern; WI-2 passed iteration 0 with zero code changes because WI-1's implementation was already correct.
category: pattern
keywords: [live-acceptance, tf_acc, two-wi-split, hollow-gate, live-gate, gate-pattern, data-source]
related_themes: [gate-mechanics-index]
created_at: 2026-06-08T00:00:00.000Z
updated_at: 2026-06-08T00:00:00.000Z
---

# Live acceptance WI as separate gate

## Pattern

`INIT-2026-06-08-release-data-sources-completion` used a two-WI split:

- **WI-1** (implementation + unit tests + examples + docs): `quality_gate_cmd` = `go test -tags all -run TestDataReleaseDefinitionRevision|TestDataReleaseDefinitionHistory|TestDataSourceDocPagesExist ./azuredevops/internal/service/release/` — no TF_ACC, no live ADO.
- **WI-2** (live acceptance): `quality_gate_cmd` = `go test -tags all -v -count=1 -run TestAccDataReleaseDefinitionRevision_Basic|TestAccDataReleaseDefinitionHistory_Basic ./azuredevops/internal/acceptancetests/` — requires TF_ACC + live ADO creds.

WI-2 ran with `TF_ACC=1`, `AZDO_ORG_SERVICE_URL`, `AZDO_PERSONAL_ACCESS_TOKEN` from the operator's `secrets.env`. Both tests passed on iteration 0 (~25s each). Zero code changes in WI-2 — the implementation from WI-1 was already correct.

Operator confirmed (from `user-feedback.md`):
> "Right split. Separating live acceptance into its own WI is a sound pattern — WI-2 consumed zero code changes, and running it as a distinct gate proved correctness against real ADO without any TF_ACC conditional-skip risk."

## Why this works

1. **Env discovery is independent.** WI-2 being separate forces the operator to supply TF_ACC creds at the start of that WI, surfacing any `secrets.env` issues before the gate runs — rather than discovering env problems inside a combined WI gate mid-iteration.
2. **Iteration count is honest.** WI-1 took 1 iteration (expected-fail at iter-0 from gate-tightening, pass at iter-1). WI-2 took 0 iterations to implement (already done), 1 gate run. Combined: 2 WIs, 2 gate passes, minimal token waste.
3. **No TF_ACC conditional-skip risk.** A folded implementation+live-acc WI risks the agent writing the acceptance test body but the gate using a conditional-skip (hollow gate semantics); the two-WI model makes it unambiguous — WI-1 is hollow-gated, WI-2 is live-gated.

## Contrast with the antipattern

The `2026-06-08-live-acc-wi-in-docs-only-initiative.md` antipattern (cycles brain) documents the case where a PM adds a live-acc WI to a doc-only initiative — that always fails on `live-env-missing`. The distinction: **only add a live-acc WI when the initiative actually ships new data-source or resource behaviour** (as in this cycle). Never for doc-only or analysis-only initiatives.

## Sources

- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion/events.jsonl` (gate.pass WI-2 iteration 0, ralph.end WI-2 stop_reason quality-gates-pass)
- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion/user-feedback.md`
- `brain/cycles/_raw/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion.md`
