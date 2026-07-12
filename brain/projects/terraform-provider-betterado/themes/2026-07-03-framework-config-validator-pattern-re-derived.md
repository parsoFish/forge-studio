---
title: Framework config-validator pattern re-derived by unifier each migration cycle
description: The terraform-plugin-framework config-validator API (ConflictsWith/RequiredWith/ExactlyOneOf equivalents) is re-explored from vendor/ each time, adding ~8 bash calls per run; the pattern should be recorded in profile.md or WI spec ACs.
category: antipattern
keywords: [config-validator, configvalidators, conflictswith, requiredwith, resourcevalidator, framework-validators, unifier]
related_themes: [framework-migration-index, ralph-brain-reads-index]
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement`, unifier run UWI-2.

The unifier needed to wire `ConflictsWith`/`RequiredWith` (SDKv2) into framework `ConfigValidators`. It did not know the framework API and explored:
1. `find vendor -path "*/terraform-plugin-framework/resource/schema/validator*" -name "*.go"`
2. `cat vendor/.../resource/config_validator.go`
3. `find vendor -path "*/terraform-plugin-framework/resource/schema/validator*" -o -path "*/terraform-plugin-framework-validators*"`
4. `ls vendor/github.com/hashicorp/`
5. `ls vendor/.../terraform-plugin-framework/resource/`
6. `cat vendor/.../resource/validate_config.go`
7. Additional grep calls

~8 bash calls before discovering that `resource.ConfigValidator` is the correct interface and `terraform-plugin-framework-validators` is vendored.

This is the same class of vendor re-exploration documented in `2026-07-03-inline-plan-modifier-pattern-re-derived-per-wi.md` (build cycle), but for a different API surface (config validators vs plan modifiers).

## The correct pattern (discovered in this cycle)

Framework config validators for `ConflictsWith`/`RequiredWith`/`ExactlyOneOf`:
```go
// In ConfigValidators() []resource.ConfigValidator:
resourcevalidator.Conflicting(
    path.MatchRoot("field_a"),
    path.MatchRoot("field_b"),
)
resourcevalidator.ExactlyOneOf(
    path.MatchRoot("field_a"),
    path.MatchRoot("field_b"),
)
```
From `vendor/github.com/hashicorp/terraform-plugin-framework-validators/resourcevalidator/`.

For per-attribute validators, use `terraform-plugin-framework-validators/stringvalidator`, `int64validator`, etc.

## Fix

1. Add this pattern to `profile.md` under "Framework migration per-resource checklist" (clause 4 on validator parity) with the concrete package path and example.
2. PM should embed the pattern in migration WI specs as a NOTE (same approach as inline plan-modifier fix in `2026-07-03-inline-plan-modifier-pattern-re-derived-per-wi.md`).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement/events.jsonl` (UWI-2 tool sequence: `find vendor -path "*/terraform-plugin-framework/resource/schema/validator*"`, `cat vendor/.../config_validator.go` at ~2026-07-03T03:56:43–57:04)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement.md`
