---
title: "make docs deletes docs/guides/ — must restore after tfplugindocs generate"
description: "tfplugindocs generate clears the entire docs/ output directory including hand-written docs/guides/; GNUmakefile must restore guides after generation."
category: pattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

## Context

`tfplugindocs generate` outputs all generated docs to `docs/`. By design it removes stale files — including `docs/guides/`, which contains hand-written (non-generated) provider guides.

## Problem

After running `make docs`, the `docs/guides/` directory is deleted. Committing at that point silently removes all hand-written guides from the repo.

## Fix

Append a restore step to the `docs` target in `GNUmakefile`:

```makefile
docs:
    tfplugindocs generate
    git checkout -- docs/guides/
```

This restores the guides from HEAD immediately after generation, so subsequent `git diff` shows only the generated changes.

## Invariant

Before merging any commit that runs `make docs`, verify `docs/guides/` is present and unmodified (or intentionally changed). `git status` should show no unexpected deletions in `docs/guides/`.

## Sources

- `_logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl` — WI-1 iteration metadata (`input_summary: make docs 2>&1; echo "Exit: $?"`, `GNUmakefile` in output_refs)
- `/home/parso/forge/brain/cycles/_raw/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples.md`
