# Brain 1 — forge-dev

> **Intent.** The LLM-wiki of **forge's own engineering knowledge** — learnings and
> research that surface as the operator works with Claude on forge, plus the ADRs and
> source map. Scope sits **above cycles and outside the phase system**.
>
> **Type:** knowledge store. **Realized via:** `brain/forge-dev/` (Karpathy three-layer:
> `_raw/` → `themes/` → indexes) + a graphify code graph.

## Responsibilities

- Hold forge-engineering themes (decisions, references, architecture notes) and the ADR
  corpus as a navigable, cross-linked wiki rendered as an Obsidian vault.
- Serve **structural code questions** ("what calls this?", "which ADR covers this module?")
  via **graphify** — which *earns its keep here* (the forge-dev graph carries ~2,000 real
  import/call/re-export edges over the TypeScript source).
- Back the operator's "ask for research" flow (a forge-project-level skill) and accrue its
  output as themes.

## Inputs → Outputs

**Consumes:** forge source + ADRs (graphify corpus); research/operator notes (ingest).
**Produces:** theme pages + category indexes; the committed `graphify-out/graph.json`.

## Relationships

- **Read by:** the operator + Claude during forge development; **not** read by the in-cycle
  phases (those read Brain 2/3). **Tooled by:** `brain-query`, `brain-graph`, `brain-lint`.

## Boundaries (what this is NOT)

- Not cycle memory (that is [Brain 2](docs/architecture/refocus-architecture/forge-cycle-brain.md)) and not project memory (that is
  [Brain 3](docs/architecture/refocus-architecture/project-dev-brain.md)).
- Not written by the in-cycle reflector (the reflector writes Brain 2 + 3).

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[BRN-1 · low]** Confirm scope/shape: 14 themes (all decision/reference) + a 119KB
  `log.md` + `as-built/`/`notes/` dirs not described in ADR 018 — define what forge-dev
  should hold vs cull.
- **[BRN-2 · med]** Two `_raw/` layers (`brain/_raw/` reference corpus vs
  `brain/cycles/_raw/` archives) confuse the ingest skill — unify or rename
  (shared with [Brain 2](docs/architecture/refocus-architecture/forge-cycle-brain.md)).
