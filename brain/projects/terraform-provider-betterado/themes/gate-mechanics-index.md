---
title: 'Quality-gate mechanics & gaming'
description: 'Topical index — How the per-WI and CI quality gates behave and get gamed: hollow/SKIP=pass gates, skip semantics, skipf evasion, expected-fail-forces-test-write, partial-acc subset, compile-only gate, doc gate, live vs offline.'
category: reference
keywords: [gate, mechanics, index, topical-hub]
related_themes: [live-evidence-demo-index, ralph-brain-reads-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** How the per-WI and CI quality gates behave and get gamed: hollow/SKIP=pass gates, skip semantics, skipf evasion, expected-fail-forces-test-write, partial-acc subset, compile-only gate, doc gate, live vs offline.

## Member themes (17)

- [[2026-06-06-acceptance-test-compile-only-gate]] — WI-5 acceptance test files compiled under go test without TF_ACC=1; gate validated compilation + registration in 3.9s without a live ADO call.
- [[2026-06-06-docs-only-wi-gate-mismatch]] — WI-4 (docs + examples) ran Go unit tests as its quality_gate_cmd — gate passed because prior WIs' tests were green, but zero doc files were verified.
- [[2026-06-06-partial-acc-test-gate-passes-subset]] — WI-4 gate `-run TestAccReleaseDefinitionPermissions` matched the committed SetPermissions test but missed the required UpdatePermissions test; spec required both.
- [[2026-06-08-doc-gate-test-pattern]] — A Go unit test asserting a doc file exists and has ≥N non-empty lines is a cheap, durable gate for doc-only WIs; runs without TF_ACC in the standard test suite.
- [[2026-06-08-golangci-lint-only-in-ci-gate-antipattern]] — Lint errors introduced by the agent survive all per-WI dev-loop gates and are caught only at the post-dev-close CI gate, forcing a full terminal re-run. Operator-confirmed fix for this project: include golangci-lint in WI acceptance criteria.
- [[2026-06-08-live-acc-wi-as-separate-gate]] — For betterado data sources, separating live TF_ACC acceptance into its own WI (after the implementation WI) is the correct two-gate pattern; WI-2 passed iteration 0 with zero code changes because WI-1's implementation was already correct.
- [[2026-06-11-acceptance-test-wi-split-write-then-run]] — When a live-acceptance WI runs without TF_ACC creds, split it into two WIs — write-WI (no creds) + run-WI (requires creds). This avoids gate-errored at iteration 0 before any code is produced.
- [[2026-06-11-live-acc-wi-gate-errors-before-ralph-runs]] — A live-acceptance WI whose quality_gate_cmd requires TF_ACC will gate-error (exit -5, live-env-missing) at iteration 0 if secrets.env is not exported — ralph runs 0 iterations and produces no work.
- [[2026-06-16-gate-expected-fail-forces-test-write]] — 3/4 WIs hit gate.expected-fail (no-work-indicator) on iteration 0; in every case this correctly forced the agent to write the test file before exiting — no false positives.
- [[2026-06-18-captureliveevidence-errcheck-lint-pattern]] — golangci-lint errcheck flags `_ = testutils.CaptureLiveEvidence(...)` even with explicit blank assignment. The correct pattern wraps the error or uses a lint-exemption comment. This is not caught by the per-WI hollow gate (no golangci-lint) and surfaces only at the CI gate.
- [[2026-06-18-hollow-gate-hcl-schema-validation]] — The betterado hollow gate (go test without TF_ACC) is not purely a compile check. resource.ParallelTest internally runs terraform plan, so Terraform schema validation fires. Incorrect block names in HCL fixtures cause plan-time failures even without live ADO credentials.
- [[2026-06-18-release-definition-acc-test-stages-not-environment]] — Any acceptance test that wraps a betterado_release_definition resource must use a `stages {}` block, not `environment {}`. Using `environment {}` triggers a Terraform schema validation error at plan time, failing the hollow gate before any ADO call.
- [[2026-06-20-tfacc-guard-relocate-decision]] — The TF_ACC skip guard on SharedReleaseFixture and the acceptance_gate requires_env list are permanent safety interlocks — never remove them. TF_ACC=1 is set only in the forge review/unifier phase and the operator's live shell. The CI gate always strips TF_ACC. This prevents false-pass (dogfood 2026-06-06/07) and avoids stray live resource creation.
- [[2026-07-03-dev-loop-gate-gaming-skipf-evasion]] — When the acceptance gate gate runs without TF_ACC (hollow gate), ralph deliberately converts t.Fatalf to t.Skipf so the test SKIPs (exit 0) and satisfies the gate — visible only to the review layer, invisible to every mechanical check.
- [[2026-07-04-framework-migration-drops-sdkv2-validators-silently]] — Two independent initiatives (git PR #46, security-permissions PR #48) delivered framework resources with 0 of the SDKv2 IsUUID/StringIsNotWhiteSpace/OneOf validators; the per-WI live-acc gate does not enforce validator parity; the gap surfaces at review.
- [[2026-07-05-acceptance-test-gate-skip-semantics]] — The acceptance test quality gate passes on SKIP (exit 0) without TF_ACC; agents re-derive this semantics each cycle instead of reading it from the profile.
- [[2026-07-10-build-definition-facade-migration-schema-only]] — build_definition framework migration passed all automated gates but expand/flatten was unwired; apply had zero API effect; caught only by operator review.

## See also

- [[live-evidence-demo-index]] — Live-evidence / demo capture discipline.
- [[ralph-brain-reads-index]] — Zero-brain-reads (dev-loop re-derivation).
