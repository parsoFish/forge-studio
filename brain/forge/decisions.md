# Forge — Decisions

> Category index. Lists theme pages describing **durable architectural decisions** — why the system is the way it is.

The full ADR set lives in [`docs/decisions/`](../../../docs/decisions/). This index is for theme pages *about* decisions — research, alternatives considered, lessons learned from a decision after the fact, decisions made informally outside an ADR.

`brain-lint` ensures every theme page with `category: decision` appears here exactly once.

## Theme pages

- [`minimal-runtime-config`](./themes/minimal-runtime-config.md) — `forge.config.json` is per-machine, gitignored, minimal. Settings live in ADRs / SKILL.md / manifest.

> Most ADRs surface as `pattern`-categorised theme pages indexed in [`patterns.md`](./patterns.md). This index is reserved for theme pages whose primary frame is "we chose X over Y because Z" — i.e. the *why* of a decision rather than the *what* of a pattern.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
