---
title: annotateManifest vs folded YAML scalars — value doubling (fixed)
description: Long manifest values (worktree_path ≥ ~80 chars) serialize as folded `>-` two-line scalars; annotateManifest's single-line regex replace left the continuation line behind, so the manifest re-parsed with the value doubled ("path path") and `forge review --approve` refused with "worktree missing". Fixed 2026-06-12 (scheduler.ts, commit 20092e9).
category: antipattern
created_at: 2026-06-12T13:30:00Z
updated_at: 2026-06-12T13:30:00Z
---

# annotateManifest vs folded YAML scalars — value doubling

## Observation

Both betterado close-outs on 2026-06-11/12 (environment-config-surface,
artifact-trigger-enhancements) hit:

```
forge review --approve: worktree missing at /path /path — cannot merge
```

The manifest's `worktree_path` parsed as the path twice, space-separated.

## Root cause

Two manifest writers with different YAML dialects:

- `serializeManifest` (gray-matter/js-yaml, lineWidth 80) emits long values as
  folded block scalars: `worktree_path: >-` + indented continuation line.
- `annotateManifest` (scheduler.ts) edits frontmatter with a raw regex
  `^key:.*$` line replace. On a folded scalar it replaced only the `key: >-`
  line and left the indented continuation, producing a multi-line *plain*
  scalar that YAML joins with a space → "path path".

Any requeue/retry that round-tripped the manifest through `serializeManifest`
(e.g. `forge requeue`) armed the trap; the next `annotateManifest` at claim
time sprang it.

## Fix (landed)

`annotateManifest`'s replace regex now consumes the key line AND any indented
continuation lines: `^key:[^\n]*(?:\n[ \t]+[^\n]*)*`. Test:
`scheduler.test.ts` "annotateManifest: replaces folded >- scalar without
leaving continuation lines". Forge commit `20092e9`.

## Wider lesson

Frontmatter has ONE canonical writer (`serializeManifest`); raw-regex editors
must understand every output form that writer can produce — or be replaced
with parse→mutate→serialize. If another ad-hoc frontmatter editor appears,
prefer the latter.
