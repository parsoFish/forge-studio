---
title: Docs-only WI gate must verify docs, not reuse a code-test gate
description: WI-4 (docs + examples) ran Go unit tests as its quality_gate_cmd — gate passed because prior WIs' tests were green, but zero doc files were verified.
category: antipattern
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Antipattern

WI-4 in INIT-2026-06-05-release-data-sources targeted docs + example HCL files only (`files_in_scope`: `docs/data-sources/betterado_release_definition*.md`, `examples/data-sources/...`). Its PM-assigned `quality_gate_cmd` was:

```
go test -mod=vendor -tags all -count=1 -run TestDataReleaseDefinition ./azuredevops/internal/service/release/
```

That gate passed at iteration 1 because WI-1/WI-2's unit tests were green. It did **not** verify:
- doc files actually existed
- HCL in examples was parseable (`terrafmt check`)
- required frontmatter in `.md` templates was present

Gate fired `required-paths-missing` at iter-0 (correct; docs didn't exist yet), then passed at iter-1 after the agent wrote the files — but without structural validation of those files.

## Correct gate for a docs-only WI

```bash
# file existence check + terrafmt
test -f docs/data-sources/betterado_release_definition.md && \
test -f docs/data-sources/betterado_release_definitions.md && \
terraform fmt -check examples/data-sources/betterado_release_definition/main.tf && \
terraform fmt -check examples/data-sources/betterado_release_definitions/main.tf
```

Or use `creates:` enforcement (already in the gate) + a `terrafmt-check` step. A Go test gate on a docs WI is a category error.

## Rule

> PM must assign a gate that exercises the WI's own `files_in_scope`. A code-test gate on a docs WI always passes vacuously once sibling tests pass.

## Sources

- `_logs/2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources/events.jsonl` (WI-4 gate events, `gate.expected-fail` at iter-0, `gate.pass` at iter-1)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources.md`
