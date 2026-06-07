# Archived themes

Distilled theme pages retired from the active sub-wikis (`forge-dev/themes/`,
`cycles/themes/`) during the **2026-06-07 simplification pass**, when the brain
was reconciled to reflect forge **as-is** rather than the full history of every
arc. They are kept here (not deleted) so the lessons stay retrievable; they are
**out of lint/index scope** (`forge brain lint` only scans the two active
`themes/` dirs) and are no longer wikilink targets.

## Archived (6) — superseded / point-in-time snapshots

| Theme | Why retired | Live successor |
|---|---|---|
| `chained-phase-benchmarks` | synthetic per-phase benches were removed 2026-05-25 | [ADR 022](../../../docs/decisions/022-real-capability-harness.md) · `real-capability-harness` |
| `phase-isolation-benchmarks` | same bench removal | `real-capability-harness` · `eval-driven-development` |
| `review-phase-target-design` | PR-as-review-window design superseded by in-UI review | [ADR 021](../../../docs/decisions/021-local-review-and-unified-demo.md) / [ADR 023](../../../docs/decisions/023-ui-sole-operator-surface.md) |
| `pr-as-sole-review-window` | review moved into the `/review` UI screen | ADR 021 / 023 |
| `forge-current-architecture-as-built` | point-in-time snapshot; as-is now lives in the living docs | `ARCHITECTURE.md` |
| `2026-05-30-ui-validation-run-fixes` | per-defect run notes; contracts folded into the project contract | `docs/forge-project-contract.md` |

## Consolidated (3) — merged into a surviving theme

| Source | Merged into |
|---|---|
| `brain-first-research` | `forge-dev/themes/brain-read-policy.md` (which supersedes the "every skill reads first" mandate) |
| `human-interaction-via-own-session` | `forge-dev/themes/six-phases-of-forge.md` (the three-human-moments invariant) |
| `2026-05-31-quality-gate-cmd-not-in-report` | `cycles/themes/quality-gate-cmd-must-assert-new-work.md` (open gap also tracked in `docs/known-gaps.md`) |
