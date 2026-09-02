# QUARRY — every production file, its owner package, and how it moves

This file is **load-bearing**, not a planning note: `scripts/check-owner.mjs` reads it
and fails CI when a production file has no row, has two, or names an owner or a
disposition outside the vocabularies below. A file that changes owner changes this
file in the same PR.

**Scope.** Every production file under `orchestrator/`, `cli/`, `loops/`,
`skills/`, `packages/` and `apps/forge/` — code (`.ts .tsx .mjs .js .cjs`) plus the `SKILL.md` agent definitions,
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
| `verbatim` | moves unchanged | 222 |
| `pruned` | moves, with a part that belongs elsewhere dropped on the way | 5 |
| `rewritten` | **cannot** move without a behaviour change; stays where it is until rewritten | 14 |
| `deleted` | not carried forward | 8 |

## Per-package LOC caps

Spec §8: "Per-package LOC cap (starting values from the QUARRY.md targets)". A
package that would exceed its cap parks; the fix is a cull, a split, or an
operator-ratified new cap — never a silent raise.

| package | files | quarried LOC | cap | note |
|---|---|---|---|---|
| `contracts` | 2 | 750 | **1,000** | the spec targets ~0.3k. The single quarried file is 738 lines and must be pruned to types + constants; the cap is the ceiling it must come under, not a licence to stay at 738. |
| `kernel` | 13 | 3,803 | **5,500** | quarried lines only. The spec's separate "~3k of new logic" cap governs anything WRITTEN into kernel rather than moved; the two are counted apart. |
| `library` | 33 | 12,070 | **12,500** | seeded from the quarried total, rounded up to the next 500. |
| `knowledge` | 26 | 11,157 | **11,500** | seeded from the quarried total, rounded up to the next 500. |
| `projects` | 22 | 7,820 | **8,000** | seeded from the quarried total, rounded up to the next 500. |
| `agents` | 30 | 8,798 | **9,000** | seeded from the quarried total, rounded up to the next 500. |
| `sessions` | 20 | 13,078 | **13,500** | seeded from the quarried total, rounded up to the next 500. |
| `flows` | 62 | 21,327 | **22,500** | seeded from the quarried total, rounded up to the next 500. |
| `factory` | 37 | 13,004 | **13,500** | **Re-seeded 12,500 → 13,500 (M2-B, operator ruling).** Two effects landed together: M2-B quarried `orchestrator/phases/executor-{deps,table}.ts` (960 lines) here, where the six phases they wire already live — a `flows`-owned table importing those phases would be a `flows → factory` edge the allow-graph forbids; and the per-package columns in this table, hand-seeded and never recomputed, are now DERIVED from the rows below, which showed `factory` at 12,044 before those two files rather than the figure its cap was seeded from. The new cap applies this row's own stated rule — the measured total (13,004) rounded up to the next 500 — to a total that is now measured rather than asserted. The full column recomputation, and teaching `check-owner.mjs` to enforce it, is bead `forge-8vfn.5.18`. |
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
| `orchestrator/flow-runner.ts` | `flows` | 615 | M2-B replaced its ten phase imports with the `PhaseExecutor` port; the table it shed is `phases/executor-{table,deps}.ts` |
| `orchestrator/project-brain-builder-runner.ts` | `knowledge` | 448 | a knowledge concern wrapped in the sessions turn-loop plumbing it must shed |
| `orchestrator/studio/registry.ts` | `kernel` | 1,180 | one loader for Agent, Flow, KB, Catalog, Community, Template and Project — five packages in one file |
| `orchestrator/studio/validate.ts` | `kernel` | 1,066 | the same five-way split on the validation side |

### `pruned` and `deleted`

| path | owner | disposition | LOC | what is dropped |
|---|---|---|---|---|
| `cli/preflight.ts` | `projects` | `pruned` | 1,135 | M2-B moved its four pure report types (`ClauseId`, `ClauseResult`, `PreflightReport`, `PreflightOptions`) to `packages/kernel/project-contract.ts`, because the `ProjectGate` port declares them and flows may not import this file (SPEC.md §6); the module re-exports them |
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
| packages/agents/agent-run.ts | agents | verbatim | 933 |
| packages/factory/architect-plan.ts | factory | verbatim | 862 |
| packages/knowledge/brain-fix-auto.ts | knowledge | verbatim | 255 |
| packages/knowledge/brain-index.ts | knowledge | verbatim | 369 |
| packages/knowledge/brain-lint-checks-filing.ts | knowledge | verbatim | 326 |
| packages/knowledge/brain-lint-checks-graph.ts | knowledge | verbatim | 247 |
| packages/knowledge/brain-lint-checks-integrity.ts | knowledge | verbatim | 484 |
| packages/knowledge/brain-lint-theme-paths.ts | knowledge | verbatim | 146 |
| packages/knowledge/brain-lint-types.ts | knowledge | verbatim | 54 |
| packages/knowledge/brain-lint.ts | knowledge | verbatim | 646 |
| packages/flows/bridge-hooks.ts | flows | verbatim | 397 |
| packages/flows/bridge-recovery.ts | flows | verbatim | 258 |
| cli/bridge-studio-affordances.ts | sessions | rewritten | 1313 |
| packages/sessions/bridge-studio-agent-capability.ts | sessions | verbatim | 117 |
| packages/library/bridge-studio-authoring-hook.ts | library | verbatim | 275 |
| packages/library/bridge-studio-authoring-skill.ts | library | verbatim | 64 |
| packages/library/bridge-studio-authoring-template.ts | library | verbatim | 132 |
| packages/library/bridge-studio-authoring-types.ts | library | verbatim | 24 |
| packages/library/bridge-studio-authoring.ts | library | verbatim | 517 |
| packages/library/bridge-studio-community-hook-preinstall.ts | library | verbatim | 105 |
| packages/library/bridge-studio-community-wire.ts | library | verbatim | 213 |
| packages/library/bridge-studio-community.ts | library | verbatim | 545 |
| packages/library/bridge-studio-connections.ts | library | verbatim | 225 |
| packages/library/bridge-studio-hooks.ts | library | verbatim | 727 |
| packages/library/bridge-studio-instructions.ts | library | verbatim | 149 |
| packages/knowledge/bridge-studio-kb-consolidate.ts | knowledge | verbatim | 376 |
| packages/knowledge/bridge-studio-kb-drain.ts | knowledge | verbatim | 753 |
| packages/knowledge/bridge-studio-kb-routes-lifecycle.ts | knowledge | verbatim | 538 |
| packages/knowledge/bridge-studio-kb-routes-maintenance.ts | knowledge | verbatim | 546 |
| packages/knowledge/bridge-studio-kb-routes-read.ts | knowledge | verbatim | 308 |
| packages/knowledge/bridge-studio-kbs.ts | knowledge | verbatim | 720 |
| packages/sessions/bridge-studio-lifecycle.ts | sessions | verbatim | 424 |
| packages/flows/bridge-studio-runs.ts | flows | verbatim | 947 |
| packages/sessions/bridge-studio-session-cancel.ts | sessions | verbatim | 206 |
| packages/sessions/bridge-studio-sessions.ts | sessions | verbatim | 1096 |
| packages/library/bridge-studio-skills.ts | library | verbatim | 578 |
| packages/library/bridge-studio-templates.ts | library | verbatim | 348 |
| cli/bridge-studio-writes.ts | projects | rewritten | 2482 |
| cli/bridge-studio.ts | apps/forge | rewritten | 1750 |
| packages/library/community-refresh-cmd.ts | library | verbatim | 104 |
| packages/library/community-refresh-run.ts | library | verbatim | 454 |
| packages/library/community-registry-lock.ts | library | verbatim | 126 |
| packages/projects/contract-compliance-loop.ts | projects | verbatim | 167 |
| packages/projects/contract-stages.ts | projects | verbatim | 324 |
| packages/factory/cycle-recap.ts | factory | verbatim | 395 |
| packages/knowledge/cycle-retention.ts | knowledge | verbatim | 204 |
| packages/factory/demo-capture.ts | factory | verbatim | 48 |
| packages/factory/demo-model.ts | factory | verbatim | 744 |
| packages/factory/demo-runtime.ts | factory | verbatim | 184 |
| packages/factory/demo-types.ts | factory | verbatim | 59 |
| packages/factory/demo.ts | factory | verbatim | 232 |
| cli/dry-bridge.ts | kernel | rewritten | 453 |
| packages/flows/flow-band-vocab.ts | flows | verbatim | 67 |
| packages/flows/forge-metrics.ts | flows | verbatim | 782 |
| packages/flows/forge-requeue.ts | flows | verbatim | 273 |
| apps/forge/forge-watch.ts | apps/forge | verbatim | 739 |
| packages/knowledge/kb-drain-edit-soundness.ts | knowledge | verbatim | 747 |
| packages/knowledge/kb-drain-structural.ts | knowledge | verbatim | 230 |
| packages/knowledge/kb-job-state.ts | knowledge | verbatim | 208 |
| packages/knowledge/kb-drain-routes.ts | knowledge | verbatim | 395 |
| packages/knowledge/kb-drain-model.ts | knowledge | verbatim | 381 |
| packages/knowledge/kb-drain-store.ts | knowledge | verbatim | 434 |
| packages/knowledge/routes.ts | knowledge | verbatim | 153 |
| packages/library/routes.ts | library | verbatim | 401 |
| packages/knowledge/kb-lint-summary.ts | knowledge | verbatim | 545 |
| packages/knowledge/kb-read-policy.ts | knowledge | verbatim | 91 |
| packages/knowledge/kb-sites.ts | knowledge | verbatim | 110 |
| packages/flows/manifest-path-guard.ts | flows | verbatim | 344 |
| packages/agents/materials-staging.ts | agents | verbatim | 269 |
| packages/flows/metrics.ts | flows | verbatim | 142 |
| packages/projects/preflight-fix-auto.ts | projects | verbatim | 171 |
| packages/projects/preflight-resolve.ts | projects | verbatim | 67 |
| packages/projects/preflight.ts | projects | pruned | 257 |
| packages/projects/preflight-build.ts | projects | verbatim | 142 |
| packages/projects/preflight-demo.ts | projects | verbatim | 159 |
| packages/projects/preflight-gate.ts | projects | verbatim | 268 |
| packages/projects/preflight-instructions.ts | projects | verbatim | 138 |
| packages/projects/preflight-release.ts | projects | verbatim | 74 |
| packages/projects/preflight-repo.ts | projects | verbatim | 218 |
| packages/projects/project-migrate.ts | projects | verbatim | 197 |
| packages/factory/reflect-reconcile.ts | factory | verbatim | 167 |
| packages/factory/reflection-doc.ts | factory | verbatim | 354 |
| packages/flows/run-list-cache.ts | flows | verbatim | 397 |
| packages/sessions/session-model-tier.ts | sessions | verbatim | 49 |
| packages/sessions/session-readability.ts | sessions | verbatim | 207 |
| packages/library/skill-path.ts | library | verbatim | 91 |
| packages/library/skill-staging.ts | library | verbatim | 136 |
| packages/library/studio-lint-tool-fence.ts | library | verbatim | 149 |
| cli/studio-lint.ts | kernel | rewritten | 805 |
| cli/studio-provenance.ts | kernel | rewritten | 54 |
| packages/knowledge/theme-frontmatter.ts | knowledge | verbatim | 116 |
| cli/ui-bridge.ts | apps/forge | rewritten | 6602 |
| packages/agents/_adapters/aider/index.ts | agents | verbatim | 485 |
| packages/agents/_adapters/claude/index.ts | agents | verbatim | 29 |
| packages/agents/_adapters/conformance.ts | agents | verbatim | 203 |
| packages/agents/_adapters/example/index.ts | agents | verbatim | 111 |
| packages/agents/_adapters/gemini/index.ts | agents | verbatim | 553 |
| packages/agents/_adapters/registry.ts | agents | verbatim | 107 |
| packages/agents/_adapters/types.ts | agents | verbatim | 56 |
| packages/agents/ralph/claude-agent.ts | agents | verbatim | 553 |
| packages/agents/ralph/runner.ts | agents | verbatim | 435 |
| packages/agents/ralph/stop-conditions.ts | agents | verbatim | 685 |
| packages/agents/agent-bands.ts | agents | verbatim | 86 |
| packages/agents/agent-dispatch.ts | agents | verbatim | 365 |
| packages/projects/agents-md-compose.ts | projects | verbatim | 109 |
| packages/sessions/architect-runner.ts | sessions | verbatim | 1715 |
| orchestrator/band-agent-run.ts | agents | rewritten | 242 |
| packages/sessions/bash-fence.ts | sessions | verbatim | 508 |
| packages/sessions/brain-fix-runner.ts | sessions | verbatim | 381 |
| packages/knowledge/brain-paths.ts | knowledge | pruned | 141 |
| packages/flows/claim-validator.ts | flows | verbatim | 233 |
| apps/forge/cli.ts | apps/forge | pruned | 998 |
| apps/forge/routes.ts | apps/forge | verbatim | 38 |
| packages/sessions/completeness-critic-runner.ts | sessions | verbatim | 286 |
| packages/projects/constraint-author.ts | projects | verbatim | 99 |
| packages/projects/constraint-blocks.ts | projects | verbatim | 257 |
| packages/flows/cron-triggers.ts | flows | verbatim | 242 |
| packages/flows/ci-gate.ts | flows | verbatim | 147 |
| packages/flows/cycle-context.ts | flows | verbatim | 346 |
| packages/flows/cycle-helpers.ts | flows | verbatim | 694 |
| packages/flows/cycle-report.ts | flows | verbatim | 29 |
| packages/flows/cycle.ts | flows | verbatim | 484 |
| packages/flows/daemon.ts | flows | verbatim | 248 |
| packages/sessions/demo-builder-runner.ts | sessions | verbatim | 814 |
| packages/flows/demo-fix-loop.ts | flows | verbatim | 218 |
| packages/flows/demo-paths.ts | flows | verbatim | 71 |
| packages/flows/drain-fix-loop.ts | flows | verbatim | 286 |
| packages/flows/enqueue-develop-run.ts | flows | verbatim | 77 |
| packages/flows/enqueue-flow-run.ts | flows | verbatim | 366 |
| packages/flows/enqueue-plan-run.ts | flows | verbatim | 236 |
| packages/agents/failure-classifier.ts | agents | verbatim | 517 |
| packages/flows/finalize-merged.ts | flows | verbatim | 412 |
| packages/flows/fix-work-items.ts | flows | verbatim | 388 |
| packages/flows/flow-artifacts.ts | flows | pruned | 437 |
| packages/flows/flow-budgets.ts | flows | verbatim | 450 |
| packages/flows/flow-run-requests.ts | flows | verbatim | 397 |
| packages/flows/flow-node-context.ts | flows | verbatim | 54 |
| packages/flows/flow-node-kind.ts | flows | verbatim | 66 |
| orchestrator/flow-runner.ts | flows | rewritten | 638 |
| packages/flows/flow-trigger.ts | flows | verbatim | 214 |
| packages/flows/gate-fix-loop.ts | flows | verbatim | 163 |
| packages/projects/gate-recipes.ts | projects | verbatim | 146 |
| packages/flows/initiative-id.ts | flows | verbatim | 210 |
| packages/library/instruction-seed-match.ts | library | verbatim | 152 |
| packages/sessions/instructions-runner.ts | sessions | verbatim | 630 |
| packages/sessions/interactive-finalizers.ts | sessions | verbatim | 422 |
| packages/sessions/interactive-runner.ts | sessions | verbatim | 883 |
| packages/sessions/interactive-session.ts | sessions | verbatim | 993 |
| packages/knowledge/kb-backend.ts | knowledge | verbatim | 142 |
| packages/knowledge/kb-graph.ts | knowledge | verbatim | 683 |
| packages/knowledge/kb-health.ts | knowledge | verbatim | 274 |
| packages/flows/manifest.ts | flows | verbatim | 744 |
| packages/flows/mint-triggered-initiative.ts | flows | verbatim | 233 |
| packages/agents/model-range.ts | agents | verbatim | 115 |
| packages/flows/notify.ts | flows | verbatim | 73 |
| packages/agents/phase-agent.ts | agents | verbatim | 101 |
| packages/factory/phases/adversarial-review-binding.ts | factory | verbatim | 139 |
| packages/factory/phases/adversarial-review.ts | factory | verbatim | 393 |
| packages/agents/phases/agent-scope-guard.ts | agents | verbatim | 111 |
| packages/flows/phases/closure.ts | flows | verbatim | 431 |
| orchestrator/phases/executor-deps.ts | factory | rewritten | 284 |
| orchestrator/phases/executor-table.ts | factory | rewritten | 676 |
| packages/factory/phases/decompose-completeness.ts | factory | verbatim | 197 |
| packages/factory/phases/demo-agent-binding.ts | factory | verbatim | 214 |
| packages/factory/phases/demo-agent.ts | factory | verbatim | 740 |
| packages/factory/phases/dev-binding.ts | factory | verbatim | 339 |
| packages/factory/phases/developer-loop.ts | factory | pruned | 1941 |
| packages/flows/phases/orchestrated-capture.ts | flows | verbatim | 301 |
| packages/factory/phases/pm-binding.ts | factory | verbatim | 386 |
| packages/factory/phases/project-manager.ts | factory | verbatim | 859 |
| packages/flows/phases/ralph-spec-lint.ts | flows | verbatim | 469 |
| packages/factory/phases/reflector-binding.ts | factory | verbatim | 262 |
| packages/factory/phases/reflector.ts | factory | verbatim | 981 |
| packages/factory/phases/release-finalize.ts | factory | verbatim | 299 |
| packages/flows/phases/wi-spec-compile.ts | flows | verbatim | 509 |
| packages/agents/pinned-sdk-query.ts | agents | verbatim | 87 |
| packages/flows/planned-initiatives.ts | flows | verbatim | 53 |
| packages/flows/pr.ts | flows | verbatim | 1132 |
| packages/sessions/preflight-fix-runner.ts | sessions | verbatim | 248 |
| orchestrator/project-brain-builder-runner.ts | knowledge | rewritten | 448 |
| packages/knowledge/project-brain-seed.ts | knowledge | verbatim | 353 |
| packages/projects/project-config.ts | projects | verbatim | 330 |
| packages/projects/project-config-sidecar.ts | projects | verbatim | 76 |
| packages/projects/project-config-types.ts | projects | verbatim | 211 |
| packages/projects/project-config-validate.ts | projects | verbatim | 468 |
| packages/projects/project-create.ts | projects | verbatim | 364 |
| packages/projects/project-repo-tx.ts | projects | verbatim | 201 |
| packages/flows/promote-manifests.ts | flows | verbatim | 76 |
| packages/flows/queue.ts | flows | verbatim | 231 |
| packages/factory/reflector-rerun.ts | factory | verbatim | 112 |
| packages/factory/release-finalize-invocation.ts | factory | verbatim | 165 |
| packages/factory/release-process.ts | factory | verbatim | 66 |
| packages/flows/requeue-resume.ts | flows | verbatim | 193 |
| packages/factory/review-comments.ts | factory | verbatim | 229 |
| packages/agents/run-agent.ts | agents | verbatim | 665 |
| packages/flows/run-model-derive.ts | flows | verbatim | 988 |
| packages/flows/run-model.ts | flows | verbatim | 817 |
| packages/flows/run-view-types.ts | flows | verbatim | 189 |
| packages/flows/scheduler-dispatch.ts | flows | verbatim | 252 |
| packages/flows/scheduler.ts | flows | verbatim | 1031 |
| packages/agents/skill-path.ts | agents | verbatim | 239 |
| packages/agents/stream-deadline.ts | agents | verbatim | 74 |
| packages/library/studio/community-index.ts | library | verbatim | 693 |
| packages/library/studio/community-install.ts | library | verbatim | 208 |
| packages/library/studio/community-refresh-api.ts | library | verbatim | 588 |
| packages/library/studio/community-source-url.ts | library | verbatim | 164 |
| packages/library/studio/connection-catalog.ts | library | verbatim | 163 |
| packages/library/studio/connection-install.ts | library | verbatim | 101 |
| packages/library/studio/connection-library.ts | library | verbatim | 230 |
| packages/library/studio/connection-probe.ts | library | verbatim | 417 |
| packages/library/studio/connection-readiness.ts | library | verbatim | 49 |
| packages/agents/studio/connection-run-gate.ts | agents | verbatim | 71 |
| packages/library/studio/connection-validate.ts | library | verbatim | 217 |
| packages/agents/studio/derive.ts | agents | verbatim | 290 |
| packages/agents/studio/hook-dispatch.ts | agents | verbatim | 439 |
| packages/library/studio/hook-library.ts | library | verbatim | 526 |
| packages/library/studio/hook-package.ts | library | verbatim | 502 |
| packages/library/studio/hook-runtime.ts | library | verbatim | 372 |
| packages/library/studio/hook-approval-ledger.ts | library | verbatim | 355 |
| packages/library/studio/hook-scan.ts | library | verbatim | 480 |
| packages/library/studio/instructions-draft.ts | library | verbatim | 185 |
| packages/knowledge/studio/kb-descriptor.ts | knowledge | verbatim | 210 |
| packages/agents/studio/materials.ts | agents | verbatim | 194 |
| orchestrator/studio/registry.ts | kernel | rewritten | 1180 |
| packages/sessions/studio/session-kinds.ts | sessions | verbatim | 1389 |
| packages/sessions/studio/session-transcript.ts | sessions | verbatim | 1359 |
| packages/library/studio/skill-install-ledger.ts | library | verbatim | 166 |
| packages/library/studio/skill-install.ts | library | verbatim | 324 |
| packages/library/studio/skill-package.ts | library | verbatim | 183 |
| packages/library/studio/skill-trust.ts | library | verbatim | 461 |
| packages/agents/studio/skill-md-fidelity.ts | agents | verbatim | 224 |
| packages/library/studio/template-library.ts | library | verbatim | 610 |
| packages/contracts/studio/types.ts | contracts | verbatim | 738 |
| packages/flows/studio/validate-triggers.ts | flows | verbatim | 431 |
| orchestrator/studio/validate.ts | kernel | rewritten | 1066 |
| packages/library/studio/yaml-comments.ts | library | verbatim | 132 |
| packages/kernel/studio/yaml-fields.ts | kernel | verbatim | 105 |
| packages/agents/tool-event-emit.ts | agents | verbatim | 244 |
| packages/flows/trigger-payload.ts | flows | verbatim | 294 |
| packages/flows/webhook-verify.ts | flows | verbatim | 114 |
| packages/flows/wi-dispatch-scheduler.ts | flows | verbatim | 151 |
| packages/flows/wi-merge-back.ts | flows | verbatim | 464 |
| packages/flows/wi-worktree.ts | flows | verbatim | 327 |
| packages/flows/work-item.ts | flows | verbatim | 710 |
| packages/flows/worktree.ts | flows | verbatim | 201 |
| skills/adversarial-review/SKILL.md | factory | verbatim | 202 |
| skills/architect-completeness-critic/SKILL.md | factory | verbatim | 85 |
| skills/architect/SKILL.md | factory | verbatim | 215 |
| skills/brain-fix/SKILL.md | knowledge | verbatim | 65 |
| skills/brain-ingest/SKILL.md | knowledge | verbatim | 106 |
| skills/brain-lint/SKILL.md | knowledge | verbatim | 66 |
| skills/brain-maintenance/SKILL.md | knowledge | verbatim | 139 |
| skills/brain-query/SKILL.md | knowledge | verbatim | 92 |
| skills/changelog-semver/SKILL.md | flows | verbatim | 56 |
| skills/contract-check/SKILL.md | projects | verbatim | 89 |
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
| apps/forge/index.ts | apps/forge | verbatim | 8 |
| packages/agents/index.ts | agents | verbatim | 11 |
| packages/contracts/index.ts | contracts | verbatim | 138 |
| packages/contracts/studio-types.ts | contracts | verbatim | 738 |
| packages/factory/index.ts | factory | verbatim | 8 |
| packages/flows/index.ts | flows | verbatim | 11 |
| packages/kernel/config.ts | kernel | verbatim | 493 |
| packages/kernel/ids.ts | kernel | verbatim | 117 |
| packages/kernel/event-cost.ts | kernel | verbatim | 63 |
| packages/kernel/index.ts | kernel | verbatim | 30 |
| packages/kernel/init.ts | kernel | verbatim | 144 |
| packages/kernel/logging.ts | kernel | verbatim | 169 |
| packages/kernel/path-guard.ts | kernel | verbatim | 607 |
| packages/kernel/ports.ts | kernel | verbatim | 71 |
| packages/kernel/spawn-env.ts | kernel | verbatim | 181 |
| packages/kernel/route-entry.ts | kernel | verbatim | 114 |
| packages/kernel/http-envelope.ts | kernel | verbatim | 72 |
| packages/kernel/project-contract.ts | kernel | verbatim | 37 |
| packages/kernel/project-layout.ts | kernel | verbatim | 125 |
| packages/knowledge/index.ts | knowledge | verbatim | 11 |
| packages/library/index.ts | library | verbatim | 8 |
| packages/projects/index.ts | projects | verbatim | 11 |
| packages/sessions/index.ts | sessions | verbatim | 11 |
