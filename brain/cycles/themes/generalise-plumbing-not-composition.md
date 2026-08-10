---
title: Generalise the plumbing, measure the composition — a spine dissolves duplication, not identity
description: Batch-E lesson from the interactive-surface primitive (ADR-043). A generic spine cleanly absorbed the four bespoke runners' shared plumbing (containment preamble, spec/model derivation, telemetry, dispatch loop), but a migration pass measured that each runner is mostly per-kind prompt/state composition — for which the spine has no seam. The migration was killed by measurement in hours instead of shipped wrong.
category: pattern
keywords:
  - generalisation
  - spine
  - plumbing-vs-composition
  - golden-capture-probe
  - measurement-before-migration
  - turnSpec
  - interactive-runner
  - adr-043
created_at: 2026-08-11
updated_at: 2026-08-11
related_themes:
  - orchestrator-owned-execution-beats-heuristic-verification
  - declared-data-fails-open
---

# Generalise the plumbing, measure the composition

ADR-043 replaced the recurring "add a fifth bespoke interactive runner" cap park with one declarative primitive (`turnSpec`) plus one generic runner. That worked for its **first consumer** — creation-agent shipped live on the spine with zero bespoke code — and the temptation was to conclude the four legacy runners would follow as staged no-regression migrations.

They did not, and the reason is the durable lesson: **a generic spine dissolves what the implementations share, not what makes each one itself.** The four runners share the SEC-04 containment preamble, the ADR-024 spec/model/prompt derivation, telemetry, and the phase dispatch loop — the spine owns all of that once. What remains per runner is prompt and state *composition* (seed matching, prior-answer folding, demo element bodies, brain-index injection, a kb_binding cwd branch), and that is the **majority of each runner's lines**, with no data-shaped seam to hang it on.

## The method that made the finding cheap

The migration lane did not attempt a migration and discover the wall mid-refactor. It **drove the spine directly against each runner's committed golden-capture scenario** (the WI-0 fixtures pinned before the primitive landed) and diffed the turn outputs. Three probes, three measured refusals — `instructions` rejected before the LLM is called, `demo-builder`'s writes structurally outside the `writes:` model, `project-brain` divergent in prompt/cwd/maxTurns/result shape. Total cost: hours, zero fixture edits, zero re-baselines.

**Golden captures taken *before* a generalisation double as its feasibility probes after.** That is a second, unplanned return on the pin-first discipline.

## Rules of thumb

- Before scheduling "migrate N implementations onto the new primitive," measure one: drive the primitive against the implementation's own golden scenario. Byte-diff the result. Let the diff, not the architecture diagram, size the initiative.
- If the primitive can only close the gap by growing per-kind fields or a handler registry, the migration is **not a refactor** — it is either new sanctioned surface (an operator ask) or a re-authoring of the per-kind content into its declared home (for forge: the agent's `SKILL.md`, per ADR-024) with **live** acceptance, because the content changes by design.
- State the surface-decrease claim of a generalisation as *owed until measured*. In batch E the net production deletion from the migration path was **zero**; the honest roadmap line says so.
