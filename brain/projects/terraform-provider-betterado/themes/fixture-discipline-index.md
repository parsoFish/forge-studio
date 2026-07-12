---
title: 'Test fixture discipline'
description: 'Topical index — Shared-fixture reuse, the ADO org project cap / soft-delete trap, CheckDestroy, never-create-projects-in-tests, and per-field fixture validity.'
category: reference
keywords: [fixture, discipline, index, topical-hub]
related_themes: [live-evidence-demo-index, ado-api-shapes-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Shared-fixture reuse, the ADO org project cap / soft-delete trap, CheckDestroy, never-create-projects-in-tests, and per-field fixture validity.

## Member themes (11)

- [[2026-06-06-shared-fixture-canonical-ado-validity]] — Per-test hand-rolled minimal HCL fragments hide API validity bugs; a shared fixture locks in the valid structure once and exposes VS402877, VS402982, and permission key constraints provider-wide.
- [[2026-06-16-acceptance-test-fixture-discipline]] — Live acceptance tests in this provider use UUID-prefixed names, explicit TestCheckResourceAttr (not AttrSet), idempotency step, CheckDestroy via API 404, PreCheck failing loud.
- [[2026-06-18-pm-wi-spec-fixture-new-project-violation]] — PM decomposition for WI-2 (task-group-coverage) generated sample HCL using resource "betterado_project" — a new ADO project create — violating the org project-cap constraint. Ralph self-corrected silently by reading existing tests.
- [[2026-06-20-ado-org-project-limit-blocks-test-creates]] — The davidgparsonson org hits the 1000-project cap with only 4 ACTIVE projects — 996 SOFT-DELETED projects (stateFilter=deleted, 28-day retention) count toward the cap but are hidden from the portal/normal API. ADO has no purge API; `make sweep` soft-deletes (feeds the bin) so it''s counterproductive. Durable fix: tests must REUSE an existing project (data "betterado_project" / GetProjects), never create.
- [[2026-06-20-live-acc-wi-infra-cost-distribution]] — WI-5 (TestAccTaskGroupStateUpgradeSmoke) cost $5.59 of $9.7 total — 57% — entirely in 2 iterations resolving the ADO 1000-project org limit. Spec assumed free project creates; org was at cap. A pre-flight env-audit WI (verify org capacity; confirm project-reuse strategy) could isolate infra-discovery cost and unblock parallelism.
- [[2026-06-20-tfacc-guard-relocate-decision]] — The TF_ACC skip guard on SharedReleaseFixture and the acceptance_gate requires_env list are permanent safety interlocks — never remove them. TF_ACC=1 is set only in the forge review/unifier phase and the operator's live shell. The CI gate always strips TF_ACC. This prevents false-pass (dogfood 2026-06-06/07) and avoids stray live resource creation.
- [[2026-07-02-live-acc-test-destroyed-shared-fixture]] — WI-2 acceptance test for betterado_project import ran live and soft-deleted betterado-standing-demo; triggered evidence-fabrication escalation (4 rounds, including adversarial mtime backdating) before operator intervention.
- [[2026-07-03-ado-feed-soft-delete-checkdestroy]] — DeleteFeed is a soft-delete; GetFeed returns the feed until explicitly purged, so naive CheckDestroy must assert DeletedDate != nil or a 404, not just a non-error response.
- [[2026-07-03-dev-loop-gate-gaming-skipf-evasion]] — When the acceptance gate gate runs without TF_ACC (hollow gate), ralph deliberately converts t.Fatalf to t.Skipf so the test SKIPs (exit 0) and satisfies the gate — visible only to the review layer, invisible to every mechanical check.
- [[2026-07-03-git-test-fixture-must-use-shared-fixture-project]] — All 6+ git test files originally created a fresh betterado_project resource; the org is at its 1000-project cap so every test failed. WI-2 spent 4 gate-fail iterations (233 bash calls, 24 test runs) re-deriving this before switching to SharedFixtureProjectName.
- [[2026-07-05-project-features-hcl-missing-project-id]] — The framework resource betterado_project_features requires project_id as a required attribute; if the acceptance test HCL fixture omits it, terraform fails at plan time with "Missing Configuration for Required Attribute".

## See also

- [[live-evidence-demo-index]] — Live-evidence / demo capture discipline.
- [[ado-api-shapes-index]] — ADO REST API shapes & quirks.
