---
title: M7 Studio consolidation arc — finishing the strangler, lessons
description: >-
  How the M7 consolidation (Studio becomes the one product — delete /dashboard,
  fold the moment-screens, collapse the CLI, harden the launcher) was executed as
  per-WI multi-agent workflows, and the durable lessons: migrate-the-harness-before-
  you-delete, ui:journey as the integration oracle, adversarial review earns its cost.
category: reference
keywords:
  - forge-studio
  - strangler-cutover
  - consolidation
  - subagent-orchestration
  - ui-journey-oracle
  - harness-migration-ordering
  - adversarial-review
  - cli-collapse
created_at: 2026-06-14T00:00:00.000Z
updated_at: 2026-06-14T00:00:00.000Z
related_themes:
  - forge-studio-build-arc
  - six-phases-of-forge
  - real-capability-harness
---

# M7 — finishing the strangler

M0–M6 ([`forge-studio-build-arc`](./forge-studio-build-arc.md)) landed the new Studio
surfaces *alongside* the ones they replaced. M7 ([ADR-031](../../../docs/decisions/031-studio-consolidation.md))
ripped out the legacy and productionised the launch: deleted the pre-Studio
`/dashboard` + its ~2.6k-LOC cluster, folded `/review`+`/reflect` into `/artifact`,
rebuilt the architect interview+PLAN gate natively in Studio (retiring
ScreenShell/MomentHex), collapsed the CLI to its runtime spine (the bridge is the
operator API now), and replaced the brittle `forge watch` with a deterministic
`forge studio` launcher. 7 WIs, all spine-green (test 1114, ui:journey 60/60).

## The orchestration (same playbook, one WI per workflow)

Each WI ran as its own multi-agent workflow — research (parallel investigators) →
implement → **adversarial spec + quality review in parallel** → fix — with the
human-in-loop running the heavy `ui:journey` and committing **between** workflows.
Commit-per-WI kept history granular and recoverable.

## Lessons that generalise

- **Migrate the harness BEFORE you delete the surface.** `/dashboard` was the hub
  for three separable concerns (cycle monitor, architect entry, review/reflect
  spine-checks). Deletion (M7-2) had to wait on M7-1+M7-3+M7-4 re-homing every
  harness assertion onto Studio. The rule that made it safe: **the migrated harness
  must go green on unmodified `main` first** — that green is the proof the old
  surface is redundant. A pre-delete grep-proof (every importer is the route itself
  or an intra-cluster member) is the second lock.
- **`ui:journey` is the integration oracle build/tsc/vitest can't be.** Three WIs
  reported all-green in-agent yet `ui:journey` failed on the live stack: a
  `main[...]`-vs-`<div>` selector (the `/artifact` root isn't a `<main>`), a
  watch-it-build payoff that a review fix over-corrected into never showing, a
  reflection node keyed `reflection` not `reflect` (the flow.yaml node id). Always
  run the real journey on the main thread after each UI WI; never trust the
  implementer's self-reported green for integration.
- **Adversarial review pays for itself.** Independent skeptic reviewers caught a
  CI-breaker (a node:test file in a Vitest-owned dir), a stale-closure demo-fetch,
  a cross-round approval leak, and a pre-existing CSRF-missing 403 on the send-back
  POST — none visible to the compiler.
- **Watch the over-correction.** A review's fix for the approval-leak (reset on any
  phase ≠ awaiting-verdict) also fired on *approve* (→committed), hiding the payoff.
  Drive terminal UI state off the bridge source of truth (`session.phase==='committed'`),
  not a local optimistic boolean that a sibling effect can wipe.
- **Decouple before you delete.** The CLI collapse only worked because the bridge
  stopped *spawning* `forge start` first — extract the shared helper
  (`spawnServeDetached`), point the bridge at it, *then* delete the command.
- **Subagents drift.** Two off-task market-analysis docs appeared mid-run; one was
  actually wanted (memory-referenced), so "surface, don't auto-delete" held.
