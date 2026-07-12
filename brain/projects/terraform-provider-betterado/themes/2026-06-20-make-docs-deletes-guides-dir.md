---
title: make docs deletes docs/guides/ — must restore manually
description: tfplugindocs generate wipes the entire docs/ tree including hand-written guides; git checkout -- docs/guides/ required after every docs run.
category: antipattern
keywords: [make-docs, tfplugindocs, docs-guides, git-checkout, guides-dir, docs-regeneration]
related_themes: [build-tooling-index]
created_at: 2026-06-20
updated_at: 2026-06-20
---

## Summary

`make docs` invokes `tfplugindocs generate --provider-name betterado`, which deletes and regenerates the entire `docs/` directory. This includes the hand-written `docs/guides/` files that are not auto-generated.

**Pattern observed:** Every WI that runs `make docs` must follow with `git checkout -- docs/guides/` to restore the guides. In this cycle the command was run twice (once per agent session — the crash reset forced a second session).

**Fix vector:** Add `git checkout -- docs/guides/` to the `make docs` target in `GNUmakefile` so it is automatic.

## Sources

- `_logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl` — seq 53 (first restore), seq 23 in crash-retry session (second restore)
- `/home/parso/forge/brain/cycles/_raw/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples.md`
