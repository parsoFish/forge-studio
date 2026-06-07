# ADR 025 — Live observability: cost/tokens via the SDK stream; hook-emission deferred

- **Status:** accepted
- **Date:** 2026-06-07
- **Relates to:** [ADR 008](./008-jsonl-event-log.md) (the JSONL event log is the source of truth), [ADR 023](./023-ui-sole-operator-surface.md) (the UI is the operator surface). Records the observability decisions of the 2026-06-07 simplification pass.

## Context

The operator wanted to **see cost/usage live** — "some level of costs live rather than
only at the closure of a phase or work item" — inspired by *agent-flow*'s live updates.
As-built, the forge-ui showed cost only at phase/WI closure (the `iteration`/`end`
events carry `cost_usd`). Two mechanisms were considered: surfacing what the SDK
naturally gives us more often, vs. a Claude-**hooks**-based event channel (how agent-flow
does it).

A key finding: **Claude hooks carry no token/cost data** (the hook payloads have
tool identity + timing only — confirmed against the SDK + GitHub issue #11008). Cost
lives only on the **SDK stream** (`SDKAssistantMessage.usage` per turn;
`total_cost_usd` on the `result` per `query()`). So hooks were never the cost channel.

## Decision

**1. Cost + tokens surface at the natural points the SDK gives us — more often than
phase/WI closure — with no pricing table.**
- `cost-tick` consumer wired into the cycle logger (rolling per-iteration cost across
  all phases).
- `onUsageDelta` on `createClaudeAgent` emits per-turn token deltas; the forge-ui folds
  them in **live** via a committed-vs-in-flight reconciliation (`derivePerWiActivity` /
  `deriveStageTotals`): tokens tick during a query, and the authoritative iteration
  total **supersedes** the in-flight estimate — so no double-count.
- **No per-model pricing table.** The operator chose to track tokens/cost at the points
  we naturally have them, not to estimate a live-$ figure (a pricing table is
  stale-prone surface for marginal within-query value). $ lands at the iteration points.

**2. The hook-based emission-unification is DEFERRED (documented as viable).**
The SDK *does* support inline `Options.hooks` callbacks
(`runtimeTypes.d.ts`: `hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>`,
`PreToolUse: [{ hooks: [async (input) => ({ continue: true })] }]`). Replacing forge's
stream `tool_use` parsing with `PreToolUse`/`PostToolUse` hooks is a viable future
simplification. It is **deferred** because:
- The stream parsing it would replace is **load-bearing** — it drives `filesChanged`,
  the heartbeat tool counter, bash-command capture, the tool observability log, AND the
  live `onToolUse` telemetry — and it works reliably today.
- Whether the **real** SDK fires those inline hooks as documented is the one thing no
  mock can prove (only a real cycle can); replacing working, load-bearing code with an
  only-real-cycle-validatable alternative, for a cleanliness gain, is not justified now.
- The live feel the operator wanted is **already delivered** by decision (1).

**3. The `/hook-events` HTTP channel is DEFERRED with the overlay.** A `POST /hook-events`
bridge endpoint + `settings.json` http hooks would let forge capture an operator's
*interactive* `claude` session — the foundation for the parked harness-overlay
([2026-06-07 simplification review] D1). It is deferred with that overlay.

## Consequences

- Live cost/tokens shipped with **minimal new surface**: no pricing table, no hooks
  rewrite, the source-of-truth event log stays on the reliable in-process SDK stream.
- The hooks path is **documented + confirmed viable** (the API exists), ready to pick up
  when there's a concrete need — chiefly the overlay, which needs hook/HTTP capture of
  interactive sessions regardless. The mocking strategy is known: an injected `queryFn`
  fires the hooks for unit tests; a `/hook-events` contract test covers the HTTP path;
  `ui:journey` validates UI consumption; a single real-cycle check confirms the SDK fires.

## Alternatives considered

- **Per-model pricing table for live-$ within a query.** Rejected — stale-prone surface,
  provisional-vs-authoritative double-count complexity, marginal value (cost-tick already
  ticks per iteration; single-query phases are quick).
- **Full hook-emission-replacement now.** Rejected for this pass — replaces working,
  load-bearing stream parsing with an only-real-cycle-validatable alternative for a
  cleanliness gain; the live feel is already delivered. Documented as a viable future step.
