---
title: Declarative specs over imperative instructions
description: Ralph principle — describe the desired state, let the agent iterate toward it, rather than dictating step-by-step procedures. Bad specs produce mediocre results.
category: pattern
keywords: [declarative, imperative, specs, ralph, prompts, refactoring, prompt-engineering]
created_at: 2026-05-04T18:00:00Z
updated_at: 2026-05-04T18:00:00Z
related_themes: [ralph-loop-pattern, spec-driven-work-items]
---

# Declarative specs over imperative instructions

A core lesson from Ralph practitioners: **describe desired state, not the procedure.** Imperative instructions ("first do X, then Y, then Z") are brittle — when reality diverges from the procedure, the agent has no way to recover. Declarative specs ("the system, when complete, shall verify these acceptance criteria") let the agent interpret the state and iterate toward it.

This is what makes Ralph valuable for refactoring, spec generation, and autonomous repository development — domains where the *target state* is clear but the *path* is not.

The corollary: **bad specifications produce mediocre results.** Vague Given-When-Then criteria leave the agent guessing; precise criteria let it self-verify. Forge encodes this in the project-manager phase: every work item must have at least one Given-When-Then acceptance criterion, and the criteria must be specific enough that the orchestrator (not the agent) can verify them.

Practitioner lesson: small, manageable changesets deployed repeatedly outperform massive single runs. Iteration requires human judgment for genuine taste decisions, but mechanical questions ("is this criterion met?") should be machine-verifiable.

## Sources

- [`ralph-humanlayer-history.web.md`](../../_raw/web/ralph-humanlayer-history.web.md) — declarative-vs-imperative framing, "bad specs → mediocre results" lesson.
- [`ralph-ghuntley.web.md`](../../_raw/web/ralph-ghuntley.web.md) — "deterministically bad in an undeterministic world" — predictable failure tunable through prompt refinement.

## Related

- [Theme: Ralph loop pattern](./ralph-loop-pattern.md) — the loop these specs feed.
- [Theme: Spec-driven work items](./spec-driven-work-items.md) — forge's instantiation.
