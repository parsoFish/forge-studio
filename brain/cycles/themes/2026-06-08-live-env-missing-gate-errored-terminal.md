---
title: live-env-missing gate-errored classifies cycle as terminal — discards completed dev-loop work
description: When a WI's quality_gate_cmd is a live-acc test and TF_ACC is unset, gate exit-code -5 (gate-errored, reject_reason live-env-missing) fires and the cycle is immediately classified terminal (recoverable:false), discarding all previously completed WI work in the same dev-loop run.
category: antipattern
created_at: 2026-06-08T00:00:00.000Z
updated_at: 2026-06-08T00:00:00.000Z
---

# live-env-missing gate-errored → terminal classification

## What happened

`INIT-2026-06-08-release-data-sources-completion` run 1 (2026-06-08):

- WI-1/2/3 completed successfully (1 iteration each, 13 files, 1395 insertions).
- WI-4 `quality_gate_cmd`: `go test -tags all -run TestAccDataReleaseDefinitionRevision ./azuredevops/internal/acceptancetests/`
- TF_ACC, AZDO_ORG_SERVICE_URL, AZDO_PERSONAL_ACCESS_TOKEN were unset in the runner.
- Gate: exit-code `-5` (gate-errored), `reject_reason: live-env-missing`, 0 iterations, 0 tool calls.
- Failure classification: `failure_mode: terminal`, `recoverable: false`.

**Consequence:** The entire first run was discarded. A second full run (PM re-decompose → dev-loop → unifier) was required, at an additional ~$2.62 cost. The WI-1/2/3 work from run 1 was replicated in run 2 but not reused.

## Gate guard rationale (correct)

The gate guard fires to prevent a false-pass: `resource.ParallelTest` exits 0 when `TF_ACC` is absent (the test skips). Exit-0 without real execution would be misread as a passing live-acc test. The guard correctly detects this and forces a hard fail rather than a silent pass.

## The problem: terminal classification on live-env-missing

The issue is not the guard itself — it is that `gate-errored` on `live-env-missing` immediately triggers `terminal + recoverable:false` classification. This discards the completed WI work rather than:
- (a) skipping the gate-errored WI and continuing with a `status: env-missing` annotation, OR
- (b) classifying as recoverable-with-env-fix (the operator can supply env and re-run just that WI).

## Would apply to any project

Any project with a WI that has a live-env-guarded `quality_gate_cmd` faces this: if the dev-loop runner lacks the required env vars, the whole cycle is terminal even if N-1 of N WIs completed cleanly. The fix is forge-side (cycle/ralph recovery policy), not project-specific.

## Sources

- `_logs/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion/events.jsonl` (gate.errored WI-4, failure_classification terminal, dev-loop.delivered run-1: 13 files discarded)
- `brain/cycles/_raw/2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion.md`
