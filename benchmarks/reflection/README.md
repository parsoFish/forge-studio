# Benchmarks — Reflection

> Scores the reflector skill's brain-ingest deltas against expected outputs for fixture cycles.

## Cases

`cycles/<n>/`:
- `events.jsonl` — fixture event log.
- `expected.json`:

```json
{
  "expected_new_themes": ["theme-slug-1", "theme-slug-2"],
  "expected_new_antipatterns": ["slug-3"],
  "must_resolve_brain_gaps": ["gap-id-1"],
  "lint_must_be_clean": true
}
```

## Scoring

- New theme pages match expected slugs.
- New antipatterns indexed correctly.
- Brain gaps from the cycle log are addressed (filled or escalated).
- Brain-lint passes after the ingest.
- Retro doc structure (3 sections: self-reflection, user questions, user feedback) present.

## Status

⏳ Wired but empty.
