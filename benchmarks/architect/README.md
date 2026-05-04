# Benchmarks — Architect

> Scores the architect skill's initiative output structure against expected shapes.

## Cases

`prompts.json` — array of:

```json
{
  "id": "P1",
  "user_prompt": "I want to add OAuth login to simplarr",
  "project": "simplarr",
  "expected": {
    "initiative_count": 1,
    "min_features": 2,
    "max_features": 6,
    "dependency_depth_at_least": 1,
    "every_feature_has_acceptance_criteria": true,
    "council_escalations_at_most": 3
  }
}
```

## Scoring

- Initiative count matches.
- Feature count in expected range.
- Dependency depth ≥ expected.
- Every feature has at least one Given-When-Then criterion.
- Council escalations ≤ expected (the council should resolve most things mechanically).
- Brain-query was the first event in the log.

Composite score: weighted sum of the above.

## Status

⏳ Wired but empty. Cases land alongside architect skill implementation.
