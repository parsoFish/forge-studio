/**
 * agent-parity.mjs — one run-level start closed by one run-level end, per
 * agent channel a story run launched. Row 206 (bead `forge-8vfn.8.5.56`).
 *
 * A CHANNEL is one `_logs/<dir>` the run owns: a standalone agent dispatch
 * (`_agent-*`), a session-less fix turn (`_preflight-fix-*`, `_brainfix-*`,
 * `runFixTurn`, packages/sessions/kinds/fix-turn.ts), a session turn
 * (`_<kind>-<sessionId>`, `<kind>` registered in `studio/session-kinds.yaml`),
 * or a cycle log (more than one distinct top-level `phase` column value in
 * its own rows — the same test `spend.mjs`'s `summariseRunSpend` already
 * uses as `isCycleLog`). The Studio bridge's own `_bridge-*` log is not an
 * agent channel; neither is a directory this rule cannot place in one of the
 * four shapes above (measured: `_hook-test-fire-story-s7-hook`, a story's own
 * isolated hook-fire fixture — nothing dispatched an agent there). Both are
 * `excluded`, never silently folded into a violation.
 *
 * RUN-LEVEL VOCABULARY IS NOT "EVERY START/END ROW IN THE DIR". The only
 * three writers this rule means by "start"/"end" are `runAgent`
 * (packages/agents/run-agent.ts:393-421/503-527), `runKindTurn`
 * (packages/sessions/kinds/kind-turn.ts:312/412, and `interactive-runner.ts`'s
 * generic turn, which the `authoring` kind rides and stamps the identical
 * `metadata.phase` the same way) and `runFixTurn`
 * (packages/sessions/kinds/fix-turn.ts:175/345). A real channel's dir carries
 * OTHER `start`/`end` rows besides theirs, measured on the real captures this
 * rule was replayed against (`_1.0/reports/m7-e-r206-parity-replay.md`):
 *
 *   - a hook fired mid-turn (`skill: 'hook:<id>'`) writes its own start/end
 *     pair synchronously, inside the SAME dir the agent is still writing to
 *     (row 198's own measured capture, `standalone-run-own-end.test.ts`).
 *   - `emitTurnCostRow` / `emitTurnEndedUnpricedRow`
 *     (packages/sessions/turn-cost-rows.ts) write a PRICING row —
 *     `event_type: 'end'`, `metadata.priced` a boolean — never a lifecycle
 *     boundary.
 *   - the architect session runs sub-turns INSIDE one `runKindTurn` call:
 *     `architect.explore.start` / `.draft.start` / `.revise.start` /
 *     `.finalize.start` (packages/sessions/kinds/architect-stage-events.ts)
 *     under the SAME skill value `runKindTurn` itself writes for the architect,
 *     and the completeness critic's own start/end pair
 *     (packages/sessions/kinds/architect-critic.ts) under
 *     `skill: 'architect-completeness-critic'`. MEASURED on a real S1
 *     capture: one architect session dir held 9 `start` rows and 12 `end`
 *     rows across three skills, none of it a parity bug.
 *
 * `runKindTurn` stamps `metadata.phase` on every start and every end it
 * writes, UNCONDITIONALLY (`status.phase` / `result.phase` — required
 * fields on every session's status) — and nothing else observed in a session
 * dir ever sets that key. So for a `session` channel, "this row is the
 * turn's own boundary, not an inner stage ping, a critic sub-turn or a
 * pricing row" reads as `typeof row.metadata.phase === 'string'`.
 *
 * HARNESS-RECORDED STOPS. `reapAgentRuns` (scripts/stories/reap.mjs) is the
 * one place a dispatch this run owns is deliberately ended from the outside
 * — a SIGTERM/SIGKILL the teardown aimed at a pid it had already admitted,
 * called from the SAME three sites regardless of why the run is stopping:
 * the unconditional end-of-story teardown (scripts/stories/run-story.mjs:341,
 * every story, breached ceiling or not), the mid-run SIGINT/SIGTERM path
 * (scripts/stories/stop-path.mjs, its own `reapAgentRuns` call), and the
 * run-end abort backstop (scripts/stories/run.mjs:705). A SIGTERM cannot run
 * a pending `finally` and a SIGKILL cannot be handled at all
 * (reap-cancel.mjs's own header), so a reaped turn writes NOTHING of its own
 * into `events.jsonl` — no terminal fact survives inside the channel's own
 * rows for this rule to read. The fact survives instead in `reapAgentRuns`'s
 * OWN return value, `{ reaped: [{ dir, pid, signal, via }], skipped }` — so
 * this rule takes it as data, `opts.reapedDirs`, the way `ceilingHaltVerdict`
 * (spend.mjs) takes `emitFailures`/`spendUnknown` as data rather than
 * re-reading a file itself. A channel the caller did NOT name in
 * `reapedDirs` and whose last start never closed is reported as a plain
 * `missing-end` violation — still running, or stopped for a reason this rule
 * was given no evidence of, is not this rule's call to make either way.
 *
 * ROW 207 (bead `forge-8vfn.8.5.57`, T1 ruling 1973qf) — S10, the first full
 * develop cycle judged here, measured three more shapes on its cycle logs:
 *
 *   - PER-WORK-ITEM ROWS. developer-ralph writes one `ralph.end` per work
 *     item (`metadata.work_item_id`) beside the developer-loop phase's own
 *     end per attempt. A per-WI row never opens or closes a lane —
 *     `isPerWorkItemRow` (packages/kernel/per-work-item-row.ts), the SAME
 *     predicate `deriveNodeStatuses` reads.
 *   - ID-LESS ROWS. forge's event logger mints an `event_id` on every row it
 *     writes (`createLogger`, packages/kernel/logging.ts), so a row without
 *     one is not a run-level emission: measured, the reflector AGENT appended
 *     its own `reflector.start`/`reflector.end` text pair (Python spacing,
 *     microsecond timestamps) inside the runtime's own reflector turn.
 *     Excluded rather than paired as a nested stack, because a stack would
 *     equally accept a forged pair that DOES carry an id — an id the agent
 *     typed is still counted (a forged `end` still reds as `extra-end`).
 *   - CYCLE ATTEMPTS. Every attempt's `cycle.start` is closed by its own
 *     `cycle.end` (cycle.ts writes one on a throw too, `stopped` for an
 *     operator stop), so a resumed attempt is simply the next FIFO pair. The
 *     FINAL attempt — every run-level row from the channel's last
 *     `orchestrator`/`cycle` start on — can still be running when the story
 *     ends, inside the scheduler daemon this run started. It is judged with
 *     the harness's own SERVE STOP as evidence, the way `reapedDirs` is for
 *     an agent turn: `opts.serveAlivePid` (story end, the daemon still alive)
 *     DEFERS its open starts; `opts.serveStop` (`serveStopEvidence`,
 *     agent-parity-serve-stop.mjs, after the batch teardown's own stop)
 *     satisfies them only when that stop KILLED the daemon (it did not
 *     drain) with this initiative in `_queue/in-flight/`. An earlier attempt
 *     left open is never deferred and never excused.
 */
import { basename } from 'node:path';
import { isPerWorkItemRow } from '../../packages/kernel/per-work-item-row.ts';

/** @param {unknown} skill */
function isHookSkill(skill) {
  return typeof skill === 'string' && skill.startsWith('hook:');
}

/** `emitTurnCostRow` / `emitTurnEndedUnpricedRow` (turn-cost-rows.ts) — always
 *  a boolean there, never a lifecycle boundary. */
function isPricingOnlyEnd(row) {
  return row?.event_type === 'end' && typeof row?.metadata?.priced === 'boolean';
}

/**
 * Rows this rule will even consider a run-level `start`/`end` boundary,
 * before any kind-specific narrowing — never a hook's own pair (its skill
 * starts `hook:`) or a pricing row (`emitTurnCostRow`/`emitTurnEndedUnpricedRow`,
 * a boolean `metadata.priced`, never a lifecycle boundary), and never
 * anything other than `event_type: 'start'|'end'` — a `file_change`/`log`/
 * `tool_use` row is never a boundary regardless of what it carries in
 * `phase`. Shared by `classifyChannelDir`'s multi-phase test and by
 * `runLevelRows` below so the two can never disagree about which rows count.
 */
function runLevelCandidateRows(rows) {
  return (rows ?? []).filter(
    (r) =>
      (r?.event_type === 'start' || r?.event_type === 'end') &&
      typeof r?.event_id === 'string' &&
      !isPerWorkItemRow(r) &&
      !isHookSkill(r?.skill) &&
      !isPricingOnlyEnd(r),
  );
}

/**
 * Classify one channel directory from its own basename and rows. Pure and
 * total: every input lands in exactly one of the four kinds below.
 *
 * DIR-NAME SHAPE IS TESTED FIRST, not the multi-phase test. Row 206
 * follow-on, measured on a real capture
 * (`_demo-2026-10-04T07-46-43-3602d1ce`, `_1.0/reports/m7-e-r206-parity-replay.md`):
 * the Studio bridge writes 5 `file_change` rows straight into a SESSION's
 * own dir mid-turn, each stamped `phase: 'orchestrator'` beside the
 * session's own `phase: 'demo'` rows. Testing the multi-phase shape first
 * read that as a multi-phase `cycle` log and lost whole-channel judging for
 * a dir that is, by its own name, a registered session kind's turn — a
 * bridge write into someone else's dir must never be able to flip that. A
 * dir's OWN NAME is this rule's most specific evidence of what dispatched
 * it (the dispatcher chose that name), so a name matching one of the four
 * named shapes below is authoritative and the multi-phase test never even
 * runs for it. Only a dir matching NEITHER a standalone prefix nor a
 * registered session kind falls through to the multi-phase test — and that
 * test itself counts phases over run-level candidate rows ONLY
 * (`runLevelCandidateRows`, `start`/`end`, minus a hook pair and a pricing
 * row), the same restriction `runLevelRows` applies below, so a bridge
 * `file_change`/`log` row can never contribute a phase value either, on ANY
 * dir, named or not.
 *
 * @param {string} dirName the channel's own basename (`_agent-…`, `_bridge-…`, …)
 * @param {object[]} rows this channel's own (already-deduped) events
 * @param {Set<string>} registeredSessionKindIds every id `studio/session-kinds.yaml` declares
 * @returns {{kind: 'standalone'|'session'|'cycle'|'excluded', detail: string}}
 */
export function classifyChannelDir(dirName, rows, registeredSessionKindIds = new Set()) {
  if (dirName.startsWith('_agent-')) return { kind: 'standalone', detail: 'runAgent dispatch' };
  if (dirName.startsWith('_preflight-fix-')) return { kind: 'standalone', detail: 'preflight-fix turn (runFixTurn)' };
  if (dirName.startsWith('_brainfix-')) return { kind: 'standalone', detail: 'brain-fix turn (runFixTurn)' };
  if (dirName === '_bridge' || dirName.startsWith('_bridge-')) {
    return { kind: 'excluded', detail: 'the Studio bridge process, not an agent/session/cycle channel' };
  }
  // Longest match wins — no registered id is a prefix of another today, but a
  // future one might be, and the longer id is always the more specific claim.
  let matched = null;
  for (const id of registeredSessionKindIds) {
    const isMatch = dirName === `_${id}` || dirName.startsWith(`_${id}-`);
    if (isMatch && (matched === null || id.length > matched.length)) matched = id;
  }
  if (matched !== null) return { kind: 'session', detail: `session turn (kind=${matched})` };
  // Neither a standalone prefix nor a registered session kind — the ONLY
  // shape left that legitimately carries more than one top-level `phase`
  // value in one dir (orchestrator + architect + …), the same test
  // `spend.mjs`'s `summariseRunSpend` uses as `isCycleLog`.
  const phases = new Set(
    runLevelCandidateRows(rows).map((r) => r?.phase).filter((p) => typeof p === 'string' && p !== ''),
  );
  if (phases.size > 1) {
    return { kind: 'cycle', detail: `multi-phase cycle log (${[...phases].sort().join(', ')})` };
  }
  return { kind: 'excluded', detail: 'not a recognised agent/session/cycle channel shape' };
}

/**
 * The rows THIS rule means by "start"/"end" for one already-classified
 * channel — see the module header. Never a hook's own pair or a pricing row;
 * for a `session` channel, never a row lacking `metadata.phase`.
 */
function runLevelRows(rows, kind) {
  const base = runLevelCandidateRows(rows);
  if (kind !== 'session') return base;
  return base.filter((r) => typeof r?.metadata?.phase === 'string' && r.metadata.phase !== '');
}

const eid = (r) => (typeof r?.event_id === 'string' ? r.event_id : null);

/**
 * Parity over ONE group's own run-level rows, already time-ordered — a group
 * is the WHOLE CHANNEL (`standalone`/`session`: the channel runs exactly one
 * turn at a time, whatever skill each one is dispatched under, so two
 * overlapping starts under different skill values collide in one FIFO)
 * or one `phase::skill` pair (`cycle`: "per-phase starts are legit", so each
 * phase's own skill gets its own FIFO, because a cycle genuinely runs more
 * than one phase concurrently).
 *
 * `oneShotOnly` (standalone/fix-turn) treats ANY second start as a
 * `double-start` — this run id should see exactly one dispatch ever, so even
 * two cleanly SEQUENTIAL complete pairs sharing one dir is the anomaly, not
 * only two concurrent ones. A `session`/`cycle` group instead runs a plain
 * FIFO: any number of sequential turns is legitimate, and only a start
 * arriving before the previous one closed is a `double-start`.
 *
 * An `end` with nothing open is `extra-end`. Anything still open once the
 * group's rows run out is `missing-end` against the OLDEST open start
 * (FIFO) — `satisfied`, not a violation, when `reapedDirs` names this
 * channel (see the module header).
 */
function groupViolations(rows, { channel, key, reapedDirs, oneShotOnly, finalAttempt, serveAlivePid, serveExcuse }) {
  const violations = [];
  const satisfied = [];
  const deferred = [];
  const open = [];
  let lastStart = null;
  for (const r of rows) {
    if (r.event_type === 'start') {
      const isDouble = oneShotOnly ? lastStart !== null : open.length > 0;
      if (isDouble) {
        const prior = oneShotOnly ? lastStart : open[open.length - 1];
        violations.push({ kind: 'double-start', channel, key, eventIds: [eid(prior), eid(r)] });
      }
      open.push(r);
      lastStart = r;
    } else if (open.length === 0) {
      violations.push({ kind: 'extra-end', channel, key, eventIds: [eid(r)] });
    } else {
      open.shift();
    }
  }
  for (const leftover of open) {
    const item = { kind: 'missing-end', channel, key, eventIds: [eid(leftover)] };
    if (reapedDirs.has(channel)) {
      satisfied.push({
        ...item,
        reason: `closed by the harness's own reap of ${channel} (reapAgentRuns, scripts/stories/reap.mjs) — not a product red`,
      });
    } else if (finalAttempt.has(leftover) && serveExcuse !== null) {
      satisfied.push({ ...item, reason: serveExcuse });
    } else if (finalAttempt.has(leftover) && serveAlivePid !== null) {
      deferred.push({ ...item, serveAlivePid });
    } else {
      violations.push(item);
    }
  }
  return { violations, satisfied, deferred };
}

const isCycleStart = (r) => r.phase === 'orchestrator' && r.skill === 'cycle' && r.event_type === 'start';

/**
 * The final attempt of a `cycle` channel — every run-level row from its LAST
 * `orchestrator`/`cycle` start on — and the serve-stop excuse for it, if the
 * evidence holds one (see the module header, ROW 207). Empty for any other
 * kind: only a cycle runs inside the scheduler daemon.
 */
function finalAttemptOf(relevant, kind, serveStop) {
  let from = -1;
  if (kind === 'cycle') relevant.forEach((r, i) => { if (isCycleStart(r)) from = i; });
  const finalAttempt = new Set(from < 0 ? [] : relevant.slice(from));
  const initiativeId = from < 0 ? undefined : relevant[from].initiative_id;
  const killed = serveStop != null && !serveStop.drained && serveStop.inFlightInitiativeIds.has(initiativeId);
  const serveExcuse = killed
    ? `closed by the harness's own serve stop — scheduler pid ${serveStop.pid} by ${serveStop.how}, did not drain, ` +
      `with ${initiativeId} in _queue/in-flight/ (stopStudioThenScheduler, scripts/stories/sweep-teardown.mjs) — not a product red`
    : null;
  return { finalAttempt, serveExcuse };
}

/**
 * One channel's own parity verdict.
 *
 * @param {string} dir the channel's own `_logs/<dir>` path — used ONLY as a
 *   label and as the `reapedDirs` lookup key, so it must be the SAME string
 *   form `reapAgentRuns`' own `{dir}` rows use (both derived from the same
 *   `_logs` root) for a harness-stop to be recognised at all
 * @param {object[]} rows this channel's own `events.jsonl` rows, in any order
 * @param {{registeredSessionKindIds?: Set<string>, reapedDirs?: Set<string>, serveAlivePid?: number|null,
 *   serveStop?: ReturnType<typeof import('./agent-parity-serve-stop.mjs').serveStopEvidence>}} [opts]
 * @returns {Readonly<{channel: string, kind: string, detail: string, ok: boolean,
 *   violations: ReadonlyArray<object>, satisfied: ReadonlyArray<object>, deferred: ReadonlyArray<object>}>}
 */
export function channelParityVerdict(dir, rows, opts = {}) {
  const registeredSessionKindIds = opts.registeredSessionKindIds ?? new Set();
  const reapedDirs = opts.reapedDirs ?? new Set();
  const serveAlivePid = opts.serveAlivePid ?? null;

  // Row 206 follow-on (MEDIUM-11) — `rows.unknown` (readRunEvents's own
  // carried fact, scripts/stories/run-observe.mjs) names a read that did NOT
  // fully succeed: an unreadable `events.jsonl` (EACCES/EIO/a torn line) or a
  // line that would not parse. A channel this run could not fully read is
  // never judged ok on partial evidence — an unmeasured channel is never a
  // clean pass; a torn log
  // could easily be hiding the very end row that would have closed this
  // channel's FIFO. Captured BEFORE dedup rebuilds a fresh array below,
  // which would otherwise drop the property silently (a plain array copy
  // carries no custom properties with it).
  const unmeasured = Array.isArray(rows) && Array.isArray(rows.unknown) ? rows.unknown : [];

  // Deduped by `event_id`, the same defence `spend.mjs`'s `summariseRunSpend`
  // takes against a row read twice — cheap, and never wrong when ids are
  // already unique.
  const seen = new Set();
  const deduped = [];
  for (const r of rows ?? []) {
    const id = eid(r);
    if (id !== null) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    deduped.push(r);
  }

  const name = basename(dir);
  const { kind, detail } = classifyChannelDir(name, deduped, registeredSessionKindIds);
  if (kind === 'excluded') {
    // Unchanged by MEDIUM-11: an excluded channel (the bridge's own log, an
    // unrecognised dir shape) is not an agent/session/cycle channel this
    // rule polices at all, per the module header — a read failure on it is
    // not this rule's violation to raise, same as a healthy read on it never
    // becomes one.
    return Object.freeze({
      channel: dir, kind, detail, ok: true,
      violations: Object.freeze([]), satisfied: Object.freeze([]), deferred: Object.freeze([]),
    });
  }

  // NEVER RE-SORTED BY `started_at` — RULE BUG, measured against a real
  // capture and fixed before this rule was wired into anything (replay
  // report, `_1.0/reports/m7-e-r206-parity-replay.md`). `started_at` is
  // `new Date().toISOString()` (packages/kernel/logging.ts:162), the WALL
  // clock other writers already route around because it steps backward on
  // this host (bead `forge-8vfn.7.6.50`, `run-agent.ts:423`/`cycle.ts:216`).
  // A real S1 architect capture has its `architect turn end
  // (phase=awaiting-verdict)` row on an EARLIER file line than its
  // `architect.finalize.start` row, with a LATER `started_at` — sorting by
  // that field reordered them and read a real, healthy turn sequence as a
  // double-start. `events.jsonl` is append-only and line-buffered
  // (logging.ts's own header), so the array order the caller reads it in
  // («readRunEvents», line by line) already IS the one true causal order;
  // `started_at` is carried on each row for display only.
  const relevant = runLevelRows(deduped, kind);
  const oneShotOnly = kind === 'standalone';
  // Row 206 follow-on (MEDIUM-10) — `standalone`/`session` group by the
  // WHOLE CHANNEL, a single fixed key, never the row's own `skill`: two
  // starts in one channel under different skills must collide in the SAME
  // FIFO, because the channel itself (one dispatch, one session dir) runs
  // exactly one turn at a time regardless of which skill names it. Only a
  // `cycle` channel legitimately runs more than one phase concurrently, so
  // it keeps its own `phase::skill` lane — one FIFO per phase, not one per
  // channel.
  const groups = new Map();
  for (const r of relevant) {
    const key = kind === 'cycle' ? `${r.phase ?? ''}::${r.skill ?? ''}` : '(whole channel)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const { finalAttempt, serveExcuse } = finalAttemptOf(relevant, kind, opts.serveStop);
  const violations = [];
  const satisfied = [];
  const deferred = [];
  for (const [key, groupRows] of groups) {
    const v = groupViolations(groupRows, { channel: dir, key, reapedDirs, oneShotOnly, finalAttempt, serveAlivePid, serveExcuse });
    violations.push(...v.violations);
    satisfied.push(...v.satisfied);
    deferred.push(...v.deferred);
  }
  // MEDIUM-11 — appended last, so a channel that is BOTH unmeasured AND
  // shows a real double-start/missing-end on the portion it COULD read
  // reports both, never one eclipsing the other.
  for (const u of unmeasured) {
    violations.push({ kind: 'unmeasured', channel: dir, error: (u && u.error) ?? 'unreadable' });
  }
  return Object.freeze({
    channel: dir, kind, detail, ok: violations.length === 0,
    violations: Object.freeze(violations), satisfied: Object.freeze(satisfied), deferred: Object.freeze(deferred),
  });
}

/**
 * Every channel a run launched.
 *
 * @param {Array<{dir: string, rows: object[]}>} channels
 * @param {{registeredSessionKindIds?: Set<string>, reapedDirs?: Set<string>, serveAlivePid?: number|null,
 *   serveStop?: ReturnType<typeof import('./agent-parity-serve-stop.mjs').serveStopEvidence>}} [opts]
 * @returns {Readonly<{ok: boolean, results: ReadonlyArray<ReturnType<typeof channelParityVerdict>>, violations: ReadonlyArray<object>}>}
 */
export function agentParityVerdict(channels, opts = {}) {
  const results = (channels ?? []).map(({ dir, rows }) => channelParityVerdict(dir, rows, opts));
  const violations = results.flatMap((r) => r.violations);
  const deferred = results.flatMap((r) => r.deferred);
  return Object.freeze({
    ok: violations.length === 0, results: Object.freeze(results), violations: Object.freeze(violations), deferred: Object.freeze(deferred),
  });
}

/**
 * One line per violation and per harness-satisfied stop — printed every run,
 * not only when something is wrong, the same "a guard that speaks only when
 * it fires is indistinguishable from one that never ran" rule `spendSoFar`
 * (run-observe.mjs) already follows.
 *
 * @param {ReturnType<typeof agentParityVerdict>} verdict
 * @returns {string[]}
 */
export function describeAgentParity(verdict) {
  const lines = [];
  for (const r of verdict.results) {
    if (r.kind === 'excluded') continue;
    for (const s of r.satisfied) {
      lines.push(`[stories] agent-parity: ${s.channel} — ${s.reason}`);
    }
    for (const d of r.deferred) {
      lines.push(
        `[stories] agent-parity: ${d.channel} — DEFERRED: ${d.key} start ${d.eventIds.join(', ')} is still open while this ` +
        `run's own serve (pid ${d.serveAlivePid}) is alive; judged after the batch teardown's serve stop`,
      );
    }
    if (r.ok && r.deferred.length === 0) {
      lines.push(`[stories] agent-parity: ${r.channel} (${r.kind}) — ok`);
    }
  }
  for (const v of verdict.violations) {
    // MEDIUM-11 — `unmeasured` carries no `key`/`eventIds` (there is no FIFO
    // group to blame; the read itself is what failed), so it gets its own
    // line shape naming the channel and the real read error verbatim.
    if (v.kind === 'unmeasured') {
      lines.push(`[stories] agent-parity: UNMEASURED — channel ${v.channel} — ${v.error}`);
      continue;
    }
    lines.push(
      `[stories] agent-parity: PRODUCT RED — ${v.kind} on channel ${v.channel} (${v.key}), event id(s) ${v.eventIds.join(', ')}`,
    );
  }
  return lines;
}
