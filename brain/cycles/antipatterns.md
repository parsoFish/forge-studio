# Forge — Antipatterns

> Category index. Lists theme pages describing **proven approaches that don't work** — failure modes, traps, lessons from prior cycles.

`brain-lint` ensures every theme page with `category: antipattern` appears here exactly once.

## Theme pages

### Git / merge

- [`squash-merge-stacked-prs`](./themes/squash-merge-stacked-prs.md) — Squash-merging stacked PRs orphans children. v1 Cycle 2 trafficGame: 90 test failures + 12 TS errors after 8 squashed PRs.
- [`merge-boundary-stacked-initiative-failure`](./themes/merge-boundary-stacked-initiative-failure.md) — 12 trafficGame cycles; only PR #47 truly merged. Approved feature initiatives died at `gh pr merge` yet moved to done/. Queue done/ ≠ merged.

### Loop / orchestration waste

- [`rate-limit-no-backoff`](./themes/rate-limit-no-backoff.md) — Immediate retry after rate-limit produces 215+ zero-cost spawns; 49% of v1 Cycle 3 failures.
- [`agent-stuck-no-detection`](./themes/agent-stuck-no-detection.md) — Silent build/test loops; 12 timeouts/day at $8-12 waste in v1.
- [`review-fix-loop-spinning`](./themes/review-fix-loop-spinning.md) — Missing SHA-guard caused 70+ review-fix cycles overnight in v1 Cycle 1; $200 waste.
- [`reactive-constraint-stripback-arc`](./themes/reactive-constraint-stripback-arc.md) — Agent-facing constraints (path validator, brain-first gate, noop stop) masked structural bugs (cwd=forgeRoot, shared scratch); fixes were deletions.

### Memory & learning

- [`episodic-not-cumulative-learnings`](./themes/episodic-not-cumulative-learnings.md) — 5 identical learnings/day from truncated cross-cycle context; the brain is the architectural fix.

### Operational discipline

- [`human-directed-work-as-initiatives`](./themes/human-directed-work-as-initiatives.md) — Hand-directed project surgery routed through the pipeline pollutes autonomy metrics; needs an `origin` tag.
- [`pm-bounded-brain-query`](./themes/pm-bounded-brain-query.md) — 9+ brain-query calls in one cycle signals exploration confusion, not depth; the PM SKILL caps it at ≤3 queries.
- [`quality-gate-cmd-must-assert-new-work`](./themes/quality-gate-cmd-must-assert-new-work.md) — A `quality_gate_cmd` like `go test ./...` false-passes when zero tests were added; the gate must assert the expected new artefact landed.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas`](./themes/2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas.md) — Across 6 ralph sessions in a framework-migration cycle, brainReads=0 in every session; all three live-acc failures (duplicate resource type, nil-Meta, 1000-project cap) were re-derived from scratch via 20-108 bash/read calls despite being in profile.md.

- [`2026-06-07-forge-demo-render-dir-cwd-trap`](./themes/2026-06-07-forge-demo-render-dir-cwd-trap.md)

- [`2026-06-22-demo-capture-missing-from-unifier-prompt`](./themes/2026-06-22-demo-capture-missing-from-unifier-prompt.md) — The unifier-invocation prompt only says `forge demo render` — never `forge demo capture`. A secondary bug causes captureCheckpoints to skip ALL capture when the fresh-worktree build is non-zero, so demos fall back to prose beforeNote/afterNote instead of real CLI output.

- [`2026-06-21-unifier-demo-render-discovery`](./themes/2026-06-21-unifier-demo-render-discovery.md) — The unifier skill spends significant tokens probing forge internals to find the demo render sub-command or its --dir flag convention; it falls back to manual file copy after failing to invoke it correctly.

- [`2026-06-20-unifier-pr-description-restore-loop`](./themes/2026-06-20-unifier-pr-description-restore-loop.md) — The automated chore:drop-forge-scratch commit stripped .forge/pr-description.md on each iteration, causing the unifier to spend 12 iterations restoring it rather than doing substantive work.

- [`2026-06-20-pm-must-grep-test-name-before-gate`](./themes/2026-06-20-pm-must-grep-test-name-before-gate.md) — PM invented a plausible but nonexistent test name in quality_gate_cmd; forge no-work guard fired 5 times; pipeline dead-ended. Operator confirmed this should be a hard brain constraint, not just manifest guidance.

- [`2026-06-20-pm-invented-test-name-gate-failure`](./themes/2026-06-20-pm-invented-test-name-gate-failure.md) — The PM invented TestProvider_HasCorrectResources as the quality_gate_cmd for a provider-registration WI. The test does not exist; go test returned [no tests to run] every iteration; the no-work guard fired 5 times and exhausted the iteration budget.

- [`2026-06-20-pm-acceptance-gate-misfires-on-scoped-docs-initiatives`](./themes/2026-06-20-pm-acceptance-gate-misfires-on-scoped-docs-initiatives.md) — Blanket 'must include TF_ACC acceptance WI' rule causes 4+ PM retries when the initiative explicitly scopes out live acceptance testing (e.g. docs/examples-only changes).

- [`2026-06-19-unifier-cwd-forge-root-exploration`](./themes/2026-06-19-unifier-cwd-forge-root-exploration.md) — When unifier runs with cwd at forge root rather than the worktree, it reads wrong AGENT.md/fix_plan.md paths and burns ~30 tool calls probing forge CLI internals (forge demo render, orchestrator structure) before finding what it needs.

- [`2026-06-16-unifier-demo-render-undiscoverable`](./themes/2026-06-16-unifier-demo-render-undiscoverable.md) — Unifier spent ~40 Bash calls finding the correct forge demo render invocation and demo.json schema because PROMPT.md/AGENT.md in the worktree don't document it — a recurring friction cost.

- [`2026-06-12-pm-ignores-manifest-regrounding-annotation`](./themes/2026-06-12-pm-ignores-manifest-regrounding-annotation.md) — PM decomposed WIs using already-passing test names as gates despite an operator re-grounding annotation explicitly warning that would cause gate-too-loose; 0/3 WIs completed and the entire dev-loop failed.

- [`2026-06-12-annotate-manifest-folded-scalar-doubling`](./themes/2026-06-12-annotate-manifest-folded-scalar-doubling.md) — Long manifest values (worktree_path ≥ ~80 chars) serialize as folded `>-` two-line scalars; annotateManifest's single-line regex replace left the continuation line behind, so the manifest re-parsed with the value doubled ("path path") and `forge review --approve` refused with "worktree missing". Fixed 2026-06-12 (scheduler.ts, commit 20092e9).

- [`2026-06-11-unifier-wedge-33hr-no-tool-progress`](./themes/2026-06-11-unifier-wedge-33hr-no-tool-progress.md) — Second unifier invocation (UWI-2) stalled with tool_use_count frozen at 16 from 2026-06-08T12:08 to 2026-06-09T21:29 (~33 hours), heartbeating every 15s, then crashed "exited code 1" — worktree blocked for the full duration.

- [`2026-06-08-dev-loop-zero-brain-reads-persistent`](./themes/2026-06-08-dev-loop-zero-brain-reads-persistent.md) — Across multiple cycles, dev-loop (developer-ralph) agents show brainReads:0 while PM agents read 3-5 brain pages. Work items are the only context the dev-loop agents receive; brain knowledge present in the PM phase does not carry forward to the dev-loop phase.

- [`2026-06-07-resume-needs-rebase-concurrent-merge`](./themes/2026-06-07-resume-needs-rebase-concurrent-merge.md) — An initiative that stalls in queue accumulates conflict risk; when another initiative merges to main during the stall, the queued branch cannot auto-rebase on resume and is classified terminal/non-recoverable.

- [`2026-06-06-unifier-forge-cli-cwd-confusion`](./themes/2026-06-06-unifier-forge-cli-cwd-confusion.md) — The unifier runs inside the project worktree but forge CLI commands (e.g. `forge demo render`) must be invoked from the forge root — the unifier wastes Bash calls probing the wrong cwd before resolving.

- [`2026-06-06-live-acc-gate-misses-lint-ci-gate-net`](./themes/2026-06-06-live-acc-gate-misses-lint-ci-gate-net.md) — For a live-acceptance work item, the per-WI quality_gate_cmd is the acceptance test (e.g. `go test -tags all -run TestX ./acceptancetests/`), which does NOT run the project linter. So the dev-loop can mark a WI `complete` while its code is golangci-lint-red — the standing AC tells the agent "CI-equivalent must pass" but nothing ENFORCES it at the per-WI gate. The cycle-level CI DELIVERY GATE (`make test && golangci-lint run ./... && make terrafmt-check`, with TF_ACC stripped) catches it and CORRECTLY refuses to open the PR — same "gate != project CI" class as the 2026-05-31/06-02 findings, now in the live-acc-WI guise. Recovery that works: hand-fix the lint, then `forge requeue --resume-from=unifier` → re-runs the unifier + CI gate (now green) + opens the PR, WITHOUT discarding the dev-loop's delivery (resume-don't-discard). The shared-acceptance-fixture cycle validated the full operator journey end-to-end this way (architect council → PLAN gate → PM → dev-loop → unifier → CI gate BLOCKS → resume → review → merge). Direction: run the project linter INSIDE the dev-loop for live-acc WIs (append it to the composed per-WI gate, or a changed-files lint sub-check at dev-loop close) so a lint-red WI can't reach `complete` and fail only at the end.

- [`2026-06-05-forge-demo-render-cwd-sensitivity`](./themes/2026-06-05-forge-demo-render-cwd-sensitivity.md) — The unifier's `forge demo render <id>` call fails silently when cwd is not the worktree root containing `demo/<id>/demo.json`; requires explicit `--dir <abs-path>` to resolve correctly.
