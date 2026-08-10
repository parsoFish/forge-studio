---
title: A per-scope status derived from a whole-scope check must read n/a, never a false pass
description: When a per-scope health status is computed from a check that only inspected some scopes, any scope the check never actually looked at must show 'n/a' — never 'pass'. A pass the check did not earn is a fabricated green. R6-08 project-KB checks reported pass while only scanning cycles/forge-dev; checkReflectorLoss is global; the fix drives per-check status off a registry-derived CHECK_NAMES to kill drift.
category: pattern
keywords:
  - per-kb-health
  - na-not-false-pass
  - honest-absent
  - scope-attribution
  - check-names-registry
  - registry-derived-status
  - whole-scope-check
  - drift
created_at: 2026-08-10
updated_at: 2026-08-10
related_themes:
  - derived-never-stored-run-model
  - declared-data-fails-open
  - journey-never-gate-on-async-lagging-ui-display
  - health-check-protocol
---

# Per-KB health must say n/a when the check never looked

A per-scope status tile is only as honest as the check behind each cell. When a whole-scope check is projected onto per-scope tiles, every scope the check **did not actually inspect** must render **`n/a`**, never `pass`. A green a check did not earn is a fabricated pass — the honest-absent rule ([[derived-never-stored-run-model]]) applied to health: absent evidence is `n/a`, **never a default-to-green**.

## Confirmed instance — R6-08

The kb-maintain surface projected forge-side checks onto **per-project-KB** tiles. Two mismatches produced false greens:

- **Scope the check never scanned.** Project-KB tiles reported `pass` from checks that only scan `cycles/` and `forge-dev/` — the project KB was never inspected, yet its cell showed a healthy pass. The correct value is `n/a`: this check does not apply to this scope.
- **A genuinely global check.** `checkReflectorLoss` is global, not per-scope; rendering it as a per-KB `pass`/`fail` implies a per-KB verdict it never computed.

## The invariant

For every (scope, check) cell:

- The check **inspected** this scope and passed → `pass`.
- The check **inspected** this scope and failed → `fail`.
- The check **did not inspect** this scope (out of scope, or global-only) → **`n/a`**.

Deriving `pass` for a cell the check skipped is the same class as [[declared-data-fails-open]]: a status surfaced without the evidence it claims.

## Kill the drift — registry-derive the check set

The per-check status must iterate a **registry-derived `CHECK_NAMES`**, not a hand-maintained list that silently diverges from the checks that actually run. When the lint check registry is the single source, a new or renamed check cannot leave a stale tile asserting a verdict for a check that no longer exists — the same single-derivation discipline as [[derived-never-stored-run-model]].

## Sources

- `_wave5/ledger.md` (gitignored campaign state) — R6-08 project-KB false-pass, `checkReflectorLoss` global, `CHECK_NAMES` registry derivation, batch D region.
- [`cli/brain-lint.ts`](../../../cli/brain-lint.ts) — the check registry the per-check status must derive from.

## See also

- [[journey-never-gate-on-async-lagging-ui-display]] — the R6-08 sibling: how to gate this status without flaking on render lag.
- [[health-check-protocol]] — the health-surface protocol this honesty rule extends.
