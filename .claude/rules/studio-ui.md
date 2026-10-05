---
paths:
  - "apps/studio/**"
---

# Studio UI rules

The stories (`tests/stories/*.story.mjs`) drive Studio by reading `data-*`
attributes. They never match markup or copy. A UI change that moves
load-bearing state without moving its attribute breaks a story or, worse,
leaves it green over a dead path.

## The `data-*` contract

- Mirror every load-bearing state to a `data-*` attribute: route identity
  (`data-page`), fetch state, gate state, counts, ids. Act through
  `data-action` / `data-field` controls.
- `data-page-ready` is derived by `routeReady(...)` in
  `apps/studio/lib/route-readiness.ts`, never written as a literal. A route
  that owns no fetch still derives it.
- A press that mints a session publishes the id on an always-present
  element (`data-minted-session-id=""` before the mint, the id after) and
  renders a real anchor `data-action="open-minted-session"`. It never
  navigates by itself. Use an empty string, never an absent key.
- Name a minted-id key distinctly (not the generic `data-session-id`). A
  minting surface usually renders inside another session's page.
- A disabled primary action says why: `data-disabled-reason` plus `title`
  (`node scripts/check-disabled-reason.mjs`).
- Studio imports `@forge/contracts` only (`node scripts/check-boundaries.mjs`).

## Keep the stories in sync

When a change adds, renames or removes a load-bearing attribute, route or
control, re-run `node scripts/dev-gen.mjs`
(regenerates `dev/studio-dom-contract.md`) and update the affected story beat in
the same PR. Invoke the `journey-sync` skill. You may not edit a story to make it
pass. A beat you need to change is an operator-approved amendment.

Run the costless stories before pushing a Studio change:
`npm run stories -- --story smoke && npm run stories -- --story proof`.
