# Fixture: slugifier-merged

A real merged cycle from the e2e bench (slugifier multi-feature initiative).
3 features → 6 work items, 1 round of reviewer send-back, then approve+merge.

## Why this fixture

This exercises the bench rubric's most important paths:

- **`themes_emitted`**: cycle has enough signal for ≥ 2 themes (clean
  decomposition + send-back lesson).
- **`themes_evidence_grounded`**: events.jsonl is the real shape from a
  full PM → dev-loop → review cycle, with concrete WI IDs / cost / duration
  fields the reflector can cite as evidence.
- **`theme_categories_balanced`**: the events.jsonl contains a
  `reviewer.verdict.send-back` entry → the rubric requires ≥ 1
  `category: antipattern` theme.
- **`brain_gaps_addressed`**: gaps file is empty → criterion auto-passes
  (this fixture is not the gap-stress test).

## Inputs (per the bench harness contract)

- `manifest.md` — closed manifest of the multi-feature slugifier initiative.
- `events.jsonl` — real e2e cycle log (35 entries: orchestrator + PM + dev-loop
  + reviewer; `reviewer.merged` near the end).
- `brain-gaps.jsonl` — empty.
- `merged-tree/` — small post-merge TS lib snapshot.
- `user-feedback.md` — canned simulator content addressing common reflector
  questions (AC-tightness rationale; send-back root cause).

## Expected output

- `_logs/<cycle-id>/retro.md` — three sections, populated.
- `brain/_raw/cycles/<cycle-id>.md` — archive with required frontmatter.
- `brain/projects/slugifier/themes/<date>-<slug>.md` × ≥ 2 — at least one
  pattern, at least one antipattern (because the events show a send-back).
