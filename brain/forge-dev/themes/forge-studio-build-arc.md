---
title: Forge Studio build arc (M0-M6) — playbook + lessons
description: >-
  How the full Forge Studio roadmap (definitions-as-data → flow engine →
  pluggable runtimes) was built in one push via subagent orchestration, and the
  durable lessons — strangler equivalence, verify-cycle corpus non-determinism,
  the review catches.
category: reference
keywords:
  - forge-studio
  - subagent-orchestration
  - strangler-cutover
  - verify-cycle
  - corpus-non-determinism
  - adapter-framework
  - milestone-playbook
  - review-discipline
created_at: 2026-06-14T00:00:00.000Z
updated_at: 2026-06-14T00:00:00.000Z
related_themes:
  - six-phases-of-forge
  - alternative-loop-runtimes
  - brain-read-policy
---

# Forge Studio build arc — M0 to M6

The full roadmap ([`docs/forge-studio/`](../../../docs/forge-studio/), ADRs 027-030) shipped to `main` across one push: definitions-as-data → run model + read-only UI → builders + single-source specs → the flow-engine cutover → flow builder + artifact viewer → KBs as objects → a pluggable runtime adapter framework. 1084 tests; relicensed AGPL-3.0.

## The orchestration playbook (what worked)

- **Per milestone: research → plan → execute.** Each milestone began with parallel read-only investigators mapping the exact seams (file:line + verbatim shapes), then a `writing-plans`-style plan doc with the ground-truth baked in, then task-by-task execution.
- **Per task: fresh implementer + spec review + code-quality review.** A clean subagent implemented each WI; an independent spec-reviewer checked it against the plan; a quality-reviewer (often `typescript-reviewer`/`security-reviewer`) checked the build. Fixes verified before commit. The full spine (`npm test` + build + `forge brain lint` + `forge studio lint` + `ui:journey`) was green at every merge.
- **Reviews caught real defects pre-merge** that build/tsc could not: two CRITICAL CSRF + path-traversal holes (M2/M3 write surfaces), a YAML injection in KB-create (M5), a folded-scalar frontmatter swallow (M5), the 33h-wedge gap (M3 — closed for real with a `Promise.race` timer, not just post-detected), node-field loss on flow save (M4 — would have stripped forge-cycle's gate). Build-green never meant correct; the live `ui:journey` run repeatedly surfaced integration bugs unit tests missed.

## Strangler cutover (M3) — the equivalence oracle

The riskiest change (`runCycle` → `flow-runner` from `flow.yaml`) was made safe by one rule: **the full existing cycle/phase/scheduler suite must pass UNCHANGED**. Behaviour-identical = provable when the old tests stay green. Same rule guarded the M6 adapter extraction (`claude-agent.ts` diff was empty — the adapter wraps, never rewrites).

## verify-cycle corpus non-determinism (load-bearing)

Six real-money `verify:cycle` runs. The dev agent is **non-deterministic**: M3 + M4 did real work and hit fully-GREEN gates; M2 + M5 + M6 hit `WI-1 dev failed · iters=0 · gate-too-loose` (the iter-0 hollow-pass guard firing because the project's gate is already green at the frozen base). The engine ran claim→PM→dev faithfully every time — a `gate-too-loose` FAIL is the corpus artifact, NOT a code regression. Operational gotchas for a clean run: clear the stale `origin/forge/<id>` branch first, strip the manifest's stale `resume_from` (fixed in `stageManifest`), and the routine harness sets `FORGE_SKIP_CONTRACT_CHECK=1` (it tests execution, not onboarding). See [`docs/forge-studio/work-items.md`](../../../docs/forge-studio/work-items.md) per-milestone verify notes.

## Endpoint

Forge is now a modular agent-flow platform: every load-bearing object (agent, flow, project, KB, runtime) is data + a thin layer over a proven mechanism. The one hardcoded cycle became seed data. Remaining ask-first drop-in: a real second SDK adapter (the framework + conformance suite are ready). Known latent gaps documented in [`docs/known-gaps.md`](../../../docs/known-gaps.md).
