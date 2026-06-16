# OOTB Knowledge Packs

Curated, reusable seed knowledge for the brain — the knowledge-base half of the
Forge Studio OOTB library (ADR-018 amendment). A pack is a portable bundle an
operator applies to a project's Brain 3 (or the cross-cycle Brain 2) when
onboarding, so a fresh project starts with proven patterns instead of a cold brain.

## Layout

```
brain/packs/<slug>/
├── pack.yaml        # descriptor: id, name, scope, appliesTo, desc, themes[]
├── themes/          # the seed theme pages (pattern|antipattern|decision|reference)
└── _raw/            # (optional) immutable source material the themes distil
```

## Applying a pack

A pack is *content*, not a live brain. Applying it copies its `themes/` into the
target brain's `themes/` (Brain 2 `brain/cycles/themes/` or a project's
`projects/<name>/brain/themes/`), then `forge brain index --write` regenerates the
navigation. A future `forge kb seed --pack <slug> --project <name>` will mechanise
this; today it is a curated copy.

## Packs

- **terraform-provider** — Go Terraform-provider projects (CRUD lifecycle, live
  acceptance discipline, ADO/REST gotchas). Distilled from the betterado cycles.
- **forge-craft** — how to *run forge well* (initiative sizing, WI dependency
  ordering, the two-gate model, resume-don't-discard). Project-agnostic.

These are deliberately thin and high-signal (the Karpathy wiki rule: 15–40-line
source-linked pages, no filler). Grow them from real merged cycles, never invent.
