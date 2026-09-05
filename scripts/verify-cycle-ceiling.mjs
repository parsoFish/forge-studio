/**
 * verify-cycle-ceiling.mjs — what `--cost-ceiling` means, and how it reaches the run.
 * Bead forge-8vfn.6.10.23.
 *
 * `--cost-ceiling` used to be a POST-HOC gate assertion only: `verify-cycle.mjs`
 * summed the run's cost afterwards and pushed a `pass: totalCost <= COST_CEILING`
 * check. The flag never entered the spawned `forge serve` process, so the ceiling
 * the CostTracker enforced was whatever the manifest derived — during G2 that was
 * $58 against an authorised $20, and the flag reported an overspend it had no
 * power to prevent.
 *
 * An EXPLICIT flag now also binds the run, by the same env var the product
 * already resolves first (`FORGE_COST_CEILING_USD` →
 * `resolveCostCeilingOverride`, `packages/flows/cycle.ts`). The harness's own
 * DEFAULT deliberately does not: env beats the manifest, so threading a default
 * nobody typed would silently override an operator's `cost_ceiling_usd`.
 *
 * Pure function of argv so the decision is testable without a funded run
 * (§15.163); nothing here reads cwd or the environment.
 */

/**
 * @param {string[]} argv                 the harness's argv (flags only; no node/script prefix required)
 * @param {number} defaultCeilingUsd      the ceiling the post-run gate asserts when no flag is given
 * @returns {{ ceilingUsd: number, bound: boolean, env: Record<string, string> }}
 *          `ceilingUsd` for the post-run assertion, `bound` = the run itself is
 *          held to it, `env` merged into the spawn env (empty when unbound).
 */
export function harnessCeilingEnv(argv, defaultCeilingUsd) {
  const i = argv.indexOf('--cost-ceiling');
  if (i < 0) return { ceilingUsd: defaultCeilingUsd, bound: false, env: {} };

  const raw = argv[i + 1];
  if (raw === undefined || raw.startsWith('--')) {
    throw new Error('--cost-ceiling needs a value in USD (e.g. --cost-ceiling 20)');
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    // Fail loud. A typo that fell back to the default would be this bead's own
    // defect wearing a different hat: a run bound by a ceiling nobody chose.
    throw new Error(`--cost-ceiling must be a positive number of USD, got "${raw}"`);
  }
  return { ceilingUsd: n, bound: true, env: { FORGE_COST_CEILING_USD: String(n) } };
}
