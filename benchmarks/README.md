# Benchmarks

> Per-phase eval harnesses. Each phase has its own suite at `benchmarks/<phase>/`. See [ADR 005](../docs/decisions/005-phase-isolation-with-benchmarks.md).

## Why

User principle 3: every phase needs sample-input → measurable-output benchmarks so a session focused on improving that phase can prove improvement *without* running a full cycle. Slow / expensive / noisy.

## Structure (per phase)

```
benchmarks/<phase>/
├── README.md                 # input format, scoring metric, how to add cases
├── score.ts                  # the runner — invokes the phase's skill(s) against fixtures and emits a JSON score
├── <fixtures>/               # the cases (format varies per phase)
└── results/                  # gitignored; per-run output
```

## Run a suite

```bash
npm run bench:brain
npm run bench:architect
npm run bench:project-manager
npm run bench:developer-loop
npm run bench:review-loop
npm run bench:reflection
```

Each `score.ts` is a `node --experimental-strip-types` script that prints a JSON object:

```json
{
  "phase": "brain",
  "ran_at": "...",
  "cases": [
    { "id": "Q1", "score": 1.0, "expected": "...", "actual": "...", "elapsed_ms": 230 }
  ],
  "summary": { "passed": 9, "failed": 1, "accuracy": 0.9, "p95_ms": 380 }
}
```

CI can run all suites; sessions run only the phase they're working on.

## Adding cases

1. Drop a fixture in the phase's directory (format documented in that phase's README).
2. Re-run the suite. The runner picks them up automatically.
3. Tune scoring weights in `score.ts` if the new case exposes a metric gap.

Reflection-discovered failures should become benchmark cases — that's how the suites compound across cycles.

## Scaffold status

- ✅ Harness wired for every phase (this README + `score.ts` stub each).
- ⏳ Cases are empty by design. They land as each phase is built (and as cycles surface real failures).
- ⏳ Reporting (HTML report, trends across runs) is a future improvement.
