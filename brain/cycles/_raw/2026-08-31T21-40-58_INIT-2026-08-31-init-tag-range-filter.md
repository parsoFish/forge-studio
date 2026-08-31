---
source_type: cycle
source_url: _logs/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter/events.jsonl
source_title: Cycle 2026-08-31T21-40-58 — Initiative INIT-2026-08-31-init-tag-range-filter
cycle_id: 2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter
initiative_id: INIT-2026-08-31-init-tag-range-filter
project: gitpulse
ingested_at: 2026-08-31T22:30:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/projects/gitpulse/themes/2026-08-31-gitignored-scratch-eighth-cycle.md
  - brain/projects/gitpulse/themes/2026-08-31-tag-range-dead-code-ac4-wire.md
  - brain/projects/gitpulse/themes/2026-08-31-tag-range-filter-delivery.md
---

# Cycle 2026-08-31T21-40-58 — INIT-2026-08-31-init-tag-range-filter

## Summary

Added `--since-tag` / `--until-tag` global flags to gitpulse for exact release-window analytics. Both annotated and lightweight tags are resolved via `git rev-parse --verify <tag>^{commit}`. Filter applied at the git-truth seam so all aggregators (single-snapshot, `--compare`, tags, coupling) inherit transparently. New pure module `src/tag-range.ts` with `filterCommitsByTagRange` and `resolveEffectiveBounds`.

**3-WI TDD chain, all 3 complete in 1 iteration.** Delivery: 9 changed files, +1412/-15 lines, 11 commits. Merged as PR #14. Released as v0.13.0.

## Cycle mechanics

- **Architect:** ran out-of-cycle (session 2026-08-31T21-36-28-353a3ccf); event emitted at cycle start.
- **PM run 1:** $0.70, error — WI-3 missing `verification_artifact` (ADR-037 set-error). Cycle restarted.
- **PM run 2 (restart):** $0.70, success — 3 WIs emitted. `brainReads=0` (same as prior cycles).
- **WI-1** (pure module + git-seam): 1 iteration, $0.92, `ralph.uncommitted-work-swept` (fix_plan.md/AGENT.md).
- **WI-2** (CLI wiring + renderers): 1 iteration, $1.84, `ralph.uncommitted-work-swept`.
- **WI-3** (acceptance + docs): 1 iteration, $4.02, no sweep.
- **Adversarial review:** 4 findings — RF-1 major (resolveEffectiveBounds dead code in CLI, AC4 wire absent), RF-2 minor (tags argv strip bug), RF-3 minor (silent compare-path fallback), RF-4 info (--help to stderr). 0 blockers → PR opened.
- **Release:** v0.13.0 finalized ($0.34).

## Key events

- `_logs/2026-08-31T21-40-58_INIT-2026-08-31-init-tag-range-filter/events.jsonl`
- `_logs/INIT-2026-08-31-init-tag-range-filter/artifacts/review-findings.json`
