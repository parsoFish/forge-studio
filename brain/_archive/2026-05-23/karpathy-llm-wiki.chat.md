---
source_type: chat
source_url: synthesis (canonical Karpathy gist URL was 404 at ingest time)
source_title: Karpathy LLM-wiki philosophy (synthesised from training-knowledge + how forge v1/v2 implements it)
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 4)
cycle_id: pass-a-bootstrap
---

# Karpathy LLM-wiki philosophy (synthesised)

> **Note on provenance:** the canonical gist URL (gist.github.com/karpathy/...) was unreachable at ingest time. This is a synthesis of the philosophy as it has been described in practitioner write-ups and as forge v1 implemented and validated it. A future ingest pass should replace this with the real gist content when accessible.

## Three layers

The LLM-wiki is structured in three discrete layers, each with a different update discipline:

1. **Raw layer (`_raw/`)** — immutable, append-only ground truth. Web fetches, paper PDFs, cycle logs, ingested third-party docs all land here verbatim with provenance frontmatter. Never modified, never deleted, never rewritten in place. If a source is wrong, the correction is a *new* raw source (a fix or erratum) plus a theme-page note about supersession; the original stays.

2. **Theme pages (`themes/`)** — small (~15-40 line) navigable indexes over the raw layer. Each theme page focuses on one topic and links to multiple raw sources with one-line annotations. Theme pages do **not paraphrase** raw content; the source links *are* the index. Theme pages can be updated as new raw arrives.

3. **Category indexes (`patterns.md`, `antipatterns.md`, etc.) + meta-index (`INDEX.md`)** — pure navigation. One-line pointers to theme pages.

## Core principles

- **Many small theme pages > few large summaries.** The wiki's value is making the raw layer *reachable*, not condensing it. A reader (human or agent) should arrive at the right raw source within 2-3 clicks.

- **No summarisation of summaries.** Theme pages link to raw; they don't paraphrase other theme pages. Otherwise drift compounds and the substrate is lost.

- **Annotated links are the index.** Each link gets a one-line description of what's *in* the linked file. The annotations are what makes the index navigable.

- **Append-only raw.** Without immutability, theme pages drift from sources, history is lost, and replay/audit becomes impossible.

## What it prevents

- **Wiki bloat** — without size discipline on theme pages, summaries grow unbounded and lose the "many small pages" property.
- **Stale themes** — themes whose linked raw has been corrected need to point at the corrections, not silently absorb them.
- **Episodic learning** — without a wiki, every session relearns the same lessons.

## Implementation notes

- Frontmatter is mandatory on raw and themes (see `brain/LINT.md`).
- Slug = filename. `tdd-atomic-items.md`, not `TDD Atomic Items.md`.
- Theme-page length cap: warn at 60 lines, error at 100. Long pages get split.
- Theme pages indexed in **exactly one** category index.
