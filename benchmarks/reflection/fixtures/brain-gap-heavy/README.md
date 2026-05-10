# Fixture: brain-gap-heavy

A clean cycle (no wedges, no send-backs) for the env-optimiser project,
designed to stress the `brain_gaps_addressed` criterion.

## Why this fixture

Stresses the brain-gap rubric path:

- **`brain_gaps_addressed`**: 4 gap-ids in `brain-gaps.jsonl` (logged
  during PM × 1, dev-loop × 2, reviewer × 1). The reflector must reference
  every gap-id either in `retro.md` or as evidence in a new theme.
  Empty-gaps fixtures auto-pass this; this fixture does not.
- **No wedge / send-back**: `theme_categories_balanced` auto-passes (no
  antipattern requirement). Frees the reflector to focus on
  knowledge-completion themes rather than failure-mode themes.

## Inputs

- `manifest.md` — closed manifest for the env-optimiser redact_argv
  initiative.
- `events.jsonl` — 16-line trace with three `*.brain-query` events
  (one per phase) carrying gap_ids in metadata.
- `brain-gaps.jsonl` — 4 distinct gap-id entries.
- `merged-tree/` — Python redactor module + tests.
- `user-feedback.md` — clusters the 4 gaps into theme suggestions.

## Expected output

- ≥ 2 themes under `brain/projects/env-optimiser/themes/`.
- Every gap-id in `brain-gaps.jsonl` referenced in `retro.md` or in a theme.
- No antipattern requirement (clean cycle).
