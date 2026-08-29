/**
 * spend.mjs — the story spend gate (park point H2).
 *
 * Stories run REAL spawns. They never set `FORGE_ARCHITECT_NO_SPAWN` (1.0.md
 * §3.1), so this gate is the only thing between `npm run stories` and the
 * operator's money.
 *
 * It is pure, and the runner evaluates it BEFORE any lock, bridge or browser
 * work, so a refusal costs nothing. Two independent declarations mean money —
 * `realSpawn` and a non-zero `budget_usd` — and either one alone is enough to
 * require approval. A story declaring a spawn at a zero budget is
 * mis-declared, and the safe reading of a mis-declared story is that it spends.
 */

/**
 * @param {{realSpawn: boolean, budget_usd: number}} ground
 * @param {{approveSpend?: boolean}} [flags]
 * @returns {Readonly<{allowed: boolean, reason: string}>}
 */
export function spendGateVerdict(ground, { approveSpend = false } = {}) {
  const costs = ground.realSpawn === true || ground.budget_usd > 0;

  if (!costs) {
    return Object.freeze({ allowed: true, reason: 'costless story — no real spawn, no budget' });
  }
  if (approveSpend) {
    return Object.freeze({
      allowed: true,
      reason: `spend approved by --approve-spend; ceiling $${ground.budget_usd}`,
    });
  }
  return Object.freeze({
    allowed: false,
    reason:
      `this story spends: realSpawn=${ground.realSpawn}, ceiling $${ground.budget_usd}. ` +
      'Re-run with --approve-spend to authorise it.',
  });
}
