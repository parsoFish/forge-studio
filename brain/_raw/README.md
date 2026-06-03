# Brain — Raw Layer (forge-dev ingest corpus)

> **Immutable.** Append-only. Never modified, never deleted, never re-themed in place.

This directory holds the ground-truth **forge-engineering** sources the brain's
theme pages index — third-party docs, web research, v1-wiki snapshots, ADR
ingests. Anything ingested by `brain-ingest` for forge itself lands here with
provenance preserved.

> **Two separate `_raw` layers — do not confuse them:**
>
> | Path | What lives here | Writer |
> |---|---|---|
> | `brain/_raw/` (this dir) | Ingested **reference material** — web fetches, docs, papers, retros, external research. Feeds theme pages via `brain-ingest`. | `brain-ingest` skill (operator-driven) |
> | `brain/cycles/_raw/` | Per-cycle **event-log archives** — the raw JSONL + retro files written at cycle close. Feeds the reflector's synthesis. | orchestrator / reflector (automatic) |
>
> If you're adding external research or an operator retro: `brain/_raw/`.
> If you're reading cycle history: `brain/cycles/_raw/`.

## Conventions

- **Filename:** `<slug>.<source-type>.md` where `<source-type>` is one of `web`, `docs`, `cycle`, `paper`, `chat`, `repo`, `retro`.
- **Frontmatter (mandatory):**
  ```yaml
  ---
  source_type: web | docs | cycle | paper | chat | repo | retro
  source_url: <if applicable>
  source_title: <human title>
  ingested_at: <ISO-8601>
  ingested_by: <skill name>
  cycle_id: <if applicable>
  ---
  ```
- **Body:** the raw content, minimally cleaned (de-paginated, ad-stripped) but otherwise preserved.

## Subdirectories

Created on demand by ingest. Common ones:

- `_raw/web/` — web fetches.
- `_raw/docs/` — third-party documentation.
- `_raw/papers/` — research papers.
- `_raw/chats/` — saved Claude/ChatGPT conversations relevant to forge.
- `_raw/repos/` — README/architecture extracts from reference projects.
- `_raw/retros/` — retro outputs from reflection.

## Why immutable

If raw can be edited, theme pages drift from sources, history is lost, and reflection can't replay. The raw layer is the brain's substrate; everything else is interpretation.

If a source is *wrong*, the correction is a new raw source (a fix, an erratum) plus a theme page noting the supersession. The original stays.
