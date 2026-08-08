---
title: Derived, never stored — the run-model posture ADR-008 implies but never states
description: Everything on a run surface is derived from the cycle's event log at read time; nothing about a run is authored or cached. The corollary is the load-bearing half — when ONE correct derivation already exists, re-deriving it elsewhere (especially client-side) is a documented defect, not a shortcut. Cost inflated 2-3× twice; batch C caught two more pre-implementation.
category: decision
keywords: [derived-never-stored, event-log, run-model, eventToNodeId, single-derivation, cost-aggregation, client-side-rederivation, RunPhaseMeta, honest-absent, adr-008]
created_at: 2026-08-08
updated_at: 2026-08-08
related_themes: [cost-event-phase-aware-aggregation-rule, jsonl-event-log, orchestrator-owned-execution-beats-heuristic-verification]
---

# Derived, never stored — the run-model posture

[ADR-008](../../../docs/decisions/008-jsonl-event-log.md) makes `_logs/<cycle-id>/events.jsonl`
the one source of truth but never states the derivation rule in those words. The code does:
`orchestrator/run-model.ts` declares the shapes, `run-model-derive.ts` computes every one of
them from events — node statuses, per-node meta, work items, artifacts. `Run.trigger` carries it
verbatim — "derived and never stored/authored. Absent when the run carries no derivable
provenance … NEVER a fabricated default" (`orchestrator/run-model.ts:129-133`). The run-detail
timeline goes one further and derives its rows from the **flow definition**, because "a timeline
derived from the events present would silently vanish" the nodes that never ran
(`docs/forge-ui-dom-and-harness.md:517-519`).

## The corollary that bites: one derivation, reused

The trap is not storing a derived value — it is deriving it **twice**. `cli/metrics.ts::aggregate()`
was the one correct cost implementation; `per_skill` and `run-model-derive.ts::buildNodeMeta()` both
summed events unconditionally and **inflated dev-loop cost 2-3×**, because an iteration-loop phase
restates its dollars on rollup `end` events ([[cost-event-phase-aware-aggregation-rule]]). Both fed
user-visible badges. The DOM contract now pins the survivor: `data-phase-cost-usd` is **exactly**
`run.phaseMeta[node].costUsd`, "never re-summed from events — this codebase has twice shipped a
2-3× inflation that way" (`docs/forge-ui-dom-and-harness.md:524-528`). The single derivation is
`sumAuthoritativeCostUsd` (`orchestrator/event-cost.ts:54`).

Batch C applied the rule twice more, both times *before* an implementer saw the pin.

**R6-01 F1 — `lastEventAt` moved server-side.** The pinned ATs attributed events client-side by
`event.phase === nodeId`. Driving the real `buildNodeMapping()` measured that **only 4 of 12 phase
strings equal their node id** — `developer-loop→dev`, `project-manager→pm`, `reflection→reflect`,
`review-loop→review` all FALSE, `orchestrator` resolving only via `metadata.agent_slug`. An
implementer conforming exactly to those ATs would have shipped the feature non-functional for the
dev, pm, reflect and review nodes **with a green suite**. Amended contract: `RunPhaseMeta.lastEventAt`
derived in `computeLastEventAt` (`orchestrator/run-model-derive.ts:262`) over every event attributed
by the authoritative `eventToNodeId` (`run-model-derive.ts:817`) — the resolver the phase-log route
already filters with — and the client collapsed to `phaseLogRefreshSignal(run, nodeId)`. A naive
implementation does not merely miss the right node, it invents a wrong one, so the AT asserts the
phantom's absence (`phaseMeta['developer-loop'] === undefined`) as well as the hit.

**R6-05 D6 — `findings` derived, not fetched per row.** A findings count is not on `Run` in any
form; the alternative was one `GET /api/artifact/<id>/review-findings.json` **per ledger row**.
Ruled: derive server-side into an additive `RunPhaseMeta.findings` from the existing
`review.findings.authored` event (`orchestrator/phases/adversarial-review.ts:332`, whose counts are
already mechanical), five count fields only, honest-absent (`orchestrator/run-model.ts:80-89`). Two
recorded arguments: N rows must not mean N HTTP calls, and the per-row alternative would add N
callers to a path-handling sink with no `realpath` and no filename charset guard.

## The rule a planner applies

Before specifying any run-surface field, find whether a correct derivation already exists. If it
does, the WI extends **that** call site — an additive optional field on the derived type — and the
acceptance weight lands in the `npm test` CI home where the derivation lives, not a browser-only
unit test. A second derivation is a defect even when both are correct today: only one of them gets
fixed when the event schema moves.

## See also

- [[cost-event-phase-aware-aggregation-rule]] — the concrete 2-3× inflation this posture prevents.
- [[jsonl-event-log]] — the append-only log contract every derivation reads.
- [[orchestrator-owned-execution-beats-heuristic-verification]] — the same instinct for evidence: one authoritative producer, everyone else reads it.
