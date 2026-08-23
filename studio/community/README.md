# `studio/community/` — the curated community seed (R3-07, registry moved by W6-CR-1)

Three things live here, and the difference matters:

- **`registry.yaml`** — the declared-list source of truth for community items
  (W6-CR-1; previously `studio/catalog.yaml`'s `community-skills:` section).
  **Schema v2 (W8-B5)** splits it in two: `items:` carries per-item curation,
  and `sources:` carries repo-level facts (`stars`, `upstreamUpdatedAt`,
  `fetchedAt`, `fetchedBy`) keyed by a normalized source key such as
  `github:obra/superpowers`. Several items share one repo, so a repo fact has
  exactly one home and the item has no field to hold a divergent copy. Today
  every source row is `fetchedBy: seed` — hand-curated, never a verified live
  signal from the upstream host; `forge community refresh` replaces that with
  `api:github` / `api:npm` / `api:mcp-registry` only for a source it genuinely
  got a 200 for. See `orchestrator/studio/registry.ts`'s
  `loadCommunityRegistry`.

  The **leading comment block** of `registry.yaml` is preserved verbatim across
  every programmatic write; a comment INSIDE `items:` is not (js-yaml cannot
  round-trip it), so `forge studio lint` refuses one. Put rationale in the
  header.
- **`hubs.yaml`** — a registry of real public source hubs. It exists only so an
  item's hub can be **derived** by matching the item's own upstream URL, instead
  of trusting a declared hub name (D4). Nothing crawls it.
- **`skills/<id>/` and `hooks/<id>/`** — **vendored packages whose bytes are in
  this repo**, so the community browser's install action can complete for real
  through the owning pipeline (skills → R3-01's draft→scan→approve, hooks →
  R3-03's scan + approval gate).

## What this seed does NOT contain, and why

Forge does **not** vendor third-party content and attribute it to its upstream.
The nine `kind: skill` entries in `registry.yaml` and the nine connections in
`studio/catalog.yaml`'s `tools:`/`mcps:` sections are indexed here with their
real upstream metadata, but **their bytes are not in this repo** — so the
browser derives their installability from disk (there is no vendored package ⇒
no server-resolved install) rather than declaring it, and says so on the page.

Every package under `skills/` and `hooks/` is therefore **forge-authored** and
attributed to the `forge-seed` hub (`github.com/parsoFish/forge-studio`). That
attribution is literally true. No package here carries a star count or a
download number: forge invents no signal it cannot source, and an item with none
renders "no signals published" rather than a zero.

A vendored id may never collide with a `registry.yaml` community-skills id —
that would be claiming third-party bytes. `forge studio lint` enforces it.

## Live hub fetching

Out of scope for R3-07 by the roadmap's own out-of-scope clause, and a new
external dependency besides (ask-first). The static curated seed is the honest
v1; a hub API integration is a separate decision.
