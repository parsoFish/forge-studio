---
title: Unifier overloaded when per-WI gates don't enforce migration checklist items
description: Servicehook migration ran 4 unifier passes ($11.95 total, exceeding dev-loop $8.87) because checklist items (validator parity, dead-file deletion) not enforced at WI gates were deferred to the unifier. Unifier cost > dev-loop cost is a signal that WI ACs are missing checklist coverage.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook` (terraform-provider-betterado, servicehook migration).

Dev-loop: 6 WIs, $8.87 total, all passed in 1–3 gate iterations.
Unifier: 4 passes (UWI-2, UWI-4 × 3), $11.95 total. UWI-4 pass 2 alone cost $6.47.

The large UWI-4 remediation pass likely addressed:
- **Checklist clause 3b** — dead SDKv2 files not deleted (the dev-loop "deregistered from provider.go" but did not delete the old resource/test files)
- **Checklist clause 4** — validator parity (`ValidateFunc`→`Validators:`) missed by the dev-loop because no WI AC explicitly required it

Both of these have been caught by the reviewer in prior cycles (PR #46, PR #48 per profile.md). The unifier is the backstop, but at $6.47/pass it's expensive.

## The lever

Per the `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas` antipattern: the PM must embed the checklist clauses directly into per-WI ACs. Specifically:
- WI migrating a resource: AC must include "SDKv2 source files (`resource_X.go`, `resource_X_test.go`, shared helpers no longer used) are DELETED in this WI (clause 3b)"
- WI migrating a resource: AC must include "every `ValidateFunc`/`ValidateDiagFunc` maps to a `Validators:` entry; every `ForceNew` maps to `RequiresReplace` (clause 4)"

When these are explicit ACs with concrete file names, the dev-loop's quality-gate-pass requires them. When they're only in `profile.md`, they're invisible to the dev-loop.

## Diagnostic signal

**Unifier cost > dev-loop cost** is the quantitative flag that checklist items are being deferred. Track this ratio per migration initiative. A healthy ratio is unifier ≈ 0.3–0.5× dev-loop for a clean migration.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook/events.jsonl` (ralph.end cost events, unifier.end cost events)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook.md`
- `brain/projects/terraform-provider-betterado/profile.md` (Framework migration checklist clauses 3b, 4)
