---
title: Framework migration silently drops SDKv2 validators — caught by review, not gate
description: Two independent initiatives (git PR #46, security-permissions PR #48) delivered framework resources with 0 of the SDKv2 IsUUID/StringIsNotWhiteSpace/OneOf validators; the per-WI live-acc gate does not enforce validator parity; the gap surfaces at review.
category: antipattern
keywords: [validator-parity, isuuid, stringisnotwhitespace, oneof, validators, framework-migration, gate-gap]
related_themes: [framework-migration-index, gate-mechanics-index]
created_at: 2026-07-04T00:00:00.000Z
updated_at: 2026-07-04T00:00:00.000Z
---

## Pattern observed

On PR #48 (INIT-2026-07-01-migrate-framework-security-permissions): 0 of 20 migrated framework resource files carried `Validators:` entries equivalent to the SDKv2 `ValidateFunc`/`ValidateDiagFunc` they replaced (IsUUID, StringIsNotWhiteSpace, OneOf enums). The same gap was caught at PR #46 in a prior initiative.

Operative evidence from `docs/investigations/2026-07-betterado-run-friction.md`:
> "framework migrations silently drop SDKv2 validators... security-permissions (PR #48 — 0 of 20 framework files carry Validators; SDKv2 had IsUUID/StringIsNotWhiteSpace throughout)"

User-feedback confirmation: "Minor divergence — validator parity was not achieved at first-pass merge; closed via send-back, not first-pass delivery."

## Why this happens

- The per-WI quality gate (`TestAccXxx` live run) verifies CRUD correctness but does NOT scan for missing validators.
- `make test` (offline suite) compiles and passes — framework accepts missing validators at compile time.
- `golangci-lint` does not flag missing Validators entries.
- Developer ralph derives validator mappings from scratch (brainReads=0); the mapping table is in `profile.md` clause 4 and `2026-07-01-framework-validators-library-adoption.md` but is not in the WI spec.

## Fix direction

Three levers (in decreasing enforcement strength):
1. **Embed the validator-parity checklist in every framework-migration WI spec** — the PM must paste the SDKv2→framework mapping table from profile.md clause 4 as an explicit AC: "Every attribute that had ValidateFunc/ValidateDiagFunc MUST carry a matching `Validators:` entry."
2. **Add a static grep check to the per-WI gate**: `grep -r 'ValidateFunc\|ValidateDiagFunc' <package>/ | grep -v '_test.go'` — if non-zero hits remain post-migration, the gate fails.
3. **Review send-back discipline** (current state) — works but burns a full review round per initiative.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions/user-feedback.md` (Q2 answer: "0 of 20 framework files carrying IsUUID/StringIsNotWhiteSpace validators")
- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions/retro.md` ("Validator parity (profile.md clause 4) re-derived per-WI")
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions.md`
- Profile.md clause 4 (framework migration checklist)
