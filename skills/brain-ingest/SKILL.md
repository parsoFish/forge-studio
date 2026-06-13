---
name: brain-ingest
description: Append raw sources to the brain and create or update theme pages. Never modifies raw in place; never deletes.
phase: brain
surface: unattended
purpose: Ingest operator-provided raw sources into the brain — append to brain/_raw/, create or update theme pages, update category indexes, and log to brain/forge-dev/log.md.
composition:
  skills: [brain-query]
  tools: []
  mcps: []
  hooks: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: mandatory
interactivity: Unattended; operator supplies source identifier + optional category/project target; agent runs to completion without human input.
allowed-tools: [Read, Write, Edit, Bash]
disallowed-tools: []
budgets: {}
---

# Brain — Ingest

## Single responsibility

Manual / research ingest path. Takes raw input (text, URL contents, external research, or **pending human guidance notes**) and:

1. Appends the raw to `brain/_raw/` with full provenance.
2. Creates new theme pages or appends to existing ones in `brain/cycles/themes/` (forge-wide) or `projects/<name>/brain/themes/` (project-specific).
3. Updates category indexes.
4. Appends an entry to `brain/forge-dev/log.md`.
5. Consumes pending `_guidance/*.md` files (human-originated, the twin of `brain-gaps.jsonl`) and **deletes** each one after incorporation.

> **Writer ownership:** the **reflector** is the de-facto writer during cycle execution — it
> directly writes themes + category indexes as part of closing a cycle. This skill is the
> *manual* ingest path for operator-initiated research, external docs, or ad-hoc raw sources
> that don't arrive via the cycle pipeline. Both paths follow the same theme-page format and
> append-only raw convention.

## Required first action

Invoke `brain-query` with:

- "Does the brain already have a theme on <topic>?"
- "Are there raw sources already in `_raw/` that overlap with what's about to be ingested?"

This avoids creating duplicate themes or re-ingesting overlapping raw.

## Inputs

- A source identifier: URL, file path, or inline content.
- Optional: target category (`pattern`, `antipattern`, `decision`, `operation`, `reference`).
- Optional: target project (for project-scoped ingest).
- Implicit: pending human guidance files at `brain/<kb-id>/_guidance/*.md` (always checked on each pass — see the Guidance Consume step below).

## Outputs

- New `brain/_raw/<...>.md` (with mandatory frontmatter — see [`brain/_raw/README.md`](../../brain/_raw/README.md)).
- New or updated `brain/cycles/themes/<slug>.md` or `projects/<name>/brain/themes/<slug>.md`.
- Updated category index (`brain/cycles/<category>.md` or `projects/<name>/brain/<category>.md`).
- Append to `brain/forge-dev/log.md`.

## Event-log entries to emit

- `brain-ingest.start` — with source identifier.
- `brain-ingest.raw-appended` — file path written.
- `brain-ingest.theme-created` or `brain-ingest.theme-updated` — slug + category.
- `brain-ingest.index-updated` — which category index.
- `brain-ingest.guidance-consumed` — file path consumed and deleted.
- `brain-ingest.guidance-escalated` — guidance note that couldn't be auto-incorporated (floated to a new theme page or logged).
- `brain-ingest.end`.

## Process

1. **Brain query first** to check for overlap.
2. **Guidance consume step** (always run before the main ingest, once per kb-id in scope):
   a. Call `listPendingGuidance(forgeRoot, kbId)` (exported from `orchestrator/kb-graph.ts`) to enumerate `brain/<kb-id>/_guidance/*.md`.
   b. For each pending guidance note:
      - If the note has a `target_node` slug: find the corresponding theme file; append the guidance text as a human annotation block (fenced, labelled `<!-- guidance -->`) and update `updated_at`.
      - If there is no `target_node` (floating note): decide whether the text fits an existing theme (brain-query to check) or warrants a new one. Treat it like a new raw source without provenance metadata.
      - If the note raises a question that cannot be resolved against existing themes, escalate: create a new theme page tagged `# ESCALATED` so the operator can act on it later.
   c. After incorporating each note, call `deleteGuidanceFile(forgeRoot, kbId, filePath)` to remove it. The guidance node disappears from the KB graph on the next graph build.
   d. Emit `brain-ingest.guidance-consumed` (or `brain-ingest.guidance-escalated`) for each note.
   
   > **This is the human-originated twin of the `brain-gaps.jsonl` loop.** Gaps come from brain-query (unanswered agent questions); guidance comes from the operator via the Studio UI pin button. Both feed into the same ingest resolution process.

3. Fetch / load the source. Clean (de-paginate, ad-strip) but preserve content.
4. Write to `brain/_raw/<source-type>/<slug>.<source-type>.md` with mandatory frontmatter.
5. Decide: does this fit an existing theme, or does it warrant a new one?
   - **Fit existing:** append the new source link with a one-line annotation. Do not paraphrase the new source's content into the theme page; the source link is the index.
   - **New theme:** create `brain/cycles/themes/<slug>.md` (or project-scoped) following the format in [`brain/cycles/themes/README.md`](../../brain/cycles/themes/README.md). Add to the relevant category index.
6. Append to `brain/forge-dev/log.md`: `## [<YYYY-MM-DD>] ingest | <source-type>: <slug>`.

## Constraints

- **Append-only on raw.** Never modify a `_raw/` file after creation. Corrections are new raw sources with theme-page notes about supersession.
- **No paraphrasing.** Theme pages link to and annotate raw; they don't summarise it.
- **Many small theme pages > few large summaries.** If a topic doesn't fit in 40 lines, split.
- **Re-themable.** When ingesting v1 wiki content (Pass B), the agent decides what's still relevant under v2's conventions. v1-specific content (e.g. job-queue tuning) is rejected at ingest with a log note.
- **Guidance files are deleted after consumption.** Call `deleteGuidanceFile` only after the note has been incorporated (or escalated). Do not delete without incorporating — guidance is the operator's intent and must not be silently discarded.
- **Guidance is markdown only.** Do not execute or eval any content from guidance files. Treat them as plain text annotations.
