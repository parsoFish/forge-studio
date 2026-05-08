# Benchmarks — Architect

> Scores the architect skill's initiative manifest against expected shape and quality dimensions. Deterministic-input bench: each fixture supplies a fully-committed user intent (taste decisions baked in), and we score the artifact the architect emits.

## Cases

`prompts.json` — array of fixtures:

```json
{
  "id": "A1-oauth",
  "user_prompt": "Add Google OAuth login to simplarr's web companion. ...",
  "project": "simplarr",
  "expected": { "min_features": 2, "max_features": 5 }
}
```

Eight starter fixtures span project types: auth feature, refactor, CI setup, CLI command, performance fix, ORM migration, test scaffolding, docs site.

## Scoring

Pure functions in [`scoring.ts`](./scoring.ts); tests in [`scoring.test.ts`](./scoring.test.ts).

Four rubric criteria, each scored 0/1:

| Criterion | Weight | Source |
|-----------|--------|--------|
| `manifest_valid` | gate | `validateManifest()` from [`orchestrator/manifest.ts`](../../orchestrator/manifest.ts) — invalid manifest → total score 0 |
| `specs_concrete` | 0.4 | Body has `≥ feature_count` Given-When-Then triads or `## Acceptance` headings |
| `scope_right_sized` | 0.3 | `feature_count ∈ [expected.min_features, expected.max_features]` |
| `brain_consulted` | 0.3 | Body cites at least one `brain/...` path |

Pass threshold = **0.7** weighted score (matches the brain bench bar).

## Runtime

[`sdk.ts`](./sdk.ts) — wraps the Claude Agent SDK. Each fixture runs in its own tempdir with read-only symlinks to `brain/`, `skills/`, `docs/`, `orchestrator/`. Architect writes the manifest to `<tempdir>/_queue/pending/`. Bench reads it back, scores, and cleans up.

[`score.ts`](./score.ts) — entry point. `npm run bench:architect` runs all fixtures with bounded concurrency (4), enforces a session budget cap, and writes `results/<iso>.json`.

## Status

✅ Operational. Wired end-to-end against fixtures. Iteration on critic prompts and SKILL.md happens by re-running the bench and inspecting which criterion regressed.
