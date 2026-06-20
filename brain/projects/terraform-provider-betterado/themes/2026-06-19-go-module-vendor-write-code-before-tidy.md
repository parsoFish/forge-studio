---
title: go mod tidy removes imports not yet referenced — write code before tidying
description: In vendor-mode Go modules, running go mod tidy before writing the importing code drops the new deps; the correct order is write code → go get → go mod tidy → go mod vendor.
category: pattern
created_at: 2026-06-19T00:00:00.000Z
updated_at: 2026-06-19T00:00:00.000Z
---

## Pattern

When adding new Go dependencies to a vendor-mode module:

1. **Write the Go source file that imports the new packages first.**
2. Run `go get <pkg>@<version>`.
3. Run `go mod tidy`.
4. Run `go mod vendor`.

**Anti-order (what happened in this cycle, self-corrected):**
- `go get github.com/hashicorp/terraform-plugin-framework@latest`
- `go mod tidy` → removes the dep because no file imports it yet.
- `go mod vendor` → framework absent.
- Developer must `go get` again after writing the code.

`go mod tidy` prunes any package that has no Go import pointing to it. In a vendor workflow this means round-tripping the internet-fetch twice. The correct order avoids the wasted step.

The agent caught this at seq 70 (WI-1, iteration 0) with reasoning: "The strategy is to write the code FIRST, then tidy."

## Sources

- `_logs/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint/events.jsonl` (EV_mqkjyz1q reasoning at seq 70; seq 96 re-get; seq 98 tidy post-code; seq 100 confirmed direct deps)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint.md`
