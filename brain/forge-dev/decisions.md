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

### Auto-linked (re-file under a curated heading when convenient)

- [`2026-06-08-audit-initiative-vs-architect-phase`](./themes/2026-06-08-audit-initiative-vs-architect-phase.md) — documentation/analysis initiatives (e.g. the release-definition schema audit) sit awkwardly in the full cycle pipeline; decision analysis on when audit-shaped work belongs in an architect phase vs a queued initiative.
- [`2026-06-06-ralph-scratch-leak-pre-pr-strip`](./themes/2026-06-06-ralph-scratch-leak-pre-pr-strip.md) — PROMPT.md / AGENT.md / fix_plan.md are stamped at the WORKTREE ROOT (the dev agent references them by relative path), NOT under the gitignored .forge/ dir. So autoCommitWorktreeIfDirty's `git add -A` and the agent's own commits sweep them onto the initiative branch, where they leak into the PR and re-introduce the C2 (scratch-hygiene) contract violation on main after merge — across the whole betterADO release chain this forced a manual `git rm --cached AGENT.md fix_plan.md` before EVERY merge. Fix (pr.ts b53dfda): stripForgeScratchFromBranch now also drops the root Ralph scratch trio at the same pre-PR boundary it strips `.forge/`, BASE-GUARDED — it only removes copies this cycle introduced (tracked on the branch but absent from the base ref), so a project that legitimately ships an AGENT.md keeps it in its PR. A project .gitignore covering the trio prevents the `git add -A` path at source; the strip is the belt-and-braces for the agent's own/forced adds and for projects without that ignore.
