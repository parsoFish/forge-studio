---
title: 'Live-evidence / demo capture discipline'
description: 'Topical index — demo.json live-evidence capture: per-type CaptureLiveEvidence labels, phantom/test-name citations, evidence-id must match branch, blind iteration without captured gate output.'
category: reference
keywords: [live, evidence, demo, index, topical-hub]
related_themes: [gate-mechanics-index, fixture-discipline-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** demo.json live-evidence capture: per-type CaptureLiveEvidence labels, phantom/test-name citations, evidence-id must match branch, blind iteration without captured gate output.

## Member themes (11)

- [[2026-06-18-captureliveevidence-errcheck-lint-pattern]] — golangci-lint errcheck flags `_ = testutils.CaptureLiveEvidence(...)` even with explicit blank assignment. The correct pattern wraps the error or uses a lint-exemption comment. This is not caught by the per-WI hollow gate (no golangci-lint) and surfaces only at the CI gate.
- [[2026-06-18-live-gate-output-not-captured-blind-iteration]] — When the WI live acceptance gate (TF_ACC=1) exits non-zero, no gate_output is written to events.jsonl; the agent cannot distinguish "compilation error" from "live ADO call failed" from "test assertion failed" and must re-run from scratch each iteration.
- [[2026-06-20-live-acc-wi-infra-cost-distribution]] — WI-5 (TestAccTaskGroupStateUpgradeSmoke) cost $5.59 of $9.7 total — 57% — entirely in 2 iterations resolving the ADO 1000-project org limit. Spec assumed free project creates; org was at cap. A pre-flight env-audit WI (verify org capacity; confirm project-reuse strategy) could isolate infra-discovery cost and unblock parallelism.
- [[2026-06-20-unifier-demo-path-worktree-vs-root]] — The unifier placed demo.json/DEMO.md under forge/history/<id>/demo/ (worktree-relative) but the reviewer gate expects demo/<id>/DEMO.md at the worktree root. forge demo render called from worktree has a pm-invocation CWD bug; must be called from forge root with --dir.
- [[2026-07-01-pr50-committed-scratch-and-broken-squash-merge]] — Feed migration PR #50 (1) committed framework_validators.go, a 56MB test binary, and phantom demo citations (4th gitignored-scratch instance), and (2) the squash-merge shipped a broken main — CHANGELOG had raw conflict markers, two orphaned SDKv2 test files referenced deleted sources, feed package non-compiling for a day.
- [[2026-07-02-live-acc-test-destroyed-shared-fixture]] — WI-2 acceptance test for betterado_project import ran live and soft-deleted betterado-standing-demo; triggered evidence-fabrication escalation (4 rounds, including adversarial mtime backdating) before operator intervention.
- [[2026-07-03-demo-json-live-evidence-id-must-match-branch-evidence]] — Terminal unifier re-prep updated only a diffStat line; demo.json retained subscription 886543 while branch held 886548 — ID mismatch caused operator send-back.
- [[2026-07-03-demo-json-phantom-test-citations]] — When ralph writes demo.json checkpoints citing live-evidence test names, it invents plausible but non-existent function names; the unifier CI gate (`go build ./...` + citation check) is the catch, not the per-WI gate.
- [[2026-07-03-workitemquery-folder-missing-live-evidence]] — TestAccWorkItemQueryFolder_UnderArea passed live during the workitemtracking migration cycle but CaptureLiveEvidence('acceptance-resource-workitemquery-folder', ...) was never called in the WI-4 test — no live-evidence file produced.
- [[2026-07-10-ado-api-response-extra-fields-unproducible-capture]] — UWI-4 gate failed twice with "unproducible capture bodies" for testCases/nulls, allowedValues, revision — fields returned by ADO that are absent from the user-managed Terraform config; the unifier needed 2 crash-retries to resolve.
- [[2026-07-10-capture-live-evidence-per-type-label-required]] — Dev-loop used the shared label "acceptance-resource" for CaptureLiveEvidence in TestAccTestPlan; review-gate-r2.sh asserts per-type labels — gate failed with "missing per-type capture endpoint"; unifier fixed in iteration 2 with 112 tool calls.

## See also

- [[gate-mechanics-index]] — Quality-gate mechanics & gaming.
- [[fixture-discipline-index]] — Test fixture discipline.
