# Forge Refinement Backlog

> The holistic review of forge against the [refocus architecture](docs/architecture/refocus-architecture/README.md),
> consolidated into a **prioritized, direct-edit backlog** for this session to execute.
> Each item is intent-preserving; aggressive culling is the default. **Nothing here is
> executed yet** — this is the review gate. IDs are referenced from the component specs.
>
> Effort: **S** ≲50 LOC / <1h · **M** multi-file / few hours · **L** day+ or risky.
> Tag: 🟥 correctness/broken · 🟩 cull/simplify · 🟦 align-to-north-star · 📄 doc.

## The meta-finding

Forge's *phases* are reliable. Its failures cluster at **seams and the merge boundary**,
and the dominant defect class is **"intent declared in prose / SKILL.md / ADR / a removed
bench — but never enforced in the live runtime path."** So this backlog does two things at
once: it **culls accreted bloat** (much of it dead scaffolding from the removed benchmarks)
*and* **moves load-bearing contracts into enforced code at the seams**. The two are the same
work — most of the bloat is exactly the unenforced intent.

**Biggest wins (by impact):** fix the three broken-but-believed-working paths (reflection
interview, contract C2, dev-loop completion truth) [P0]; cull the second demo system,
the dead bench-candidate pipeline, and graphify-over-cycles [P1, ~1,900 LOC + a graph
artifact]; enforce the single-decomposition decision across architect+PM [P1].

---

## P0 — Correctness & broken human-moments (do first)

| ID | 🏷 | Item | Files | Effort |
|---|---|---|---|---|
| **REF-1** | 🟥 | Reflection interview is **non-functional in production**: the UI reads `user-questions.json` but the live prompt only writes `user-questions.md` (only the e2e emulator seeds `.json`). Emit the `.json` (or derive it post-exit). A whole human moment is silently dead. | `orchestrator/reflector-invocation.ts`, `orchestrator/phases/reflector.ts` | S |
| **CON-1** | 🟥 | Contract **C2 false-pass**: greps `.gitignore` text, but ignores are no-ops on tracked files — betterado's committed `AGENT.md` passes C2. Switch to `git check-ignore -q` + `git ls-files`. A "CONTRACT MET" project violates the flagship clause. | `cli/preflight.ts` | S |
| **DEV-1** | 🟥 | **Completion truth on resume**: per-WI counts go stale (`failed:2` while 11 tests landed); a genuinely-empty branch (`complete:0`) once opened an empty PR. Make `dev-loop.delivered` (git diff) authoritative everywhere; on `complete:0` at resume, disambiguate real-delivery vs zero before proceeding; never open a PR on an empty branch. | `orchestrator/phases/developer-loop.ts`, `orchestrator/cycle.ts` | M |
| **ARCH-1** | 🟥 | Architect **brain grounding is faked** (`brain_context: []` hardcoded; never calls brain-query) despite the planner brain-first mandate. Wire a real brain-query at turn start (also satisfies the mandate + populates the PLAN brain section). | `orchestrator/architect-runner.ts` | M |

> **Merge boundary** (the historical #1 ceiling) is now largely held: closure confirms
> `gh == MERGED` before `done/` (G1), and the scheduler dependency-gate makes a dependent
> wait for its prerequisite to merge before branching from fresh `main`. **Guard to add**
> under DEV-1/REV: when WIs are stacked, use **rebase-merge, never squash** (squash on a
> >1-PR merge group produces wrong commits — confirmed upstream).

---

## P1 — High-value culls + north-star alignment

### Culls (dead weight, intent untouched)

| ID | 🏷 | Item | Files | Effort |
|---|---|---|---|---|
| **REV-2** | 🟩 | Delete the **second demo system** (~1,500 LOC): the Playwright author stack (`cli/demo-script.ts`, `generateComparisonDemo` in `cli/demo.ts`, the unused parts of `cli/demo-runtime.ts`, the `DemoManifest` schema, `comparison.html`). Keep one path: `demo.json` → DEMO.html, with a thin screenshot-only `capture` that back-fills PNGs. | `cli/demo*.ts`, `orchestrator/cli.ts` | M |
| **REF-2** | 🟩 | Delete the **dead bench-candidate pipeline** (~210 LOC): `emitBenchCandidates` + helpers + `forge brain bench:promote` (target `benchmarks/brain/` was removed). Drops `reflector.ts` back under the 800-line cap. | `orchestrator/phases/reflector.ts`, `cli/brain-bench-promote.ts`, `orchestrator/cli.ts` | S |
| **BRN-3** | 🟩🟦 | **Drop graphify for the cycle brain** (locked + empirically 0 relational edges): delete `brain/cycles/graphify-out/`, its merge-driver line, the cycles arm of `scripts/brain-graphify-all.sh`; brain-query over Brain 2 → INDEX/category keyword scan. | `scripts/brain-graphify-all.sh`, `.gitattributes`, `brain/cycles/graphify-out/` | S |
| **SKL-1** | 🟩 | Strip **dead bench scaffolding** from the 4 `*-invocation.ts` headers ("single source of truth so the bench reflects production"), the `_brainCwd` bench-compat param, and ~37 lines of S8/C23 prompt-caching prose for an unconsumed flag. | `orchestrator/{pm,dev,reflector,unifier}-invocation.ts`, `loops/ralph/claude-agent.ts` | S |
| **PM-2** | 🟩 | Collapse the **~157-line PM user prompt** toward the 4-line intent: one gate rule (not three), drop inlined incident war-stories (belong in brain themes), let the self-check point at the validator. | `orchestrator/pm-invocation.ts` | M |
| **ARCH-4** | 🟩 | Delete dead architect render paths: C27 exploration + C26 project-metrics blocks (runner never sets them) and the terminal-era PLAN.md annotation machinery (`VERDICT_PLACEHOLDER`, "edit the inner text"). | `cli/architect-plan.ts`, `skills/architect/SKILL.md` | S |
| **PM-4/5** | 🟩 | Delete dead PM exploration branch (`detectManifestType` reads a non-existent `type` field), stale bench headers, `bashCalls` counter (Bash disallowed), and the `requiredVerificationPaths` no-op stub + its dev-loop call site. | `orchestrator/pm-invocation.ts`, `orchestrator/work-item.ts`, `orchestrator/phases/developer-loop.ts` | S |
| **ORC-2** | 🟩 | Replace the **three hand-rolled YAML frontmatter parsers** with the already-imported `manifest.ts` parser (removes ~50 LOC + a silent-disagreement class). | `orchestrator/scheduler.ts`, `orchestrator/queue.ts` | S |
| **DEV-3** | 🟩 | Collapse the dead `loops/ralph/PROMPT.md.tmpl` into the live `renderDevUserPrompt` (one source); fix `loops/README.md` (removed `wedged` stop / `_adapters/`). | `loops/ralph/`, `orchestrator/dev-invocation.ts` | S |
| **UI-1** | 🟩 | Delete `ActivityPanel`'s dead full-tab chip-bar mode + `selectedWiId` prop (~130 LOC; only the scoped-hex form is used). | `forge-ui/components/ActivityPanel.tsx` | S |
| **SKL-3** | 🟩🟦 | Collapse the **demo-prose duplication**: have the unifier compose `skills/demo/SKILL.md` instead of the hand-synced `demoInstructionsForShape()` copy. | `orchestrator/unifier-invocation.ts` | M |
| **SKL-2** | 🟩 | Kill the **dead `model:` frontmatter** (no runtime parses it; values drifted to a non-existent model) — delete everywhere, with tier-in-`PhaseAgentSpec` as the one source. | `skills/*/SKILL.md` | S |

### Align to the locked decisions

| ID | 🏷 | Item | Files | Effort |
|---|---|---|---|---|
| **ARCH-3 + PM-1** | 🟦 | Enforce **one decomposition**: architect emits **coarse capability-features, no per-feature gates**; PM is the **sole** WI-sizer + gate-setter. Update both skills + the validators; removes the duplicated SDK decomposition pass. | `skills/architect/SKILL.md`, `skills/project-manager/SKILL.md`, `orchestrator/{architect-runner,pm-invocation}.ts` | M |
| **ARCH-2** | 🟦📄 | Drop the unwritten **`roadmap.md` output** claim (roadmap = derived view); amend SKILL + phase doc. | `skills/architect/SKILL.md`, `docs/phases/architect.md` | S |
| **CON-2** | 🟦🟩 | Collapse the **two `.forge/project.json` validators** into one (preflight calls `validateProjectConfig`, downgraded to advisory); delete the duplicate `DEMO_SHAPES`. | `cli/preflight.ts`, `orchestrator/project-config.ts` | M |
| **PM-3** | 🟦 | Resolve the `files_in_scope` advisory-vs-enforced contradiction: keep **hotspot-file ownership** enforced (research-backed merge-safety), make non-hotspot scope advisory; reconcile the prose. | `skills/project-manager/SKILL.md`, `orchestrator/work-item.ts` | M |
| **DEV-4** | 🟦 | Add a **wedge/stall circuit-breaker** to the dev-loop (no-file-change-for-N, identical-error-for-M → escalate/restart-clean), beyond the iteration budget. Highest-cost unattended failure mode. | `orchestrator/phases/developer-loop.ts`, `loops/ralph/` | M |

---

## P2 — Structure, docs, polish

| ID | 🏷 | Item | Effort |
|---|---|---|---|
| **REV-3** | 🟥 | Drop the `body.length >= 300` floor in the unifier gate (the synthetic threshold the reviewer doc says was removed); keep the `## Demo` heading check. | S |
| **REV-5** | 📄 | Rewrite `docs/phases/review-loop.md` (describes an absent `review-router.ts` + PR-comment poller + 2-round cap); retire/mark ADR 016 (VHS, superseded). Remove `/forge-review` skill references repo-wide. | M |
| **REV-6** | 🟩 | Collapse the ~30-line `reviewer.ts` into closure (one fewer phase boundary); unify the two `closure→reflector` chains (in-cycle + `finalize-merged`) onto one shared `finalizeMerged()`. | M |
| **ORC-1** | 🟩📄 | Extract scheduler operator-UX (progress tee, idle ticker, announce dedup) out of the 771-LOC `scheduler.ts`; reconcile the ADR 011 LOC budget to the honest number. | M |
| **ORC-3** | 🟩 | Quarantine the `pr.ts` no-origin gh-shim behind one injected `PrTransport` (real-gh vs local) instead of `if (!hasOriginRemote)` in every fn. *(needs the local-merge-mode call, below)* | M |
| **ORC-4/5** | 🟩 | One `node_modules` guard (the git-exclude, drop the cycle.ts `git reset`); slim `failure-classifier` (~18 signatures → transient set + reasons); consider deriving the synthetic architect events in the UI not the engine. | M |
| **BRN-4** | 🟦 | Add lightweight temporal provenance to Brain 2 themes (`derived_from_cycles`, `last_validated_cycle`); lint flags stale high-confidence themes ("zombie memory" guard) — *not* a temporal KG. | M |
| **BRN-5/6** | 🟩📄 | Decide `brain-ingest` (make-real vs retire — reflector direct-writes today); slim the 167-line `brain-query` SKILL now that Brain 2 has no graph; auto-regenerate `INDEX.md` on reflector ingest; delete dead lint checks (`checkContamination` scans a removed path; `checkGraphFreshness` referenced-not-implemented; benchmarks/ residue). | M |
| **REF-3/4** | 🟦 | Make the standing question battery (sizing / design-vs-impl / intent-alignment) a guaranteed seed set; add index-regen + a dedup/contradiction pass on ingest (the "index + lint on ingest" intent). | M |
| **REF-6 / SKL-4** | 📄 | Strip dead bench scaffolding from the reflector docs; wire-or-drop the `forge-dev/log.md` append; rewrite `skills/README.md` to the as-built catalog. | S |
| **CON-4/5** | 🟦📄 | Regenerate/delete `docs/schemas/project-config.schema.json` (phantom C26-C28, forbids real `logging`); wire-or-drop `demo.skill`; fix ADR 017 stale paths; emit a preflight JSONL event per run. | M |
| **CON-6** | 🟦 | Add **C8 — agent-instruction file** to the contract: a human-authored `AGENTS.md`/`CLAUDE.md` at the project root (commands before line 50); preflight checks presence. *(Research: ~4pp uplift; auto-generated hurts — author, don't generate.)* | S |
| **UI-3** | 🟩 | Extract the 3 hand-maintained orchestrator-logic mirrors (`dep-layout`, phase order, phase routing ×2) into one shared pure-TS module to kill sync-drift. | M |
| **UI-4 / ARCH-6** | 🟩📄 | Lean `AgentGraphCanvas` on ReactFlow + a shared topo helper; refresh stale comments (UI "read-only M2-A", "hand-rolled `<canvas>`"); wire-or-delete architect `archiveSessionDir` on reject; de-dup the PLAN SVG vs UI roadmap layout. | M |
| **BRN-1/2** | 📄 | Define forge-dev brain scope (themes vs 119KB log vs as-built/notes dirs); unify/rename the two `_raw/` layers. | S |
| **DEV-5** | 🟩 | Split the unifier sub-phase out of the 1265-line `developer-loop.ts` into its own runner. | M |

---

## Needs an operator call before I execute

| # | Decision | Options | My lean |
|---|---|---|---|
| **D1 (REV-1)** | Operator **send-back loop** is half-wired (UI writes a verdict file nothing reads; `unifierFeedbackRef` never set). | (a) Wire UI send-back → auto-requeue `resume_from: unifier` + feedback; (b) delete the dead send-back machinery, make `forge requeue` the documented path. | **(a)** — the refocus intent ("demo takes feedback into another cycle") wants the closed loop; it's the operator-journey gap. |
| **D2 (CON-3)** | **AGENT.md lifecycle** — committed durable memory vs C2 scratch-to-ignore. | (a) Move unifier memory to an already-ignored `.forge/` path (keeps C2 honest); (b) bless tracked AGENT.md, drop it from C2. | **(a)**. |
| **D3 (REV-4)** | **Demo richness** — invest in reliable rich visual capture (screenshots/video/API-diff) as the default, or accept notes-first + optional media. | (a) rich self-contained HTML as default; (b) notes-first. | **(a)** for demo-able projects (your standing "demos must be visual evidence" feedback) — pairs with REV-2. |
| **D4 (ORC-3)** | Is the **no-origin local-merge** path a supported run mode (claude-harness, no-remote projects) or bench-only scaffolding to lift out of production `pr.ts`? | (a) supported → keep behind `PrTransport`; (b) bench-only → remove from prod. | Need your fact. |
| **D5 (REF mid)** | **Reflection interactivity** — true turn-by-turn (AskUserQuestion) vs the async file-handoff + UI-rerun model (once REF-1 fixes the `.json`). | (a) keep async (simpler); (b) true interactive. | **(a)** — async fits unattended; fix REF-1 and it works. |

---

## Deferred — separate efforts (not this pass)

- **SKL-5 — full ADR-024 migration** (PM / dev-loop / reflector / architect → `PhaseAgentSpec`;
  move discipline prose into the SKILL.md files so the skill is the single runnable source;
  open the **skills-as-plugins** path). Per operator: this is the **north-star direction**,
  harness-gated, scheduled as its own effort — *not* folded into this refinement.
- **Cross-cycle synthesis pass** (promote recurring antipatterns to principles) + multi-signal
  brain-query retrieval — desirable per the memory research, but net-new; revisit after the culls.

## Cull tally (surface removed if P0+P1 land)

- Second demo system: **~1,500 LOC** (REV-2) · dead bench-candidate pipeline: **~210 LOC** (REF-2)
- PM prompt trim + dead branches: **~120 LOC** (PM-2/4/5) · dead frontmatter parsers: **~50 LOC** (ORC-2)
- Dead ActivityPanel mode: **~130 LOC** (UI-1) · bench scaffolding + caching prose: **~60 LOC** (SKL-1)
- Architect dead render paths: **~80 LOC** (ARCH-4) · graphify cycle graph: **a 347KB artifact + its rebuild/merge machinery** (BRN-3)
- **Net: ~2,150+ LOC and a stale graph artifact removed, while three broken human-moment/contract
  paths get fixed and the single-decomposition decision gets enforced.**
