# `studio/community/` — the curated community seed (R3-07)

Two things live here, and the difference matters:

- **`hubs.yaml`** — a registry of real public source hubs. It exists only so an
  item's hub can be **derived** by matching the item's own upstream URL, instead
  of trusting a declared hub name (D4). Nothing crawls it.
- **`skills/<id>/` and `hooks/<id>/`** — **vendored packages whose bytes are in
  this repo**, so the community browser's install action can complete for real
  through the owning pipeline (skills → R3-01's draft→scan→approve, hooks →
  R3-03's scan + approval gate).

## What this seed does NOT contain, and why

Forge does **not** vendor third-party content and attribute it to its upstream.
The nine `community-skills` entries in `studio/catalog.yaml` and the nine
connections in its `tools:`/`mcps:` sections are indexed here with their real
upstream metadata, but **their bytes are not in this repo** — so the browser
derives their installability from disk (there is no vendored package ⇒ no
server-resolved install) rather than declaring it, and says so on the page.

Every package under `skills/` and `hooks/` is therefore **forge-authored** and
attributed to the `forge-seed` hub (`github.com/parsoFish/forge-studio`). That
attribution is literally true. No package here carries a star count or a
download number: forge invents no signal it cannot source, and an item with none
renders "no signals published" rather than a zero.

A vendored id may never collide with a `community-skills` id — that would be
claiming third-party bytes. `forge studio lint` enforces it.

## Live hub fetching

Out of scope for R3-07 by the roadmap's own out-of-scope clause, and a new
external dependency besides (ask-first). The static curated seed is the honest
v1; a hub API integration is a separate decision.
