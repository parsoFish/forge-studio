#!/usr/bin/env node
/**
 * check-raw-fs-guarded.scope-list.mjs — EXPLICIT_MODULES, the TIER 1 modules
 * the import-graph walk structurally CANNOT reach (a process-spawn boundary,
 * or a delegated helper whose request-derived arguments arrive by
 * parameter), kept explicit rather than name-globbed.
 *
 * SIBLING, not a second lint (ruling 492, forge-38dl): a pure DATA module,
 * same shape as `check-raw-fs-guarded.allowlist.mjs` /
 * `.interproc.mjs` / `.destructure.mjs` — no logic here, only the list, so
 * growing the declared TIER 1 surface never raises `check-raw-fs-guarded.mjs`'s
 * own file-size ratchet baseline (the cap only tightens; a data list that
 * legitimately grows belongs in its own file, not in a baseline raise).
 * `check-raw-fs-guarded.mjs` imports `EXPLICIT_MODULES` from here and
 * re-exports it unchanged, so every consumer's import path is unchanged.
 *
 * Every row below states why the walker cannot see it.
 */
export const EXPLICIT_MODULES = [
  // R4-22 WI-2: the FINALIZERS registry's sole row today, copyStagingToLibrary
  // — session-derived staging paths + a request-derived packageId both reach fs
  // writes; same class as the legacy interactive runners below.
  'packages/sessions/interactive-finalizers.ts',
  // R4-22 WI-3 (ADR-043 §2): the generic interactive-turn spine, and the four
  // legacy runners. They cannot be reached by the reachability walk (that walk
  // follows relative imports from the bridge entry points; the
  // packages/agents/agent-run.ts -> runInteractiveTurn dispatch crosses a PROCESS-SPAWN
  // boundary), so this list is the only mechanism that lints them. Session-
  // derived (kindDir, sessionId) and finalizer-bound (packageId) paths reach fs
  // sinks in every one.
  // Bead 5.48: the four CLI-dispatch entries that sat here are now the sibling's `DISPATCH_ENTRY_MODULES` — one declaration, consumed by both lints.
  'packages/sessions/interactive-session.ts',
  'packages/sessions/interactive-runner.ts',
  'packages/sessions/kinds/architect.ts',
  'packages/sessions/kinds/instructions.ts',
  'packages/sessions/kinds/demo-builder.ts', 'packages/sessions/kinds/demo-generate.ts', // heir ADDED beside its parent, never swapped in (6.11.49; rationale in docs/reference/request-path-sinks.md)
  'packages/agents/band-agent-run.ts', // shared seed; two safe sites allowlisted
  // M4 §4 step 2: carving this module's routes out took its HTTP-plumbing
  // signal with them, dropping it to tier 2 where `runId` is excluded; ten
  // audited residuals silently stopped suppressing (89->78) while the check
  // still said PASS. The tier-2 note above names this exact blind spot.
  'packages/knowledge/bridge-studio-kb-drain.ts',
  // M4 PR 4b: the same blind spot one file over. Splitting `bridge-studio-kbs.ts`
  // five ways moved its sinks into modules with no HTTP-plumbing signal left:
  // measured 92 residuals before, 88 after, four silently unsuppressed and the
  // check still PASS. A falling count after a carve is a blinded scanner.
  'packages/knowledge/bridge-studio-kbs.ts',
  'packages/knowledge/bridge-studio-kb-consolidate.ts',
  'packages/knowledge/bridge-studio-kb-routes-read.ts',
  'packages/knowledge/bridge-studio-kb-routes-lifecycle.ts',
  'packages/knowledge/bridge-studio-kb-routes-maintenance.ts',
  // M4 PR 5, the same shape a third time: the drain split moved its status/log
  // writes into heirs with no route plumbing; residuals fell 92 -> 81, 0 findings.
  'packages/knowledge/kb-drain-model.ts',
  'packages/knowledge/kb-drain-store.ts',
  // M4 projects carve, this blind spot a FOURTH time: pure scaffold helpers
  // (reached from bridge-studio-project-onboard.ts's POST /api/studio/projects with a
  // request-derived projectRoot) carrying no HTTP-plumbing token by design.
  'packages/projects/project-contract-scaffold.ts',
  // CLI-side operator surfaces that take the same project/initiative ids the
  // routes do, reached by `forge <verb>` rather than by an HTTP dispatch.
  'packages/flows/metrics.ts',
  'packages/projects/contract-stages.ts',
  'packages/sessions/kinds/architect-plan.ts',
  // Not a request handler itself — the shared config-loader HELPER that
  // multiple request routes DELEGATE their `.forge/project.json` read to
  // (bridge-studio-runs verdict send-back -> loadProjectConfig(projectRepoPath),
  // contract-stages, preflight). It is the interprocedural leaf-append SITE for
  // blind-spot #b: `join(projectRoot, '.forge', 'project.json')` on an
  // unresolved param, invisible unless the helper's own body is scanned.
  'packages/projects/project-config.ts',
  // SEC-05 q80 (FORWARD DEFENSE): the skill-package install + vendored-read
  // helpers the /api/studio/skills/install and community-install/index routes
  // DELEGATE their per-entry filesystem walk to. The request-derived `id` and
  // package entry paths flow into these bodies by parameter.
  'packages/library/studio/skill-install.ts', 'packages/library/studio/skill-package.ts', 'packages/library/studio/skill-trust.ts', 'packages/library/bridge-studio-authoring-hook.ts', 'packages/library/bridge-studio-authoring-template.ts',
  'packages/library/studio/community-install.ts',
  'packages/library/studio/community-index.ts',
  // forge-38dl (T3 lane RA): 34 modules promoted out of the tier-2 sweep after
  // a module-by-module audit of the full model's findings over them (98
  // findings, all SERVER-BUILT or BOUNDARY-VALIDATED — see
  // check-raw-fs-guarded.allowlist.mjs's matching ALLOWLIST rows for the
  // per-finding evidence). None carries the HTTP-plumbing signal or sits on
  // the bridge's relative-import reachability walk, so tier 2 was the only
  // coverage they had before this — exactly the "unaudited" residue this
  // bead measured.
  'packages/flows/cycle.ts',
  'packages/flows/enqueue-flow-run.ts',
  'packages/flows/enqueue-plan-run.ts',
  'packages/library/studio/template-library.ts',
  'packages/projects/preflight-build.ts',
  'packages/projects/project-create.ts',
  'packages/stations/reflector-rerun.ts',
  'packages/flows/review-comments.ts',
  'packages/kernel/case-folding-probe.ts',
  'packages/library/instruction-seed-match.ts',
  'packages/projects/preflight-gate.ts',
  'packages/agents/spawn-marker.ts',
  'packages/flows/scheduler-run-one.ts',
  'packages/kernel/logging.ts',
  'packages/projects/preflight-deps.ts',
  'packages/projects/preflight-instructions.ts',
  'packages/sessions/studio/session-artifact-derivers.ts',
  'packages/stations/cycle-recap.ts',
  'packages/flows/requeue-resume.ts',
  'packages/knowledge/brain-paths.ts',
  'packages/knowledge/kb-job-state.ts',
  'packages/library/studio/connection-probe.ts',
  'packages/projects/preflight-demo.ts',
  'packages/projects/preflight-fix-auto.ts',
  'packages/projects/preflight-repo.ts',
  'packages/agents/agent-dispatch.ts',
  'packages/flows/forge-metrics.ts',
  'packages/flows/pr.ts',
  'packages/flows/run-model-derive-lineage.ts',
  'packages/flows/work-item.ts',
  'packages/knowledge/kb-drain-structural.ts',
  'packages/knowledge/kb-lint-summary.ts',
  'packages/projects/preflight-release.ts',
  'packages/projects/preflight.ts',
  // forge-38dl: a second, beyond-bridge-reachable-scope pass over the full
  // production tree found 16 more full-model findings in these 4 CLI-only
  // lint/migration modules (see the matching ALLOWLIST rows).
  'apps/forge/studio-lint.ts',
  'packages/library/studio-lint-library-passes.ts',
  'packages/projects/constraint-author.ts',
  'packages/projects/project-migrate.ts',
];
