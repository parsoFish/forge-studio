# Forge — Reference

> Category index. Lists theme pages categorised as `reference` — overviews, profiles, comparisons, glossaries. Material that's neither a pattern to follow nor an antipattern to avoid; it's context.

`brain-lint` ensures every theme page with `category: reference` appears here exactly once.

## Theme pages

### System overviews

- [`six-phases-of-forge`](./themes/six-phases-of-forge.md) — Brain → Architect → PM → Developer Loop → Review Loop → Reflection.
- [`infrastructure-evolution`](./themes/infrastructure-evolution.md) — What forge kept from its founding mental models and what it replaced with battle-tested tools.
- [`forge-studio-build-arc`](./themes/forge-studio-build-arc.md) — How the full Forge Studio roadmap (M0-M6) was built via subagent orchestration, and the durable lessons (strangler equivalence, verify-cycle corpus non-determinism, review discipline).
- [`framework-migration-capstone-arc`](./themes/framework-migration-capstone-arc.md) — Operator-driven betterado SDKv2→plugin-framework migration: the four forge fixes, the TF_ACC-inheritance off-rails, and the gate-gap that shipped a mis-named headline resource (a passing live acc test doesn't prove the merged surface).
- [`2026-07-01-architect-coverage-scope-fidelity`](./themes/2026-07-01-architect-coverage-scope-fidelity.md) — Architect first-pass gaps on roadmap-scale migration plans (no coverage-closure → orphans, decomposition-vs-package double-ownership, silent scope reduction, invariants left in the narrative, brain constraints not propagated to ACs) and the FINALIZE completeness-critic that would catch them; from the 2026-07-01 betterado readiness review.

### External-system profiles

- [`gstack-conventions`](./themes/gstack-conventions.md) — gstack's process-not-tools philosophy and the conventions forge inherited (skills, /autoplan, markdown-artifacts).
- [`alternative-loop-runtimes`](./themes/alternative-loop-runtimes.md) — Aider, OpenHands, OpenClaw, Hermes — adapter slots in `loops/_adapters/`.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-07-11-verify-harness-repo-state-traps`](./themes/2026-07-11-verify-harness-repo-state-traps.md) — Frozen-SHA replay of an already-remote-merged feature is structurally unmergeable, and a --base-sha run leaves local main frozen so later greenfield runs conflict too; gates use greenfield ideas on a synced main.

- [`2026-07-11-orphaned-scheduler-stale-modules`](./themes/2026-07-11-orphaned-scheduler-stale-modules.md) — A long-lived forge process from a dead session wins queue-claim races and runs phases on its boot-time module snapshot — hours behind disk; mixed-era evidence in one cycle log is the tell.

- [`m7-studio-consolidation-arc`](./themes/m7-studio-consolidation-arc.md) — How the M7 consolidation (Studio becomes the one product — delete /dashboard, fold the moment-screens, collapse the CLI, harden the launcher) was executed as per-WI multi-agent workflows, and the durable lessons: migrate-the-harness-before- you-delete, ui:journey as the integration oracle, adversarial review earns its cost.
