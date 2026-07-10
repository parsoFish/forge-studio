---
title: terrafmt omitted from agent's offline self-check — caught late at CI gate
description: The ralph dev-loop agent's ad-hoc offline pre-gate check chain (go build, go vet, gofmt -l) consistently omits ./scripts/terrafmt.sh; terrafmt failures in HCL blocks inside acceptance test files are caught at gate time or at the CI gate, not by the agent's own pass.
category: antipattern
created_at: 2026-07-10T10:30:00.000Z
updated_at: 2026-07-10T10:30:00.000Z
---

## Pattern

When the ralph agent prepares to commit, it self-applies offline checks:
1. `go build ./...` (or package-scoped)
2. `go vet ./...`
3. `gofmt -l <file>`

It does NOT run `./scripts/terrafmt.sh` (or `make terrafmt-check`). HCL formatting inside Go test files (`resource.TestStep{Config: ...}`) is not caught by gofmt. The terrafmt check runs only when explicitly included in `make test` or when the agent makes a separate call.

## Evidence across cycles

- 2026-06-06: first noted in docs-only WI gate mismatch
- 2026-06-17: WI-3 gate.fail × 4 on ConfigMode:Attr initiative — terrafmt on HCL fixtures
- 2026-06-18 (this cycle): WI-5 iter 1 did not run terrafmt; iter 2 the agent ran `./scripts/terrafmt.sh` explicitly after orientation

## Fix options

Option A: The WI spec's `quality_gate_cmd` for any WI touching HCL-in-Go files should include terrafmt. Currently it points at `go test` only.

Option B: The ralph SKILL.md offline self-check section should mention terrafmt as mandatory when editing `*_test.go` files containing HCL template strings.

Option C: Add `terrafmt` to the acceptance test file's CI-equivalent check list in `.forge/project.json` `standing_work_item_acs`.

## Sources

- `_logs/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps/events.jsonl` (WI-5 08:33:53 `./scripts/terrafmt.sh 2>&1 | tail -20` call in iter 2, not iter 1)
- `/home/parso/forge/brain/cycles/_raw/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps.md`
