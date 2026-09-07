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
these pages — it lives in git, in the ADRs (`decisions/`), and in the brain
(`brain/forge-dev/themes/`, `brain/cycles/themes/`).

---

## Tutorials — learning by doing

A tutorial takes a newcomer through a flow end to end for the first time,
beat by beat, so they finish with something that worked rather than just
something they read.

| Page | What it covers |
|---|---|
| [Getting started](./tutorials/getting-started.md) | Install to first merged PR: bring a project under forge, preflight it, author or reuse a flow, kick off the architect, review and merge. The five-step path for someone who has never run forge before. |

The rest of `tutorials/` is **generated**, one page per operator story in
[`tests/stories/`](../tests/stories) — see [`tutorials/README.md`](./tutorials/README.md)
for the full, current list.

## How-to guides — goal-directed recipes

A how-to guide assumes you already know the ground and answers one question:
how do I get *this* specific outcome. No teaching, no theory — just the steps.

Every page in `how-to/` is **generated**, one page per operator story in
[`tests/stories/`](../tests/stories) — see [`how-to/README.md`](./how-to/README.md)
for the full, current list. There are no hand-written how-to pages: every
recipe forge ships is proven by a story first.

## Reference — information about the machinery

Reference pages are consulted, not read start to finish: the exact shape of a
contract, a schema, an attribute, an enumeration. They describe what *is*,
not how to get there or why.

| Page | What it covers |
|---|---|
| [CLI reference](./reference/cli.md) | The `forge --help` output plus the CLI verbs beyond Studio (`serve`, `preflight`, `brain lint`/`index`, phase entry points) — Studio is the sole operator surface; this documents the rest. |
| [Project contract](./reference/project-contract.md) | The forge↔project contract every managed project must satisfy: the Studio object fields, the C1–C10 operational clauses, the gate-script template (with the errexit-exempt trap it closes), and the enforcement table. |
| [Studio DOM contract](./reference/studio-dom-contract.md) | The per-route `data-*` attribute contract every Studio page mirrors its load-bearing state into, so automation (Playwright today) drives a page by reading structured DOM state rather than scraping rendered text. |
| [Extension seams](./reference/extension-seams.md) | The pluggable points forge exposes for adding capability — RuntimeAdapter, KbBackend and Flow, each a registry with its own conformance-test admission gate, plus the skill/agent registration point. |
| [Request-path sinks](./reference/request-path-sinks.md) | The enumeration behind the path-guard ratchet: every filesystem read/write reachable from a bridge route or CLI dispatch whose path derives from request data, classified `guarded` / `unguarded` / `accidentally-safe`. |
| [Agent cost ceilings](./reference/agent-cost-ceilings.md) | How a standalone agent spawn enforces a cost ceiling, the per-agent default `budgets.maxBudgetUsd` values and how they were derived, and the operator-ceiling precedence rule. |
| [Serve supervision](./reference/serve-supervision.md) | Running `forge serve` under an OS process supervisor (systemd, pm2, runit) — what forge's own recovery model does and does not cover, and where the split falls. |
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

- **[Decisions](./decisions/README.md)** — one ADR per load-bearing choice,
  plus the retirement ledger. If a change conflicts with an ADR, the ADR is
  updated first, with rationale.
- **[Roadmaps](./roadmaps/README.md)** — [`1.0.md`](./roadmaps/1.0.md) is the
  single roadmap driving all current forge work; its companions
  ([`1.0-kickoffs.md`](./roadmaps/1.0-kickoffs.md),
  [`1.0-skills.md`](./roadmaps/1.0-skills.md)) and the
  [design spec](./superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md)
  sit alongside it. [`roadmaps/archive/`](./roadmaps/README.md) keeps the
  R1–R8 roadmaps that drove forge before the 1.0 plan — superseded for new
  work, kept as the record of what was built and why.
- **[Schemas](./schemas/project-config.schema.json)** — the JSON Schema a
  managed project's `forge.config.json` is validated against, with worked
  [examples](./schemas/examples/project.mdtoc.json) for
  [two real projects](./schemas/examples/project.betterado.json). The prose
  contract these encode is
  [`reference/project-contract.md`](./reference/project-contract.md).
- **[Product](./product/user-stories.md)** — the tiered catalogue of operator
  journeys forge supports, and its companion, the
  [Minimum Viable User Story](./product/minimum-viable-user-story.md) vision
  for the shipped out-of-the-box suite.

---

*Historical campaign notes and one-shot investigation reports are not kept
here — they live in git history and the brain
(`brain/forge-dev/themes/`, `brain/cycles/themes/`).*
