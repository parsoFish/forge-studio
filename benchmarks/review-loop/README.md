# Benchmarks — Review Loop

> Scores the reviewer skill's review-prep output: PR description quality, demo correctness.

## Cases

`prs/<n>/`:
- `branch-state/` — initiative branch fixture (working tree to be reviewed).
- `expected.json`:

```json
{
  "demo_must_run": true,
  "pr_description_must_explain_why": true,
  "pr_must_include_demo_link": true,
  "approved_on_first_pass": true
}
```

## Scoring

- Demo script runs without manual intervention.
- PR description includes a "Why" section, not just a "What".
- PR description links to the demo.
- For an automated approval signal: a small ruleset (Github Actions or similar) approves if all the above hold; otherwise a "send-back" verdict is recorded.

## Status

⏳ Wired but empty.
