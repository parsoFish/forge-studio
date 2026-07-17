# Forge Studio Documentation

Forge Studio is a visual SWE pipeline that develops your projects autonomously between a few human moments. This index splits the docs into two audiences. If you only want to **run forge on your own project**, read the *Using Forge Studio* set. If you want to understand or change **how forge is built**, read the *Developing Forge Studio* set.

---

## Using Forge Studio (operators)

Docs are labelled by [Diátaxis](https://diataxis.fr/) type — **Tutorial** (learning-oriented), **How-to** (task-oriented), **Reference** (information lookup), **Explanation** (understanding).

| Doc | Type | What it covers |
|-----|------|----------------|
| [Getting started](./getting-started.md) | Tutorial | Install → onboard a project → first merged PR. Projects are auto-discovered from disk — there is no registry file to edit. |
| [Project contract](./forge-project-contract.md) | How-to · Reference | The forge↔project contract every managed repo must satisfy (acceptance tiers, demo shapes, the C10 release final-loop). The SSOT. |
| [Operator journey](./operator-journey.md) | Explanation | The AUTHOR / RUN / SWAP narrative — what Studio actually does end to end. |
| [Product vision](./product/minimum-viable-user-story.md) | Explanation | The canonical user story: idea → autonomous build → review → release → reflect. |
| [Licensing & dependencies](./licensing-and-dependencies.md) | Reference | What AGPL-3.0 means for you, plus the dependency audit. |
| [`.forge/project.json` schema](./schemas/project-config.schema.json) | Reference | Reference schema for a project's config, with real examples: [mdtoc](./schemas/examples/project.mdtoc.json) (creds-free, out-of-the-box) and [betterado](./schemas/examples/project.betterado.json) (live external resources). |

The human moments: **architect interview** (shape the work), **review verdict** (approve / send back), and **release approve** (sign off the changelog before forge merges). Everything between runs unattended.

## Vision & positioning

Perishable strategy docs (dated; not onboarding material):

- [What makes it different](./forge-studio-market-and-differentiation.md) — *Explanation.* Competitive position + the modularity-as-subsumption thesis. **Dated 2026-06-14 positioning**, not current-state reference.

---

## Developing Forge Studio (contributors)

**Orientation**
- [Repository map](./repo-map.md) — *Explanation.* The three scopes and which rule governs each path. Start here.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — narrative as-built architecture (repo root).
- [PRINCIPLES.md](../PRINCIPLES.md) — the five non-negotiable principles (repo root).
- [CONTRIBUTING.md](../CONTRIBUTING.md) — build/test gates and how to extend forge (repo root).
- [Architecture overview](./architecture/overview.md) — internal index into phases, decisions, and the contract.
- [CLI reference](./reference/cli.md) — *Reference.* The committed `forge --help` plus the daemon / scaffolding / phase verbs.

**Direction**
- [Roadmap set](./roadmaps/README.md) — *Explanation · Reference.* The living forge-dev roadmaps (R1–R8): the planning SSOT for everything forge builds next, with the coverage map routing every architecture pillar to its owning roadmap. Start any forge-dev work here.

**Decisions**
- [ADR index](./decisions/README.md) — every load-bearing choice plus the retirement ledger.

**Phases** (purpose + success signals)
- [architect](./phases/architect.md) · [brain](./phases/brain.md) · [project-manager](./phases/project-manager.md) · [developer-loop](./phases/developer-loop.md) · [review-loop](./phases/review-loop.md) · [reflection](./phases/reflection.md)

**Seams & extension**
- [Extending forge](./extending-forge.md) — add a runtime adapter, flow, or skill.
- [Harness-overlay seam](./architecture/harness-overlay-seam.md) — the parked injection seam.
- [Gate-script template](./gate-script-template.md) — the errexit-exempt-safe template for a multi-step `quality_gate_cmd` script.

**Operations & backlog**
- [Serve supervision](./operations/serve-supervision.md) — running `forge serve` under a supervisor.
- [Headroom token-efficiency trial](./operations/headroom-token-efficiency-trial.md) — runbook + decision criteria for trialling the headroom context-compression proxy against forge.
- [Verify-cycle idea corpus](./verify-cycle-ideas/README.md) — hand-authored initiative ideas fed to `scripts/verify-cycle.mjs --idea-file` for the gitpulse reference-project harness.
- [Known gaps](./known-gaps.md) — the open hardening backlog (internal).
- [UX reference](./reference/studio-first-flow-ux.md)

---

*Historical milestone plans, completed roadmaps, and one-shot review reports have been removed; they live in git history. Durable lessons live in the brain (`brain/forge-dev/themes/`) and the ADRs.*
