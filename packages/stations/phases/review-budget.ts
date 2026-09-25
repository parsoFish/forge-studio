/**
 * The review chunk's spend ceiling — ONE derivation, no logic anywhere else.
 *
 * Beads `forge-gefz` and `forge-jb7i`, operator ruling 475. Both turn on the
 * same measured fact, seen from two ends: THE WORK SCALES WITH THE DIFF AND
 * THE DECLARED BUDGET DOES NOT.
 *
 * ## What was measured, and where
 *
 * `adversarial-review` declares `budgets.maxBudgetUsd: 2.0` in its SKILL.md.
 * On G2 resume 4 a single work item's review of `scripts/gates/gap-registry-wi3.sh`
 * cost **$2.7056** against that 2.0, and a separate spawn measured **$2.7216**
 * — 35 % and 36 % over. Both completed the work; neither respected the number.
 *
 * ## `jb7i`: a declared per-spawn budget is a REQUEST, not a guarantee
 *
 * Forge has two budget enforcements and only one of them is real:
 *
 *   - WITHIN a spawn, `options.maxBudgetUsd` is handed to the SDK and the SDK
 *     alone decides — measured 36 % over.
 *   - BETWEEN work items, `CostTracker` compares ACTUAL `spentUsd` to the
 *     ceiling. That one holds, because it is arithmetic over money already
 *     spent.
 *
 * So any bound computed from a declared budget is computed over a number
 * nothing guarantees, and must assume overshoot. That is what
 * `OVERSHOOT_ALLOWANCE` is: not slack, and not permission to spend more — an
 * honest restatement of what the declared figure has been measured to mean.
 *
 * ## `gefz`: the split has a floor, and a file cannot be cut
 *
 * `adversarial-review` re-reviews a budget-killed chunk one file at a time,
 * but only `if (chunk.files.length > 1)`. A chunk that is already ONE file has
 * no smaller cut, so it fails `budget-exhausted` and stops. A work item can be
 * cut to its files; a file cannot be cut.
 *
 * Ruling 290 forbids the fourth answer ("raise the budget"), and hunk-level
 * splitting was refused in the proposal: a hunk review cannot judge whether a
 * change is coherent, belongs to its work item, or meets its criteria. It
 * would buy headroom by making the review worth less.
 *
 * So the ceiling is DERIVED from the size of the change under review, bounded
 * by a per-class maximum the operator owns (`CLASS_PROFILES[...].reviewCeilingUsd`).
 * The declared budget stops being a flat number and becomes a FLOOR and a
 * SHAPE. Nothing here becomes unbounded: the class maximum is the wall, and
 * `adversarial-review` fails LOUD against it rather than silently spending past
 * it.
 *
 * ## ONE ceiling per INITIATIVE, not per chunk (operator ruling 526)
 *
 * The first build of this derived a ceiling per chunk, from each chunk's own
 * diff. That broke a rule: ruling 290 pins that every chunk's spawn carries a
 * BYTE-IDENTICAL option bag — same tool set, same fence, same turn cap — and
 * `adversarial-review-spawn-capture.test.ts` enforces it with the words "a
 * chunk reviewed under different options is a second, weaker reviewer". A
 * per-chunk budget makes those bags differ by construction, and the assertion
 * fired.
 *
 * Narrowing that invariant to exclude the budget was the other option and was
 * REFUSED: a lane reinterpreting a ruling to make its own change pass is
 * setting policy under cover of a bug fix. So the ceiling is derived ONCE from
 * the whole initiative's change size and handed to every chunk unchanged.
 *
 * gefz is still fixed: the single file that could not be cut gets a ceiling
 * that rose with the initiative it belongs to. The trade is that a small chunk
 * inside a large initiative carries more room than it will use — which costs
 * nothing, because `CostTracker` bounds ACTUAL spend between work items and a
 * ceiling is not a spend.
 *
 * ## This module decides nothing else
 *
 * It is pure arithmetic over four numbers and holds no policy of its own: the
 * declared budget is the agent's, the class maximum is the operator's, and the
 * diff is the cycle's.
 */

/**
 * How far past a declared per-spawn budget a spawn is ASSUMED to go.
 *
 * 0.4 against a measured 0.35/0.36 — rounded up, because a bound that only
 * just covers the worst case yet seen is a bound that fails on the next one.
 * This is applied to the FLOOR, so the smallest possible derived ceiling
 * already admits what the SDK actually does.
 */
export const OVERSHOOT_ALLOWANCE = 0.4;

/**
 * Changed lines per doubling-ish step of the ceiling. 400 is the operator's
 * starting value under 475: a 400-line initiative gets twice the floor, a
 * 1,200-line one four times it, and the class maximum stops the curve.
 */
export const CEILING_SCALE_LINES = 400;

/**
 * Changed lines across a whole `git diff --numstat` — added + deleted, summed
 * over every file.
 *
 * `--numstat` rather than counting `+`/`-` in a unified patch: the patch would
 * have to be materialised and walked, its `+++`/`---` file headers counted file
 * COUNT as change SIZE, and the whole-initiative patch is exactly the file bead
 * `forge-8vfn.6.10.24` stopped writing. `numstat` is one git call and three
 * fields per line.
 *
 * A binary file's counts are `-\t-\t<path>`; those rows contribute 0 rather
 * than throwing, because a binary blob is not review work an agent reads.
 */
export function changedLinesFromNumstat(numstat: string): number {
  let n = 0;
  for (const line of numstat.split('\n')) {
    if (line.trim() === '') continue;
    const [added, deleted] = line.split('\t');
    n += (Number.parseInt(added ?? '', 10) || 0) + (Number.parseInt(deleted ?? '', 10) || 0);
  }
  return n;
}

/**
 * The ceiling every chunk of this initiative's review may reach, in dollars.
 *
 * `declaredUsd` is the agent's own `budgets.maxBudgetUsd` (its floor, after
 * the overshoot allowance); `changedLines` is the WHOLE initiative's change
 * size, not one chunk's (ruling 526); `classMax` is the operator's wall for
 * this change class. Returns `undefined` only when the agent declared no flat
 * budget at all — the caller then leaves the existing resolution alone rather
 * than inventing a number.
 */
export function reviewCeilingUsd(
  declaredUsd: number | undefined,
  changedLines: number,
  classMax: number,
): number | undefined {
  if (declaredUsd === undefined) return undefined;
  const floor = declaredUsd * (1 + OVERSHOOT_ALLOWANCE);
  const scaled = floor * (1 + changedLines / CEILING_SCALE_LINES);
  return Math.min(Math.max(floor, scaled), classMax);
}
