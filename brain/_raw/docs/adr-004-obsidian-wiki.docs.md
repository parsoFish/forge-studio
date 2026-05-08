---
source_type: docs
source_url: docs/decisions/004-obsidian-wiki.md
source_title: ADR 004 — Brain is a Karpathy three-layer wiki rendered in Obsidian
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 1)
cycle_id: pass-a-bootstrap
---

# ADR 004 — Brain is a Karpathy three-layer wiki rendered in Obsidian

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The brain has two audiences: agents (need fast, accurate lookup) and humans (need to navigate, prune, audit). V1 validated the **Karpathy LLM-wiki model** — minimal summarisation, maximal indexation, three layers (raw → themes → indexes). Obsidian renders markdown wikis as graphs natively, supports backlinks, and is read-only-friendly for agents.

## Decision

Brain = Karpathy three-layer wiki + Obsidian vault.

```
brain/
├── INDEX.md                        # meta-index of categories
├── _raw/                           # immutable raw sources (ground truth)
├── forge/                          # forge-system knowledge
│   ├── themes/                     # ~15-40 line theme pages
│   ├── patterns.md                 # category index
│   ├── antipatterns.md
│   ├── decisions.md
│   └── operations.md
├── projects/<name>/                # per-project sub-wikis
├── LINT.md                         # structural rules
└── log.md
```

Three skills front the brain: `brain-ingest` (appends to `_raw/`, creates new theme pages, never modifies raw), `brain-lint` (orphans, frontmatter, conflicts), `brain-query` (efficient lookup; mandated as first action of every other skill).

## Consequences

- Same data structure agents query and humans browse.
- Obsidian's graph view satisfies the visualisation requirement from the diagram.
- Markdown is universal — any future tool can read it.
- Append-only `_raw/` means historical context is never lost.
- Trade-off: no vector search out of the box — `brain-query` does grep-and-load. Add embeddings later if recall becomes a bottleneck. Obsidian config is per-user (gitignored).

## Alternatives considered

- **Vector DB (Chroma, Qdrant)** — premature optimisation. Quality of theme pages is the bottleneck, not recall.
- **Notion / Confluence** — external dependency, breaks "agents read from disk" simplicity.
- **One big markdown file** — v1 tried this; summary files grow unbounded. Karpathy's "many small theme pages > few large summaries" is the correction.

## References

- Karpathy LLM-Wiki gist (search "LLM wiki")
- v1's Phase 3.5 wiki rebuild theme pages (ingested in Pass B)
- https://obsidian.md/
