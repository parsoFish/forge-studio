# Forge Studio documentation

Forge Studio is a construction platform for agentic software factories. This
tree is organised by [Diátaxis](https://diataxis.fr/) — **tutorials**,
**how-to guides**, **reference** and **explanation** — because those four
answer four different questions, and mixing them is how docs rot. Work out
which question you have, then go straight to that quadrant:

- Learning forge for the first time, with no goal yet of your own? **Tutorials.**
- Already know forge, want to get one specific thing done? **How-to guides.**
- Need the exact shape of something — a field, a contract clause, an
  attribute? **Reference.**
- Want to know *why* forge is built this way? **Explanation.**

Every page here describes the **current state**. History is not narrated in
these pages — it lives in git, in `DECISIONS.md`, and in the brain
(`brain/forge-dev/themes/`, `brain/cycles/themes/`).

---

## Tutorials — learning by doing

A tutorial takes a newcomer through a flow end to end for the first time,
beat by beat, so they finish with something that worked rather than just
something they read.

| Page | What it covers |
|---|---|
| [Getting started](./tutorials/getting-started.md) | Install to first merged PR: bring a project under forge, preflight it, author or reuse a flow, kick off the architect, review and merge. The five-step path for someone who has never run forge before. |

The story walkthroughs are generated how-to pages on the docs site
(`apps/docs/src/content/docs/guides/how-to/`); see
[`tutorials/README.md`](./tutorials/README.md).

## How-to guides — goal-directed recipes

A how-to guide assumes you already know the ground and answers one question:
how do I get *this* specific outcome. No teaching, no theory — just the steps.

How-to pages are **generated**, one per operator story in
[`tests/stories/`](../tests/stories), into the docs site at
`apps/docs/src/content/docs/guides/how-to/`. There are no hand-written how-to
pages: every recipe forge ships is proven by a story first.

## Reference — information about the machinery

Reference pages are consulted, not read start to finish: the exact shape of a
contract, a schema, an attribute, an enumeration. They describe what *is*,
not how to get there or why.

| Page | What it covers |
|---|---|
| [Studio DOM contract](./reference/studio-dom-contract.md) | The per-route `data-*` attribute contract every Studio page mirrors its load-bearing state into, so automation (Playwright today) drives a page by reading structured DOM state rather than scraping rendered text. |
| [Request-path sinks](./reference/request-path-sinks.md) | The enumeration behind the path-guard ratchet: every filesystem read/write reachable from a bridge route or CLI dispatch whose path derives from request data, classified `guarded` / `unguarded` / `accidentally-safe`. |
| [Studio copy](./reference/studio-copy.md) | The facts Studio and the scripts still take from the deleted `mockups/` tree — the named constant or behaviour, its value, and the mockup decision that justified it. |

## Explanation — understanding the design

Explanation pages step back from the mechanics and discuss *why*: the
alternatives, the trade-offs, the reasoning a reference page has no room for.

| Page | What it covers |
|---|---|
| [Architecture](./explanation/architecture.md) | Why the workspace is nine packages and two apps rather than the old flat `orchestrator/`/`cli/` split, and how the dependency-graph boundary lint enforces it. |
| [The request-path security model](./explanation/security-model.md) | Why forge treats request-derived filesystem paths as a closed, enumerated class rather than a bug fixed opportunistically when found — the escape-shape catalogue and the ratchet that keeps the enumeration true. |
| [The example factory](./explanation/example-factory.md) | What each station of the shipped develop factory does — brain, architect, plan, build, integrate, review, verdict, reflect — and how each is known to fail, in one page instead of five because the factory is data, not framework. |
| [Licensing](./explanation/licensing.md) | What AGPL-3.0-or-later means in practice for an operator running forge as a service. |
| [Community registry](./explanation/community-registry.md) | Who writes `studio/community/registry.yaml`, how writes reach git, and the commit policy that keeps the operator, not forge, holding the git identity. |

---

## Outside the four quadrants

Four areas sit outside Diátaxis on purpose — they are records, plans and
machine-readable contracts, not usage docs:

- **[Decisions](../DECISIONS.md)** — one row per load-bearing choice and
  rejected alternative. If a change conflicts with a row, the row is
  updated first, with rationale.
- **[Roadmaps](./roadmaps/README.md)** — [`1.0.md`](./roadmaps/1.0.md) is the
  single roadmap driving all current forge work; its companion
  [`1.0-skills.md`](./roadmaps/1.0-skills.md) and the
  [design spec](./superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md)
  sit alongside it.
- **[Schemas](./schemas/project-config.schema.json)** — the JSON Schema a
  managed project's `forge.config.json` is validated against, with worked
  [examples](./schemas/examples/project.mdtoc.json) for
  [two real projects](./schemas/examples/project.betterado.json). The prose
  contract these encode is
  the Project contract page of the docs site.
- **[Product](./product/user-stories.md)** — the tiered catalogue of operator
  journeys forge supports, and its companion, the
  [Minimum Viable User Story](./product/minimum-viable-user-story.md) vision
  for the shipped out-of-the-box suite.

---

*Historical campaign notes and one-shot investigation reports are not kept
here — they live in git history and the brain
(`brain/forge-dev/themes/`, `brain/cycles/themes/`).*
