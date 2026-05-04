# Benchmarks — Project Manager

> Scores the project-manager skill's work-item decomposition.

## Cases

`initiatives.json` — array of:

```json
{
  "id": "I1",
  "initiative_manifest": "fixtures/init-1.md",
  "expected": {
    "min_work_items": 3,
    "max_work_items": 12,
    "every_item_has_acceptance_criteria": true,
    "every_item_lists_files_in_scope": true,
    "parallel_fraction_at_least": 0.3,
    "no_hidden_file_coupling": true
  }
}
```

## Scoring

- Work-item count in expected range.
- All items have Given-When-Then criteria.
- All items list `files_in_scope`.
- ≥30% of items can run in parallel (no edge between them in the dep graph).
- No two items in scope-conflict (touching the same file but not declared dependent).
- Brain-query was the first logged event.

## Status

⏳ Wired but empty. Cases land alongside PM skill implementation.
