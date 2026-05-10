# Fixture: send-back-loop-bash

A hand-fabricated cycle for the simplarr (bash CLI) project where the
reviewer issued **two** send-back rounds before approving — exercising the
iteration cap and the antipattern requirement.

## Why this fixture

Stresses two specific rubric paths:

- **Cross-project theme path resolution**: themes must land under
  `brain/projects/simplarr/themes/`, not the default `slugifier/themes/`.
  This validates the SDK harness's brain-layering (the `simplarr/themes/`
  directory is the masked-fresh dir for this fixture).
- **Antipattern requirement under multi-send-back**: events.jsonl contains
  TWO `reviewer.verdict.send-back` entries → the rubric's
  `theme_categories_balanced` criterion requires ≥ 1 theme with
  `category: antipattern`.

## Inputs

- `manifest.md` — closed manifest for the simplarr `--dry-run` initiative.
- `events.jsonl` — hand-fabricated 14-line trace ending with
  `reviewer.merged` after 2 send-backs and an approve.
- `brain-gaps.jsonl` — empty.
- `merged-tree/` — bash + bats merged snapshot.
- `user-feedback.md` — canned simulator content explaining the two
  send-back root causes (missing demo assertion + missing demo regeneration).

## Expected output

- ≥ 1 theme under `brain/projects/simplarr/themes/`.
- ≥ 1 theme with `category: antipattern` (the two-send-back lesson).
- Retro doc + cycle archive at the standard paths.
