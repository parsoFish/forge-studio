# ADR 004 — Brain is a Karpathy three-layer wiki rendered in Obsidian

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The brain has two audiences: agents (need fast, accurate lookup) and humans (need to navigate, prune, audit). V1 validated the **Karpathy LLM-wiki model** — minimal summarisation, maximal indexation, three layers (raw → themes → indexes). The forge2.0 diagram explicitly calls for graph visualisation that "doubles as the visual layer for humans."

Obsidian renders markdown wikis as graphs natively, supports backlinks, and is read-only-friendly for agents (just markdown files on disk).

## Decision

**The brain is structured as a Karpathy three-layer wiki and rendered as an Obsidian vault.**

Layout:

```
brain/
├── INDEX.md                        # meta-index of categories
├── _raw/                           # immutable raw sources (ground truth)
├── forge/                          # forge-system knowledge
│   ├── themes/                     # ~15-40 line theme pages
│   ├── patterns.md                 # category index
│   ├── antipatterns.md             # category index
│   ├── decisions.md                # category index
│   └── operations.md               # category index
├── projects/<name>/                # per-project sub-wikis
│   ├── profile.md                  # who/what/taste signals
│   └── themes/
├── LINT.md                         # structural rules
└── log.md                          # significant operations log
```

The brain is itself fronted by three skills:
- `brain-ingest` — appends to `_raw/`, creates new theme pages, never modifies raw.
- `brain-lint` — surfaces orphans, malformed frontmatter, conflicts (escalates ambiguous ones).
- `brain-query` — efficient lookup; mandated as first action of every other skill.

## Consequences

**Positive:**
- Same data structure agents query and humans browse.
- Obsidian's graph view satisfies the visualisation requirement from the diagram.
- Markdown is the universal lowest-common-denominator — any future tool can read it.
- Append-only `_raw/` means historical context is never lost.

**Negative / accepted trade-offs:**
- No vector search out of the box — `brain-query` does grep-and-load. If recall ever becomes a bottleneck we add embeddings later.
- Obsidian config is per-user (vault settings) — left to the user to set up; not committed.

## Alternatives considered

- **Vector DB (Chroma, Qdrant, etc.)** — premature optimisation. Recall isn't the bottleneck; quality of theme pages is.
- **Notion / Confluence / external wiki** — adds an external dependency, breaks "agents read from disk" simplicity, and pulls forge off the local-first path.
- **One big markdown file** — v1 tried summary files; they grow unbounded and lose detail. Karpathy's "many small theme pages > few large summaries" is the correction.

## References

- [Karpathy LLM-Wiki gist](https://gist.github.com/karpathy/) (search "LLM wiki" — exact URL captured during Pass A ingest)
- v1's Phase 3.5 wiki rebuild theme pages (carry into brain via Pass B)
- [Obsidian](https://obsidian.md/)
