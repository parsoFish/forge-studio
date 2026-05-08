---
title: Spec-driven development — PRD as the contract
description: Vague specs propagate downstream and break the developer loop. Concrete specs let agents self-verify. PRD is the contract between architect → PM → developer.
category: pattern
keywords: [spec-driven, prd, contract, given-when-then, declarative, files-in-scope, acceptance-criteria]
created_at: 2026-05-04T18:00:00Z
updated_at: 2026-05-04T18:00:00Z
related_themes: [spec-driven-work-items, declarative-specs-vs-imperative, six-phases-of-forge]
---

# Spec-driven development — PRD as the contract

Vague specs propagate downstream. The developer loop can't verify what the PM didn't specify; the architect can't reject what the user didn't articulate. Concrete specs let every phase self-verify.

The forge v2 contract chain:

- **Architect ↔ user** — the PRD / initiative manifest. The user agrees this is the desired state.
- **PM ↔ architect output** — the work items. The PM decomposes against the PRD; ambiguity gets surfaced via the LLM Council before the manifest is queued.
- **Developer loop ↔ PM output** — the Ralph loop. Every iteration verifies against the work item's Given-When-Then acceptance criteria.

Practice:

- Every work item has ≥1 Given-When-Then acceptance criterion.
- Specs declare desired *state*, not procedure (declarative > imperative).
- `files_in_scope` is declared so changes don't sprawl.
- The PM's last step is a self-check against the dependency graph: are all dependencies real and reachable?

## Sources

- [`agentic-engineering-best-practices.chat.md`](../../_raw/web/agentic-engineering-best-practices.chat.md) — synthesis section 2.
- [`forge-v2-phase-project-manager.docs.md`](../../_raw/docs/forge-v2-phase-project-manager.docs.md) — forge's instantiation.

## Related

- [Theme: Spec-driven work items](./spec-driven-work-items.md) — the artifact.
- [Theme: Declarative specs over imperative](./declarative-specs-vs-imperative.md) — the prompt-level discipline.
- [Theme: Six phases of forge](./six-phases-of-forge.md) — the phase chain.
