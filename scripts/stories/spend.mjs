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
      'Read the first spawn before deciding why (§15.458), with `classifyUnmeasuredDispatch` ' +
      '(bead `forge-8vfn.7.6.76`) rather than by eye: ONE read of "many lines, pid alive" cannot tell a ' +
      'turn reaped mid-hang (forge-8vfn.6.11.17) from a healthy first spawn that just has not priced ' +
      'itself yet — both look identical viewed once, and only the TREND across two reads decides it. ' +
      'This is NOT $0.00.',
    priced: 0,
  });
}

/**
 * Which of THREE arms a dispatch that dispatched a real agent and priced
 * nothing is actually in — bead `forge-8vfn.7.6.76`.
 *
 * ONE READ CANNOT TELL THEM APART. The prior text offered two causes keyed to
 * "many lines, pid alive" — but that is also exactly what a healthy first
 * spawn looks like: still working, still writing, nothing priced YET. Viewed
 * once, a live turn and a reaped one are the same symptom. The TREND across
 * two reads is what decides it — growth means something is still writing;
 * pid gone or a static count means nothing is.
 *
 * `previous` defaults to an empty read (0 lines, no pid) so the very first
 * call — with nothing to compare against yet — reads as growth from zero
 * rather than needing a null check at every call site.
 *
 * @param {{pid: number|null, alive: boolean, eventLines: number, stderrTail?: string, exitCode?: number|null}} current
 * @param {{pid: number|null, alive: boolean, eventLines: number}} [previous]
 * @returns {Readonly<{arm: 'in-flight'|'reaped'|'never-started', detail: string}>}
 */
export function classifyUnmeasuredDispatch(current, previous = { pid: null, alive: false, eventLines: 0 }) {
  // NEVER STARTED — the SDK child exited within seconds, leaving ONE `start`
  // line and nothing more coming; `alive` false is what makes this terminal
  // rather than merely "just began", which a still-alive one-liner is (it
  // falls through to IN FLIGHT below, correctly, with grew=1).
  if (current.eventLines <= 1 && !current.alive) {
    return Object.freeze({
      arm: 'never-started',
      detail: `NEVER STARTED — events.jsonl carries ${current.eventLines} line(s) (start-and-nothing) and exit code ${current.exitCode ?? 'unrecorded'}`,
    });
  }
  const grew = current.eventLines - previous.eventLines;
  // REAPED/DIED — pid absent OR the count did not move. OR, deliberately: a
  // pid that still answers `kill(pid, 0)` over a static log is a stuck or
  // zombie shape, not evidence of live work.
  if (!current.alive || grew <= 0) {
    return Object.freeze({
      arm: 'reaped',
      detail:
        `REAPED/DIED — ${current.alive ? 'events.jsonl is static' : 'pid is gone'} ` +
        `(events.jsonl ${previous.eventLines}→${current.eventLines} lines); stderr tail: ${current.stderrTail || '(empty)'}`,
    });
  }
  return Object.freeze({
    arm: 'in-flight',
    detail: `IN FLIGHT — pid ${current.pid} alive and events.jsonl grew by ${grew} line(s) since the previous read`,
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

/**
 * Was a beat's own `costless: true` declaration kept? — findings row 61.
 *
 * A beat declaring `costless: true` asserts it dispatches nothing at all, so
 * the runner enforces the assertion the same way `spendCeilingVerdict`
 * enforces the story's own ceiling: by comparing two MEASURED readings, never
 * by trusting the declaration. `beforeUsd` is the run's total spend
 * immediately before this beat ran and `afterUsd` immediately after; a beat
 * that dispatched nothing leaves the two equal.
 *
 * `null` ON EITHER SIDE NEVER RESOLVES TOWARD RED (§15.504). `summariseRunSpend`
 * returns `usd: null` for UNMEASURED — a dispatch that has not priced itself
 * yet, or a turn reaped before it could — and there is no number to say moved.
 * Reddening a beat on an absence would fail a healthy in-flight dispatch at the
 * very beat boundary that is supposed to prove nothing was dispatched, which is
 * backwards: an unmeasured reading is a reason to look harder at the run's own
 * ceiling column, not a verdict this comparison can make for it.
 *
 * A DECREASE IS NOT A VIOLATION. The only question this asks is "did spend
 * GROW inside this beat's own window"; a ledger correction or an accounting
 * reconciliation moving the total down is not something the beat did.
 *
 * @param {number|null} beforeUsd measured spend immediately before this beat ran
 * @param {number|null} afterUsd measured spend immediately after
 * @returns {Readonly<{ok: boolean, reason: string|null}>}
 */
export function costlessBeatVerdict(beforeUsd, afterUsd) {
  if (typeof beforeUsd !== 'number' || !Number.isFinite(beforeUsd)
    || typeof afterUsd !== 'number' || !Number.isFinite(afterUsd)) {
    return Object.freeze({ ok: true, reason: null });
  }
  const spent = afterUsd - beforeUsd;
  if (spent > 0) {
    return Object.freeze({ ok: false, reason: `declared costless, spent $${spent.toFixed(4)}` });
  }
  return Object.freeze({ ok: true, reason: null });
}

/**
 * Turns that ENDED with nobody pricing them — bead `forge-8vfn.7.6.71`,
 * T1 ruling 849 option (d).
 *
 * THE DIFFERENCE THAT DECIDES EVERYTHING IS "ENDED" (823). A dispatched turn
 * with no priced event and no terminal row is IN FLIGHT: unmeasured is the
 * correct live state, it may still price itself on its own `end`, and a runner
 * that halted on it would kill healthy runs at every beat. A turn that has
 * ENDED unpriced is a different fact with the same symptom — there is no
 * figure coming, and the ceiling above it will never compare anything again.
 *
 * 7.6.51 printed `spend UNMEASURED against ceiling $X` at every beat and
 * carried on. Honest, and blind exactly when it matters: D's S7 run 4 spent an
 * unknown amount against a declared $25 while the enforcer narrated its own
 * blindness twenty-three times. THE HONEST FIX FOR BLINDNESS IS TO STOP ON
 * BLINDNESS, not to manufacture sight — 849 refused a pricing table for the
 * same reason, because a ceiling compared against a figure we derived
 * ourselves fails in the direction that looks safe.
 *
 * WHAT COUNTS AS THE END OF A TURN, and why it is not `event_type: 'end'`.
 * Plenty of honest `end` rows carry no `cost_usd` — a phase's terminal move, a
 * closure step — and treating those as unpriced turns would halt every healthy
 * run at beat 1. The row this reads is the one 7.6.55 (#698) added for exactly
 * this purpose: the runner writes `interactive.turn-ended-unpriced` when a turn
 * ends without the SDK's priced `result`, carrying the tokens it was observed
 * to consume and `unpriced_reason: abort|died`. TWO INDEPENDENT MARKERS are
 * accepted — that message, or `metadata.priced === false` — because a guard
 * keyed to a single string literal in another package goes silently blind the
 * day someone renames it, which is this campaign's own fail-open shape.
 * `spend-unpriced.test.ts` holds a door on the literal for the same reason.
 *
 * A ROW THAT DID GET A PRICE IS NOT ONE OF THESE. `cost_usd` present means the
 * turn was priced after all, whatever its message says; the evidence wins over
 * the label.
 *
 * Deduped by `event_id` like `summariseRunSpend`, because a cycle channel
 * re-logs a session's own terminal row and one turn must not read as two.
 *
 * @param {{event_id?: unknown, message?: unknown, cost_usd?: unknown, tokens_in?: unknown, tokens_out?: unknown, metadata?: Record<string, unknown>}[][]} eventLists
 * @returns {ReadonlyArray<{reason: string, tokensIn: number|null, tokensOut: number|null, sessionId: string}>}
 */
export function endedUnpricedTurns(eventLists) {
  const seen = new Set();
  const out = [];
  for (const rows of eventLists ?? []) {
    for (const r of rows ?? []) {
      const meta = (r?.metadata ?? {});
      // TWO INDEPENDENT MARKERS, and the first one stopped being independent —
      // `forge-8vfn.7.6.73`, found by C reading this line rather than taking my
      // word for what it did.
      //
      // It used to be `r?.message === 'interactive.turn-ended-unpriced'`: exact
      // equality against ONE literal, written as belt-and-braces so either
      // marker alone would suffice (§15.504 — the halt must not rest on a single
      // field). 7.6.73 added three more emitters, each correctly named for its
      // own caller (`architect.turn-ended-unpriced`,
      // `architect.completeness-critic.turn-ended-unpriced`,
      // `instructions.draft.turn-ended-unpriced`), and NONE of them matches a
      // literal spelled `interactive.…`. So the belt quietly became the braces'
      // shadow: three of the four emitters were held by `priced === false`
      // alone.
      //
      // The failure that sets up is not cosmetic. A future emitter written to
      // the obvious convention — `somephase.turn-ended-unpriced` — and missing
      // `priced: false` is INVISIBLE to the halt while looking correct to
      // whoever wrote it, because its message says "unpriced" in plain English
      // and matches every sibling. §15.534 one level along: a guard keyed on a
      // literal name, evaded by ordinary growth rather than by an attacker —
      // and the growth had already happened, in the bead that found this.
      //
      // Matching the SUFFIX makes the convention enforce itself: a new emitter
      // earns the second marker by naming alone, and the two arms are genuinely
      // independent again.
      const marked = /(^|\.)turn-ended-unpriced$/.test(String(r?.message ?? '')) || meta['priced'] === false;
      if (!marked) continue;
      if (typeof r?.cost_usd === 'number') continue;
      const id = typeof r?.event_id === 'string' ? r.event_id : null;
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(Object.freeze({
        reason: typeof meta['unpriced_reason'] === 'string' ? meta['unpriced_reason'] : 'unstated',
        tokensIn: typeof r?.tokens_in === 'number' ? r.tokens_in : null,
        tokensOut: typeof r?.tokens_out === 'number' ? r.tokens_out : null,
        sessionId: typeof meta['session_id'] === 'string' ? meta['session_id'] : 'unknown',
      }));
    }
  }
  return Object.freeze(out);
}

/**
 * Does this beat boundary stop the run? — bead `forge-8vfn.7.6.71`.
 *
 * THREE STATES, NOT TWO (§15.504): green, red, and UNKNOWN — and UNKNOWN never
 * resolves toward proceeding. A breach is red on a number. A turn that ended
 * unpriced under an enforceable ceiling is UNKNOWN, and it stops the run
 * because the guard above it can no longer do its job, not because anything
 * was proven over budget.
 *
 * THE BREACH IS CHECKED FIRST and that ordering is deliberate: when part of the
 * spend is priced and already over, the honest headline is the number we have,
 * not the one we lost. The measured total is a LOWER BOUND once a turn has gone
 * unpriced, so `EXCEEDED` remains true whatever the missing row held.
 *
 * NO USABLE CEILING MEANS NOTHING TO MAKE UNENFORCEABLE. An unbounded run is
 * already `effectiveCeiling`'s finding and prints as one; adding a second
 * verdict for it here would stop runs on a condition this bead was not ruled
 * for and 7.6.52 already names up front.
 *
 * THE BOUND THIS DOES NOT COVER, stated rather than discovered later: it runs
 * at beat boundaries, so a turn that ends unpriced after the LAST boundary is
 * reported by the spend column and not halted on. The run is in teardown by
 * then and the reap runs regardless; what is lost is the red, not the kill.
 *
 * A THIRD WAY OF NOT BEING ABLE TO MEASURE — `forge-8vfn.7.6.103`, T1
 * 1037/1039. A row that FAILED TO WRITE is not an unpriced turn: the turn may
 * have been priced perfectly and the ledger simply could not record it. Either
 * way the ledger is incomplete, and this function already halts on "cannot
 * measure" as well as "exceeded".
 *
 * WHY IT DOES NOT CONSULT THE HEADROOM, which is the argument that settles it
 * (C): a headroom test would be COMPUTED FROM THE VERY LEDGER whose
 * completeness is in doubt. "Only $0.50 of $35, so blindness is fine" requires
 * that $0.50 be a MEASUREMENT — and after a failed row it is a FLOOR. You would
 * be reading the corrupted number to decide whether the corruption matters.
 * That is not a wrong answer, it is a question that cannot be asked honestly.
 *
 * BUT IT IS GATED ON `enforceable`, EXACTLY LIKE ITS NEIGHBOUR, AND THAT IS
 * DELIBERATE — said here because a reader will otherwise assume it either way.
 * A run with NO declared ceiling has no bound to go blind about, and firing
 * unconditionally would make this the first verdict in this function able to
 * stop a run carrying no spend bound at all: every costless story run would
 * halt the moment a logdir went read-only, and CI runs costless stories on
 * every push. 1039 ruled the gated form.
 *
 * ORDER: breach -> row-write-failed -> unenforceable. Breach stays first for
 * the reason above — a number beats an unknown. `row-write-failed` goes ahead
 * of `unenforceable` as a judgement, not a derivation: it is an
 * operator-actionable INFRASTRUCTURE fault, where `unenforceable` is a product
 * behaviour, and a run can plausibly have both.
 *
 * @param {{spend: ReturnType<typeof summariseRunSpend>, ceilingUsd: number, unpriced: ReturnType<typeof endedUnpricedTurns>, emitFailures?: {failures: object[], unreadable: {dir: string, error: string}[]}}} args
 * @returns {Readonly<{halt: boolean, kind: 'breach'|'row-write-failed'|'unenforceable'|null, headline: string|null, reason: string, note: string}>}
 */
export function ceilingHaltVerdict({ spend, ceilingUsd, unpriced, emitFailures }) {
  const v = spendCeilingVerdict(spend, ceilingUsd);
  if (v.breached) {
    return Object.freeze({
      halt: true, kind: 'breach', headline: 'CEILING BREACHED', reason: v.reason,
      note: 'The run was stopped at the ceiling, so the beat score above is a partial run, not a verdict on the product.',
    });
  }
  const enforceable = typeof ceilingUsd === 'number' && Number.isFinite(ceilingUsd) && ceilingUsd >= 0;

  // 7.6.103 — a row that could not be written, or a sidecar that could not be
  // read. BOTH halt: an unreadable sidecar is UNKNOWN, and UNKNOWN never
  // resolves toward proceeding (§15.504) — the signal may be sitting there
  // unreadable, which must not render as "nothing was recorded".
  // A MALFORMED `emitFailures` IS UNKNOWN, NOT EMPTY — C's review of this bead.
  // `emitFailures?.failures ?? []` alone would synthesise ABSENCE from a SHAPE
  // ERROR: if a later refactor made `readEmitFailures` return a bare array, or
  // any object without these two keys, both arms would read `[]`, this would
  // stop halting, and NOTHING would print a word. Every door here would still
  // pass, because the doors construct the object themselves — a fixture
  // deciding the experiment, which is the class this bead exists to prevent.
  //
  // `unpriced ?? []` one line below has the same property and has had it since
  // 7.6.71. The reason the line is drawn here and not there: `unpriced` is
  // FLAT, so a wrong-typed value fails loudly at `.length`, while
  // `emitFailures` is NESTED and `?.failures` swallows one more class of
  // mismatch silently. The nested shape is the bigger surface and it is the new
  // one.
  const shapeOk = emitFailures === undefined || emitFailures === null
    || (Array.isArray(emitFailures.failures) && Array.isArray(emitFailures.unreadable));
  const wrote = shapeOk ? (emitFailures?.failures ?? []) : [];
  const unreadable = shapeOk
    ? (emitFailures?.unreadable ?? [])
    : [{ dir: '(caller)', error: `emitFailures is present but malformed (${Array.isArray(emitFailures) ? 'array' : typeof emitFailures}) — unreadable is UNKNOWN, not absent` }];
  if (enforceable && (wrote.length > 0 || unreadable.length > 0)) {
    const detail = wrote.length > 0
      ? `${wrote.length} ledger row(s) FAILED TO WRITE (first: message=${wrote[0]?.message ?? 'unrecorded'}, error=${wrote[0]?.error ?? 'unrecorded'})`
      : `the emit-failure sidecar could not be READ (${unreadable[0]?.dir}: ${unreadable[0]?.error}) — unreadable is UNKNOWN, not absent`;
    return Object.freeze({
      halt: true, kind: 'row-write-failed', headline: 'LEDGER INCOMPLETE',
      reason:
        `ceiling $${ceilingUsd.toFixed(2)} cannot be trusted: ${detail}. The spend total is a FLOOR, not a ` +
        'measurement, so the headroom that would justify continuing is computed from the very ledger in doubt',
      note: 'The run was stopped because its ledger could not be written or read, NOT because a limit was exceeded — this is an infrastructure fault (disk, permissions, handle), and the spend total above is a lower bound.',
    });
  }

  const ended = unpriced ?? [];
  if (enforceable && ended.length > 0) {
    const t = ended[0];
    const tokens = [
      t.tokensOut === null ? 'tokens_out=unrecorded' : `tokens_out=${t.tokensOut}`,
      t.tokensIn === null ? 'tokens_in=unrecorded' : `tokens_in=${t.tokensIn}`,
    ].join(', ');
    return Object.freeze({
      halt: true, kind: 'unenforceable', headline: 'CEILING UNENFORCEABLE',
      reason:
        `ceiling $${ceilingUsd.toFixed(2)} UNENFORCEABLE: ${ended.length} turn(s) ended unpriced ` +
        `(first: reason=${t.reason}, ${tokens}, session=${t.sessionId}) — no figure is coming for ` +
        'them, so nothing below this ceiling can be compared to it again',
      note: 'The run was stopped because its ceiling went blind, NOT because a limit was exceeded — the beat score above is a partial run and the spend total is a lower bound.',
    });
  }
  return Object.freeze({ halt: false, kind: null, headline: null, reason: v.reason, note: '' });
}
