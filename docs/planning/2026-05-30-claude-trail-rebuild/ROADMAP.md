# claude-trail greenfield rebuild — 5-initiative roadmap

> The release-tier path of [ADR 022](../../decisions/022-real-capability-harness.md):
> reconstruct `claude-trail` from an empty repo, one forge cycle per initiative,
> each gated on a golden-file acceptance. Run when verifying forge against a
> major release. The routine tier (frozen-SHA, single initiative) draws from this
> same set — **these five initiatives double as forge's regression corpus.**

## Why a fixed decomposition

The original proposal
([`docs/planning/2026-05-24-claude-harness/PROPOSAL.md`](../2026-05-24-claude-harness/PROPOSAL.md))
treated the cycle breakdown as a *hypothesis* the architect's interview would
refine — and in practice it shipped across ~10 small cycles. For a **regression
harness** we want the opposite: a stable, minimal, fully-specified set so a
rebuild is reproducible and a golden diff is meaningful. This roadmap is
reconstructed from the real shipped artifacts
(`projects/claude-harness/src/`, the closed manifests at
`_queue/done/INIT-...-claude-trail-*.md`, and the reflection archives) and
collapses the real history into five clean, dependency-ordered initiatives —
each one a self-contained forge cycle with a binary acceptance.

Each initiative below is sized for a single cycle (≤ a handful of WIs), takes
**no runtime dependencies**, and is accepted by a **golden markdown file**
compared byte-for-byte (the one acceptance shape the project has used since
cycle 1). The harness runner asserts the real-cycle OUTCOMES from ADR 022
(reached PR/merge, dev-loop N/N complete, `npm test` green post-merge, golden
files present + matching, cost under ceiling) — never a synthetic rubric.

## Dependency order

```
1 scaffold + events rollup   (no deps)
        │
2 brain themes + git activity (dep: 1)
        │
3 cost rollup + PR metadata + verdict (dep: 2)
        │
4 machine-readable output (--format json / --out) (dep: 3)
        │
5 cross-cycle + query subcommands (--since, tail/stats/filter) (dep: 4)
```

Strictly linear: each initiative reads the artifact shape the previous one
established, so the release-tier rebuild must run them in order. The routine
tier can re-run any single one in isolation against its frozen base SHA.

---

## Initiative 1 — scaffold + events rollup

- **Slug:** `claude-trail-scaffold`
- **Deps:** none
- **Scope:** Package scaffold (`package.json`, `tsconfig.json`, `src/cli.ts`
  entry, `node --test --experimental-strip-types` runner). `claude-trail <id>`
  reads a frozen `events.jsonl` fixture, resolves the initiative to its cycle
  dir, and emits the **Title** + **Summary** (outcome + verdict + total) +
  **Phases** (chronological per-phase event rollup) sections.
- **Acceptance theme:** `claude-trail INIT-FIXTURE-1` stdout matches
  `tests/fixtures/INIT-FIXTURE-1.trail.golden.md` **byte-for-byte**. This is the
  whole bar — no flags, positional arg only.
- **Rough WI count:** 3 (cli + arg dispatch; trail composer; events reader +
  per-phase rollup).
- **Corpus anchor:** `_queue/done/INIT-2026-05-24-claude-trail-scaffold.md`,
  real source `src/cli.ts` / `src/trail.ts` / `src/events.ts`.

## Initiative 2 — brain themes + git activity sections

- **Slug:** `claude-trail-brain-git`
- **Deps:** 1
- **Scope:** Add the **Themes consulted** section (walk `brain/`, find themes
  mentioning the target initiative_id, list path + one-line summary) and the
  **Files touched / git activity** section (git log + `diff --name-only` across
  the cycle's commits, against the worktree path recorded on `cycle.start`).
- **Acceptance theme:** extended golden adds the two new sections; byte-for-byte
  against the frozen brain-slice + git-log-dump fixture.
- **Rough WI count:** 2 (`src/brain.ts` theme lookup; `src/git.ts` log + diff).
- **Corpus anchor:** `_queue/done/INIT-2026-05-25-claude-trail-git-enrich.md`,
  real source `src/brain.ts` / `src/git.ts`.

## Initiative 3 — cost rollup + PR metadata + verdict summary

- **Slug:** `claude-trail-cost-pr-verdict`
- **Deps:** 2
- **Scope:** **Cost** section (per-phase cost sum from the event log); **PR**
  section (reads `_pr-metadata.json`, **skips cleanly when absent** — no error,
  section omitted); **Verdict** summary line (outcome + approve/send-back).
- **Acceptance theme:** golden with cost + PR + verdict sections **and** a second
  golden proving graceful omission when `_pr-metadata.json` is missing.
- **Rough WI count:** 3 (cost rollup in `events.ts`; `src/pr.ts` reader;
  verdict summary line).
- **Corpus anchor:** `_queue/done/INIT-2026-05-25-claude-trail-cost-only.md` +
  `...-verdict-summary.md`, real source `src/pr.ts` + cost path in `events.ts`.

## Initiative 4 — machine-readable output

- **Slug:** `claude-trail-format-flag`
- **Deps:** 3
- **Scope:** `--format json` emits the same trail data as a JSON object;
  `--out <file>` writes to a file instead of stdout. **Default markdown output
  unchanged** (regression-guarded by the cycle-1/2/3 goldens).
- **Acceptance theme:** JSON golden carries the same fields as the markdown
  golden; the existing markdown goldens still pass unchanged (proves no
  regression of the default path).
- **Rough WI count:** 2 (json formatter; `--out` file writer + arg parsing).
- **Corpus anchor:** `_queue/done/INIT-2026-05-25-claude-trail-format-flag.md`,
  real source `src/filter-renderer.ts` / format paths.

## Initiative 5 — cross-cycle + query subcommands

- **Slug:** `claude-trail-cross-cycle`
- **Deps:** 4
- **Scope:** `--since <id>` aggregates the target plus preceding cycles
  (retry / send-back rounds) into one trail; plus query subcommands over a cycle
  dir — `tail` (recent events), `stats` (counts/cost aggregates), `filter`
  (by phase / status). Each is golden-tested.
- **Acceptance theme:** `--since` golden spanning multiple cycle dirs; per
  subcommand golden (`tail` / `stats` / `filter`) against the frozen multi-cycle
  fixture.
- **Rough WI count:** 4–5 (`--since` aggregation; `src/tail.ts`; `src/stats.ts`;
  `src/filter.ts` + the `filter-phase` / `filter-status` / `filter-renderer`
  matchers).
- **Corpus anchor:** `_queue/done/INIT-2026-05-25-claude-trail-since-flag.md` +
  the `verify-cascade` arc, real source `src/tail.ts` / `src/stats.ts` /
  `src/filter*.ts` / `src/probe.ts`.

---

## These initiatives ARE the regression corpus

Per ADR 022 the harness asserts real-cycle outcomes, and the cheapest way to do
that is to re-run a known-good cycle and diff its observable results:

- **Routine tier (frozen-SHA):** pick one initiative, reset `claude-harness` to
  the SHA *before* that initiative landed, re-run it, assert its golden + outcome
  set. Initiative 1 is the natural smoke test (scaffold-from-near-empty);
  initiative 5 is the heaviest single-initiative exercise.
- **Release tier (full greenfield):** run 1→5 from an empty repo. The linear
  dependency chain means a break in any earlier initiative's output shape will
  surface as a golden mismatch downstream — a built-in integration signal.
- **Corpus extension:** new `claude-trail` features become a 6th, 7th, …
  initiative with their own golden, growing the corpus without scope creep
  (the project's original "naturally grows" property).

## Open questions

- **Golden refresh discipline:** when forge *intentionally* changes a trail's
  shape, the goldens must be regenerated deliberately (an `update-goldens`
  path). The harness must distinguish "golden out of date because behaviour
  improved" from "golden mismatch because forge regressed" — the operator
  decides at the manual gate. Left to the runner-codification work on
  `scripts/verify-cycle.mjs`.
- **Base-SHA registry:** the routine tier needs a recorded base SHA per
  initiative. Where this lives (a small JSON in `projects/claude-harness/` vs.
  derived from the closed manifest's git boundary) is a runner-design choice,
  deferred to the same work.
