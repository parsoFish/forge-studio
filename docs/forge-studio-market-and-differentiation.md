# Forge Studio — Market Analysis & Differentiation

> ⚠️ **Dated positioning (2026-06-14) — not current-state reference.** A perishable
> competitive-analysis snapshot; market and competitor claims drift. For what forge
> *is* today, see [ARCHITECTURE.md](../ARCHITECTURE.md) and [the repo map](./repo-map.md).

> **Single source of truth** for Forge Studio's competitive position and differentiation. Consolidates the prior `market-analysis-forge-studio.md` (long-form landscape) and `forge-studio-differentiation-seed.md` (verified scorecard + matrix), and folds in the operator's **modularity-as-subsumption** thesis (§3) as the unifying strategic frame.
>
> **Method (2026-06-14):** internal product map (repo / brain / ADRs, 2 grounding agents) + a deep-research web harness (5 angles → 22 sources → 101 claims → adversarial verification). A first harness pass hit a session limit mid-verify; a second pass re-verified all 18 abstained claims on Haiku and profiled 5 under-covered competitors on Sonnet, with synthesis on Opus (deliberate model tiering to avoid an all-Opus spend).
>
> **Confidence tags:** **[V]** verified high-confidence · **[P]** partly-true / nuanced · **[S]** single-source, plausible.

---

## 1. Executive summary

Forge Studio is a **hybrid that spans three otherwise-separate categories** — autonomous software-engineering agents, visual agent-flow builders, and compounding knowledge/memory layers. No surveyed competitor bridges all three.

There are **two layers** to the differentiation, and keeping them distinct matters:

- **Today's moat (defensible now): the intersection.** Forge is the only system combining a *visually editable* autonomous-SWE pipeline, *structurally code-enforced* human gates, and a *compounding, human-navigable engineering knowledge graph wired into planning* — for a single operator running a *portfolio* of projects. Each capability has a competitor; the combination has none.

- **The flywheel (defensible over time): modularity-as-subsumption.** Forge is a *steerable composition substrate*. Because its objects are declarative data over swappable seams (runtime adapters, dev-loop adapters, KB descriptors, a catalog of SDKs/models/tools/MCPs/hooks), it can **absorb the best point-solution in each agent-building sub-domain over time, turning competitors into components.** It raises the operator's unit of work from "complete this task" to "design the agents and flows that complete *classes* of tasks." This is the founding principle (PRINCIPLES.md #1: *"powerful in hanging other powerful ideas together, not building from scratch"*) expressed as a go-to-market strategy.

The single most important honest finding: **the commodity primitives are not weaknesses — they are the sockets.** Defs-as-data, runtime-agnosticism, and per-agent model routing are all available elsewhere (verified below), but that ubiquity is precisely what makes subsumption viable. Forge's value is not in owning those primitives; it is in *orchestrating* best-in-class components under a steerable, gated, knowledge-compounding pipeline.

**The one-sentence claim:** *Forge Studio is the steerable composition layer for autonomous software delivery — the only place where you can see and edit the pipeline, can't accidentally skip the human, and where every cycle makes the next plan smarter; built to absorb the best agent-building components over time rather than out-build them.*

---

## 2. Category placement

```
                AUTONOMOUS SWE AGENTS                VISUAL AGENT/FLOW BUILDERS
        (Devin, Cursor, Factory, Jules,            (OpenAI AgentKit, n8n, Flowise,
         Copilot agent, OpenHands, Bernstein)       Langflow, Dify, Lindy)
                       \                                   /
                        \         FORGE STUDIO            /
                         \   (all three + the seam)      /
                          \                             /
                    COMPOUNDING KNOWLEDGE / MEMORY LAYERS
                       (Mem0, Zep, Letta, Cognee)
```

- **Positioning line:** *"n8n for autonomous software delivery — with a memory that compounds and gates that can't be skipped."*
- **Target wedge:** the **single technical operator running a portfolio of projects** (matches the north star: *"idea machine for one human across many side projects"*). Enterprise tools (Factory, Devin, Copilot) optimise for *teams*; Cursor for *in-IDE devs*; Lindy for *non-technical ops*. The solo-polymath-with-many-projects buyer is **under-served**.

> **Amendment (2026-07-17, [ADR 038](./decisions/038-north-star-platform-and-ootb.md)):**
> Internally, forge's engineering north star is now **two-level** — Scope 1 is a modular
> platform for building the ideas machine or **any other agentic flow** (SWE-focused for
> now by explicit choice); Scope 2 OOTB is the ideas machine positioned above. This
> reframe is the **internal** north star only. **External positioning is unchanged**: the
> four qualifiers in §3.4 stay in every external claim until non-SWE connectors actually
> exist to market — market the proven wedge, not the aspirational platform.

---

## 3. The strategic thesis: modularity-as-subsumption & the meta-layer

This is the unifying frame that ties the verified differentiators together and defines the long game.

### 3.1 The thesis

Forge's durable advantage is that it is **modular by construction**, and therefore can **over time subsume the best players in each specific area of agent building** to improve the product. Every advance by a point-solution — a better memory graph, a stronger autonomous coder, a cheaper model, a richer tool ecosystem — becomes an *upgrade Forge plugs in*, not a competitor that erodes it. Forge competes by **integrating**, not out-building.

In parallel, Forge **raises the abstraction**: it pushes the operator to think about *how to develop agents and flows* — the reusable layer above any one task or project — rather than grinding a specific deliverable. The unit of leverage moves up. Agents, flows, and accumulated brain-knowledge are assets that compound across the whole portfolio.

### 3.2 Why the architecture already supports it (the seams)

Each subsumption point is an existing socket, not a hypothetical:

| Sub-domain | Best-in-class point solutions | Forge's seam (where they plug in) |
|---|---|---|
| **Agent runtime / model** | Claude SDK, Codex, Gemini, local | `RuntimeAdapter` interface + conformance suite (ADR-029); per-agent model routing |
| **Dev-loop engine** | Ralph (live), OpenHands, Aider, Hermes | `loops/_adapters/` placeholder seam (ARCHITECTURE.md §Developer Loop) |
| **Memory / knowledge** | Mem0, Zep/Graphiti, Cognee, Letta | KB = a `kb.yaml` *descriptor over an existing brain* (ADR-027) — the backend is swappable |
| **Tools / integrations** | MCP servers (ado-mcp, browser-mcp, …) | catalog of MCPs/tools/hooks; agents compose them (ADR-024) |
| **Flow composition** | hardcoded pipelines elsewhere | generic flow engine; "forge is just one flow" (ADR-028) |

The commodity findings from the scorecard (§4: defs-as-data, runtime-agnosticism, cost routing are all available elsewhere) are **re-read here as enablers**: ubiquitous, well-understood primitives are exactly what make a clean integration seam possible.

> **Accuracy caveat (as-built):** the *proven* subsumption socket today is the **runtime adapter** (the SDK is threaded through and the gemini / aider adapters drop in). The **memory / knowledge** row is aspirational — the KB-backend swap was scoped to **filesystem-only**, so "the backend is swappable" describes the seam's design, not a shipped second backend. Read the table as architecture-validated seams, with the runtime adapter as the one currently exercised.

### 3.3 Alignment with the founding principle

This is not a new direction — it is the original thesis made explicit. PRINCIPLES.md #1: *"I think my idea is powerful in hanging other powerful ideas together, not in building the entire thing from scratch."* The modularity-as-subsumption strategy is that principle applied to the market: **don't beat Devin/Mem0/Cursor at their game — orchestrate them under a layer they don't have.**

### 3.4 Honest counter-analysis (do not skip)

The thesis is strong but carries real risk; market the *specific* version, not the generic one.

- **"Modular composition layer" is itself a crowded pitch.** OpenAI AgentKit, LangGraph, n8n, and Dify all sell composition **[V/S]**. *Generic* modularity is not a differentiator. The defensible version is narrow: *subsumption of best-in-class **software-engineering** components under a **steerable, gated, knowledge-compounding** autonomous pipeline for a **portfolio** operator.* Keep all four qualifiers.
- **Aggregator / platform-dependency risk.** Subsuming a component means depending on it. A subsumed player can close its API, change pricing, or integrate *downward* into Forge's territory; the base SDK (Claude Agent SDK) can shift under you. Integrators get squeezed when components grow upward. Mitigant: the adapter/conformance-suite discipline + no-lock-in defs-as-data keep switching cost low — but this must stay true in practice.
- **Realization gap.** Subsumption is currently an *architecture-validated strategy, not a shipped reality*: only the Claude runtime adapter is live, the KB is forge's own brain (not yet a pluggable Mem0/Zep), and the dev-loop is Ralph with placeholder adapters. **Credibility depends on shipping one real second adapter** — e.g. swap the brain backend to Zep, or run an OpenHands dev-loop node — to *prove the seam*. Until then the thesis is a promise.
- **The meta-layer abstraction is on-trend, therefore not itself a moat.** The industry is already moving from "pair with one AI" to "manage an agent team" (verified: multi-agent orchestration is *maturing*, claim #12 **[P]**; automations shifting to graphs, claim #18 **[P]**). Raising the abstraction is validated by the market — which also means *the abstraction won't be the moat*. The moat stays the execution: the gates, the brain shape, the journey, and the quality of the seams.

### 3.5 Net

Modularity-as-subsumption is the **"why this wins over time"**; the §1 intersection is the **"why this is differentiated today."** Together: a steerable, gated, knowledge-compounding autonomous-SWE pipeline that gets better by absorbing the field rather than racing it — provided the seams are proven and the integrator's-dilemma risks are actively managed.

---

## 4. Differentiator scorecard (the 7 claims + emergent, re-scored against verified evidence)

| # | Claimed differentiator | Verdict | Why (verified evidence) |
|---|---|---|---|
| 1 | **Defs-as-data** (git YAML/md, no DB, agent = SKILL.md) | **Commodity primitive → re-cast as a *socket*** | CrewAI uses YAML `agents.yaml`/`tasks.yaml` **[V]**; Claude *Code* supports file-defined subagents in `.claude/agents/` (the SDK itself recommends programmatic defs) **[P]**; Dagu is a no-DB YAML DAG engine **[V]**. Building blocks are commodity. Forge-specific value = unifying **all four** object types into one no-DB git store with a single serializer, *and* (per §3) this is the enabler of clean, swappable seams. Don't claim the primitive; claim the unification + the modularity it unlocks. |
| 2 | **Pipeline-as-an-editable-flow** ("forge is just one flow") | **Contested — the *visual* layer is the edge** | Bernstein (OSS, Apache-2.0) already authors SWE pipelines as declarative YAML and ships a stock `idea-to-pr` flow **[P, important correction]**. "Editable SWE pipeline-as-data" is *not* unique. What no SWE competitor has: a **visual** drag-DAG builder for that pipeline (Lindy = visual but business-automation, not SWE; Bernstein = SWE-as-data but no visual builder; AgentKit = visual but generic). Lead with **visual authoring of an autonomous-SWE pipeline**. |
| 3 | **Compounding "brain"** queried by planners, ingesting reflections | **Crowded category — differentiate on *shape*** | Knowledge-graph memory is busy: Zep/Graphiti (bi-temporal graph) **[V]**, Mem0 (vector + optional graph; AWS Strands provider; 35M→186M API calls 2025; $24M Series A) **[V]**, Cognee, Letta. Factory's HyperCode = a *per-repo* retrieval graph **[S]**. The market did **not** converge on flat files for memory **[P, correction]**. Forge's brain is differentiated *not by being a graph* but by being a *cross-cycle, cross-project, human-navigable **engineering** wiki, curated via a human pin-loop, wired into **planning** under an asymmetric read policy* — it tunes *how work is designed*, not just runtime recall. Always qualify "knowledge graph"; unqualified it's table stakes. |
| 4 | **Cost-aware multi-tier routing** + per-flow USD ceilings | **Commodity** | The Claude Agent SDK has a per-agent `model` field (opus/sonnet/haiku/fable) **[V]** and Anthropic documents the exact "opus for strict reviews, sonnet otherwise" pattern **[V]**. Factory and Lindy are model-agnostic too. Per-flow USD ceiling is mildly differentiated, not a headline. **Do not market as novel.** |
| 5 | **Runtime-agnostic adapter framework** (Claude live, Codex/Gemini pluggable) | **Not a *current* feature-moat → it is the *subsumption seam*** | Model/runtime-agnosticism is table stakes (Factory spans Claude/GPT-5/Gemini/open-weight; LiteLLM/LangChain ubiquitous) and only Claude is live in Forge. As a *sold feature* today: drop it. As the *mechanism* of the §3 flywheel: it is central — but it only earns the claim once a real second adapter ships. |
| 6 | **Safety invariants in code, not prompts** (no auto-approve path, wedge-kill, never-self-modify) | **GENUINELY NOVEL — strongest single atom** | Across **every** competitor surveyed, gates are *soft*: Cursor = manual per-diff review **[V]**, Jules = informal plan/PR review **[V]**, Factory = "adjustable autonomy" soft controls **[S]**, Copilot = PR-review request only **[V]**, Lindy = optional approval *nodes* **[V]**. **None enforces gates structurally in code such that the pipeline cannot proceed.** Forge's "no auto-approve code path exists anywhere" + wedge-kill timer + never-self-modify-while-running is unmatched, and is the precondition for *trustworthy* unattended operation. |
| 7 | **Outcome-only real-cycle regression harness** (vs synthetic benchmarks) | **Rare discipline (internal-facing)** | Bernstein has a per-run "Janitor" verify **[P]**; a *standing* harness asserting real-cycle *outcomes* (reached PR, tests green post-merge, cost under ceiling) tiered as a release gate is unusual — industry benchmarks on synthetic SWE-bench. Credible quality signal; hard to market externally. |

**Emergent differentiators (surfaced by the research, not in the original 7):**

- **E1 — Code-enforced gates as the enabler of unattended ops** (= #6; reframe as a *headline*, not a footnote).
- **E2 — The designed operator journey** (idea → architect interview → PLAN gate → autonomous cycle → review verdict → reflection → brain). No competitor ships a structured, opinionated end-to-end journey; they ship a task box + a PR. **[V across all 5 new competitors]**
- **E3 — Single-operator portfolio orchestration.** No competitor has a first-class portfolio/roadmap layer spanning projects (Cursor = partial multi-repo; Jules = parallel task queue; Factory = parallel tabs) — all task-level **[V]**. ⚠️ M7/ADR-031 *retired the cross-project roadmap pane*; this is latent architectural ground. Re-shipping it enters open territory.
- **E4 — Modularity-as-subsumption** (= §3). The *strategic* differentiator: the integrator's flywheel. Defensible over time, with the caveats in §3.4.

---

## 5. Competitor landscape

### 5.1 Verified matrix

Legend: Autonomy = none / assist / supervised-async / high-unattended.

| Competitor | Cat | Autonomy | Visual flow builder | Compounding cross-project knowledge | Code-enforced gates | Multi-project | Open / pricing |
|---|---|---|---|---|---|---|---|
| **Devin** (Cognition) | SWE | high | ❌ | ⚠️ flat "Knowledge" notes | ❌ soft | partial | proprietary; SWE-bench 13.86% (2024 launch fig, stale) **[V]** |
| **Cursor** (bg agents/Automations) | SWE | high | ❌ | ❌ flat `MEMORIES.md`/automation | ❌ manual review | partial multi-repo | proprietary; **$1B+ ARR, ~30-35% own PRs agent-made** **[V]** |
| **Factory.ai Droids** | SWE | high | ❌ | ⚠️ HyperCode = *per-repo* graph, not compounding | ❌ soft autonomy | parallel sessions | proprietary; **$1.5B val, Series C $150M Apr-2026** **[V]** |
| **GitHub Copilot coding agent** | SWE | supervised | ❌ | ⚠️ AGENTS.md + 28-day-expiring cited facts | ❌ PR review only | ❌ single-repo | proprietary; **90% of F100, ~42% market** **[V]** |
| **Google Jules** | SWE | supervised | ❌ | ❌ none (fresh VM per task) | ❌ informal | parallel task queue | proprietary; Google distribution **[V]** |
| **OpenHands** (ex-OpenDevin) | SWE | high | ❌ | ❌ minimal | ❌ | per-task | **MIT OSS, 76.9k★, 400+ contributors** **[V]** |
| **Bernstein** (OSS) | SWE | high | ❌ (YAML authoring, no canvas) | ❌ `.sdd/` state, no graph | ⚠️ Janitor verify (not a human gate) | per-flow | **Apache-2.0; closest architectural twin** **[P]** |
| **OpenAI AgentKit / Agent Builder** | Builder | n/a | ✅ drag-drop, typed edges | ❌ | ❌ | n/a | proprietary; **Oct 2025, OpenAI distribution** **[V]** |
| **Lindy** | Builder | supervised | ✅ drag-drop directed graph | ❌ vector memory, per-agent | ⚠️ optional approval *nodes* | workspace, no project abstraction | proprietary; biz-automation, not SWE **[V]** |
| **n8n / Flowise / Langflow / Dify** | Builder | n/a | ✅ | ❌ | ❌ | n/a | OSS/mixed; generic LLM chains **[S]** |
| **CrewAI** | Framework | n/a | ❌ (code: `@start/@listen`) | ❌ | ❌ | n/a | **MIT + CrewAI AMP enterprise** **[V]** |
| **Mem0 / Zep / Letta / Cognee** | Memory | n/a | ❌ | ✅ (runtime memory, not eng-wiki) | ❌ | varies | mixed; **strong 2025 traction** **[V]** |
| **➡️ FORGE STUDIO** | **Hybrid** | **high-unattended** | **✅ SWE-native** | **✅ cross-cycle eng wiki → planning** | **✅ structural** | **✅ portfolio (latent post-M7)** | AGPL-3.0 |

**No row except Forge has ✅ across visual-builder + compounding-knowledge + code-enforced-gates simultaneously** — and none has the subsumption seam (§3) as an explicit strategy.

### 5.2 Narrative by category

- **Autonomous SWE agents (A):** the most direct rivals on the runtime. Devin/OpenHands/Cursor/Factory/Jules/Copilot all do idea-or-issue → PR; the market converged on *parallel isolated-worktree agents supervised from a Kanban/dashboard*, **none with a drag-drop visual flow builder** and **none with compounding knowledge-graph memory** **[V, claims #16/#17]**. Bernstein is the closest *architectural* twin (Goal→Planner→Task-Graph→parallel-Agents→verify→merge, YAML-authored) but has thin docs, no visual builder, no brain **[P]**.
- **Visual builders (B):** OpenAI AgentKit (Oct 2025) commoditises the *canvas* with distribution **[V]**; n8n/Flowise/Langflow/Dify are generic LLM-app builders **[S]**; Lindy has a polished visual graph + human-approval nodes but targets *business automation*, not SWE **[V]**. Forge cannot claim the canvas as novel — only *what it authors* (an autonomous-SWE pipeline) and *how it gates it*.
- **Memory layers (C):** a crowded, well-funded category (Mem0/Zep/Letta/Cognee) **[V]**. These are runtime recall layers; Forge's brain is a *human-navigable engineering wiki wired into planning*, a different shape — and, per §3, these are *candidates to subsume as KB backends*, not just rivals.

---

## 6. Open ground (where no competitor sits)

1. **Structural, non-bypassable human gates inside an autonomous pipeline.** Unique. **[V]**
2. **Visual authoring of an *autonomous-SWE* pipeline.** The Lindy/Bernstein/AgentKit combination-gap. **[V]**
3. **A compounding *engineering* knowledge wiki that tunes *planning* across projects** (vs runtime caches). Shape-unique. **[P]**
4. **Single-operator portfolio/roadmap orchestration.** Latent (M7 retired the pane) — re-shipping enters open territory. **[V/architecture]**
5. **The opinionated operator journey** as a product surface. **[V]**
6. **Subsumption-as-strategy** — an autonomous-SWE composition layer *explicitly designed to absorb best-in-class components* (§3). No surveyed SWE player frames itself this way; generic builders do, but not for steerable, gated SWE delivery. **[V/S, with §3.4 caveats]**

---

## 7. Threats, ranked

1. **Factory.ai** — $1.5B, doubling MoM, Fortune-500 land-grab; defining "autonomous SDLC" in *enterprise* procurement before Forge is legible there. HyperCode is the closest thing to the brain. *Mitigant: different buyer (enterprise team vs solo operator).* **[V]**
2. **Cursor** — $1B+ ARR, vast distribution; Automations now = event-driven unattended task→PR for individuals. Closest on the raw "fire-and-forget → PR" value prop. *Mitigant: opaque pipeline, flat memory, no structural gates.* **[V]**
3. **GitHub Copilot coding agent** — network effect (90% F100) commoditises the basic issue→PR loop; AGENTS.md is a flat analog to PLAN/CLAUDE.md. **[V]**
4. **OpenAI AgentKit** — commoditises *visual agent building* generally, with distribution; also the strongest threat to the §3 "composition layer" framing. **[V]**
5. **Integrator's dilemma (structural, not a company)** — subsumed components closing APIs, integrating downward, or the base SDK shifting (§3.4). The chief risk to the *flywheel* thesis.
6. **Bernstein** — closest *architectural* twin (editable YAML SWE pipeline + stock idea-to-pr + verify). Proves the core idea is reproducible OSS. **[P]**
7. **Lindy** — could add a code-integration node and poach the non-technical "describe → get software" segment via its polished visual builder. **[V]**
8. **Jules** — competes on Google breadth/price; lowest overlap on Forge's actual differentiators. **[V]**

---

## 8. Messaging seeds (ready to adapt)

- **Headline:** *"The autonomous software studio you can actually steer."* (gates + visual pipeline + journey)
- **Subsumption / meta-layer:** *"Don't bet on one agent. Build the layer that gets better as every agent does — Forge absorbs the best memory, the best coder, the best model, under one pipeline you control."*
- **Abstraction shift:** *"Stop doing tasks. Design the agents that do them — once, across every project."*
- **Gates:** *"Every other agent asks you to trust it. Forge makes 'skip the human' impossible — the gate is in the code, not the prompt."*
- **Brain:** *"Most agents forget. Memory tools cache. Forge's brain compounds — every cycle makes the next plan smarter, across every project."*
- **Pipeline:** *"Devin gives you a fixed engineer. AgentKit gives you a blank canvas. Forge gives you an editable engineer — see the pipeline, change the pipeline, run the pipeline."*
- **Wedge:** *"Built for one person shipping many things — not a team renting a black box."*

**Stop saying:** runtime-agnosticism *as a feature* (#5 — sell the seam's *results*, not the seam); "defs-as-data is novel" (#1, commodity); "cost routing is novel" (#4, SDK-native); "we have a knowledge graph" *unqualified* (#3, crowded). **Start saying:** modularity-as-subsumption (§3) — but only the *specific* four-qualifier version, and back it with a shipped second adapter.

---

## 9. Honest weaknesses & open risks

- **Distribution gap.** Every serious rival has scale (Cursor $1B+ ARR, Copilot 90% F100, Factory $1.5B). Forge has none. The wedge (solo-portfolio operator) is a defensible *niche*, not a mass market — frame TAM accordingly (personal-leverage / indie-polymath, not enterprise platform).
- **No independent benchmark for Forge itself.** Quality is self-asserted via the internal real-cycle harness; rivals publish numbers (even if synthetic).
- **The flywheel is unproven** until a real second adapter ships (§3.4 realization gap). The strongest single counter to the whole thesis is "you have *one* live runtime and *one* brain."
- **On-trend abstractions don't moat.** Visual building (AgentKit), graph memory (Zep/Mem0), and "manage an agent team" (multi-agent) are all converging industry-wide — execution on gates/brain/journey/seams is the only durable edge.
- **Latent capability.** E3 (portfolio orchestration) is currently retired; the open ground only counts if it's re-shipped.

---

## 10. Confidence & provenance

**Verification:** of 18 re-checked claims — 13 **confirmed**, 5 **partly-true** (#3 file-subagents = Claude Code, not SDK-native; #11 memory market is diverse, not flat-file-converged; #12 multi-agent is maturing, not emerging; #15 Bernstein authors flows, not just views; #18 DAG is leading-but-not-sole paradigm); 0 outright refuted. First-pass: 7 claims passed 3-vote adversarial verification (Devin positioning/SWE-bench/Knowledge/Auto-Fix, OpenAI Agent Builder canvas + multi-agent, CrewAI YAML). Competitor profiles (Sonnet, primary-source-grounded, dated): Cursor, Jules, Factory.ai, Copilot coding agent, Lindy.

**Residual gaps:** funding/valuation/version numbers are point-in-time — re-check before external publication; Devin's 13.86% SWE-bench is a stale 2024 launch figure; the modularity flywheel is architecture-validated but not yet demonstrated by a shipped second adapter.

**Key sources:** cognition.ai, docs.devin.ai, openai.com/index/introducing-agentkit, github.com/crewAIInc/crewAI, code.claude.com/docs/en/agent-sdk/subagents, github.com/dagu-org/dagu, atlan.com (memory surveys), augmentcode.com (OSS-orchestrator survey), factory.ai, cursor.com/docs, jules.google, github.blog, lindy.ai.

**Cost note:** verification on Haiku, competitor research on Sonnet, synthesis on Opus — deliberate tiering.
