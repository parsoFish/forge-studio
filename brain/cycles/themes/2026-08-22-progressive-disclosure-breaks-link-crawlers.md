---
title: "Progressive disclosure is a coverage regression for any harness that walks anchors"
description: "W7-B5 paged the agent history ledger at 15 rows; the walkthrough crawl fell 924 -> 657 reachable routes and the coverage floor read it as a Studio regression. The rows were the crawler's main road to the flow-run and artifact families. The fix belongs in the harness (expand disclosure before harvesting), not the product — and the first attempted fix bought zero routes because it expanded something that was never anchors."
category: antipattern
keywords:
  - harness-coverage
  - progressive-disclosure
  - link-crawler
  - walkthrough
  - false-regression
related_themes: [2026-08-22-verifier-without-a-repro-produces-agreement]
created_at: "2026-08-22"
updated_at: "2026-08-22"
---

## What happened

W7-B5 (agents-32) gave the agent history ledger `pageSize={15}` and a "Show
more" control — a straightforwardly good change for an operator staring at 76
rows. The next wave gate reported `coverage collapsed: 657 route(s) crawled <
832`, and the obvious reading was that Studio had lost a quarter of its
reachable surface.

It had not. The ledger's rows are `<a>` elements, and they were the crawler's
main road to `/flows/<id>/run/<runId>` and, through those, to the whole
`/artifact?run=…&type=…` family. Measured on the live tree: `/agents/architect`
linked 61 flow-run routes in the August baseline and 11 after paging;
`developer-ralph` 60 → 15; Home 30 → 30 with 47 more behind two clicks.

## The first fix bought nothing, and that is the sharper lesson

The flow monitor's RunRail had *also* started collapsing its COMPLETE group
past 10 runs (W7-A3), and that looked like the same defect. The collapse state
is read from `localStorage['forge-run-groups:<flowId>']` and a stored map wins,
so one `addInitScript` answering that read forces every group open — elegant,
no clicking, no per-flow key list.

It expanded the rail from 2 to 60 cards, measured, and moved the route count
from 665 to **657**. Rail cards are `<div onClick>`, not anchors. The override
changed what the crawl SAW without changing what it could REACH.

**A harness override that changes what the crawl sees without changing what it
can reach is decoration** — and it makes the capture less representative of
what the operator's own browser renders, so it was deleted rather than kept as
harmless.

## What actually worked

Click `[data-action="ledger-show-more"]` to exhaustion before harvesting links,
bounded. `/agents/architect` went 11 → 63 run links, `developer-ralph` 15 → 60,
Home 30 → 77. The crawl recovered to 703-715 routes.

## The part that mattered most

**The lost coverage was hiding live defects.** The moment the crawler could
reach those routes again it found two real ones: `/projects/<unknown-id>` firing
three per-project reads and 404'ing all three, and a frozen cycle advertising a
PR artifact tab that 404'd because `deriveArtifacts` and the route that serves
what it declares disagreed about where the file lives.

A coverage regression is not a cosmetic metric. It is a measurement of how much
of the product the gate can still see.

## Rule

When a UI gains collapse, paging, lazy-loading or any other progressive
disclosure, the link crawler gains a matching expansion step **in the same PR**.
Judge the affordance as UX, not as missing data — and before accepting any
harness workaround, check that it moved the number it was supposed to move.
