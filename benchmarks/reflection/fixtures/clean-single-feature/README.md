# Fixture: clean-single-feature

Minimal clean cycle for the healarr project — single feature, single WI,
single iteration per phase, immediate approval. Reference baseline for
"what a healthy cycle looks like."

## Why this fixture

Stresses the floor of the rubric:

- **No send-backs / wedges / gaps**: the only failure modes are
  reflector-side (vague themes, missing evidence, bad frontmatter).
  Validates the rubric isn't accidentally requiring negative-path content.
- **Lowest min_themes (1)**: the simplest case still requires at least
  one captured pattern. Catches the "skipped reflection entirely" failure
  mode.

## Inputs

- `manifest.md` — single-feature healarr multipart-stub initiative.
- `events.jsonl` — 12-line trace, no errors, single approve.
- `brain-gaps.jsonl` — empty.
- `merged-tree/` — TS multipart stub.
- `user-feedback.md` — frames this as the reference healthy-cycle pattern.

## Expected output

- ≥ 1 theme under `brain/projects/healarr/themes/`.
- No antipattern requirement.
- Retro + cycle archive at standard paths.
