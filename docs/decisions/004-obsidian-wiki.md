# ADR 004 — Brain is a Karpathy three-layer wiki rendered in Obsidian

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The brain has two audiences: agents (need fast, accurate lookup) and humans (need to navigate, prune, audit). The **Karpathy LLM-wiki model** — minimal summarisation, maximal indexation, three layers (raw → themes → indexes) — is the design of record. The architecture calls for a brain that "doubles as the visual layer for humans."

Obsidian renders markdown wikis as graphs natively, supports backlinks, and is read-only-friendly for agents (just markdown files on disk).

## Decision

**The brain is structured as a Karpathy three-layer wiki and rendered as an Obsidian vault.**

> **Amended 2026-05-26 ([ADR 018](./018-three-brain-model.md)):** the brain was
> restructured into three scoped graphs. The original single-root layout below
> is superseded by the three-brain model; ADR 018 is the authority on the
> current structure.

Current layout (post-ADR 018 three-brain restructure):

```
brain/
├── INDEX.md                        # meta-index across all three brains
├── _raw/                           # immutable raw sources (ground truth)
├── forge-dev/                      # Brain 1 — forge engineering knowledge
│   ├── themes/                     # ~15-40 line theme pages
│   └── (category indexes)
├── cycles/                         # Brain 2 — cross-cycle patterns + archives
│   ├── themes/
│   └── _raw/                       # immutable cycle records
└── log.md                          # significant operations log

# Brain 3 (per-project) lives inside each managed project's repo:
projects/<name>/brain/
├── profile.md                      # who/what/taste signals
└── themes/
```

Original layout (scaffold, superseded by ADR 018):

```
brain/
├── INDEX.md
├── _raw/
├── forge/                          # now split into brain/forge-dev/ + brain/cycles/
│   ├── themes/
│   ├── patterns.md
│   ├── antipatterns.md
│   ├── decisions.md
│   └── operations.md
├── projects/<name>/                # now lives in each project's own repo
│   ├── profile.md
│   └── themes/
├── LINT.md
└── log.md
```

The brain is itself fronted by three skills:
- `brain-ingest` — appends to `_raw/`, creates new theme pages, never modifies raw.
- `brain-lint` — surfaces orphans, malformed frontmatter, conflicts (escalates ambiguous ones).
- `brain-query` — efficient lookup; mandated as first action of every other skill.

## Consequences

**Positive:**
- Same data structure agents query and humans browse.
- A markdown vault renders as a navigable graph in Obsidian (or any wiki viewer), satisfying the human-visualisation requirement.
- Markdown is the universal lowest-common-denominator — any future tool can read it.
- Append-only `_raw/` means historical context is never lost.

**Negative / accepted trade-offs:**
- No vector search out of the box — `brain-query` does grep-and-load. If recall ever becomes a bottleneck we add embeddings later.
- Obsidian config is per-user (vault settings) — left to the user to set up; not committed.

## Alternatives considered

- **Vector DB (Chroma, Qdrant, etc.)** — premature optimisation. Recall isn't the bottleneck; quality of theme pages is.
- **Notion / Confluence / external wiki** — adds an external dependency, breaks "agents read from disk" simplicity, and pulls forge off the local-first path.
- **One big markdown file** — the prior approach tried summary files; they grow unbounded and lose detail. Karpathy's "many small theme pages > few large summaries" is the correction.

## References

- [Karpathy LLM-Wiki gist](https://gist.github.com/karpathy/) (search "LLM wiki" — exact URL captured during Pass A ingest)
- The prior build's Phase 3.5 wiki rebuild theme pages (folded into the brain)
- [Obsidian](https://obsidian.md/)
