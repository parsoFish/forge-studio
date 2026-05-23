---
title: env-optimiser — features land via specs/<feature>/ pattern (specify/)
description: >-
  Each feature has spec.md, plan.md, tasks.md, quickstart.md under
  specs/<NNN>-<slug>/. The PM phase mirrors this layout when decomposing
  initiatives.
category: pattern
keywords:
  - env-optimiser
  - specify
  - spec-driven
  - quickstart
  - pm-mapping
  - feature-folder
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# env-optimiser — specify/-driven features

env-optimiser uses the [Specify framework](https://github.com/specify) layout for features. Each feature lives under `specs/<NNN>-<slug>/` with:

- `spec.md` — the requirements + user stories (architect output ≈ this).
- `plan.md` — the technical design (PM output's prose ≈ this).
- `tasks.md` — the task breakdown (PM's work-item list ≈ this).
- `quickstart.md` — the runnable end-to-end validation flow.

For env-optimiser initiatives, the v2 PM phase should:

- **Map the architect's manifest features → `specs/<feature>/spec.md` updates** (don't create new feature folders without justification).
- **Add work items as tasks in `tasks.md`** with the same `WI-N` IDs the orchestrator uses.
- **Verify the quickstart flow remains runnable** as part of the work-item acceptance criteria — `wsl-deo status`, `wsl-deo collect`, `wsl-deo brief generate`, `wsl-deo brief show`.

The reviewer phase's demo script for any env-optimiser initiative should *be* the relevant `quickstart.md` (or a tightly-scoped subset).

## Sources

- env-optimiser README — references `specs/001-local-history-mvp/`, `specs/002-install-prereqs/`.
