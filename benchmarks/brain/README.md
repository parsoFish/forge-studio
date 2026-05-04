# Benchmarks — Brain

> Scores `brain-query` accuracy + latency + source-correctness against a curated question set.

## Cases

`questions.json` — array of:

```json
{
  "id": "Q1",
  "question": "What does forge use as the developer-loop runtime?",
  "expected_sources": ["brain/forge/themes/ralph-loop.md"],
  "expected_keywords": ["ralph", "claude agent sdk"],
  "scope": null,
  "category": null
}
```

## Scoring

- **source_match** (1.0 if all `expected_sources` cited; else partial).
- **keyword_match** (fraction of `expected_keywords` present in the answer).
- **latency** (p95 across all cases).
- **gap_rate** (fraction of cases that returned `gap: true`).

Composite score = `0.5 * source_match + 0.4 * keyword_match - 0.1 * gap_rate`.

## Status

- ⏳ Wired but empty. Pass A seeding adds ~10 questions; Pass B adds project-specific questions.
