# Forge Studio

> A construction platform for agentic software factories — for one operator running a portfolio of projects.

**forge-studio** is a small set of composable primitives — agents, skills, flows, knowledge and gates — that one operator assembles into a purpose-built delivery pipeline for any codebase. A **factory** is one assembled, running pipeline; forge-studio is the kit you build factories with, and **Forge Studio** is the one operator surface you build, run and watch them from. It ships **one deletable example factory, the develop flow** (idea → plan → build → review → merge → reflect), to prove the primitives out of the box: evidence the kit works, not the product itself ([D-32](./DECISIONS.md)). It is SWE-focused by explicit choice, and built for the **single technical operator running many side projects**.

Three properties make it one kit rather than a bag of scripts:

- **Factories are data.** A factory's flow is a `FlowDef` — stations and gates declared in YAML — walked by one generic flow engine through a node-executor registry ([SPEC §2](./SPEC.md)). You see the pipeline, change the pipeline, run the pipeline. A second factory is built from data plus one enumerated seam entry, with no platform edits; deleting the example package leaves the platform running, and CI proves it.
- **Gates live in the code.** A factory declares where it stops for a human, and those stops are structural, not advisory: there is **no auto-approve code path anywhere**, so a factory cannot accidentally skip its operator. Every interactive stop is a session kind with a finalizer ([SPEC §5](./SPEC.md)) — gates you can *read*, not just trust.
- **Knowledge compounds.** Reflections are distilled into a human-navigable engineering wiki ([SPEC §4](./SPEC.md), three scoped graphs) that planning agents query *before* designing the next piece of work, across every project.

Full competitive analysis and the strategic frame: [`brain/forge-dev/themes/studio-differentiation-and-subsumption-moat.md`](./brain/forge-dev/themes/studio-differentiation-and-subsumption-moat.md).

## See it run

The canonical walkthrough is the **story suite** — ten operator stories driven entirely through Forge Studio: onboard an existing project, create one from scratch, reset a project contract, create a flow, an agent, a knowledge base and library components, install from the community registry, do all of it through the assistant, and run the example factory to a merged PR. Each story records a video and an annotated frame gallery, asserts the DOM-as-metrics invariants per beat, and emits a tutorial or how-to document from the same run. Regenerate any of them with `npm run stories -- --story <id>` (output: [`demos/stories/index.html`](./demos/stories)).

## The moat

There are two layers to the differentiation, and keeping them distinct matters.

**Today — the intersection (§1).** forge-studio is the only system that combines *visually editable* agentic pipelines, *structurally code-enforced* human gates, and a *compounding, human-navigable engineering knowledge graph wired into planning*, for a single operator running a portfolio. Each capability has a competitor; the combination has none — and forge-studio is **the only open product at that intersection.** Open matters here for a specific reason: when the gate is in the code and the code is yours to read, "won't skip the human" is a property you can *verify*, not a vendor promise.

**Over time — modularity-as-subsumption (§3).** forge-studio's objects are declarative data over swappable seams, so it can **absorb the best point-solution in each sub-domain — turning competitors into components** — instead of out-building them. The seams are real and used in production; the **runtime-adapter** seam carries a second implementation behind it:

| Seam | Live | Second implementation (seam-proven) | Contract |
|---|---|---|---|
| Runtime / model | Claude Agent SDK | Gemini, Aider adapters | [SPEC §1](./SPEC.md) |
| Flow engine | node-executor registry | any node type as a data-table entry | [SPEC §2](./SPEC.md) |
| Knowledge backend | filesystem brain (`FilesystemKbBackend`) | seam present; filesystem-only today | [D-09](./DECISIONS.md) |

A standing conformance suite (`packages/agents/tests/contract/conformance.test.ts`) runs every registered runtime adapter, the second implementations included, through the same contract — "competitors → components" made mechanically true, not just asserted.

**Honest caveats (do not skip — see §3.4).** *Generic* modularity is a crowded pitch; the defensible claim is the *specific* one: subsumption of best-in-class **software-engineering** components under **steerable, gated, knowledge-compounding** factories for a **portfolio** operator. Today the **runtime-adapter** seam is the one with a shipped second implementation (the KB seam is filesystem-only — `FilesystemKbBackend` — and the flow engine is registry-driven). The second adapters are **seam-proven but provisioning-gated** (`available: false` until their dep + creds are present); a *live* combined cycle additionally needs a Gemini tool executor and per-adapter model resolution. The seam accepts the component today; each live integration ships as it is provisioned.

## Quickstart

**Supported platform: WSL2 or Linux.** macOS and native Windows are not supported. The install form is a Node source checkout: clone this repository and build it; there is no npm package.

This README and the pages it links to are the documentation. Files an AI coding assistant may load on its own, such as `CLAUDE.md`, are instructions for agents working on forge itself, not a setup guide.

**Studio is a browser UI.** On WSL2, open <http://localhost:4124> in your Windows browser once `forge studio` is up.

```bash
# Prerequisites
node --version           # Node 22.12+
gh --version             # GitHub CLI, logged in: gh auth status
git --version            # 2.20+ (for git worktree)
claude --version         # Claude Code, logged in (`claude`, then /login) — forge's agents run through it

# Clone — the full history is about 3 GB, so expect several minutes with little progress output
git clone https://github.com/parsoFish/forge-studio.git && cd forge-studio

# Install + build + test
npm install
npm run build
npm test                 # the full node:test suite
npm link                 # puts the `forge` command on PATH (bin/forge.mjs)
forge init               # creates forge.config.json and the working dirs, and checks gh + credentials
export FORGE_CLAUDE_CLI="$(readlink -f "$(command -v claude)")"   # required: agents spawn through this binary (see .env.example)

# Launch Forge Studio — the operator UI is the whole product
forge studio             # health-probes the bridge + UI, spawns/adopts + supervises forge serve, then opens the browser
                         # (--bridge-only, --no-open, --bridge-port, --ui-port, --ready-file)

# Runtime spine (the bridge/UI is the operator API; the CLI is recovery + CI)
forge serve [--once]     # the daemon forge studio already supervises; run standalone for CI/headless use
forge preflight <project>        # check the forge↔project contract
forge studio lint        # validate studio definitions (agents/flows/catalog/kb)
forge brain lint         # structural integrity checks on the brain
forge --help             # full surface

# Verification gates
npm run stories          # the story suite (UI regression + demo video + how-to docs)
npm run verify:cycle     # real cycle against a managed project (real-money; operator-gated)
```

## Onboard your first project

Forge auto-discovers managed projects from disk — any directory under
`projects/` (or `$FORGE_PROJECTS_DIR`) carrying a `.forge/project.json`
contract file is a managed project. To get one ready:

1. Read [**Getting started**](./apps/docs/src/content/docs/guides/getting-started.md) — the
   install-to-first-merge walkthrough (clone/symlink → `forge preflight <id>`
   until green → author or reuse a flow → `/architect/new` → approve → review →
   merge).
2. Bring the project up to the [**forge↔project contract**](./docs/reference/project-contract.md)
   with the `forge-onboard-project` skill. Copy
   [`studio/starters/project.json.example`](./studio/starters/project.json.example)
   to `<project>/.forge/project.json` and fill in each field.
3. Run `forge preflight <id>` until every hard clause is green (or onboard via
   Studio → Projects → New, which scaffolds the contract files for you).

## The example factory's gates

The platform prescribes no fixed human moments: a factory declares its own gates in its flow, and Studio renders each one as a session the operator finalizes. The example develop factory ([stations and gates](./apps/docs/src/content/docs/how-forge-works.md)) is built with four operator acts; everything between them runs unattended:

| Act | What you do in Studio | The factory produces |
|---|---|---|
| **Plan gate** | drop an idea → interview → approve the PLAN | a queued initiative on the project's roadmap |
| **Kickoff** | on the project's roadmap, press **Start development** on the initiative's card — `forge serve` already claimed and planned it the moment the plan was approved | the build → integrate → review run |
| **Verdict gate** | inspect the demo-embedded PR → approve (merge) or send back | a self-contained PR; merge fires reflection |
| **Reflection** | answer the reflector's questions | brain themes + retro + cycle archive |

## Repository layout

The platform is nine ranked packages and two apps, their allow-graph enforced by a boundary lint; the factory content (flows, agents, skills, brain) is data on top, and managed projects sit outside the tree. The scope column says which: platform (1), factory content (2), projects (3). See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full map.

| Path | Scope | What lives here |
|---|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | — | Narrative architecture |
| [`PRINCIPLES.md`](./PRINCIPLES.md) | — | The five principles that gate every decision |
| [`docs/`](./docs/) | — | Docs — [repo map](./ARCHITECTURE.md), decisions, phase docs, guides |
| [`packages/`](./packages/) | 1 | The ranked packages — `contracts ← kernel ← {library, knowledge, projects} ← agents ← sessions ← flows ← stations ← factory` |
| [`apps/forge/`](./apps/forge/) | 1 | The assembly — `forge` CLI entry, the UI bridge and its routes, assembly-side bindings |
| [`apps/studio/`](./apps/studio/) | 1 | Forge Studio — the Next.js operator UI (launched by `forge studio`) |
| [`studio/`](./studio/) | 2 | Studio definitions as data — flows, agents, catalog, KBs |
| [`skills/`](./skills/) | 2 | Claude Code skills — the agent surface |
| [`brain/`](./brain/) | 2·3 | The compounding engineering wiki (three scoped graphs) |
| [`projects/`](./projects/) | 3 | Managed projects forge develops (gitignored; contract-driven) |

## Extending Forge

Forge grows by plugging components into its seams, not by forking the core. To add a runtime/model, implement `RuntimeAdapter` in `packages/agents/_adapters/<sdk>/index.ts`, pass the conformance suite (`packages/agents/_adapters/conformance.ts`), register it in `packages/agents/_adapters/registry.ts`, and add it to `studio/catalog.yaml`. KB backends ([D-09](./DECISIONS.md)) and flow node executors ([SPEC §2](./SPEC.md)) follow the same implement-the-interface-then-register pattern. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow and the per-seam extension recipes.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE) (AGPL-3.0-or-later). Network use is distribution: anyone who runs a modified Forge as a service must make the modified source available to its users.
