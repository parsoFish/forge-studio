# The forge operator journey (vision + intent)

> **Status:** operator's canonical vision for the end-to-end journey. Rewritten
> 2026-06-14 for the post-M8 Studio (ADR-031 "Studio is the one product" +
> M8 seams). It defines the intent and the **target behaviour forge moves
> towards** — not only the as-built. The video-recorded
> [`scripts/e2e-journey.mjs`](../scripts/e2e-journey.mjs) (`npm run ui:journey`)
> is its executable spec: it walks these beats at a watchable pace, entirely
> through Forge Studio, and doubles as the DOM-as-metrics regression harness.

The journey is centralised on Forge Studio. The operator never leaves it.

## The reframe: the platform is the hero

Pre-M8 the journey's hero was one linear cycle (idea → merged PR). Post-M8 the
forge cycle is **three composable flow definitions** — `studio/flows/forge-architect/`
(plan + decompose), `studio/flows/forge-develop/` (dev → unifier → review), and
`studio/flows/forge-reflect/` (retrospective) — interpreted by the node-executor
registry (ADR-028), with swappable runtime adapters (ADR-029); the KB is
filesystem-only (ADR-027). So the journey is
organised around the three things the platform now does — **author a flow, run
it, swap its engine** — with the cycle as the proof case inside RUN.

## ACT 1 — AUTHOR (everything in Studio is data)

1. **The library** (`/`) lists flows, agents, projects and KBs as cards, with the
   operator pulse (what needs you). All of it is editable definitions.
2. **Build a cycle flow from scratch.** Author a cycle flow as a definition — its
   agents, its artifact edges, and its human gates (`plan`, `verdict`). The
   platform validates it (`forge studio lint`), it is structurally identical to
   the production seed flows (subsumption), and the flow builder renders it live.
   The hardcoded cycle is subsumed by data.
3. **The agent builder** (`/agents/<id>`) edits an agent's composition (skills /
   tools / MCPs / hooks), runtime SDK + budgets, and brain access.
4. **The project builder** (`/projects/<id>`) edits a project's north star, its
   demo timeline (for betterado: apply → live REST GET → portal → destroy),
   bound skills + KB, and contract readiness.

## ACT 2 — RUN (the cycle as the proof case)

5. **New idea** (`/architect/new`) — the operator types an idea for a managed
   project.
6. **Architect interview** (`/architect/<sid>/interview`) — the architect reads
   the project + brain (live activity panel), returns clarifying questions, takes
   free-text or option answers, and drafts a Given/When/Then plan; every phase is
   costed, stalls/crashes surface inline.
7. **PLAN gate** (`/artifact?…type=plan&mode=gate`) — the operator reviews the
   rich plan, sends back for revision, then approves (human decision #1).
8. **Autonomous build on the develop flow (`/flows/forge-develop`)** — the PM
   decomposes the ACs into dependency-ordered work items, the dev-loop runs TDD
   (red → grind → gate.pass) per WI fanned off the dev hex, then the **unifier**
   (its own hex) reviews the branch and authors the demo.
9. **Verdict gate** (`/artifact?…type=verdict&mode=gate`) — the operator reviews
   the per-AC evaluated demo (for live projects: real REST evidence), authors a
   new acceptance criterion on send-back, the dev-loop reruns, and on re-review
   the gap closes (PARTIAL → MET); approve + merge (human decision #2).
10. **Reflect** (`/artifact?…type=reflection&mode=gate`) — the operator tunes the
    brain (human decision #3); the reflector folds the feedback in.

## ACT 3 — SWAP (the seams — the platform is modular)

11. **Flow-engine controls** — the engine runs any flow with guardrails:
    start-run CTA, cost-ceiling gauge, gate parking, resume.
12. **Runtime-adapter seam** (ADR-029) — the SDK picker is registry-driven and
    **wired**: the SDK threads through to the runtime, claude is live, and the
    gemini / aider adapters drop in (codex disabled until its adapter ships); the
    range strategy routes to the cheapest capable tier first. This is the proven
    swap surface.
13. **KB-backend seam** (ADR-027) — the brain is a browsable force-graph backed
    by the **filesystem-only** KB; the operator pins guidance that surfaces as a
    node until the next ingest pass.

## As-built vs target (honest gap)

Most beats are wired. The standing gaps are the same intent-surfacing items the
backlog already tracks, now framed against the Studio surface:

| Beat | As-built today | Gap to the vision |
|---|---|---|
| A2 — build a flow from scratch | The flow builder authors flows as data; `forge studio lint` validates; the engine runs the authored def. | Make the builder's drag-author → save → run loop a fully first-class no-code path (headless DnD is still finicky; the harness authors the def + proves lint/parity/render). |
| 6 — architect explores edge cases | The runner brain-queries + reads the project before drafting. | Surface "exploring / edge cases" as an explicit architect stage and prompt it to enumerate them. |
| 8 — unifier clean-up loop + demo skill | The unifier sub-phase iterates against the gates and authors `demo.json`. | Surface the clean-up loop distinctly from the per-WI dev-loop, and make the demo-skill a first-class wrap-up (always produce the page; capture live evidence when the project stands up real resources). |
| 9 — review↔dev loop until approve | The verdict gate writes a send-back the dev-loop reacts to. | Make send-back visibly spawn a dev-loop, re-demo, and re-present as a continuous loop gated only by operator approval. |
| 12 — adapter seam | claude is live and the gemini / aider adapters are wired in (SDK threaded through to the runtime); the registry disables only the still-unprovisioned SDKs (codex). | Exercise a second adapter on a full real cycle end-to-end (the seam is wired; the remaining gap is a live cross-adapter cycle run, not the plumbing). |

The UI-emulation harness emulates the **target** for every beat (seeding the
files/events the real phases write) so the recording is a faithful picture of
where forge is going. The **real** proof is the separate
[`scripts/verify-cycle.mjs`](../scripts/verify-cycle.mjs) gate — run it against
betterado (`--project terraform-provider-betterado`) for the live-ADO tier.
