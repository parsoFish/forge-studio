# ADR 029 — Runtime adapter seam: multi-SDK agents, model-range routing

**Status:** Accepted — 2026-06-14.
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

Two seams already exist as informal contracts:

- `QueryFn` (`loops/ralph/claude-agent.ts:22`): the raw SDK-call boundary.
  Every direct-stream phase (`pm`, `dev`, `reflector`, `architect`) already
  injects this via `sdkQuery as unknown as QueryFn`.
- `AgentInvocation` (`loops/ralph/runner.ts:133`): the Ralph-runner callable
  that one work-item iteration resolves to. The stub agent is the minimal
  implementation; `createClaudeAgent` returns this shape.

M6 formalises these two seams into a named `RuntimeAdapter` interface —
extraction, not redesign.

## Decision

### M6-1 (this ADR): Interface + Claude reference adapter

1. **`RuntimeAdapter` interface** (`loops/_adapters/types.ts`): named contract
   formalising the `QueryFn + AgentInvocation` seams. Fields:
   `id: string`, `available: boolean`, `createAgent(opts): AgentInvocation`,
   `query: QueryFn`. Re-exports `AgentInvocation`, `AgentIterationInfo`,
   `QueryFn` so adapter authors import from one place.
2. **Claude reference adapter** (`loops/_adapters/claude/index.ts`): wraps
   `createClaudeAgent` + `sdkQuery`. Physical location: the adapter is new;
   `loops/ralph/claude-agent.ts` stays in place to avoid import churn. The
   adapter is the **new public seam**; the existing file is the implementation
   it wraps (behaviour-identical by construction).
3. **Wrap-not-move decision**: `claude-agent.ts` remains at `loops/ralph/` so
   the ~15 existing import sites (phases, tests) require zero changes. The
   adapter (`loops/_adapters/claude/index.ts`) wraps it. Logically the adapter
   is the public seam; physically the file stays. This is noted in the adapter
   source. The full existing test suite (1036 tests) must pass unchanged.

### M6-2 (next): Registry + conformance suite + example adapter

4. **Registry** (`loops/_adapters/registry.ts`): `getAdapter(sdkId)`,
   `listAdapters()`, `registeredSdkIds()`. Claude + example registered.
5. **Conformance suite** (`loops/_adapters/conformance.ts`): contract tests
   every adapter must satisfy (createAgent returns a callable yielding
   AgentIterationInfo shape; query yields an AsyncIterable; callbacks fire).
   Proven against the Claude adapter (mock queryFn — no real API) and an
   in-repo **example adapter** (dependency-free mock, no external SDK).
6. **Example adapter** (`loops/_adapters/example/`): dependency-free mock
   proving the registry handles >1 adapter. Not a real SDK; proves pluggability.

### M6-3 (after M6-2): strategy:range model routing

7. **Range routing lives in the spec/adapter layer.** `deriveAgentSpec` removes
   the `strategy !== 'fixed'` throw. A `resolveRangeModel` picks the cheapest-
   capable tier first (by catalog costIn+costOut) and escalates on gate failure.
   Works across Claude tiers (haiku→sonnet→opus) — no second SDK needed.
   Cross-SDK range is schema-ready (ADR 027), deferred to a real 2nd SDK.

### Deferred: real second SDK (Codex / Gemini / local)

8. **A real second SDK is ask-first** (new external dependency). The framework
   (M6-1 through M6-3) is complete without it. Adding one later: implement
   `RuntimeAdapter` in `loops/_adapters/<sdk>/`, register it, install the dep.
   The conformance suite is the admission gate.

## Consequences

- **Behaviour-identical extraction** (M6-1): `createClaudeAgent` is unchanged;
  the Claude path is identical behind the new wrapper. verify:cycle routine tier
  is the real guard.
- **No new npm dependency** in M6: the example adapter is an in-repo mock; the
  Claude adapter keeps the existing `@anthropic-ai/claude-agent-sdk` dep.
- The 33h-wedge kill, rate-limit gate, and cost ceiling (ADR 028) apply
  uniformly to every runtime because they observe the adapter callbacks,
  not SDK internals.
- Local/zero-cost models become available for fanOut-heavy nodes without
  touching flow or agent semantics.
- Orchestrator and flow engine stay SDK-agnostic: they consume the adapter
  interface only. No `if (sdk === ...)` outside `loops/_adapters/`.
