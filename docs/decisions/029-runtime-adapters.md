# ADR 029 — Runtime adapter seam: multi-SDK agents, model-range routing

**Status:** Accepted — 2026-06-13. Implementation staged per
[`docs/forge-studio/roadmap.md`](../forge-studio/roadmap.md) (M6 — last).
Amends ADR 001 (Claude Agent SDK becomes the reference adapter, not the only
runtime) and ADR 002 (the Ralph loop's agent-swappability contract gets its
real second implementation).

## Context

Agent definitions (ADR 027) declare `runtime.sdk` and a model strategy
(`fixed | range`). Today only the Claude Agent SDK exists, wired through
`createClaudeAgent` (`loops/ralph/claude-agent.ts`), which owns the
load-bearing semantics: turn caps, idle-deadline abort, heartbeats,
`onToolUse` observability, `onUsageDelta` cost stream (ADR 025). The mocks
promise Codex / Gemini / local runtimes per agent. Hand-rolling N SDK
integrations ad hoc would scatter those semantics.

## Decision

1. **One adapter interface, extracted from `createClaudeAgent`** into
   `loops/_adapters/`: `spawn(spec, callbacks)` preserving heartbeat,
   idle-deadline, usage-delta, tool-event, and turn-cap semantics exactly.
   `loops/_adapters/claude/` is **moved code, behaviour-identical** —
   verify-cycle routine tier guards the move.
2. **A conformance suite is the admission gate** for any new adapter: the
   contract tests (budgets honoured, heartbeats emitted, usage deltas
   monotonic, tool events observable, abort semantics) must pass before an
   SDK becomes selectable in the agent builder. UI ships the picker earlier
   with non-conformant options disabled.
3. **Adapters are added one at a time, operator-prioritised.** Each new SDK
   is a new external dependency — ask-first per project rules.
4. **Model `strategy: range` routing lives in the adapter layer:** route to
   the cheapest capable tier first, escalate on gate failure. Cost
   attribution flows through the same usage-delta stream regardless of
   adapter, so per-run cost (ADR 025) and the flow cost ceiling (ADR 028)
   need no per-SDK logic.
5. **Orchestrator and flow engine stay SDK-agnostic:** they consume the
   adapter interface only. No `if (sdk === ...)` outside `loops/_adapters/`.

## Consequences

- The 33h-wedge kill, rate-limit gate, and cost ceiling (ADR 028) apply
  uniformly to every runtime because they observe the adapter callbacks,
  not SDK internals.
- Local/zero-cost models become available for fanOut-heavy nodes without
  touching flow or agent semantics.
- Deferred until M6 deliberately: zero value until definition-driven flows
  exist; largest external-dependency surface in the plan.
