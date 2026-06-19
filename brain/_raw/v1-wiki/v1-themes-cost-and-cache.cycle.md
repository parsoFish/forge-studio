---
source_type: cycle
source_url: ~/sideProjects/.forge/wiki/forge/themes/
source_title: v1 wiki extracts — cost optimisation lessons (Cycles 1–3)
ingested_at: 2026-05-04T19:30:00Z
ingested_by: brain-ingest (Pass B, batch 1)
cycle_id: pass-b-bootstrap
deprecated: true
deprecated_in_favor_of: brain/forge-dev/themes/infrastructure-evolution.md
deprecation_note: >-
  Immutable archival record from the prior (pre-current) forge wiki. Preserved
  as ground-truth evidence; superseded by the distilled cycles/ + forge-dev/
  themes it fed into.
---

# v1 wiki extracts — cost optimisation lessons

---

## Prompt caching strategy — 92% hit rate

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/prompt-caching-strategy.md`

Across Cycle 3 (Apr 2–6), forge processed ~978M total tokens with 903M as cache reads and only 363K as fresh input — a **92% cache hit rate**. This was not accidental: prompt caching is high-leverage (50–70% input cost reduction per Anthropic docs) when the system prompt is placed first and kept stable across invocations.

The key discipline: static content (tools, system values, agent persona) must precede dynamic content (work item context, file reads). Any reordering that puts volatile content before stable content breaks caching.

Claude Code CLI handled prompt caching internally in v1; v2's Claude Agent SDK exposes explicit `cache_control` breakpoints when needed.

---

## Model routing — 87% cost reduction

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/model-routing-cost-leverage.md`

Not all agent tasks require the same model capability. Lightweight tasks (PR creation, simple code edits, routine test writes) can run on Haiku at ~3× cost savings vs Sonnet, while complex planning and architecture decisions warrant Opus. Routing incorrectly (running everything on Opus) wastes ~87% of per-token cost on tasks that don't need that capacity.

Per-skill model overrides via `forge.config.json` `models.<skill>` is the mechanism.

Prompt caching (92% hit rate) and model routing together represent the two largest cost levers. They're complementary and both should be optimised before any architectural cost changes.

---

## Conditional core values injection

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/conditional-core-values.md`

Not all roles need all core values (Quality Gates, Bold Autonomy, Self-Sufficient Specs). A pr-creator agent doesn't need detailed TDD guidance; a developer agent doesn't need PR description format guidance. Injecting all values into all agents wastes tokens on irrelevant context.

`coreValuesPromptForRole(role)` returns only the relevant subset:

- **developer**: Quality Gates (TDD, zero warnings) + Bold Autonomy (own decisions).
- **planner**: Self-Sufficient Specs (work items need no clarification).
- **reviewer**: Quality Gates (verify gates passed) + Self-Sufficient Specs.

The secondary benefit: a smaller, more stable system prompt prefix means better prompt cache utilisation.

---

## Stage output summarisation

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/token-optimization-stage-summarization.md`

Pipeline stages produce verbose output. When a test stage passes full test runner output to the develop stage, the developer agent reads hundreds of lines of passing test output to find the 3 lines that matter (failing tests). Stage output summarisation strips this to just the failures.

Implemented patterns (as of Cycle 3):

- `test → develop`: only failing test names + error messages.
- `develop → pr`: only files changed + commit messages.

In v2 this generalises to the markdown-artifact flow: each phase reads the prior phase's *artifact*, not its full transcript. The artifact is the summary.
