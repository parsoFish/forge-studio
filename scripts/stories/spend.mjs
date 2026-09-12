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

/**
 * What a run actually spent — bead `forge-8vfn.6.11.8`.
 *
 * Four H6 runs dispatched real agents and every one reported UNMEASURED.
 * Session 7 settled the class by measuring its opposite: three healthy
 * architect turns each priced themselves on their own `end` event ($0.3844,
 * $0.3870, $0.5358), while the ONE turn that hung was reaped mid-turn, wrote no
 * terminal event, and so had nothing to price. UNMEASURED was never a pricing
 * bug — it is the shape of a reaped turn.
 *
 * THE RULE THAT MATTERS IS THE NEGATIVE ONE. A run that DISPATCHED and produced
 * no priced event reports UNMEASURED with a reason, never `$0.00`: a zero
 * meaning "nothing was spent" and a zero meaning "nobody looked" must never
 * print the same, and this milestone has already paid for that confusion once.
 *
 * `usd` is `null` rather than `0` when unmeasured, so a caller cannot add it to
 * a total by accident.
 *
 * @param {{realSpawn: boolean, events: {event_id?: unknown, event_type?: string, cost_usd?: unknown}[][]}} run
 * @returns {Readonly<{measured: boolean, usd: number|null, label: string, priced: number}>}
 */
export function summariseRunSpend({ realSpawn, events = [] }) {
  // ONE PHASE IS COUNTED ONCE, AT THE HIGHER OF ITS TWO ACCOUNTS (bead
  // `forge-rzrs`, T1 867). A cycle channel records one ROLLED-UP row per phase
  // while that phase's own session directory records each turn — so the two
  // logs carry the same money under DIFFERENT `event_id`s. Measured on S10 run
  // 15: four architect turn rows summing $2.1916 in the session dir, one
  // $2.1916 rollup in the cycle log, and the project-manager's $0.6774 which
  // exists ONLY in the cycle log. Counting both logs gives $5.0606 for a run
  // that spent $2.8690; counting one gives $2.1916 and hides the PM.
  //
  // MAX, NOT "PREFER THE SESSION DIR": a session directory that logged only
  // some of a phase's turns would under-report, and a ceiling must over-report
  // before it under-reports. When the two accounts disagree, that disagreement
  // is a PRODUCT finding and is returned in `notes` rather than swallowed.
  //
  // A DIRECTORY IS A CYCLE LOG WHEN IT CARRIES MORE THAN ONE PHASE — measured,
  // not assumed: run 15's session dir held 98 rows all `architect`, its cycle
  // log held `orchestrator` + `architect` + `project-manager`. Rows with no
  // `phase` at all (the `_agent-*` shape) are keyed by their own log, because
  // nothing links them to a phase and collapsing them would under-report.
  const groups = new Map();
  events.forEach((log, logIndex) => {
    const rows = log ?? [];
    const phases = new Set(rows.map((e) => e?.phase).filter((p) => typeof p === 'string' && p !== ''));
    const isCycleLog = phases.size > 1;
    for (const e of rows) {
      const c = e?.cost_usd;
      // Only genuine, non-negative numbers. A string "0.50" is a shape the
      // event contract does not promise, and a negative is never a real spend.
      if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) continue;
      const phase = typeof e?.phase === 'string' && e.phase !== '' ? e.phase : null;
      const key = phase ?? `log:${logIndex}`;
      let g = groups.get(key);
      if (g === undefined) {
        g = { phase, parts: 0, partsCount: 0, rollup: 0, rollupCount: 0 };
        groups.set(key, g);
      }
      if (phase !== null && isCycleLog) {
        g.rollup += c;
        g.rollupCount += 1;
      } else {
        g.parts += c;
        g.partsCount += 1;
      }
    }
  });

  let priced = 0;
  let total = 0;
  const notes = [];
  for (const g of groups.values()) {
    const takeRollup = g.rollup > g.parts;
    total += takeRollup ? g.rollup : g.parts;
    priced += takeRollup ? g.rollupCount : g.partsCount;
    if (g.partsCount > 0 && g.rollupCount > 0 && g.parts !== g.rollup) {
      notes.push(
        `${g.phase}: aggregate $${g.rollup.toFixed(4)} \u2260 parts $${g.parts.toFixed(4)} — ` +
          'the cycle log and the phase\u2019s own session disagree about what it spent; the HIGHER is counted',
      );
    }
  }
  if (priced > 0) {
    return Object.freeze({ measured: true, usd: total, label: `$${total.toFixed(4)}`, priced, notes: Object.freeze(notes) });
  }
  if (realSpawn !== true) {
    return Object.freeze({ measured: true, usd: 0, label: '$0.0000 (costless story — nothing was dispatched)', priced: 0 });
  }
  return Object.freeze({
    measured: false,
    usd: null,
    label:
      'UNMEASURED — this run dispatched a real agent and no priced event reached its log. ' +
      'TWO causes produce this, and they need opposite responses — read the first spawn before choosing ' +
      '(§15.458): (a) the turn RAN and was reaped mid-hang, writing no terminal event ' +
      '(forge-8vfn.6.11.17) — its events.jsonl carries many lines and its pid was alive; ' +
      '(b) the turn NEVER STARTED — the SDK child exited non-zero within seconds, leaving ONE `start` ' +
      'line in events.jsonl and the reason in the session\'s stderr.log. ' +
      'DISCRIMINATOR: `wc -l <session>/events.jsonl` (one line = start-and-nothing) and stderr\'s exit ' +
      'code. A terms banner in stderr proves NOTHING either way — it appears in its advisory form on ' +
      'healthy runs and its blocking form on dead ones, one verb apart. ' +
      'This is NOT $0.00.',
    priced: 0,
  });
}

/**
 * Is a run over its declared ceiling? Bead `forge-8vfn.7.6.51`, T1 ruling 788.
 *
 * §15.449 — A CEILING IN A STRING IS A LABEL. Until this existed, `budget_usd`
 * appeared in exactly five places and not one of them compared it to anything
 * spent: `spendGateVerdict` interpolated it into its reason text, `run.mjs`
 * printed it in the `--list` label, and the rest tested `> 0` to ask "does this
 * story cost anything at all". `--approve-spend` authorised an UNBOUNDED run.
 * Runs 12 and 13 came in at $2.91 and $2.81 against a declared $35 because
 * S10's shape bounds them, not because anything watched the number — and the
 * product agrees: `developer-loop.ts:573` sets
 * `costBudgetUsd: Number.POSITIVE_INFINITY`. A betterado initiative declaring
 * $12 spent $84.
 *
 * THE UNMEASURED CASE IS NOT UNDER THE CEILING. `summariseRunSpend` returns
 * `measured: false` when a real agent was dispatched and no priced event
 * reached its log — a turn reaped mid-hang writes no terminal event. That is
 * "nobody could look", and it must not render as "under budget", which is the
 * same defect this campaign has met as `ls 2>/dev/null | wc -l`, as `idle`
 * standing in for a discarded manifest, and as a filtered listing read as an
 * empty one. It cannot BREACH either — there is no number to compare — so it
 * gets its own verdict and says so.
 *
 * @param {{measured: boolean, usd: number|null, label: string}} spend
 * @param {number} ceilingUsd
 * @returns {{breached: boolean, known: boolean, reason: string}}
 */
export function spendCeilingVerdict(spend, ceilingUsd) {
  if (typeof ceilingUsd !== 'number' || !Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
    return Object.freeze({
      breached: false, known: false,
      reason: `no usable ceiling to enforce (got ${JSON.stringify(ceilingUsd)}) — the run is UNBOUNDED and this is not "within budget"`,
    });
  }
  if (spend?.measured !== true || typeof spend.usd !== 'number') {
    return Object.freeze({
      breached: false, known: false,
      reason: `spend UNMEASURED against ceiling $${ceilingUsd.toFixed(2)} — nothing was priced, so this run is neither under nor over it. ${spend?.label ?? ''}`.trim(),
    });
  }
  if (spend.usd > ceilingUsd) {
    return Object.freeze({
      breached: true, known: true,
      reason: `ceiling $${ceilingUsd.toFixed(2)} EXCEEDED at $${spend.usd.toFixed(4)}`,
    });
  }
  return Object.freeze({
    breached: false, known: true,
    reason: `$${spend.usd.toFixed(4)} of $${ceilingUsd.toFixed(2)}`,
  });
}

/**
 * The ceiling actually in force — bead `forge-8vfn.7.6.52`, T1 ruling 791.
 *
 * TWO NUMBERS CAN DISAGREE AND ONLY ONE IS AUTHORISED. A story declares
 * `budget_usd` in its own file; the operator funds a run through the launcher.
 * D's S7 run 4 declared **$25** and was funded **$5**. With 7.6.51's
 * enforcement and nothing else, that run would have been stopped at $25 —
 * five times what anyone authorised — and the log would have called it
 * compliant, because the only number it knew was the story's.
 *
 * So the runner takes both and enforces the LOWER. The declared figure is a
 * property of the story; the funded figure is a decision about this run, and a
 * decision cannot be overridden by a file.
 *
 * BOTH PRINT AT START, always. A run whose two numbers differ must say so
 * before it spends, not afterwards in a post-mortem — and a run whose numbers
 * agree must say THAT, because a guard that speaks only when they differ is
 * indistinguishable from one that never compared them.
 *
 * @param {number} declaredUsd  the story's own `ground.budget_usd`
 * @param {number|null} fundedUsd  `--ceiling`, or null when the launcher named none
 * @returns {{usd: number, source: string, reason: string}}
 */
export function effectiveCeiling(declaredUsd, fundedUsd) {
  const dOk = typeof declaredUsd === 'number' && Number.isFinite(declaredUsd) && declaredUsd >= 0;
  const fOk = typeof fundedUsd === 'number' && Number.isFinite(fundedUsd) && fundedUsd >= 0;
  if (!fOk) {
    return Object.freeze({
      usd: dOk ? declaredUsd : NaN,
      source: 'declared',
      reason: dOk
        ? `ceiling $${declaredUsd.toFixed(2)} (declared by the story; the launcher named no --ceiling)`
        : `NO USABLE CEILING: the story declares ${JSON.stringify(declaredUsd)} and the launcher named none — this run is UNBOUNDED`,
    });
  }
  if (!dOk) {
    return Object.freeze({
      usd: fundedUsd, source: 'funded',
      reason: `ceiling $${fundedUsd.toFixed(2)} (funded; the story declares ${JSON.stringify(declaredUsd)}, which is unusable)`,
    });
  }
  const usd = Math.min(declaredUsd, fundedUsd);
  const source = fundedUsd < declaredUsd ? 'funded' : (declaredUsd < fundedUsd ? 'declared' : 'both agree');
  return Object.freeze({
    usd, source,
    reason: `ceiling $${usd.toFixed(2)} — funded $${fundedUsd.toFixed(2)}, declared $${declaredUsd.toFixed(2)}`
      + (fundedUsd === declaredUsd ? ' (they agree)' : `; enforcing the LOWER (${source})`),
  });
}
