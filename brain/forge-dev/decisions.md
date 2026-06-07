# Forge — Decisions

> Category index. Lists theme pages describing **durable architectural decisions** — why the system is the way it is.

The full ADR set lives in [`docs/decisions/`](../../../docs/decisions/). This index is for theme pages *about* decisions — research, alternatives considered, lessons learned from a decision after the fact, decisions made informally outside an ADR.

`brain-lint` ensures every theme page with `category: decision` appears here exactly once.

## Theme pages

- [`minimal-runtime-config`](./themes/minimal-runtime-config.md) — `forge.config.json` is per-machine, gitignored, minimal. Settings live in ADRs / SKILL.md / manifest.
- [`forge-project-onboarding-contract`](./themes/forge-project-onboarding-contract.md) — Six clauses (C1–C6) a project must meet for unattended progress; derived from what trafficGame needed. ADR-017 candidate.
- [`brain-read-policy`](./themes/brain-read-policy.md) — Planner/architect MUST read the brain; dev-loop and reviewer MUST NOT (intent is in the work items); all reads index-guarded.
- [`holistic-metrics-onboarding`](./themes/holistic-metrics-onboarding.md) — A new contract clause (C7) — projects declare a holistic metric command + locked baselines + regression budget. Tests verify "did this break"; metrics verify "did this help". Derived from the trafficGame collision/elevation arc.
- [`exploration-vs-implementation-initiatives`](./themes/exploration-vs-implementation-initiatives.md) — Exploration initiatives (sweep parameter space for a measurable outcome) need a different pipeline shape than implementation initiatives. Counterfactual reconstruction of the trafficGame arc's structure.

> Most ADRs surface as `pattern`-categorised theme pages indexed in [`patterns.md`](../cycles/patterns.md). This index is reserved for theme pages whose primary frame is "we chose X over Y because Z" — i.e. the *why* of a decision rather than the *what* of a pattern.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
