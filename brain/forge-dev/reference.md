# Forge — Reference

> Category index. Lists theme pages categorised as `reference` — overviews, profiles, comparisons, glossaries. Material that's neither a pattern to follow nor an antipattern to avoid; it's context.

`brain-lint` ensures every theme page with `category: reference` appears here exactly once.

## Theme pages

### System overviews

- [`six-phases-of-forge`](./themes/six-phases-of-forge.md) — Brain → Architect → PM → Developer Loop → Review Loop → Reflection.
- [`infrastructure-evolution`](./themes/infrastructure-evolution.md) — What forge kept from its founding mental models and what it replaced with battle-tested tools.
- [`forge-studio-build-arc`](./themes/forge-studio-build-arc.md) — How the full Forge Studio roadmap (M0-M6) was built via subagent orchestration, and the durable lessons (strangler equivalence, verify-cycle corpus non-determinism, review discipline).

### External-system profiles

- [`gstack-conventions`](./themes/gstack-conventions.md) — gstack's process-not-tools philosophy and the conventions forge inherited (skills, /autoplan, markdown-artifacts).
- [`alternative-loop-runtimes`](./themes/alternative-loop-runtimes.md) — Aider, OpenHands, OpenClaw, Hermes — adapter slots in `loops/_adapters/`.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
