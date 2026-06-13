---
title: >-
  A live-acc WI's per-WI gate doesn't run the project linter — the CI delivery
  gate is the net, and resume-from-unifier recovers without discarding work
description: >-
  For a live-acceptance work item, the per-WI quality_gate_cmd is the acceptance
  test (e.g. `go test -tags all -run TestX ./acceptancetests/`), which does NOT
  run the project linter. So the dev-loop can mark a WI `complete` while its code
  is golangci-lint-red — the standing AC tells the agent "CI-equivalent must pass"
  but nothing ENFORCES it at the per-WI gate. The cycle-level CI DELIVERY GATE
  (`make test && golangci-lint run ./... && make terrafmt-check`, with TF_ACC
  stripped) catches it and CORRECTLY refuses to open the PR — same "gate != project
  CI" class as the 2026-05-31/06-02 findings, now in the live-acc-WI guise.
  Recovery that works: hand-fix the lint, then `forge requeue --resume-from=unifier`
  → re-runs the unifier + CI gate (now green) + opens the PR, WITHOUT discarding
  the dev-loop's delivery (resume-don't-discard). The shared-acceptance-fixture
  cycle validated the full operator journey end-to-end this way (architect council
  → PLAN gate → PM → dev-loop → unifier → CI gate BLOCKS → resume → review → merge).
  Direction: run the project linter INSIDE the dev-loop for live-acc WIs (append it
  to the composed per-WI gate, or a changed-files lint sub-check at dev-loop close)
  so a lint-red WI can't reach `complete` and fail only at the end.
category: antipattern
created_at: '2026-06-06T00:00:00Z'
updated_at: '2026-06-06T00:00:00Z'
keywords:
  - gate-not-equal-ci
  - live-acc-gate
  - golangci-lint
  - ci-delivery-gate
  - resume-from-unifier
  - resume-dont-discard
  - operator-journey-validated
  - per-wi-gate
---

# Live-acc per-WI gate misses the linter; the CI delivery gate catches it

## The gap

A live-acc WI's `quality_gate_cmd` is the acceptance test — it proves the change
is exercised live, but it does NOT run `golangci-lint`. The injected standing AC
("CI-equivalent / push-green must pass") tells the agent to ensure lint passes,
but it is advisory, not gate-enforced. So the dev-loop completes a WI whose code
is lint-red (e.g. `errcheck` on cleanup `_ =` calls under `check-blank`), and the
failure surfaces only at the **post-unifier CI delivery gate** — which fails the
WHOLE cycle (an expensive net-new fixture re-run) instead of the dev-loop
self-correcting in-iteration.

## What worked

- The CI delivery gate did its job: it refused to open a PR with lint-red code —
  exactly the quality escape it exists to prevent. The work (worktree) was
  preserved.
- **resume-from-unifier** recovered cleanly: hand-fix the lint on the preserved
  branch → `forge requeue --resume-from=unifier` + `forge serve --once` (creds) →
  the unifier re-runs, the CI gate re-runs green, the PR opens. No dev-loop
  re-run, no discarded delivery. (Evidence: shared-acceptance-fixture, betterADO
  PR #13; fix commit on the cycle branch.)
- This exercised the FULL operator journey autonomously and confirmed the design
  holds: architect (real council, 0 escalations) → PLAN approve → PM (grounded,
  A1/A2a/A2b) → dev-loop → unifier → CI gate (blocks) → resume → review → merge.

## Direction (the actual fix)

Run the project linter **inside** the dev-loop for live-acc WIs — append
`golangci-lint run <scoped-pkg>` (or the language linter/formatter) to the composed
per-WI gate, or add a changed-files lint/format sub-check at dev-loop close. Then a
lint-red WI fails its own iteration (self-correct) rather than the whole cycle.
Also logged in `docs/known-gaps.md` (2026-06-06).
