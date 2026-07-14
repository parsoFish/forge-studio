# Forge Studio

> The steerable composition layer for autonomous software delivery — for one operator running a portfolio of projects.

Forge Studio is a **visual, autonomous software-engineering pipeline you can see, edit, and trust**. You hand it a direction (an idea, a roadmap); agents do the implementation, unattended, between three deliberate human moments. It is built for the **single technical operator running many side projects** — the buyer that team tools (Devin, Factory, Copilot) and in-IDE assistants (Cursor) leave under-served.

Three things make it one product rather than three:

- **A visual SWE pipeline.** The autonomous cycle — architect → plan → decompose → developer loop → unifier → review → reflection — is *data*, not a hardcoded script. "Forge is just one flow" ([ADR 028](./docs/decisions/028-flow-engine.md)): a generic flow engine dispatches each node through a node-executor registry. You see the pipeline, change the pipeline, run the pipeline.
- **Code-enforced gates.** The three human moments (architect, review, reflect) are structural, not advisory. There is **no auto-approve code path anywhere** — forge cannot accidentally skip you, because the gate lives in the code, not in a prompt. These are gates you can *read*, not just trust.
- **A compounding engineering brain.** Every cycle's reflection is distilled into a human-navigable engineering wiki ([ADR 018](./docs/decisions/018-three-brain-model.md), three scoped graphs) that planners query *before* designing the next initiative. Memory tools cache for runtime recall; the brain compounds — it tunes *how the next plan is designed*, across every project.

Full competitive analysis and the strategic frame: [`docs/forge-studio-market-and-differentiation.md`](./docs/forge-studio-market-and-differentiation.md).

## See it run

The canonical walkthrough is the **end-to-end operator journey** — new idea → architect interview + PLAN gate → decomposition into work items → developer loop (dependency-ordered) → unifier → an *interactive* review demo → reflection — driven entirely through Forge Studio. It records a video + an annotated frame gallery and asserts the DOM-as-metrics invariants as it goes. Regenerate it any time with `npm run ui:journey` (output: [`demos/e2e/index.html`](./demos/e2e)).

## The moat

There are two layers to the differentiation, and keeping them distinct matters.

**Today — the intersection (§1).** Forge is the only system that combines a *visually editable* autonomous-SWE pipeline, *structurally code-enforced* human gates, and a *compounding, human-navigable engineering knowledge graph wired into planning*, for a single operator running a portfolio. Each capability has a competitor; the combination has none — and Forge is **the only open product at that intersection.** Open matters here for a specific reason: when the gate is in the code and the code is yours to read, "won't skip the human" is a property you can *verify*, not a vendor promise.

**Over time — modularity-as-subsumption (§3).** Forge's objects are declarative data over swappable seams, so it can **absorb the best point-solution in each sub-domain — turning competitors into components** — instead of out-building them. The seams are real and used in production; the **runtime-adapter** seam carries a second implementation behind it:

| Seam | Live | Second implementation (seam-proven) | ADR |
|---|---|---|---|
| Runtime / model | Claude Agent SDK | Gemini, Aider adapters | [029](./docs/decisions/029-runtime-adapters.md) |
| Flow engine | node-executor registry (the old `classifyNode` switch is gone) | any node type as a data-table entry | [028](./docs/decisions/028-flow-engine.md) |
| Knowledge backend | filesystem brain (`FilesystemKbBackend`) | seam present; filesystem-only today | [027](./docs/decisions/027-studio-object-model.md) |

A standing test (`orchestrator/subsumption-proof.test.ts`) asserts the runtime-adapter seam resolves a second implementation — "competitors → components" made mechanically true, not just asserted.

**Honest caveats (do not skip — see §3.4 + [ADR 032](./docs/decisions/032-subsumption-proof.md)).** *Generic* modularity is a crowded pitch; the defensible claim is the *specific* one: subsumption of best-in-class **software-engineering** components under a **steerable, gated, knowledge-compounding** pipeline for a **portfolio** operator. Today the **runtime-adapter** seam is the one with a shipped second implementation (the KB seam is filesystem-only — `FilesystemKbBackend` — and the flow engine is registry-driven). The second adapters are **seam-proven but provisioning-gated** (`available: false` until their dep + creds are present); a *live* combined cycle additionally needs a Gemini tool executor and per-adapter model resolution. The seam accepts the component today; each live integration ships as it is provisioned.

## Quickstart

```bash
# Prerequisites
node --version           # Node 20+
gh --version             # GitHub CLI
git --version            # 2.20+ (for git worktree)

# Install + build + test
npm install
npm run build
npm test                 # the full node:test suite
npm link                 # puts the `forge` command on PATH (bin/forge.mjs)

# Launch Forge Studio — the operator UI is the whole product
forge studio             # health-probes the bridge + UI, then opens the browser
                         # (--bridge-only, --no-open, --bridge-port, --ui-port, --ready-file)

# Runtime spine (the bridge/UI is the operator API; the CLI is recovery + CI)
forge serve [--once]     # run the unattended scheduler in the foreground
forge preflight <project>        # check the forge↔project contract
forge studio lint        # validate studio definitions (agents/flows/catalog/kb)
forge brain lint         # structural integrity checks on the brain
forge --help             # full surface

# Verification gates
npm run ui:journey       # end-to-end operator journey (UI regression + demo video)
npm run verify:cycle     # real cycle against a managed project (real-money; operator-gated)
```

## Onboard your first project

Forge auto-discovers managed projects from disk — any directory under
`projects/` (or `$FORGE_PROJECTS_DIR`) carrying a `.forge/project.json`
contract file is a managed project. To get one ready:

1. Read [**docs/getting-started.md**](./docs/getting-started.md) — the
   install-to-first-merge walkthrough (clone/symlink → `forge preflight <id>`
   until green → author or reuse a flow → `/architect/new` → approve → review →
   merge).
2. Bring the project up to the [**forge↔project contract**](./docs/forge-project-contract.md)
   with the `forge-onboard-project` skill. Copy
   [`studio/starters/project.json.example`](./studio/starters/project.json.example)
   to `<project>/.forge/project.json` and fill in each field.
3. Run `forge preflight <id>` until every hard clause is green (or onboard via
   Studio → Projects → New, which scaffolds the contract files for you).

## The three human moments

Forge runs unattended **between** exactly three deliberate human interaction points; everything else is autonomous. All three render natively in Forge Studio ([ADR 031](./docs/decisions/031-studio-consolidation.md)): the architect interview + PLAN gate, and the review/reflect moments through the unified `/artifact` viewer ([ADR 020](./docs/decisions/020-architect-in-ui.md), [ADR 021](./docs/decisions/021-local-review-and-unified-demo.md)).

| Moment | What you do | Forge produces |
|---|---|---|
| **Architect** | drop an idea → interview → approve the PLAN | a queued initiative; the scheduler picks it up |
| **Review** | inspect the demo-embedded PR → approve (merge in GitHub) or send back | a self-contained PR; closure fires reflection on merge |
| **Reflect** | answer the reflector's questions | brain themes + retro + cycle archive |

## Repository layout

Every path belongs to one of **three scopes** — framework (1), cycles/agents/flows (2), projects (3). See **[docs/repo-map.md](./docs/repo-map.md)** for the full map and the cross-scope rule.

| Path | Scope | What lives here |
|---|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | — | Narrative architecture |
| [`PRINCIPLES.md`](./PRINCIPLES.md) | — | The five principles that gate every decision |
| [`docs/`](./docs/) | — | Docs — [repo map](./docs/repo-map.md), ADRs, phase docs, guides |
| [`orchestrator/`](./orchestrator/) | 1 | Scheduler, cycle runner, flow engine, the KB backend seam, logging (+ the Studio engine) |
| [`cli/`](./cli/) | 1 | Operator utilities, `forge` subcommands, the UI bridge |
| [`loops/`](./loops/) | 1 | Agentic loop runtimes + the runtime-adapter seam (`loops/_adapters/`) |
| [`forge-ui/`](./forge-ui/) | 1 | Forge Studio — the Next.js operator UI (launched by `forge studio`) |
| [`studio/`](./studio/) | 2 | Studio definitions as data — flows, agents, catalog, KBs |
| [`skills/`](./skills/) | 2 | Claude Code skills — the agent surface |
| [`brain/`](./brain/) | 2·3 | The compounding engineering wiki (three scoped graphs) |
| [`projects/`](./projects/) | 3 | Managed projects forge develops (gitignored; contract-driven) |

## Extending Forge

Forge grows by plugging components into its seams, not by forking the core. To add a runtime/model, implement `RuntimeAdapter` in `loops/_adapters/<sdk>/index.ts`, pass the conformance suite (`loops/_adapters/conformance.ts`), register it in `loops/_adapters/registry.ts`, and add it to `studio/catalog.yaml`. KB backends ([ADR 027](./docs/decisions/027-studio-object-model.md)) and flow node executors ([ADR 028](./docs/decisions/028-flow-engine.md)) follow the same implement-the-interface-then-register pattern. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow and the per-seam extension recipes.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE) (AGPL-3.0-or-later). Network use is distribution: anyone who runs a modified Forge as a service must make the modified source available to its users.
