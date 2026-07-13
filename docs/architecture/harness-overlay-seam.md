# Harness-overlay seam (parked) — 2026-06-07

> The harness-overlay (running forge phases against an operator's **interactive
> `claude` session** instead of spawning the Claude Agent SDK) is **PARKED** — its
> transport channel is parked alongside [ADR 025](../decisions/025-live-observability.md). The
> injection seam it would use is already clean, documented here, and exercised by
> tests — so building the overlay later is additive, not a refactor. This doc is
> the single place a future implementer starts.

## What the overlay would be

Today every forge phase spawns its own agent via the **Claude Agent SDK**
`query()`. The "overlay" idea (musing #2 in the review) is to instead let forge
drive an agent the operator already has open — an interactive `claude` CLI / IDE
session — so forge becomes a *harness layered on any Claude instance* rather than
a process that always spawns the SDK. Parked because there is no current need;
parking it avoids carrying a second execution mode's surface before it earns its
keep.

## The seam (already exists, already clean)

Every phase resolves its agent through one injectable function, defaulting to the
SDK. The pattern is uniform:

```ts
// loops/ralph/claude-agent.ts:179  (dev-loop / Ralph)
const queryFn: QueryFn = opts.queryFn ?? (sdkQuery as unknown as QueryFn);

// orchestrator/architect-runner.ts  (architect + council)
const queryFn: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);
```

- **`QueryFn`** — [loops/ralph/claude-agent.ts:22](../../loops/ralph/claude-agent.ts#L22): the dev-loop's per-turn agent driver.
- **Architect + council** — the architect runner resolves the same injectable `queryFn` (defaulting to `sdkQuery`); the council transcript type (`CouncilTranscript`) is defined in [`cli/architect-plan.ts`](../../cli/architect-plan.ts), and the council runs inside [`skills/architect/`](../../skills/architect/) — there is no separate `council.ts`.
- PM / reflector take the same `{ queryFn }` options shape
  (`runProjectManager(input, logger, { queryFn })`).

The `?? sdkQuery` fallback is the **one swap point**. Inject a `queryFn` and the
phase runs against whatever that function talks to; inject nothing and it spawns
the SDK as today.

### Proof the seam is load-bearing, not theoretical

The unit tests already drive whole phases through injected `queryFn`s — the same
mechanism an overlay would use in production:

- [orchestrator/cycle-pm-hallucination.test.ts:97](../../orchestrator/cycle-pm-hallucination.test.ts#L97) — `makeStubQueryFn` drives `runProjectManager`.
- [orchestrator/architect-runner.test.ts:41](../../orchestrator/architect-runner.test.ts#L41) — an injectable `queryFn` drives the full architect state machine + council.

If the seam regresses, these tests fail — so it stays clean for free.

## What building the overlay would take (no code now)

1. **An overlay `queryFn` adapter** — implements `QueryFn` / `CouncilQueryFn` by
   forwarding each turn to the operator's interactive session and streaming the
   reply back in the SDK message shape the phases already consume. No phase code
   changes — only a new adapter passed in at the `?? sdkQuery` point.
2. **A capture/transport channel** — the operator's interactive session reports
   tool/lifecycle events over the **`POST /hook-events`** bridge endpoint
   deferred in [ADR 025 §3](../decisions/025-live-observability.md) (settings.json
   `http` hooks). That channel is the overlay's foundation; ADR 025 parks it *with*
   this overlay deliberately.
3. **Attach/lifecycle** — a way to point a cycle at an existing session and reconcile
   forge's worktree/queue model with a human-driven agent (the open design question;
   the daemon model itself does not change — D3).

## Why this is safe to leave parked

- The seam costs **nothing** to keep — it is the same injection point the tests
  need, so it cannot bit-rot silently.
- Nothing else in the simplified architecture depends on the overlay; the single
  daemon model (D3) and SDK-stream observability (ADR 025 decision 1) stand alone.
- Picking it up later is **additive**: one adapter + the `/hook-events` channel,
  no re-architecture.
