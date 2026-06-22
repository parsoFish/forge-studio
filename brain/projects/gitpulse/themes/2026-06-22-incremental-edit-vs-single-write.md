---
title: Incremental multi-Edit to append to an existing file wastes round-trips vs. single Write
description: >-
  WI-2 made 4 Edit calls to src/format.ts to build up the renderDelta append;
  a single Read → Write would have been cheaper and clearer.
category: antipattern
keywords:
  - edit
  - write
  - format.ts
  - round-trips
  - append-pattern
created_at: 2026-06-22T00:00:00.000Z
updated_at: 2026-06-22T00:00:00.000Z
---

# Incremental multi-Edit vs. single Write for large appends

## Pattern observed

WI-2 (delta rendering, `src/format.ts`) used 4 `Edit` calls to append `renderDelta`, `serializeDelta`, and the `signedStr` helper to the existing file:

- seq 8: first Edit (import addition)
- seq 9: second Edit (partial function append)
- seq 12: third Edit (after re-reading the full file to get accurate line numbers)
- seq 13: fourth Edit (final append)

Between edits 9 and 12 the agent re-read `src/format.ts` twice to reorient on the current state of the file (seqs ~10–11). This is the pattern: incremental Edit → confusion about file state → re-Read → another Edit.

## Root cause

The `Edit` tool requires a unique `old_string` match. When appending to a large existing file, finding the right anchor string and keeping track of what was already appended requires multiple re-reads. A single `Read` of the full file followed by a single `Write` of the complete new content is cheaper for large appends.

## Guidance

For appending ≥20 lines to an existing file:
1. Read the full file once.
2. Compose the full new content in memory.
3. Write once.

Reserve `Edit` for targeted in-place changes (renaming, bug fixes) where the surrounding context is stable and unique.

## Sources

- `_logs/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta/events.jsonl` — seq 8, 9, 12, 13 (WI-2 `Edit` calls to `src/format.ts`); seq ~10–11 (re-Read calls between edits)
- `/home/parso/forge/brain/cycles/_raw/2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta.md`
