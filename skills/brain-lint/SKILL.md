---
name: brain-lint
description: Structural integrity checks on the brain — orphans, malformed frontmatter, conflicting claims, broken source links, oversized theme pages.
phase: brain
surface: unattended
model: claude-haiku-4-5
---

# Brain — Lint

## Single responsibility

Apply the rules in [`brain/LINT.md`](../../brain/LINT.md) to the wiki. Auto-fix what's safe; surface what isn't.

## Required first action

Invoke `brain-query` with:

- "What lint rules has the brain captured as nuanced — i.e. cases where the literal rule has known exceptions?"

(This catches cases where a strict rule should yield to a documented exception.)

## Inputs

- The current state of `brain/`.
- Optional: a scope flag — full / forge-only / project-only / single-file.

## Outputs

- `_logs/<cycle-id>/brain-lint.md` — report categorised as `auto-fixed`, `flagged`, `errors`.
- Direct edits to brain files for auto-fixes (filename normalisation, frontmatter ordering, category-index sync).
- Append to `brain/log.md`.

## Event-log entries to emit

- `brain-lint.start` — with scope.
- `brain-lint.auto-fix` — one event per auto-fix applied.
- `brain-lint.flag` — one event per ambiguity flagged for human review.
- `brain-lint.error` — one event per rule violation that can't be auto-fixed.
- `brain-lint.end` — summary counts.

## Benchmark suite

Shared with `brain-ingest` and `brain-query` under [`benchmarks/brain/`](../../benchmarks/brain/).

## Process

1. **Brain query first** for nuance / exceptions.
2. Walk the brain file tree. For each:
   - Validate frontmatter against `brain/LINT.md` rules.
   - Check source-link targets exist.
   - Check category-index sync.
   - Check page length.
3. For each issue:
   - **Auto-fixable** (filename, frontmatter ordering, missing index entry): apply the fix.
   - **Flagged** (conflicting claims, possible duplicate, drift): write to the report under `flagged`.
   - **Error** (frontmatter missing, broken source link, orphan): write to the report under `errors`.
4. Append summary to `brain/log.md`.

## Constraints

- **Never delete content.** Lint may move, normalise, or flag — never delete. Deletion is an explicit `brain-ingest` operation.
- **Conservative on auto-fix.** When in doubt, flag rather than fix. The cost of a wrong auto-fix outweighs the cost of a flagged item.
- **Idempotent.** Running lint twice in a row produces the same report (modulo the new lint event itself).
