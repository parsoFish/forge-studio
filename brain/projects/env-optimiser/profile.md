---
project: env-optimiser
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
status: active
domain: WSL2 developer-experience tooling
stack: [python, atuin, sqlite, pytest]
taste_decay: 0.05
---

# env-optimiser (WSL Dev Environment Optimizer / WSL-DEO)

Local-first workflow analysis and optimisation for WSL2 developers. Captures shell commands, git activity, and VS Code workspace usage; generates daily optimisation briefs with actionable recommendations. **Read-only by design** — all data stays on the local machine; no automatic environment changes are applied.

## Taste signals

- **Local-first, zero network calls.** All data stored under `~/.wsl-deo/`. Any feature that introduces a network call needs explicit constitutional justification.
- **Constitution as source of truth.** [`.specify/memory/constitution.md`](https://github.com/.../specify/memory/constitution.md) lists 7 non-negotiable principles. Every initiative gets validated against these.
- **Spec-driven via specify/.** Feature specs live under `specs/<feature>/` (`spec.md`, `plan.md`, `tasks.md`, `quickstart.md`). The PM phase should follow this layout.
- **Python stdlib + Atuin only.** New runtime dependencies need spec-level justification (constitution principle #3).
- **Test-driven** — pytest, with quickstart-driven validation (the quickstart.md must remain runnable end-to-end).

## Hard constraints

- **Mandatory secret redaction** before storage (constitution #2). Any data-capture path that bypasses redaction is a critical bug.
- **Read-only mutation surface** (constitution #4). Recommendations are preview-only; no installer that auto-applies changes.
- **WSL2 / Ubuntu 22.04 / 24.04 only** (constitution #5). Don't add cross-platform shims that aren't requested.
- **TDD-first** (constitution #6). Tests precede implementation.

## Domain advantages (from v1 Cycle 3 data)

env-optimiser had the **tightest develop-time distribution** of all 4 projects (3.6 min avg / 8.3 min max, 100% completion). Clean Python + clean spec format → predictable agent behaviour. Use as the **gold-standard reference project** when calibrating PM/developer-loop benchmarks.

## Active focus (v1 roadmap, carried forward)

- **Phase 1**: simplification + operational readiness — every milestone removes friction or strengthens the foundation.
- **Phase 2**: extend collectors (already MVP-complete: command history, git, VS Code). Add analyser depth (alias suggestions, error-pattern clustering).
