# QUARRY — every production file, its owner package, and how it moves

This file is **load-bearing**, not a planning note: `scripts/check-owner.mjs` reads it
and fails CI when a production file has no row, has two, or names an owner or a
disposition outside the vocabularies below. A file that changes owner changes this
file in the same PR.

**Scope.** Every production file under `orchestrator/`, `cli/`, `loops/` and
`skills/` — code (`.ts .tsx .mjs .js .cjs`) plus the `SKILL.md` agent definitions,
which are production artifacts ([ADR 024](docs/decisions/024-phases-as-subagents-invoking-skills.md):
the `SKILL.md` **is** the agent). Test files and fixtures are excluded — a test
travels with the module it tests.

**Owner** is one of the nine packages plus the two apps named by
[`docs/roadmaps/1.0.md`](docs/roadmaps/1.0.md) §0 and §4 M2, and described in the
blueprint spec
[§3](docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md). ADR 046
ratifies that layout and is **proposed, not yet accepted** — it is parked at the
operator gate H5 (`1.0.md` §5), so this file cites the roadmap and the spec,
which are on `main`, rather than an ADR that is not. **Disposition** is how the
file reaches its package at M3:

| disposition | meaning | count |
|---|---|---|
| `verbatim` | moves unchanged | 224 |
| `pruned` | moves, with a part that belongs elsewhere dropped on the way | 5 |
| `rewritten` | **cannot** move without a behaviour change; stays where it is until rewritten | 11 |
| `deleted` | not carried forward | 1 |

## Per-package LOC caps

Spec §8: "Per-package LOC cap (starting values from the QUARRY.md targets)". A
package that would exceed its cap parks; the fix is a cull, a split, or an
operator-ratified new cap — never a silent raise.

| package | files | quarried LOC | cap | note |
|---|---|---|---|---|
| `contracts` | 1 | 738 | **1,000** | the spec targets ~0.3k. The single quarried file is 738 lines and must be pruned to types + constants; the cap is the ceiling it must come under, not a licence to stay at 738. |
| `kernel` | 12 | 5,220 | **5,500** | quarried lines only. The spec's separate "~3k of new logic" cap governs anything WRITTEN into kernel rather than moved; the two are counted apart. |
| `library` | 33 | 12,070 | **12,500** | seeded from the quarried total, rounded up to the next 500. |
| `knowledge` | 26 | 11,157 | **11,500** | seeded from the quarried total, rounded up to the next 500. |
| `projects` | 22 | 7,841 | **8,000** | seeded from the quarried total, rounded up to the next 500. |
| `agents` | 30 | 8,798 | **9,000** | seeded from the quarried total, rounded up to the next 500. |
| `sessions` | 20 | 13,078 | **13,500** | seeded from the quarried total, rounded up to the next 500. |
| `flows` | 58 | 22,131 | **22,500** | seeded from the quarried total, rounded up to the next 500. |
| `factory` | 35 | 12,044 | **12,500** | seeded from the quarried total, rounded up to the next 500. This package is deletable; its cap is a ceiling on the EXAMPLE, not on the platform. |
| `apps/forge` | 4 | 10,089 | **800** | the spec states "CLI router + bridge host (≤800 lines)". The quarried total is 10,089 — a 9,289-line debt, all four files marked pruned or rewritten. This cap is a TARGET the move must reach, not a baseline. |
| `apps/studio` | 0 | 0 | — | the `git mv` of `forge-ui`; it quarries nothing from these four trees. |
| **total** | **241** | **103,166** | | |

## Three numbers that are findings, not targets

1. **`apps/forge` is 9,289 lines over its stated cap.** The spec fixes the router and
   bridge host at ≤800 lines; the four files that land there quarry 10,089, of which
   `cli/ui-bridge.ts` alone is 6,602. Three of the four are marked `rewritten` and one
   `pruned` for exactly this reason: the host is a monolith that mixes generic
   plumbing with route handlers belonging to five packages. Reaching 800 is the
   single largest piece of M3/M4 work this quarry surfaces.
2. **`contracts` quarries one file, 738 lines, against a ~0.3k target.**
   `orchestrator/studio/types.ts` is the only file in the tree that is purely types
   with no runtime behaviour. It moves `verbatim` and is then pruned to what
   `apps/studio` actually imports.
3. **Eleven files are `rewritten` and therefore do NOT move at M3.** Each straddles two or
   more packages, and rewriting one here would be a behaviour change smuggled into a
   move. They are listed together below so the M4 lanes inherit them explicitly.

### The `rewritten` set — files that stay put until their package rewrites them

| path | owner | LOC | why it cannot move as-is |
|---|---|---|---|
| `cli/bridge-studio-affordances.ts` | `sessions` | 1,313 | generic ADR-043 affordance dispatch with per-kind library/factory/agents logic inlined |
| `cli/bridge-studio-writes.ts` | `projects` | 2,482 | one route file writing agent SKILL.md, community entries, project scaffolding and flow.yaml |
| `cli/bridge-studio.ts` | `apps/forge` | 1,750 | generic CSRF/origin/JSON plumbing interleaved with flows and library GET routes |
| `cli/dry-bridge.ts` | `kernel` | 453 | one static table classifying routes owned by flows, agents and library alike |
| `cli/studio-lint.ts` | `kernel` | 805 | validates agent, flow, catalog and community definitions in a single pass |
| `cli/studio-provenance.ts` | `kernel` | 54 | a 54-line pure mapping whose ONLY test is a 642-line bridge integration test that imports `ui-bridge.ts`; the test cannot follow it into a package without dragging the bridge across the boundary, and a kernel module with no package-level test is the shape this campaign exists to stop. Needs its pure-mapping test extracted from the integration test first |
| `cli/ui-bridge.ts` | `apps/forge` | 6,602 | the 6,602-line host: agent spawn, session index and authoring routes in one file |
| `orchestrator/band-agent-run.ts` | `agents` | 242 | generic band dispatch that hardcodes two `orchestrator/phases/` imports — the port must exist first |
| `orchestrator/flow-runner.ts` | `flows` | 1,608 | imports ten phases directly; M2-B replaces them with the `PhaseExecutor` port |
| `orchestrator/project-brain-builder-runner.ts` | `knowledge` | 448 | a knowledge concern wrapped in the sessions turn-loop plumbing it must shed |
| `orchestrator/studio/registry.ts` | `kernel` | 1,180 | one loader for Agent, Flow, KB, Catalog, Community, Template and Project — five packages in one file |
| `orchestrator/studio/validate.ts` | `kernel` | 1,066 | the same five-way split on the validation side |

### `pruned` and `deleted`

| path | owner | disposition | LOC | what is dropped |
|---|---|---|---|---|
| `orchestrator/brain-paths.ts` | `knowledge` | `pruned` | 141 | the project-side `.forge/` artifact-root read goes to `projects` |
| `orchestrator/cli.ts` | `apps/forge` | `pruned` | 998 | every subcommand body goes to the package that owns it; only the router stays |
| `orchestrator/flow-artifacts.ts` | `flows` | `pruned` | 437 | the develop-flow-specific artifact schemas go to `factory` |
| `orchestrator/init.ts` | `kernel` | `pruned` | 144 | the `forge init` command shell goes to `apps/forge`; the layout constants stay |
| `orchestrator/_pkg/contracts.ts` | `contracts` | `deleted` | 12 | the one greppable shim through which legacy reaches `@forge/contracts` (§0); deleted at cutover, and `grep -rl "_pkg/contracts"` is the exact list of legacy files still depending on the package |
| `orchestrator/phases/demo-fanin-honesty.ts` | `factory` | `deleted` | 183 | dead: its only production caller was the retired unifier gate; knip and grep agree nothing reaches it |
| `orchestrator/phases/developer-loop.ts` | `factory` | `pruned` | 1,941 | the per-work-item queue and recovery bookkeeping goes to `flows` (spec §3.1: "queue/recovery → flows") |

## Every production file

| path | owner | disposition | loc |
|---|---|---|---|
| cli/agent-run.ts | agents | verbatim | 933 |
| cli/architect-plan.ts | factory | verbatim | 862 |
| cli/brain-fix-auto.ts | knowledge | verbatim | 255 |
| cli/brain-index.ts | knowledge | verbatim | 369 |
| cli/brain-lint.ts | knowledge | verbatim | 1697 |
| cli/bridge-hooks.ts | flows | verbatim | 397 |
| cli/bridge-recovery.ts | flows | verbatim | 258 |
| cli/bridge-studio-affordances.ts | sessions | rewritten | 1313 |
| cli/bridge-studio-agent-capability.ts | sessions | verbatim | 117 |
| cli/bridge-studio-authoring.ts | library | verbatim | 956 |
| cli/bridge-studio-community.ts | library | verbatim | 833 |
| cli/bridge-studio-connections.ts | library | verbatim | 225 |
| cli/bridge-studio-hooks.ts | library | verbatim | 727 |
| cli/bridge-studio-instructions.ts | library | verbatim | 149 |
| cli/bridge-studio-kb-drain.ts | knowledge | verbatim | 1696 |
| cli/bridge-studio-kbs.ts | knowledge | verbatim | 2068 |
| cli/bridge-studio-lifecycle.ts | sessions | verbatim | 424 |
| cli/bridge-studio-runs.ts | flows | verbatim | 947 |
| cli/bridge-studio-session-cancel.ts | sessions | verbatim | 206 |
| cli/bridge-studio-sessions.ts | sessions | verbatim | 1096 |
| cli/bridge-studio-skills.ts | library | verbatim | 578 |
| cli/bridge-studio-templates.ts | library | verbatim | 348 |
| cli/bridge-studio-writes.ts | projects | rewritten | 2482 |
| cli/bridge-studio.ts | apps/forge | rewritten | 1750 |
| cli/community-refresh-cmd.ts | library | verbatim | 104 |
| cli/community-refresh-run.ts | library | verbatim | 454 |
| cli/community-registry-lock.ts | library | verbatim | 126 |
| cli/contract-compliance-loop.ts | projects | verbatim | 167 |
| cli/contract-stages.ts | projects | verbatim | 324 |
| cli/cycle-recap.ts | factory | verbatim | 395 |
| cli/cycle-retention.ts | knowledge | verbatim | 204 |
| cli/demo-capture.ts | factory | verbatim | 48 |
| cli/demo-model.ts | factory | verbatim | 744 |
| cli/demo-runtime.ts | factory | verbatim | 184 |
| cli/demo-types.ts | factory | verbatim | 59 |
| cli/demo.ts | factory | verbatim | 232 |
| cli/dry-bridge.ts | kernel | rewritten | 453 |
| cli/flow-band-vocab.ts | flows | verbatim | 67 |
| cli/forge-metrics.ts | flows | verbatim | 782 |
| cli/forge-requeue.ts | flows | verbatim | 273 |
| cli/forge-watch.ts | apps/forge | verbatim | 739 |
| cli/kb-drain-edit-soundness.ts | knowledge | verbatim | 747 |
| cli/kb-drain-structural.ts | knowledge | verbatim | 230 |
| cli/kb-job-state.ts | knowledge | verbatim | 208 |
| cli/kb-lint-summary.ts | knowledge | verbatim | 545 |
| cli/kb-read-policy.ts | knowledge | verbatim | 91 |
| cli/kb-sites.ts | knowledge | verbatim | 110 |
| cli/manifest-path-guard.ts | flows | verbatim | 344 |
| cli/materials-staging.ts | agents | verbatim | 269 |
| cli/metrics.ts | flows | verbatim | 142 |
| cli/preflight-fix-auto.ts | projects | verbatim | 171 |
| cli/preflight-resolve.ts | projects | verbatim | 67 |
| cli/preflight.ts | projects | verbatim | 1135 |
| cli/project-migrate.ts | projects | verbatim | 197 |
| cli/reflect-reconcile.ts | factory | verbatim | 167 |
| cli/reflection-doc.ts | factory | verbatim | 354 |
| cli/run-list-cache.ts | flows | verbatim | 397 |
| cli/session-model-tier.ts | sessions | verbatim | 49 |
| cli/session-readability.ts | sessions | verbatim | 207 |
| cli/skill-staging.ts | library | verbatim | 136 |
| cli/studio-lint-tool-fence.ts | library | verbatim | 149 |
| cli/studio-lint.ts | kernel | rewritten | 805 |
| cli/studio-path-guard.ts | kernel | deleted | 8 |
| cli/studio-provenance.ts | kernel | rewritten | 54 |
| cli/theme-frontmatter.ts | knowledge | verbatim | 116 |
| cli/ui-bridge.ts | apps/forge | rewritten | 6602 |
| loops/_adapters/aider/index.ts | agents | verbatim | 485 |
| loops/_adapters/claude/index.ts | agents | verbatim | 29 |
| loops/_adapters/conformance.ts | agents | verbatim | 203 |
| loops/_adapters/example/index.ts | agents | verbatim | 111 |
| loops/_adapters/gemini/index.ts | agents | verbatim | 553 |
| loops/_adapters/registry.ts | agents | verbatim | 107 |
| loops/_adapters/types.ts | agents | verbatim | 56 |
| loops/ralph/claude-agent.ts | agents | verbatim | 553 |
| loops/ralph/runner.ts | agents | verbatim | 435 |
| loops/ralph/stop-conditions.ts | agents | verbatim | 685 |
| orchestrator/_pkg/kernel.ts | kernel | deleted | 9 |
| orchestrator/_pkg/contracts.ts | contracts | deleted | 12 |
| orchestrator/agent-bands.ts | agents | verbatim | 86 |
| orchestrator/agent-dispatch.ts | agents | verbatim | 365 |
| orchestrator/agents-md-compose.ts | projects | verbatim | 109 |
| orchestrator/architect-runner.ts | sessions | verbatim | 1715 |
| orchestrator/band-agent-run.ts | agents | rewritten | 242 |
| orchestrator/bash-fence.ts | sessions | verbatim | 508 |
| orchestrator/brain-fix-runner.ts | sessions | verbatim | 381 |
| orchestrator/brain-paths.ts | knowledge | pruned | 141 |
| orchestrator/claim-validator.ts | flows | verbatim | 233 |
| orchestrator/cli.ts | apps/forge | pruned | 998 |
| orchestrator/completeness-critic-runner.ts | sessions | verbatim | 286 |
| orchestrator/config.ts | kernel | deleted | 8 |
| orchestrator/constraint-author.ts | projects | verbatim | 99 |
| orchestrator/constraint-blocks.ts | projects | verbatim | 257 |
| orchestrator/cron-triggers.ts | flows | verbatim | 242 |
| orchestrator/cycle-context.ts | flows | verbatim | 332 |
| orchestrator/cycle-helpers.ts | flows | verbatim | 694 |
| orchestrator/cycle-report.ts | flows | verbatim | 29 |
| orchestrator/cycle.ts | flows | verbatim | 617 |
| orchestrator/daemon.ts | flows | verbatim | 248 |
| orchestrator/demo-builder-runner.ts | sessions | verbatim | 814 |
| orchestrator/demo-fix-loop.ts | flows | verbatim | 218 |
| orchestrator/demo-paths.ts | flows | verbatim | 71 |
| orchestrator/drain-fix-loop.ts | flows | verbatim | 286 |
| orchestrator/enqueue-develop-run.ts | flows | verbatim | 77 |
| orchestrator/enqueue-flow-run.ts | flows | verbatim | 366 |
| orchestrator/enqueue-plan-run.ts | flows | verbatim | 236 |
| orchestrator/event-cost.ts | kernel | deleted | 8 |
| orchestrator/failure-classifier.ts | agents | verbatim | 517 |
| orchestrator/finalize-merged.ts | flows | verbatim | 412 |
| orchestrator/fix-work-items.ts | flows | verbatim | 388 |
| orchestrator/flow-artifacts.ts | flows | pruned | 437 |
| orchestrator/flow-budgets.ts | flows | verbatim | 450 |
| orchestrator/flow-run-requests.ts | flows | verbatim | 397 |
| orchestrator/flow-runner.ts | flows | rewritten | 1608 |
| orchestrator/flow-trigger.ts | flows | verbatim | 214 |
| orchestrator/gate-fix-loop.ts | flows | verbatim | 163 |
| orchestrator/gate-recipes.ts | projects | verbatim | 146 |
| orchestrator/init.ts | kernel | deleted | 8 |
| orchestrator/initiative-id.ts | flows | verbatim | 210 |
| orchestrator/instruction-seed-match.ts | library | verbatim | 152 |
| orchestrator/instructions-runner.ts | sessions | verbatim | 630 |
| orchestrator/interactive-finalizers.ts | sessions | verbatim | 422 |
| orchestrator/interactive-runner.ts | sessions | verbatim | 883 |
| orchestrator/interactive-session.ts | sessions | verbatim | 993 |
| orchestrator/kb-backend.ts | knowledge | verbatim | 142 |
| orchestrator/kb-graph.ts | knowledge | verbatim | 683 |
| orchestrator/kb-health.ts | knowledge | verbatim | 274 |
| orchestrator/logging.ts | kernel | deleted | 8 |
| orchestrator/manifest.ts | flows | verbatim | 744 |
| orchestrator/mint-triggered-initiative.ts | flows | verbatim | 233 |
| orchestrator/model-range.ts | agents | verbatim | 115 |
| orchestrator/notify.ts | flows | verbatim | 73 |
| orchestrator/phase-agent.ts | agents | verbatim | 101 |
| orchestrator/phases/adversarial-review-binding.ts | factory | verbatim | 139 |
| orchestrator/phases/adversarial-review.ts | factory | verbatim | 393 |
| orchestrator/phases/agent-scope-guard.ts | agents | verbatim | 111 |
| orchestrator/phases/closure.ts | flows | verbatim | 438 |
| orchestrator/phases/decompose-completeness.ts | factory | verbatim | 197 |
| orchestrator/phases/demo-agent-binding.ts | factory | verbatim | 214 |
| orchestrator/phases/demo-agent.ts | factory | verbatim | 740 |
| orchestrator/phases/demo-fanin-honesty.ts | factory | deleted | 183 |
| orchestrator/phases/dev-binding.ts | factory | verbatim | 339 |
| orchestrator/phases/developer-loop.ts | factory | pruned | 1941 |
| orchestrator/phases/orchestrated-capture.ts | flows | verbatim | 301 |
| orchestrator/phases/pm-binding.ts | factory | verbatim | 386 |
| orchestrator/phases/project-manager.ts | factory | verbatim | 859 |
| orchestrator/phases/ralph-spec-lint.ts | flows | verbatim | 469 |
| orchestrator/phases/reflector-binding.ts | factory | verbatim | 262 |
| orchestrator/phases/reflector.ts | factory | verbatim | 981 |
| orchestrator/phases/release-finalize.ts | factory | verbatim | 299 |
| orchestrator/phases/wi-spec-compile.ts | flows | verbatim | 509 |
| orchestrator/pinned-sdk-query.ts | agents | verbatim | 87 |
| orchestrator/planned-initiatives.ts | flows | verbatim | 53 |
| orchestrator/pr.ts | flows | verbatim | 1132 |
| orchestrator/preflight-fix-runner.ts | sessions | verbatim | 248 |
| orchestrator/project-brain-builder-runner.ts | knowledge | rewritten | 448 |
| orchestrator/project-brain-seed.ts | knowledge | verbatim | 353 |
| orchestrator/project-config.ts | projects | verbatim | 970 |
| orchestrator/project-create.ts | projects | verbatim | 379 |
| orchestrator/project-repo-tx.ts | projects | verbatim | 201 |
| orchestrator/promote-manifests.ts | flows | verbatim | 76 |
| orchestrator/queue.ts | flows | verbatim | 231 |
| orchestrator/reflector-rerun.ts | factory | verbatim | 112 |
| orchestrator/release-finalize-invocation.ts | factory | verbatim | 165 |
| orchestrator/release-process.ts | factory | verbatim | 66 |
| orchestrator/requeue-resume.ts | flows | verbatim | 193 |
| orchestrator/review-comments.ts | factory | verbatim | 229 |
| orchestrator/run-agent.ts | agents | verbatim | 665 |
| orchestrator/run-model-derive.ts | flows | verbatim | 988 |
| orchestrator/run-model.ts | flows | verbatim | 981 |
| orchestrator/scheduler-dispatch.ts | flows | verbatim | 252 |
| orchestrator/scheduler.ts | flows | verbatim | 1031 |
| orchestrator/skill-path.ts | agents | verbatim | 373 |
| orchestrator/spawn-env.ts | agents | verbatim | 181 |
| orchestrator/stream-deadline.ts | agents | verbatim | 74 |
| orchestrator/studio/community-index.ts | library | verbatim | 693 |
| orchestrator/studio/community-install.ts | library | verbatim | 208 |
| orchestrator/studio/community-refresh-api.ts | library | verbatim | 588 |
| orchestrator/studio/community-source-url.ts | library | verbatim | 164 |
| orchestrator/studio/connection-catalog.ts | library | verbatim | 163 |
| orchestrator/studio/connection-install.ts | library | verbatim | 101 |
| orchestrator/studio/connection-library.ts | library | verbatim | 230 |
| orchestrator/studio/connection-probe.ts | library | verbatim | 417 |
| orchestrator/studio/connection-readiness.ts | library | verbatim | 49 |
| orchestrator/studio/connection-run-gate.ts | agents | verbatim | 71 |
| orchestrator/studio/connection-validate.ts | library | verbatim | 217 |
| orchestrator/studio/derive.ts | agents | verbatim | 290 |
| orchestrator/studio/hook-dispatch.ts | agents | verbatim | 439 |
| orchestrator/studio/hook-library.ts | library | verbatim | 526 |
| orchestrator/studio/hook-package.ts | library | verbatim | 502 |
| orchestrator/studio/hook-runtime.ts | library | verbatim | 372 |
| orchestrator/studio/hook-scan.ts | library | verbatim | 803 |
| orchestrator/studio/instructions-draft.ts | library | verbatim | 185 |
| orchestrator/studio/kb-descriptor.ts | knowledge | verbatim | 210 |
| orchestrator/studio/materials.ts | agents | verbatim | 194 |
| orchestrator/studio/registry.ts | kernel | rewritten | 1180 |
| orchestrator/studio/session-kinds.ts | sessions | verbatim | 1389 |
| orchestrator/studio/session-transcript.ts | sessions | verbatim | 1359 |
| orchestrator/studio/skill-install-ledger.ts | library | verbatim | 166 |
| orchestrator/studio/skill-library.ts | library | verbatim | 890 |
| orchestrator/studio/skill-md-fidelity.ts | agents | verbatim | 224 |
| orchestrator/studio/template-library.ts | library | verbatim | 610 |
| orchestrator/studio/types.ts | contracts | verbatim | 738 |
| orchestrator/studio/validate-triggers.ts | flows | verbatim | 431 |
| orchestrator/studio/validate.ts | kernel | rewritten | 1066 |
| orchestrator/studio/yaml-comments.ts | library | verbatim | 132 |
| orchestrator/studio/yaml-fields.ts | kernel | verbatim | 105 |
| orchestrator/tool-event-emit.ts | agents | verbatim | 244 |
| orchestrator/trigger-payload.ts | flows | verbatim | 294 |
| orchestrator/webhook-verify.ts | flows | verbatim | 114 |
| orchestrator/wi-dispatch-scheduler.ts | flows | verbatim | 151 |
| orchestrator/wi-merge-back.ts | flows | verbatim | 464 |
| orchestrator/wi-worktree.ts | flows | verbatim | 327 |
| orchestrator/work-item.ts | flows | verbatim | 710 |
| orchestrator/worktree.ts | flows | verbatim | 201 |
| skills/adversarial-review/SKILL.md | factory | verbatim | 202 |
| skills/architect-completeness-critic/SKILL.md | factory | verbatim | 85 |
| skills/architect/SKILL.md | factory | verbatim | 215 |
| skills/brain-fix/SKILL.md | knowledge | verbatim | 65 |
| skills/brain-ingest/SKILL.md | knowledge | verbatim | 106 |
| skills/brain-lint/SKILL.md | knowledge | verbatim | 66 |
| skills/brain-maintenance/SKILL.md | knowledge | verbatim | 139 |
| skills/brain-query/SKILL.md | knowledge | verbatim | 92 |
| skills/changelog-semver/SKILL.md | flows | verbatim | 56 |
| skills/contract-check/SKILL.md | projects | verbatim | 85 |
| skills/creation-agent/SKILL.md | library | verbatim | 117 |
| skills/cruft-sweep/SKILL.md | kernel | verbatim | 91 |
| skills/demo-agent/SKILL.md | factory | verbatim | 141 |
| skills/demo-builder/SKILL.md | projects | verbatim | 146 |
| skills/demo-design/SKILL.md | projects | verbatim | 218 |
| skills/demo/SKILL.md | factory | verbatim | 323 |
| skills/developer-ralph/SKILL.md | factory | verbatim | 108 |
| skills/doc-updater/SKILL.md | flows | verbatim | 52 |
| skills/forge-onboard-project/SKILL.md | projects | verbatim | 185 |
| skills/handoff/SKILL.md | sessions | verbatim | 38 |
| skills/instructions-creator/SKILL.md | projects | verbatim | 124 |
| skills/onboarding-agent/SKILL.md | projects | verbatim | 108 |
| skills/pre-impl-interview/SKILL.md | factory | verbatim | 39 |
| skills/preflight-fix/SKILL.md | projects | verbatim | 56 |
| skills/project-brain-builder/SKILL.md | knowledge | verbatim | 102 |
| skills/project-manager/SKILL.md | factory | verbatim | 202 |
| skills/project-scoped-review/SKILL.md | projects | verbatim | 215 |
| skills/reflector/SKILL.md | factory | verbatim | 179 |
| skills/release-finalizer/SKILL.md | flows | verbatim | 92 |
