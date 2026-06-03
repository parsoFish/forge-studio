# Brain Seeding Plan

The brain ships **empty**. Seeding is a deliberate two-pass workstream that runs *after* the brain skills (`brain-ingest`, `brain-lint`, `brain-query`) are functional.

The two passes are ordered intentionally so that v1's accumulated patterns are filtered through a brain whose conventions were set by general best practices — not the other way around.

---

## Pass A — General-purpose seed (validates brain tooling)

**Goal:** populate the brain with reference projects and general best practices that have nothing to do with v1. This proves the brain's ingest/lint/query pipeline works end-to-end and gives v2 substance from day one without dragging in v1-specific bias.

**Inputs (in roughly the order they should be ingested):**

1. **forge2.0 architecture** — the diagram, the ADRs in `docs/decisions/`, the phase docs in `docs/phases/`. This grounds the brain in v2's own design.
2. **Karpathy LLM-wiki gist** — the original wiki philosophy (immutable raw, theme indexes, minimal summarisation). This is the structure the brain itself uses.
3. **Ralph loop reference material**:
    - [Geoffrey Huntley's write-up](https://ghuntley.com/ralph/)
    - [Anthropic's ralph-wiggum plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)
    - [Vercel's ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent)
    - [HumanLayer "A Brief History of Ralph"](https://www.humanlayer.dev/blog/brief-history-of-ralph)
4. **Claude Agent SDK docs** — subagents, headless mode, hooks, MCP integration. The runtime forge runs on.
5. **gstack** — README, skill conventions (`SKILL.md` + `SKILL.md.tmpl`), the `/autoplan` chained-reviewer pattern, the `/learn` taste-profile-with-decay idea, the markdown-artifacts-flow pattern.
6. **Alternative loop runtimes** — short profiles of Aider, OpenHands, OpenClaw, Hermes Agent. Captured so future "should we swap loops?" decisions have prior research to reference.
7. **Generic agentic-engineering best practices**:
    - TDD-with-agents (write tests before implementation; verify in a worktree).
    - Spec-driven development (PRD as the contract between PM and developer).
    - Dependency-ordered work items (parallelism is correctness, not optimisation).
    - Eval-driven development (every change comes with a benchmark delta).
    - Cost-aware model routing (Opus for design, Sonnet for coding, Haiku for triage).

**Success signal — Pass A is done when:**

- The brain has ~30-50 theme pages spanning the categories above (`forge/themes/` populated; `patterns.md`, `antipatterns.md`, `decisions.md`, `operations.md` indexes filled).
- `benchmarks/brain/questions.json` contains ~10 questions whose expected answers cite specific brain pages.
- Running `npm run bench:brain` reports ≥80% accuracy with correct source-page citations.
- `brain-lint` reports zero structural issues (orphans, malformed frontmatter, duplicate themes).
- Opening `brain/INDEX.md` in Obsidian shows a coherent graph (no isolated nodes).

**Estimated effort:** 1-2 sessions of brain-ingest invocations; the agent does the heavy lifting once the source material is pointed at it.

---

## Pass B — Project-specific seed (real history, re-themed)

**Goal:** ingest v1's accumulated learnings and the existing managed projects, but **re-themed by `brain-ingest`** rather than copied verbatim. The agent decides what's still relevant under v2's conventions, what's v1-specific noise, and what needs reframing.

**Inputs:**

1. **v1 wiki** at `~/sideProjects/.forge/wiki/` — entire `_raw/` and `forge/themes/` directories pointed at `brain-ingest`. The agent's job is to reject v1-specific content (job queue tuning, resource controller heuristics) and accept durable lessons (TDD, design-bottleneck, layered merge order, prompt caching, rate-limit handling, squash-merge antipattern).
2. **v1 cycle retros** — the three completed cycles' results (in v1's wiki under cycle-* themes) carry concrete data the brain should retain.
3. **Existing managed projects** at `~/sideProjects/projects/` (trafficGame, simplarr, GitWeave, env-optimiser):
    - Each project's README, recent commit history, current state.
    - Each becomes a `brain/projects/<name>/` sub-wiki with a `profile.md` (what this project is, who it's for, taste signals) and theme pages for project-specific patterns/antipatterns.

**Success signal — Pass B is done when:**

- `brain/projects/<name>/` exists for each currently-managed project, with a populated `profile.md` and at least 3-5 project-specific theme pages.
- `benchmarks/brain/questions.json` contains additional project-specific questions (e.g., "what's the OAuth wall in simplarr?") that the brain answers correctly.
- The lint pass reports no conflicts between Pass A's general principles and Pass B's project-specific ones (where they conflict, the more specific wins and the conflict is documented as a decision).

---

## Pass A vs Pass B: separation of concerns

| | Pass A | Pass B |
|---|---|---|
| **Source** | External best practices, reference projects | v1 wiki, existing projects |
| **Risk** | Generic info missing project nuance | v1 patterns dragging v2 sideways |
| **Mitigation** | Pass B fills project nuance | Pass A's structure constrains how Pass B is themed |
| **Order** | First | Second (gated on Pass A success signal) |
| **Owner** | `brain-ingest` skill | `brain-ingest` skill (with stricter filtering rules) |

---

## What this plan is *not*

- It is **not** a copy of v1's wiki into v2's wiki. The agent re-themes; it does not bulk-import.
- It is **not** a one-time activity. The brain is appended to on every reflection of every cycle. These two passes just bootstrap it.
- It is **not** part of the scaffold. The scaffold creates an empty brain with structure; the seeding runs in subsequent sessions.
