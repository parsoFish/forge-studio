---
title: The forge-ui `data-*` contract is a maintained artifact, not a style — three ways it rots
description: Load-bearing UI state is mirrored to `data-*` so automation drives structured DOM instead of scraped text. The principle has a Brain-2 theme; the DISCIPLINE that keeps it true had no node. Three measured failure modes — attribute + reference doc + journey must move in ONE PR; a beat absent from `RUN_ORDER` never runs; attribute-projection tests are blind to element identity (a `<div>` shipped where the contract names `main`, past 45 green tests).
category: decision
keywords: [data-attributes, dom-contract, forge-ui, journey-sync, RUN_ORDER, selector-conformance, attribute-projection, element-identity, ui-journey, journeys-as-data]
created_at: 2026-08-08
updated_at: 2026-08-08
related_themes: [dom-as-metrics-for-headless-driven-uis, m7-studio-consolidation-arc, orchestrator-owned-execution-beats-heuristic-verification]
---

# The forge-ui `data-*` contract is a maintained artifact, not a style

"Every load-bearing UI state in `forge-ui/` is mirrored to `data-*` attributes so
any automation … can drive the page by reading structured DOM state rather than
scraping rendered text" — `docs/forge-ui-dom-and-harness.md:11-14`, pointed at
from `CLAUDE.md:149-156`. Each route owns its own `data-page` + `data-page-ready`
(no shared page root), so the contract is a per-route inventory and the whole of
the UI's automated verification surface. Batch C's gap note was imprecise: the
*principle* has a Brain-2 theme ([[dom-as-metrics-for-headless-driven-uis]]),
stale on its SSOT pointer (`CLAUDE.md` → the doc above, 2026-07-19); what had no
node is the **maintenance discipline** below.

## The same-PR contract

`docs/forge-ui-dom-and-harness.md:1034-1039` — change component state ⇒ update
the `data-*` attribute **and** sync the affected journey in the same PR
(beats/checks + narration/clips), via the `journey-sync` skill. The journeys are
simultaneously the demo and the UI regression gate: a UI change without its
journey update either breaks the gate or silently rots the demo. Three artifacts,
one PR — attribute → reference doc → journey beat.

## A beat absent from `RUN_ORDER` never executes

`scripts/journeys/index.mjs:165` exports `RUN_ORDER`, the flat
`[journeyId, beatId]` sequence; `scripts/e2e-journey.mjs:367` iterates *that*,
not `JOURNEYS`. Declaring a beat in a journey module is not scheduling it. A
fail-fast drift guard (`scripts/e2e-journey.mjs:287-296`) throws
`beat '<j>/<b>' is defined but never scheduled in RUN_ORDER` — batch C saw it
fire, a run dying in 2 s on `demo-builder-generations`. `index.mjs` is the
registry deciding whether a beat runs at all, so it is pinned in the gate
manifest even when the beat modules deliberately are not (R6-01).

## Attribute-projection tests do not prove element identity

R6-01 WI-2 shipped `FlowRunDetail` rendering its root as a `<div>` while the
journey beat selects `main[data-page="flow-run"][data-run-found="true"]`. **All
45 pinned render tests passed** — they assert attribute strings
(`toContain('data-page="flow-run"')`) and are element-agnostic by construction.
The doc now states it contractually: "the element type is load-bearing — journey
selectors key on `main`, and the render tests assert attributes only, so they
cannot see it" (`docs/forge-ui-dom-and-harness.md:498-500`). The implementer was
not careless — it mirrored R6-04's `RunView`, itself a `<div>`, against 27
Studio routes rendering `main[data-page=…]`: a "mirror the precedent" brief
inherits the precedent's defects.

## The rule a planner applies

1. A WI touching load-bearing UI state owes all three artifacts in one PR.
2. A new beat owes its `RUN_ORDER` row; `scripts/journeys/index.mjs` is pinned.
3. When the contract names an element or landmark, acceptance owes a
   **selector-conformance table** — every selector the beat uses mapped to
   `file:line`, proven against an EXECUTED render, element type included — for
   *every* resolved state of the route (in-flight / unresolved / resolved).

## See also

- [[dom-as-metrics-for-headless-driven-uis]] — the principle and its cwc origin; this theme is its enforcement half.
- [[m7-studio-consolidation-arc]] — `ui:journey` as the integration oracle.
- [[orchestrator-owned-execution-beats-heuristic-verification]] — a green worker suite is not evidence the gate will agree.
