# Benchmarks — Brain

> Scores `brain-query` against a curated question set on two axes: a cheap deterministic rubric (every cycle) and a periodic Opus LLM-judge (validation).

## Suites

- **Primary** — `questions.json` (18 cases): does brain-query find the right themes and synthesise correctly?
- **Negatives** — `negatives.json` (10 cases): does brain-query correctly flag `gap: true` for out-of-scope / forge-adjacent-bait / partial-match questions, without hallucinating themes?
- **Judge** — `score-judged.ts`: pairs the primary metric with an Opus verdict ("would a forge engineer accept this answer?") to validate the deterministic rubric isn't drifting.

Run via:

```bash
npm run bench:brain              # primary
npm run bench:brain:negatives    # negatives
npm run bench:brain:judge        # Opus over the latest primary result
```

## Primary cases (`questions.json`)

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

## Primary scoring

Per case:

```
score = 0.4 * source_recall + 0.6 * keyword_match
hallucinated_path → score = 0
```

- **source_recall** — `|expected ∩ actual| / |expected|`. Recall, not F1: extras don't penalise (the May 2026 Opus-judge experiment showed F1 was over-penalising "minor issue, still pass" citations). Paths are normalised (lowercased, `brain/` prefix added if missing) before set ops. F1 is still computed and surfaced as `source_f1` for diagnostics.
- **keyword_match** — mean of per-keyword scores via a layered matcher:
  - Tier 1: full lowercased substring → 1.0 (preserves precision when terminology is echoed verbatim).
  - Tier 2: stemmed token overlap → 0.7 (all tokens present after a small Porter-style stemmer + stop-word filter) or 0.4 (≥ half present).
  - Tier 0: no signal → 0.
- **hallucinated path** — any cited path that doesn't exist on disk forces score = 0. Cheap, deterministic, catches the most damaging failure mode.

Maximum per-case score is 1.0 (full recall + full keyword match). Pass bar: `score >= 0.65`.

Aggregated as summary-only metrics:

- **accuracy** — fraction of cases above the pass bar.
- **gap_rate** — fraction of cases whose answer was marked `gap: true`. A signal that the brain has a hole, not a wrong answer.
- **hallucination_rate** — fraction of cases that cited a non-existent path. Should be ~0.
- **p95_ms** — 95th percentile of SDK-reported `duration_ms`.
- **total_cost_usd** — sum of per-case Haiku spend.

## Negatives scoring (`negatives.json`)

Different rubric — exercises the gap-detection success signal that the primary suite doesn't measure. See [`negatives-scoring.ts`](./negatives-scoring.ts).

- **out_of_scope** — pass = `gap: true` AND zero sources cited.
- **forge_adjacent_bait** — pass = `gap: true` AND ≤ 2 context citations (citing 1–2 themes for "we don't have X but we have Y" is acceptable; more is filling-the-gap with fiction).
- **partial_match** — pass = `gap: true` AND at least one of `must_include_any_of` cited AND total citations ≤ `max_sources`.
- **hallucinated path** → automatic 0 in any category.

Aggregate: per-category pass rate + overall hallucination rate.

## Judge (`score-judged.ts`)

Loads the latest primary result, runs Opus over each `(question, answer, cited-theme-content)` triple. Opus returns a structured verdict (pass/severity/reason/missing-concepts/hallucinated-claims). The runner reports:

- `metric_pass_rate` — what the deterministic rubric says.
- `judge_pass_rate` — what Opus says.
- `agreement_rate` — both methods agree pass/fail.
- `metric_only_fail` / `judge_only_fail` — disagreement direction.

The judge is the validation layer. It catches Q15-shape failures (claims unverifiable from cited content) that the deterministic rubric can't see, and conversely surfaces when the rubric is too harsh — both are signals to update the rubric or the brain content.

## Status

- ✅ Recall-weighted rubric, 88% agreement with Opus judge on the validation run (May 2026).
- ✅ Negatives suite with category-shaped rubric and hallucination check.
- ✅ Opus judge as the periodic validator, ~$5 / 18-case run.
- ✅ Parallel runner (concurrency 4), wall ~1 min per primary run.
- ✅ Brain navigation index (`forge brain index`) preloaded into the system prompt as a cache-friendly prefix; eliminates the per-call grep+read of the index files.
