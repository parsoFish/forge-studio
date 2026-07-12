---
title: 'Cycle recovery & crash resilience'
description: 'Topical index — Crash resilience and resume: agent-crash-work-survives, unifier rescue / incomplete-delivery resumes, linear-dep-chain crash cascade, rate-limit crash cascade, stale event-ids after CI fix, report-diff stale on resume.'
category: reference
keywords: [cycle, recovery, index, topical-hub]
related_themes: [pm-decomposition-index, gate-mechanics-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Crash resilience and resume: agent-crash-work-survives, unifier rescue / incomplete-delivery resumes, linear-dep-chain crash cascade, rate-limit crash cascade, stale event-ids after CI fix, report-diff stale on resume.

## Member themes (8)

- [[2026-06-06-report-diff-stale-on-resume]] — On a resume-from-failed cycle, report.md's diff section shows the added files as deleted because the diff snapshot is captured before the unifier's final commit — dev-loop.delivered is authoritative.
- [[2026-06-11-linear-dep-chain-crash-cascade]] — A 5-WI fully sequential dependency chain (WI-1 → WI-2 → ... → WI-5) caused 0/5 delivery when WI-1 crashed twice; all 4 downstream WIs skipped as prerequisite-failed. Re-decomposed to 2 WIs on resume — same scope, delivered in 1 iteration each.
- [[2026-06-11-live-acc-wi-gate-errors-before-ralph-runs]] — A live-acceptance WI whose quality_gate_cmd requires TF_ACC will gate-error (exit -5, live-env-missing) at iteration 0 if secrets.env is not exported — ralph runs 0 iterations and produces no work.
- [[2026-06-11-unifier-rescue-of-gate-errored-wi]] — When ralph exits with gate-errored (0 iterations, no code), the unifier detects the missing implementation and authors it as UWI-1 recovery — preventing an empty acceptance test slot on the branch.
- [[2026-06-16-agent-crash-work-survives]] — WI-3 had an agent crash (exit code 1) after the acceptance test was written and committed; recovery scan found gate already green and marked stop_reason already-complete with zero rework.
- [[2026-07-01-rate-limit-crash-prerequisite-failed-cascade]] — >-
- [[2026-07-04-unifier-incomplete-delivery-loop-16-resumes]] — The unifier fired 16 resume-branch-pushed events over ~2h 45m on a 65-commit permissions initiative; unifier.crash-retry and unifier.failed events present; PR opened 4 times; gate cleared only after second full dev-loop run and operator requeue.
- [[2026-07-10-failure-classification-stale-event-ids-after-ci-fix]] — After CI-gate failed post dev-loop completion, orchestrator re-emitted failure_classification with event IDs from an earlier PM-failure leg, reporting wrong failure mode.

## See also

- [[pm-decomposition-index]] — PM decomposition failures.
- [[gate-mechanics-index]] — Quality-gate mechanics & gaming.
