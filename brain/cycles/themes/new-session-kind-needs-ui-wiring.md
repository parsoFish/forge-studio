---
title: A new interactive session kind is not shipped until the UI is wired and a runner exists
description: Shipping a new OOTB agent/session kind needs three layers, not one — the additive definitions (agent def + session descriptor + artifact), the UI wiring (launcher + KindSummary panel + finalize action), and a runtime runner. "The generic R2-10 shell handles it" covers only the session page; route-works is not feature-works. R4-21 was backend-complete and green across 4339 tests yet unreachable in the product.
category: pattern
keywords:
  - new-session-kind
  - ui-wiring
  - route-works-vs-feature-works
  - launcher-kindsummary-finalize
  - runtime-runner
  - generic-shell-covers-only-the-page
  - reachability
  - additive-is-not-enough
created_at: 2026-08-10
updated_at: 2026-08-10
related_themes:
  - adr042-park-recurrence-and-the-generic-primitive
  - declared-data-fails-open
  - forge-ui-data-attribute-contract-discipline
---

# A new interactive session kind needs its UI wiring and a runner

Adding an interactive OOTB agent/session kind is not one change in one layer. It is three:

1. **Additive definitions** — the agent def, the session descriptor, and the artifact shape. Purely additive, easy, and where the work *feels* done.
2. **UI wiring** — the **launcher** that starts the kind, the **KindSummary panel** that renders its state, and the **finalize action** that closes it. Without these the kind exists in the registry but the operator has no surface to drive it.
3. **A runtime runner** — the executor that actually advances an instance of the kind. Without it the session page renders but nothing runs.

"The generic R2-10 shell handles it" is the trap. The generic session shell covers layer 2's *session page* — it does **not** synthesise the launcher, the KindSummary panel, the finalize action, or the runner. **Route-works is not feature-works:** the URL resolves and the shell paints, so a reachability smoke test and the whole unit suite pass, while the operator can never actually reach or complete the kind.

## Confirmed instance — R4-21

R4-21 shipped the additive layer complete and **green across 4339 tests**, yet the kind was **unreachable in the product** past those tests — no launcher entry, no finalize path, no runner. Backend-complete, product-absent: the exact shape of [[declared-data-fails-open]], lifted from a single field to a whole feature.

## The checklist — three layers or it is not shipped

- [ ] Agent def + session descriptor + artifact (additive) — **necessary, never sufficient.**
- [ ] Launcher affordance the operator can click, with its `data-*` state.
- [ ] KindSummary panel rendering the kind's live state.
- [ ] Finalize action that terminates the session and produces its artifact.
- [ ] Runtime runner that advances an instance end to end.
- [ ] A journey that **drives the kind from launcher to finalize** — reachability, not just route resolution. Assert on the settled terminal state ([[forge-ui-data-attribute-contract-discipline]]).

When the runner is a new `orchestrator/` executor, it is ADR-042 ask-first — see [[adr042-park-recurrence-and-the-generic-primitive]] for why the per-kind runner keeps recurring and the generic primitive that dissolves it.

## Sources

- `_wave5/ledger.md` (gitignored campaign state) — R4-21 backend-complete/unreachable, batch D region.
- [`docs/forge-ui-dom-and-harness.md`](../../../docs/forge-ui-dom-and-harness.md) — the per-route `data-*` contract and the journeys-as-data gate.

## See also

- [[adr042-park-recurrence-and-the-generic-primitive]] — the runner layer as a recurring surface-cap ask.
- [[declared-data-fails-open]] — the same product-absent-yet-green shape at field granularity.
