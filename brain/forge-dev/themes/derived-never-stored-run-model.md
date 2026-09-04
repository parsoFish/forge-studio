---
title: Derived, never stored — the run-model posture ADR-008 implies but never states
description: Everything on a run surface is derived from the cycle's event log at read time; nothing about a run is authored or cached. The corollary is the load-bearing half — when ONE correct derivation already exists, re-deriving it elsewhere (especially client-side) is a documented defect, not a shortcut. Cost inflated 2-3× twice; batch C caught two more pre-implementation.
category: decision
keywords: [derived-never-stored, event-log, run-model, eventToNodeId, single-derivation, cost-aggregation, client-side-rederivation, RunPhaseMeta, honest-absent, adr-008, adr-044, bounded-memoization, read-path-cache]
created_at: 2026-08-08
updated_at: 2026-08-15
related_themes: [cost-event-phase-aware-aggregation-rule, jsonl-event-log, orchestrator-owned-execution-beats-heuristic-verification]
---

# Derived, never stored — the run-model posture

[ADR-008](../../../docs/decisions/008-jsonl-event-log.md) makes `_logs/<cycle-id>/events.jsonl`
the one source of truth but never states the derivation rule: `run-model.ts` declares the shapes,
`run-model-derive.ts` computes every one from events. `Run.trigger` states it verbatim — "derived
and never stored/authored … NEVER a fabricated default" (`orchestrator/run-model.ts:129-133`) — and
the run-detail timeline derives its rows from the **flow definition**, since events alone "would
silently vanish" the nodes that never ran (`docs/forge-ui-dom-and-harness.md:517-519`).

## The corollary that bites: one derivation, reused

The trap is not storing a derived value — it is deriving it **twice**. `packages/flows/metrics.ts::aggregate()`
was the one correct cost implementation; `per_skill` and `run-model-derive.ts::buildNodeMeta()` both
summed events unconditionally and **inflated dev-loop cost 2-3×** (an iteration-loop phase restates
its dollars on rollup `end` events — [[cost-event-phase-aware-aggregation-rule]]). Both fed
user-visible badges; the DOM contract pins the survivor, `data-phase-cost-usd` **exactly**
`run.phaseMeta[node].costUsd`, "never re-summed from events" — the single derivation is
`sumAuthoritativeCostUsd` (`orchestrator/event-cost.ts:54`; `docs/forge-ui-dom-and-harness.md:524-528`).

**R6-01 F1 — `lastEventAt` moved server-side** (batch C applied the rule twice more, both times
*before* an implementer saw the pin). The pinned ATs attributed events client-side via
`event.phase === nodeId`, but driving the real `buildNodeMapping()` measured **only 4 of 12 phase
strings equal their node id** (`developer-loop→dev`, `project-manager→pm`, `reflection→reflect`,
`review-loop→review` all FALSE, `orchestrator` resolving only via `metadata.agent_slug`) —
conforming exactly to those ATs would have shipped dev/pm/reflect/review non-functional **with a
green suite**. Amended: `RunPhaseMeta.lastEventAt` derives in `computeLastEventAt`
(`run-model-derive.ts:262`) over every event the authoritative `eventToNodeId`
(`run-model-derive.ts:817`) attributes; the client collapsed to `phaseLogRefreshSignal(run, nodeId)`.
The AT also asserts the phantom's absence (`phaseMeta['developer-loop'] === undefined`), not the hit alone.

**R6-05 D6 — `findings` derived, not fetched per row.** No `Run` field held a findings count; the
alternative was one `GET /api/artifact/<id>/review-findings.json` **per ledger row**. Ruled: derive
server-side into additive `RunPhaseMeta.findings` from the existing `review.findings.authored`
event (`orchestrator/phases/adversarial-review.ts:332`), five count fields, honest-absent
(`orchestrator/run-model.ts:80-89`) — N rows must not mean N HTTP calls to a path-handling sink with
no `realpath` and no filename charset guard.

## The rule a planner applies

Before specifying any run-surface field, find whether a correct derivation already exists. If it
does, the WI extends **that** call site — an additive field on the derived type — and the
acceptance weight lands in the `npm test` CI home the derivation lives in, not a browser test. A second derivation is a defect even when both are correct today: only one gets fixed when the schema moves.

## The bounded-memoization corollary

[ADR-044](../../../docs/decisions/044-read-path-memoization.md) narrows this posture, not reverses
it: a read-path cache is still this same single derivation wrapped in a keyed memo — manifest
content hash + events-log mtime+size, asymmetric on purpose (`packages/flows/run-list-cache.ts` header) —
never a second derivation, never a persisted artifact. `_queue/done/` grows unbounded and a
terminal run's derivation never changes, so `GET /api/runs` re-read+JSON-parsed 507 MB of settled
event logs per request before `packages/flows/run-list-cache.ts` (P1) landed. Still forbidden: writing a
derived value to a manifest/status file and reading it back, or deriving the same fact twice — the
memo lives only in the serving process and fails open on any doubt.

## See also

- [[cost-event-phase-aware-aggregation-rule]] — the concrete 2-3× inflation this posture prevents.
- [[jsonl-event-log]] — the append-only log contract every derivation reads.
- [[orchestrator-owned-execution-beats-heuristic-verification]] — the same instinct for evidence: one authoritative producer, everyone else reads it.
