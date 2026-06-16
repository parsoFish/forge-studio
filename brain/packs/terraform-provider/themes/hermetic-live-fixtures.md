---
title: Hermetic live fixtures — non-default values + read-back
description: Live acceptance tests must use non-default field values and assert via a separate API GET, or server-side field discards pass silently.
category: pattern
created_at: '2026-06-16'
updated_at: '2026-06-16'
---

# Hermetic live fixtures

Default values make a live gate blind: the server accepts the request but ignores a
field, the field reads back as its default, the default equals the asserted value —
a false pass. Two ADO fields (`VS402982` stage retention, `VS402877` pre/post
approvals) were silent discards invisible to a default-value fixture.

Rules for every live acceptance test:

- **Non-default values for every field under test.** Strings: a sentinel like
  `"test-sentinel-abc123"`, never `""` or `"test"`. Booleans: assert both states.
- **UUID-prefixed resource names** (`RandomWithPrefix`) so parallel runs never collide.
- **Read-back assertion:** after create/update, a *separate* GET verifies the stored
  state — `resource.TestCheckResourceAttr` on exact values, not `…AttrSet`.
- **Idempotency:** a `PlanOnly` step with `ExpectNonEmptyPlan: false`; and
  `ImportStateVerify: true` to re-import from the live API and diff.
- **Self-cleaning:** `defer terraform.Destroy` / `CheckDestroy` runs on success AND
  failure. Orphan sweep by name-prefix as a fallback.
- **Creds via `secrets.env`** loaded in `PreCheck` (walk up to repo root); a missing
  var is `t.Fatal` naming the canonical var, never a skip (a skip is a false pass).

## Sources

- betterado `SharedReleaseFixture` (canonical ADO validity constraints in one place).
- Contract clause C9; HashiCorp acceptance-testing + Terratest patterns.
