# Forge — Patterns

> Category index. Lists theme pages describing **proven approaches that work** in forge or in agentic systems forge draws from.

`brain-lint` ensures every theme page with `category: pattern` appears here exactly once.

## Theme pages

### Brain & knowledge

- [`brain-gap-feedback-loop`](./themes/brain-gap-feedback-loop.md) — `brain-query` failures become `brain-ingest` inputs.
- [`karpathy-three-layer-wiki`](./themes/karpathy-three-layer-wiki.md) — Brain layout: raw → 15-40-line themes → category indexes.
- [`wiki-over-truncated-context`](./themes/wiki-over-truncated-context.md) — Wiki replaces v1's 2000-char truncated cross-cycle context. Load-bearing argument for the brain.

### Agent runtime & loops

- [`claude-agent-sdk`](./themes/claude-agent-sdk.md) — First-party `@anthropic-ai/claude-agent-sdk` is the agent runtime.
- [`claude-sdk-subagents`](./themes/claude-sdk-subagents.md) — Inline-declared subagents with isolated context, per-agent tools/model/budget.
- [`claude-sdk-hooks-system`](./themes/claude-sdk-hooks-system.md) — PreToolUse / PostToolUse / SessionStart / UserPromptSubmit lifecycle hooks.
- [`ralph-loop-pattern`](./themes/ralph-loop-pattern.md) — ~30-line loop where iteration lives in the loop, not the orchestrator.
- [`objective-gate-autonomous-closure`](./themes/objective-gate-autonomous-closure.md) — Autonomous closure works when the stop condition is an objective script, not the agent's judgement; fresh-context subagents + gate-every-commit.
- [`ralph-stop-hook-vs-bash-loop`](./themes/ralph-stop-hook-vs-bash-loop.md) — Two Ralph implementations: outer bash loop vs Stop-hook in single session.
- [`declarative-specs-vs-imperative`](./themes/declarative-specs-vs-imperative.md) — Describe desired state; let the agent iterate. Bad specs → mediocre results.
- [`skills-as-agent-surface`](./themes/skills-as-agent-surface.md) — Every "agent" is a Claude Code skill (SKILL.md).
- [`llm-council-pattern`](./themes/llm-council-pattern.md) — Multi-perspective critic chain (CEO/eng/design/DX) used by architect.
- [`wedged-loop-detector`](./themes/wedged-loop-detector.md) — the dedicated no-progress detector was removed (Tier 2 thinning); iteration budget is the sole bound now.
- [`quality-gates-orchestrator-verified`](./themes/quality-gates-orchestrator-verified.md) — Acceptance-criterion verification runs in orchestrator, not agent.

### Orchestration & infra

- [`unattended-scheduler`](./themes/unattended-scheduler.md) — `forge serve` + `_queue/` + bounded worktree pool.
- [`file-based-state-machine`](./themes/file-based-state-machine.md) — `_queue/{pending,in-flight,...}/` with atomic `mv` transitions.
- [`crash-recovery-heartbeat`](./themes/crash-recovery-heartbeat.md) — Two file-system passes recover orphaned in-flight initiatives.
- [`pluggable-notifications`](./themes/pluggable-notifications.md) — `notify(event)` interface with desktop + webhook providers.
- [`gh-cli-and-worktrees`](./themes/gh-cli-and-worktrees.md) — `gh` CLI + `git worktree` + GitHub Actions instead of hand-rolled.
- [`layered-merge-order`](./themes/layered-merge-order.md) — Stacked PRs merge in Layer 0 → 1 → 2 order with health checks between layers.

### Artifacts & flow

- [`markdown-artifact-flow`](./themes/markdown-artifact-flow.md) — All inter-phase data is markdown + YAML frontmatter (gstack-style).
- [`spec-driven-work-items`](./themes/spec-driven-work-items.md) — Atomic work items with Given-When-Then acceptance criteria.
- [`spec-driven-development`](./themes/spec-driven-development.md) — PRD as the contract; vague specs propagate downstream.
- [`design-is-the-bottleneck`](./themes/design-is-the-bottleneck.md) — Planner quality multiplies downstream; design > implementation as a leverage point.
- [`work-item-completion-by-domain`](./themes/work-item-completion-by-domain.md) — Domain complexity, not item count, is the primary failure-rate predictor (109-item v1 evidence).
- [`roadmap-simplification-convergence`](./themes/roadmap-simplification-convergence.md) — All 4 v1 project roadmaps independently chose simplification before features.

### Observability

- [`jsonl-event-log`](./themes/jsonl-event-log.md) — One append-only `events.jsonl` per cycle.
- [`cycle-event-log-replay`](./themes/cycle-event-log-replay.md) — Past cycles replay-able from log + referenced artifacts.

### Evaluation & quality

- [`eval-driven-development`](./themes/eval-driven-development.md) — Every change shows a benchmark delta; reflection-discovered failures become new cases.
- [`real-capability-harness`](./themes/real-capability-harness.md) — Forge's standing regression gate is a real dogfood repo (claude-harness), tiered + manually-gated, asserting real-cycle OUTCOMES (reached PR/merge, dev-loop N/N, npm test green, goldens match, cost under ceiling) — not a rubric phases can overfit.
- [`tdd-with-agents`](./themes/tdd-with-agents.md) — Tests first, verified in a worktree by the orchestrator (never by the agent).
- [`parametric-design-search`](./themes/parametric-design-search.md) — Reusable parallel-sweep harness pattern: ~30 lines per new theory, ~10s wall-clock per sweep, score-delta vs locked baselines + screenshots. Generalises to any project with a parameter space + measurable outcome.
- [`per-project-knowledge-graph`](./themes/per-project-knowledge-graph.md) — Each managed project gets its own graphify graph inside its own repo; dev-loop / unifier consult it for code questions without traversing forge's brain. Forge brain stays scoped to forge; project graphs stay scoped to project code.

### Process discipline

- [`dependency-ordered-work`](./themes/dependency-ordered-work.md) — `depends_on` edges + graph-critic make parallelism a correctness property.
- [`cost-aware-model-routing`](./themes/cost-aware-model-routing.md) — Opus for design, Sonnet for coding, Haiku for triage; per-skill overrides. v1: 87% cost reduction.
- [`prompt-caching-strategy`](./themes/prompt-caching-strategy.md) — Stable prefix first; v1 Cycle 3 hit 92% cache reads. Largest cost lever.
- [`conditional-core-values`](./themes/conditional-core-values.md) — Each role gets only its relevant core values; smaller stable prefix → better cache hits.

### Principles

- [`avoid-hand-rolling-tools`](./themes/avoid-hand-rolling-tools.md) — User principle 1: plug into battle-tested community tools.
- [`simplicity-as-architecture`](./themes/simplicity-as-architecture.md) — User principle 2: every "no" defends the small core.

### UI / browser harness

- [`dom-as-metrics-for-headless-driven-uis`](./themes/dom-as-metrics-for-headless-driven-uis.md) — Mirror every load-bearing UI state to `data-*` attributes so headless/LLM-driven probes drive the page by reading structured DOM, not scraped text.
- [`fixed-port-takeover-for-pinned-browser-tabs`](./themes/fixed-port-takeover-for-pinned-browser-tabs.md) — Pin known dev-server ports and kill prior listeners so a single browser tab survives across re-runs.
- [`windows-browser-to-wsl-via-window-location`](./themes/windows-browser-to-wsl-via-window-location.md) — A Windows browser reaches a WSL2-hosted dev server via `localhost` (auto-forwarded), not `127.0.0.1` (Windows loopback).

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
