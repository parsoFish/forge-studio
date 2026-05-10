# Benchmarks — Reflection

> Scores the reflector skill's brain theme writes + retro doc + cycle archive
> against expected deltas for fixture cycles.

## Status

✅ **5/5 fixtures passing at score 1.0.** First-run pass. Total spend
~$3.7/run; p95 cost $1.04, p95 elapsed 442s. See `results/` for per-run
JSON.

## Layout

```
benchmarks/reflection/
├─ cases.json              # fixture catalogue (5 cases)
├─ score.ts                # runner: per-fixture loop + aggregator
├─ scoring.ts              # pure rubric (5 gates + 6 weighted criteria)
├─ scoring.test.ts         # 41 unit tests
├─ sdk.ts                  # DI harness: tempdir + layered brain + simulator wiring
├─ sdk.test.ts             # 11 unit tests
├─ simulator.ts            # file-based user-feedback shim
├─ simulator.test.ts       # 11 unit tests
├─ fixtures/
│  ├─ slugifier-merged/        # real e2e cycle log; multi-feature, 1 send-back
│  ├─ send-back-loop-bash/     # bash CLI; 2 send-backs (cross-project test)
│  ├─ wedge-recovery/          # dev-loop wedge then fresh-context recovery
│  ├─ brain-gap-heavy/         # 4 brain-query gaps to address
│  └─ clean-single-feature/    # minimal clean cycle (baseline)
└─ results/                # per-run JSON output
```

Each fixture supplies:

- `manifest.md` — closed initiative manifest with frontmatter.
- `events.jsonl` — cycle event log (real or hand-fabricated).
- `brain-gaps.jsonl` — gap entries (may be empty).
- `merged-tree/` — post-merge project source snapshot (read-only inspection).
- `user-feedback.md` — simulator-canned user feedback (stage 3 input).
- `expected.json` — `{ project, min_themes, brain_gap_ids, notes }`.
- `README.md` — one-paragraph fixture rationale.

## Rubric

**Gates (binary; any 0 → score = 0):**

- `manifest_provided` — fixture's manifest exists at the declared path.
- `log_parseable` — events.jsonl loads as valid JSONL.
- `retro_emitted` — `_logs/<cycle-id>/retro.md` was written.
- `brain_consulted` — at least one brain read in tool-use telemetry.
- `no_brain_corruption` — every emitted theme has valid frontmatter + a
  valid `category` value + ≥ 1 resolvable evidence path.

**Weighted criteria (sum to 1.0; pass threshold 0.7):**

| Criterion | Weight | Check |
|---|---|---|
| `themes_emitted` | 0.25 | ≥ N theme files in `brain/projects/<project>/themes/` (N from `expected.min_themes`). |
| `themes_evidence_grounded` | 0.25 | Every theme's `## Sources` section lists ≥ 1 path that `existsSync` resolves to the cycle log or the cycle archive. **Orchestrator-verified, not heuristic.** |
| `theme_categories_balanced` | 0.10 | Every theme has a valid `category` frontmatter. If events.jsonl has any wedge or send-back, ≥ 1 theme must carry `category: antipattern`. |
| `cycle_archived` | 0.15 | `brain/_raw/cycles/<cycle-id>.md` written with required frontmatter. |
| `retro_three_sections` | 0.15 | `retro.md` contains `## Self-reflection` / `## User questions` / `## User feedback` (case-insensitive). |
| `brain_gaps_addressed` | 0.10 | Every gap-id in fixture's `brain-gaps.jsonl` referenced in retro.md or as a source in a new theme. Empty gaps list → auto-pass. |

## Running

```bash
npm run bench:reflection                              # standard run; cleans tempdirs
FORGE_BENCH_KEEP_TEMPDIR=1 npm run bench:reflection   # keep tempdirs for inspection
```

The session aborts at $8 USD total spend (`SESSION_BUDGET_USD`); each fixture
caps at $1.0–$1.5 (`max_cost_usd` per case in `cases.json`). Concurrency 2.

## Brain isolation

The bench symlinks the live `brain/` tree into the tempdir, then masks two
directories with fresh writable copies so the reflector's writes don't pollute
the live brain:

- `<tempdir>/brain/projects/<project>/themes/` (where new themes land).
- `<tempdir>/brain/_raw/cycles/` (where the cycle archive lands).

All other brain reads pass through the symlink to the live tree, so the
reflector sees real prior themes and a real navigation index.
