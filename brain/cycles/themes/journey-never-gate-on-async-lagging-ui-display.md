---
title: A journey must never gate on a value flowing through an async-lagging UI display
description: When a journey assertion reads a value that reaches the DOM only after an async UI refresh, the gate is timing-fragile — it flakes on render lag, not on the property under test. Assert the robust terminal state plus an API-pinned data transition instead. The two-reopen-stop fires when the same class reopens under a different symptom.
category: antipattern
keywords:
  - journey-timing-fragility
  - async-lagging-display
  - assert-the-terminal-state
  - api-pin-the-transition
  - data-consolidate-state
  - two-reopen-stop
  - per-check-status-inversion
  - ui-regression-gate
created_at: 2026-08-10
updated_at: 2026-08-10
related_themes:
  - forge-ui-data-attribute-contract-discipline
  - per-kb-health-honesty-na-invariant
  - declared-data-fails-open
  - suppression-env-fakes-the-pass
---

# Journey must not gate on an async-lagging UI display

A journey step asserts a value that is *correct at the source* but reaches the DOM only after an asynchronous UI refresh — a poll, a debounce, a re-render on the next tick. The gate then measures render timing, not the property it claims to. It goes red when the refresh lands late and green when the machine is warm, so the same code both passes and fails depending on load. This is `data-*`-contract discipline turned against itself: the attribute is faithful, but the *moment* the journey samples it is not load-bearing.

## Confirmed instance — R6-08 kb-maintain per-check status

The kb-maintain surface renders a per-check status that flows through an async-lagging display. A journey pinned on that transient status **inverted on two different check names** across the batch — the identical failure class reopening under a second symptom. The status was momentarily wrong (or stale) in the DOM while the underlying maintenance operation was mid-flight; by the time it settled it was correct, but the assertion had already sampled the lagging value.

**The two-reopen-stop.** One reopen is a bug; a second reopen of the *same class* under a *different symptom* (here: a different check name showing the same inversion) is the signal to stop patching instances and close the class. Fixing check A's timing and watching check B flake the same way is the tell that the gate is anchored on the wrong surface.

## The rule — assert the terminal, API-pin the transition

- **Gate on the robust terminal state, not the in-flight display.** Assert `data-consolidate-state=cleared` (the settled end state that only exists once the operation is truly done), never the transient per-check badge that races the refresh.
- **API-pin the data transition.** Prove the value *changed correctly* by reading it from the API/server derivation — the authoritative source — rather than from the screen mid-lag. The DOM confirms the terminal; the API confirms the transition.
- **One terminal + one pin beats N per-check assertions.** Enumerating every transient check multiplies the flake surface; the terminal state is singular and monotonic.

A journey is both the demo and the UI regression gate ([[forge-ui-data-attribute-contract-discipline]]): a beat that flakes on render lag rots the demo and erodes trust in the gate exactly when a real regression needs it.

## Sources

- `_wave5/ledger.md` (gitignored campaign state) — R6-08 kb-maintain per-check status inversion, both check names, batch D region.
- [`docs/forge-ui-dom-and-harness.md`](../../../docs/forge-ui-dom-and-harness.md) — the `data-*` contract and the journeys-as-data harness.

## See also

- [[per-kb-health-honesty-na-invariant]] — the R6-08 sibling: what the per-check status must honestly report.
- [[declared-data-fails-open]] — the broader class: a value present on the wire but not load-bearing where it is read.
- [[suppression-env-fakes-the-pass]] — a green result that measures the environment, not the property.
