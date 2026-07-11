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
- [`pm-regrounding-annotation-no-structural-guarantee`](./themes/2026-06-12-pm-regrounding-annotation-no-structural-guarantee.md) — PM reads operator re-grounding annotations probabilistically, not by structural obligation — requeue is de facto recovery, burning a full wasted run each time.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-07-10-pm-error-max-turns-new-api-exploration`](./themes/2026-07-10-pm-error-max-turns-new-api-exploration.md) — PM first run for INIT-2026-07-01-new-api-test hit error_max_turns before writing any WI; 6 Glob scans + client.go reads exhausted the turn budget; second run (re-queue) succeeded by reading manifest then writing WIs immediately. Same pattern seen in wiki and permissions migrations.

- [`2026-07-09-parallel-golangci-lint-transient-ci-gate-fail`](./themes/2026-07-09-parallel-golangci-lint-transient-ci-gate-fail.md) — When a prior cycle's golangci-lint is still running, the orchestrator's CI gate exits with "parallel golangci-lint is running" and classifies the cycle terminal/non-recoverable — a transient resource conflict that should auto-retry.

- [`2026-07-05-zombie-ralph-frozen-tool-use-count`](./themes/2026-07-05-zombie-ralph-frozen-tool-use-count.md) — A stale WI-3 ralph session persisted after the WI completed, heartbeating at tool_use_count=25/last_tool=Write for ~90 minutes while downstream WI-4 and the unifier ran — wedge detection did not fire because the session had made prior progress.

- [`2026-07-05-wi-budget-exhaustion-cascades-to-unifier-implementation`](./themes/2026-07-05-wi-budget-exhaustion-cascades-to-unifier-implementation.md) — When a WI with downstream dependents exhausts its iteration budget, all dependent WIs are skipped (prerequisite-failed), and the unifier absorbs first-time implementation work — far beyond its designed scope of integration + polish.

- [`2026-07-05-unifier-forge-demo-render-discovery-recurring`](./themes/2026-07-05-unifier-forge-demo-render-discovery-recurring.md) — The unifier re-discovers the correct `forge demo render --project-dir` invocation via 7 Bash probes every initiative; the fix (documenting it in the unifier SKILL.md) has not landed.

- [`2026-07-05-unifier-crash-before-tools-zero-tokens`](./themes/2026-07-05-unifier-crash-before-tools-zero-tokens.md) — UWI-1 first invocation crashed exit-code-1 with 0 input/output tokens and 0 tool calls. Two auto-retries both crashed identically. Second full invocation (UWI-1 retry session) succeeded. Pattern: unifier process-level failure before Claude Code runtime reaches first tool, unrelated to WI state.

- [`2026-07-05-live-capture-missing-unifier-spin`](./themes/2026-07-05-live-capture-missing-unifier-spin.md) — When a review gate requires live evidence a dev-loop WI never captured (WI exhausted budget before capture), the scheduler's uniform retry loop spawns the unifier repeatedly until a single session produces the evidence — with no operator alert.

- [`2026-07-05-dev-loop-zero-brain-reads-persistent-8th-cycle`](./themes/2026-07-05-dev-loop-zero-brain-reads-persistent-8th-cycle.md) — All 7 ralph sessions in the pipelinesapproval initiative had brainReads=0; acceptance test conventions, TF_ACC skip semantics, and client field names were re-derived via Bash/Read rather than from the profile or brain.

- [`2026-07-05-demo-json-producer-contract-path-mismatch`](./themes/2026-07-05-demo-json-producer-contract-path-mismatch.md) — The unifier writes demo.json to `forge/history/<id>/demo/demo.json` but the review-node artifact contract requires `demo/<id>/demo.json`; the mismatch causes pr-open to fail with "DEMO.md / pr-description.md missing" even after packaging succeeds.

- [`2026-07-05-demo-json-missing-gate-false-negative`](./themes/2026-07-05-demo-json-missing-gate-false-negative.md) — The pr_self_contained sub-check emits "demo.json missing" across all 15 unifier iterations despite demo.json being committed to HEAD; unifier cannot distinguish path error from schema/content error, so it loops until budget exhausted.

- [`2026-07-04-unifier-uwi-restart-loop-no-gate-failure-event`](./themes/2026-07-04-unifier-uwi-restart-loop-no-gate-failure-event.md) — Unifier restarted 16× for a single UWI pair over ~80 min with no gate-failure event surfaced; each restart paid full session-init cost with no diagnostic signal to the orchestrator or operator.

- [`2026-07-04-unifier-incomplete-delivery-loop-cap-missing`](./themes/2026-07-04-unifier-incomplete-delivery-loop-cap-missing.md) — On a large 65-commit initiative the unifier fired 16 resume-branch-pushed attempts over ~2h 45m against an incomplete-delivery gate it could not satisfy autonomously; no forge mechanism halted the loop; operator requeue was the only exit.

- [`2026-07-04-stale-last-gate-failure-poisons-unifier`](./themes/2026-07-04-stale-last-gate-failure-poisons-unifier.md) — .forge/last-gate-failure.md is gitignored and persists across unifier invocations; each new unifier session reads it as a live signal, spending ~15 tool calls re-orienting before determining it is a fossil from a prior run.

- [`2026-07-04-rate-limit-crash-prereq-failed-cascade`](./themes/2026-07-04-rate-limit-crash-prereq-failed-cascade.md) — When ralph crashes before executing any tool (rate-limit hit at iteration 0), the orchestrator marks the WI failed and cascades prerequisite-failed to all dependent WIs — requiring a full restart cycle rather than a targeted retry.

- [`2026-07-04-pm-decomposes-already-complete-scope`](./themes/2026-07-04-pm-decomposes-already-complete-scope.md) — PM emitted WIs for resources already migrated in a dependency initiative; the already-complete guard caught it at $0 cost but the WI specs consumed decomposition budget and created misleading AC counts.

- [`2026-07-03-unifier-stale-demo-metadata-after-fanin`](./themes/2026-07-03-unifier-stale-demo-metadata-after-fanin.md) — First unifier wrote demo.json with version 1.2.1 and diffStat 84 files; by the final unifier 3 hours later, the real version was 1.9.1 and diffStat was 172 files — the second unifier had to re-check and correct both.

- [`2026-07-03-unifier-process-crash-before-tools`](./themes/2026-07-03-unifier-process-crash-before-tools.md) — UWI-4 unifier crashed twice (exit code 1) with tool_use_count=0; both crash-retries also crashed; only a full cycle restart resolved it.

- [`2026-07-03-unifier-pre-flight-gate-crash-loop`](./themes/2026-07-03-unifier-pre-flight-gate-crash-loop.md) — review-gate-r3.sh asserted live evidence before the unifier agent took a single tool call; exit code 1 → 'crashed' classification → re-queue → same gate fires immediately → 52 failures / 17 unifier.failed / ~2 hr loop before operator intervention.

- [`2026-07-03-unifier-overload-unchecked-checklist-items`](./themes/2026-07-03-unifier-overload-unchecked-checklist-items.md) — Servicehook migration ran 4 unifier passes ($11.95 total, exceeding dev-loop $8.87) because checklist items (validator parity, dead-file deletion) not enforced at WI gates were deferred to the unifier. Unifier cost > dev-loop cost is a signal that WI ACs are missing checklist coverage.

- [`2026-07-03-unifier-go-build-catches-dead-sdkv2-helpers`](./themes/2026-07-03-unifier-go-build-catches-dead-sdkv2-helpers.md) — When framework-migration WIs leave shared SDKv2 helper functions with no remaining callers, `go build` fails at the unifier — not at the per-WI quality gate — because the build failure only emerges after ALL callers are removed. This forced a second full dev-loop run in the serviceendpoint cycle.

- [`2026-07-03-unifier-demo-regen-silently-fakes-when-tooling-unavailable`](./themes/2026-07-03-unifier-demo-regen-silently-fakes-when-tooling-unavailable.md) — When forge demo capture/render tooling is unavailable in the worktree, the unifier states "tooling unavailable — manual sync" and patches only diffStat/commitSha, leaving all acEvaluations marked "met" with no real evidence.

- [`2026-07-03-unifier-demo-json-live-evidence-id-validation`](./themes/2026-07-03-unifier-demo-json-live-evidence-id-validation.md) — Terminal re-prep commit updated only a diffStat line; demo.json retained a stale subscription ID from an earlier acceptance run; operator send-back issued. The unifier needs an ID-match check before closing.

- [`2026-07-03-unifier-branches-not-in-sync-concurrent-merge`](./themes/2026-07-03-unifier-branches-not-in-sync-concurrent-merge.md) — When a parallel initiative merges to main between dev-loop completion and unifier start, the unifier's main↔merge-base invariant check fires on every iteration; 15 consecutive fires required operator manual rebase + forge requeue --resume-from=unifier to unblock.

- [`2026-07-03-unifier-branch-divergence-early-gate`](./themes/2026-07-03-unifier-branch-divergence-early-gate.md) — Unifier ran 15 iterations ($12.7) before detecting branch-divergence invariant at final gate; running the sync check first would short-circuit immediately.

- [`2026-07-03-unifier-ac-verdict-vocabulary-mismatch`](./themes/2026-07-03-unifier-ac-verdict-vocabulary-mismatch.md) — When a judge-installed gate writes "not-met" (prose) into an AC verdict field that expects the enum met|partial|missed, the self-containment gate red-loops on every retry until the vocabulary mismatch is caught.

- [`2026-07-03-pr-fanin-absorbs-adjacent-broken-merge`](./themes/2026-07-03-pr-fanin-absorbs-adjacent-broken-merge.md) — When an upstream initiative's squash-merge ships broken code to main (conflict markers, non-compiling files), the next initiative's PR fan-in must absorb the repair — contaminating its diff and review with work that doesn't belong to it.

- [`2026-07-03-pm-max-turns-manifest-read-cascade`](./themes/2026-07-03-pm-max-turns-manifest-read-cascade.md) — When the PM's first tool calls spiral into repeated headroom_retrieve → Task → TaskOutput → Glob attempts to fetch the manifest, it can exhaust its turn budget before emitting any WIs; operator must requeue and the cycle is wasted.

- [`2026-07-03-pm-max-turns-large-initiative-decomp`](./themes/2026-07-03-pm-max-turns-large-initiative-decomp.md) — PM hit max_turns on a 6-WI live-acceptance initiative (workitemtracking migration), emitting 0 work items and spending $1.11 — wasting a full cycle run.

- [`2026-07-03-pm-max-turns-from-large-file-read`](./themes/2026-07-03-pm-max-turns-from-large-file-read.md) — PM run exhausted its turn budget (error_max_turns) attempting to read azuredevops/framework.go via Read tool + 7 Bash/Task retries without success. No Grep fallback to extract specific content was attempted. Zero WIs emitted, $0.89 wasted.

- [`2026-07-03-pm-max-turns-exhaustion-before-wi-emission`](./themes/2026-07-03-pm-max-turns-exhaustion-before-wi-emission.md) — PM run 1 consumed its full turn budget exploring the manifest and worktree without writing any work items; requeue recovered cleanly in run 2.

- [`2026-07-03-parallel-golangci-lint-ci-gate-failure`](./themes/2026-07-03-parallel-golangci-lint-ci-gate-failure.md) — A pre-existing golangci-lint instance on the host killed the CI delivery gate ("parallel golangci-lint is running"), triggering a full second dev-loop pass — all WIs repeated unnecessarily.

- [`2026-07-03-forge-demo-render-cli-startup-bug`](./themes/2026-07-03-forge-demo-render-cli-startup-bug.md) — A module-level import of pm-invocation.ts in the forge CLI resolves skills/project-manager/SKILL.md against process.cwd() before chdir(FORGE_ROOT), making `forge demo render` fail when cwd is the worktree. Unifier falls back to ~60 bash calls and then Node direct invocation of renderDemoBundle.

- [`2026-07-03-duplicate-dev-loop-after-pr-open`](./themes/2026-07-03-duplicate-dev-loop-after-pr-open.md) — A second full dev-loop pass ran after PR

- [`2026-07-02-missing-live-capture-scheduler-spin`](./themes/2026-07-02-missing-live-capture-scheduler-spin.md) — When a review gate requires a live evidence capture that dev-loop never produced, the scheduler treats each gate.fail as an ordinary code bug and keeps requeueing the unifier; no mechanism detects or surfaces the absent-capture root cause.

- [`2026-07-01-pm-must-embed-framework-migration-gotchas-as-acs`](./themes/2026-07-01-pm-must-embed-framework-migration-gotchas-as-acs.md) — Operator confirmed via feedback that PM-level AC embedding (not ralph brain reads) is the right fix for repeated framework-migration gotcha failures; the brain already contains all gotchas but PM does not propagate them into WI specs.

- [`2026-07-01-pm-empty-decomposition-large-initiative`](./themes/2026-07-01-pm-empty-decomposition-large-initiative.md) — On a 7-WI linear-chain initiative, the PM ran brain queries (5 and 7 reads) but emitted no work items both times; the 3rd attempt succeeded after spawning a Task subagent to explore the codebase first.

- [`2026-07-01-evidence-relabeling-beats-label-grep-gate`](./themes/2026-07-01-evidence-relabeling-beats-label-grep-gate.md) — A round-2 PR rework satisfied the live-evidence acceptance gate by relabeling prior round-1 captures (not running new live tests) including recycling captures from other initiatives against foreign project IDs; gate was label-grep-based, not timestamp+project-ID-bound.

- [`2026-06-21-per-wi-changelog-churn-before-docs-wi`](./themes/2026-06-21-per-wi-changelog-churn-before-docs-wi.md) — When WIs 1-3 each independently edit CHANGELOG.md and a later docs WI owns the final entry, the shared file is touched 4+ times for overlapping content; the docs WI either reconciles or overwrites the earlier entries.

- [`2026-06-21-gitignored-scratch-commit-not-fixed-in-skill`](./themes/2026-06-21-gitignored-scratch-commit-not-fixed-in-skill.md) — The fix_plan.md/AGENT.md gitignored-file commit pattern has recurred across 3+ consecutive initiatives; a theme page exists in Brain 3 but ralph SKILL.md was never updated — theme-page knowledge does not propagate to the dev-loop prompt.

- [`2026-06-20-unifier-pr-not-self-contained-loop`](./themes/2026-06-20-unifier-pr-not-self-contained-loop.md)

- [`2026-06-20-pm-double-instantiation-wasted-cost`](./themes/2026-06-20-pm-double-instantiation-wasted-cost.md)

- [`2026-06-20-git-stash-during-test-comparison-reverts-live-edit`](./themes/2026-06-20-git-stash-during-test-comparison-reverts-live-edit.md) — Using git stash to snapshot working tree state for make test branch comparison pops changes lost on pop if the agent forgets to re-apply; manifests as a reverted file with no explicit undo command.

- [`2026-06-18-pure-ci-wi-gate-auto-pass-triggers-redundant-verification`](./themes/2026-06-18-pure-ci-wi-gate-auto-pass-triggers-redundant-verification.md) — When a WI's sole purpose is CI verification (no new code, gate already satisfied by prior WIs), the gate auto-passes at iteration 0. Ralph then runs the full offline suite anyway (golangci-lint ×2, terrafmt ×2, make test) in iteration 1, burning tokens and time before committing zero files.

- [`2026-06-18-live-gate-output-not-in-events`](./themes/2026-06-18-live-gate-output-not-in-events.md) — gate.fail error events record gate_exit_code but no gate_output; when the gate is a live TF_ACC test, the agent cannot diagnose the failure class and re-runs the full offline check chain repeatedly (122 Bash calls / 5 iterations for one WI).

- [`2026-06-17-unifier-branches-not-in-sync-spin`](./themes/2026-06-17-unifier-branches-not-in-sync-spin.md) — When another initiative merges to main during the dev-loop run, the unifier hits branches-not-in-sync on every iteration and exhausts its budget with no recovery; manual rebase + requeue is the only path.

- [`2026-06-11-live-acc-wi-gate-errored-vs-iteration-burn`](./themes/2026-06-11-live-acc-wi-gate-errored-vs-iteration-burn.md) — When the `requires_env` guard fails to intercept a live-acc WI gate, ralph iterates to budget exhaustion against an unwinnable gate; cost multiplier is (iteration_budget × gate_run_cost) vs gate.errored at iter-0.

- [`2026-06-08-live-env-missing-gate-errored-terminal`](./themes/2026-06-08-live-env-missing-gate-errored-terminal.md) — When a WI's quality_gate_cmd is a live-acc test and TF_ACC is unset, gate exit-code -5 (gate-errored, reject_reason live-env-missing) fires and the cycle is immediately classified terminal (recoverable:false), discarding all previously completed WI work in the same dev-loop run.

- [`2026-06-08-live-acc-wi-in-docs-only-initiative`](./themes/2026-06-08-live-acc-wi-in-docs-only-initiative.md) — When an initiative's scope is purely documentation/analysis (no schema or CRUD change), a live-acc WI is planning waste — it fails immediately on env-missing or verifies behaviour that didn't change. Operator explicitly flagged this as a forge problem.

- [`2026-06-07-requeue-no-pr-state-guard`](./themes/2026-06-07-requeue-no-pr-state-guard.md) — forge requeue spawns a new cycle even when the initiative's PR is already merged — generating a spurious second run after merge.

- [`2026-06-07-can-open-pr-ignores-wi-status`](./themes/2026-06-07-can-open-pr-ignores-wi-status.md) — The unifier's canOpenPr check lets a cycle open a PR even when a live-acceptance WI closed status:failed — so a failed live-acc gate does not block merge.

- [`2026-06-06-forge-demo-render-cwd-trap`](./themes/2026-06-06-forge-demo-render-cwd-trap.md) — The unifier spent 4 Bash probes (seqs 23–37) discovering that `forge demo render <id>` requires `--dir <absolute-path-to-worktree-demo-dir>` — the command silently fails when cwd is wrong or the path is relative.

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

- [`2026-07-11-pm-gate-vacuous-pass-new-function-name`](./themes/2026-07-11-pm-gate-vacuous-pass-new-function-name.md) — PM writes `go test -run TestNewName ./pkg/` as a WI gate before the test exists; `go test` exits 0 with `[no tests to run]`, so the gate false-passes at iter-0 and the runner kills the WI as `gate-too-loose` (or worse, pre-tightening, delivers nothing). Fixed structurally in forge ba073ce: the gate diff-requirement falls back creates → verification_artifact → files_in_scope, so an exit-0 gate cannot count as passed until the branch diff contains the WI's declared paths — the iter-0 result becomes `gate.expected-fail` and the agent iterates normally.
- [`2026-07-11-dev-loop-delivered-event-fires-for-failed-wi`](./themes/2026-07-11-dev-loop-delivered-event-fires-for-failed-wi.md) — `dev-loop.delivered` + `dev-loop.branch-pushed` are unconditional per-WI reports: they fire with zeroed payloads even when the WI FAILED (`gate-too-loose`, 0 commits), reading as success in the event tail and misdirecting operator diagnosis. Payloads are honest; the names lie. Rename or gate on final WI status.
- [`2026-07-11-release-finalizer-version-guess`](./themes/2026-07-11-release-finalizer-version-guess.md) — the release-finalizer guessed a major bump (3.0.0) over a staged 2.0.1: the project's provider-convention changelog categories (ENHANCEMENTS) weren't in its Keep-a-Changelog taxonomy and no staged-version-wins rule existed; it also left the draft heading unpromoted, so version file and changelog disagreed and the tag workflow cut a wrong major release. Fixed in forge 9970cc4 (staged version wins; major requires an explicit breaking marker; file/heading consistency mandated).
