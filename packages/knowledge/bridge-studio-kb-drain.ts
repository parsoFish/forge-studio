/**
 * KB drain-to-green bridge job (W6-B12).
 *
 * Operator intent: ONE button on KB health → forge iteratively remedies ALL
 * lint issues for a KB until it is green, or honestly stops and says why. This
 * module is the BRIDGE JOB + its routes; W6-B13 adds the Studio button/UI that
 * dispatches it. Nothing here is imported by forge-ui — no UI wiring in this file.
 *
 * New file (not folded into packages/knowledge/bridge-studio-kbs.ts, already at the 800-line
 * cap) — follows that module's conventions: never imports ./ui-bridge.ts,
 * reuses its shared helpers (sendJson/allowedOrigin/sanitizeError/pathOnly/
 * StudioContext from ./bridge-studio.ts), and reuses ITS per-kbId serialization
 * queue (`enqueueConsolidate`, exported from packages/knowledge/bridge-studio-kbs.ts precisely
 * so a second caller can share the same lock — see that export's own doc
 * comment) so a drain run and a consolidate run against the SAME kb can never
 * race real agent turns against each other's files.
 *
 * THE STATE MACHINE. `runKbDrain` loops (max `KB_DRAIN_MAX_ROUNDS` rounds):
 * fresh-lint → scope to kb → drain the AUTO tier to a fixed point
 * (`applyAutoFixesUntilStable`) → sequentially dispatch ONE `runBrainFixTurn`
 * per AGENT-tier residual (same per-finding prompt shape
 * `LintResolutionPanel.tsx`'s `fixAllAgent` already dispatches, apps/studio/
 * components/studio/knowledge/LintResolutionPanel.tsx:83-93) → fresh-lint
 * again → decide:
 *
 *   - GREEN         — zero auto+agent findings remain (USER-tier is not this
 *                      job's obligation; a KB that is otherwise clean but has
 *                      USER-tier residuals is 'needs-you', never a false GREEN).
 *   - NEEDS-YOU      — zero auto+agent findings remain, but ≥1 USER-tier
 *                      finding does (listed in `perFinding`) — a real, honest
 *                      stop, not a failure.
 *   - COST-CEILING   — the running sum of this run's own agent-turn costs
 *                      reaches `opts.maxCostUsd` (default
 *                      `DEFAULT_KB_DRAIN_MAX_COST_USD`) — checked after EACH
 *                      turn, so a ceiling breach mid-round stops dispatching
 *                      immediately rather than finishing the round's queue.
 *   - NO-PROGRESS    — either (a) this round's pre-fix and post-fix scoped
 *                      auto+agent finding-KEY sets (kind::file) are
 *                      identical (nothing this round's fixers touched
 *                      actually cleared), or (b) this round's post-fix set
 *                      is a non-empty subset of the UNION of every PRIOR
 *                      round's post-fix set — a bounded OSCILLATION
 *                      (A cleared → B appears → A reappears → …) that keeps
 *                      changing round to round without ever converging.
 *                      Either way, spinning more rounds would not help.
 *   - ROUND-CAP      — `KB_DRAIN_MAX_ROUNDS` rounds ran and none of the above
 *                      fired — an honest "still not clean, out of budget".
 *   - FAILED         — an unexpected throw ANYWHERE in the run (createLogger
 *                      itself, the initial status persist, a lint/
 *                      applyAutoFixes call, …) — never a single turn's own
 *                      failure, which is caught per-turn and recorded as
 *                      `outcome:'not-cleared'` (mirrors
 *                      `runBrainConsolidateNow`'s per-group catch, cli/
 *                      bridge-studio-kbs.ts). The ENTIRE run — first status
 *                      write through last emit — sits inside one try, so a
 *                      throw anywhere in it still reaches an honest 'failed'
 *                      terminal on disk; if even THAT recovery persist
 *                      throws, the failure is logged to stderr and rethrown
 *                      rather than silently leaving status.json stuck at
 *                      'running' forever.
 *
 * Under `FORGE_ARCHITECT_NO_SPAWN=1` / dry-bridge, the loop still runs (lint
 * + auto-fix + re-lint every round) but never actually calls the configured
 * `runFixTurn` — an agent-tier residual is left honestly uncleared instead of
 * risking a real SDK call in CI. The gate sits at the per-finding CALL SITE,
 * not the implementation-selection step, so it holds even for a caller-
 * supplied `opts.runFixTurn` override.
 *
 * Every round (and the terminal outcome) is persisted ATOMICALLY (temp write
 * + rename, this repo's standard status-write convention — see
 * `writeKbDrainStatus`) to `_logs/_kb-drain-<runId>/status.json` — survives
 * nav-away by construction (it is a file, not in-memory UI state), and a
 * concurrent reader (the GET routes, polled by a caller) can only ever see a
 * fully-written prior or fully-written new version, never a truncated one.
 * Events land in the SAME dir's `events.jsonl` through the standard
 * `createLogger` (orchestrator/logging.ts) so a future ActivityLog (B7) can
 * tail it. `runBrainFixTurn`'s own thinking/reasoning sinks stream into ITS
 * OWN per-turn sub-dir (`_logs/_brainfix-<runId>__r<round>__<i>/`) — free,
 * unchanged from how consolidate's per-group turns already work.
 */

import { basename, join } from 'node:path';
import { resolveKbBrainDir } from './brain-paths.ts';
import { createLogger, sanitizeError } from '@forge/kernel';
import { applyAutoFixesUntilStable, resolutionCounts, type Finding } from './brain-lint.ts';
import { collectKbFindings, findingUnderDir, runBrainLintFullFresh } from './kb-lint-summary.ts';
import { diffKbSnapshot, type KbEditChange } from './kb-drain-structural.ts';
import type { KbDrainFixTurnInput, KbDrainFixTurnResult, KbDrainRunFixTurnFn, SessionStatusIoPort } from './kb-drain-model.ts';
import {
  guardAgentKbEdits,
  snapshotBrainTree,
  brainRootDir,
  noKbEdits,
  type KbEditGateResult,
} from './kb-drain-edit-soundness.ts';
import { isDryBridge } from '@forge/kernel';
import {
  DEFAULT_KB_DRAIN_MAX_COST_USD,
  KB_DRAIN_HEARTBEAT_MS,
  KB_DRAIN_MAX_ROUNDS,
  autoAppliedEntry,
  autoSkippedEntry,
  autoUnattributedEntry,
  buildAutoProposedChanges,
  buildProposedChanges,
  finalizeRoundRows,
  findingKey,
  pendingRows,
  progressKeySet,
  setsEqual,
  type KbDrainApplyAutoFixesFn,
  type KbDrainLintFn,
  type KbDrainPerFinding,
  type KbDrainRoundRow,
  type KbDrainState,
  type KbDrainStatus,
} from './kb-drain-model.ts';
import {
  initialKbDrainStatus,
  isKbDrainCancelRequested,
  mintKbCleanupDraftSession,
  revertProseChanges,
  writeKbDrainStatus,
} from './kb-drain-store.ts';

// ---------------------------------------------------------------------------
// Re-export barrel — PR 5 kept every importer untouched
// ---------------------------------------------------------------------------
//
// `kb-drain-routes.ts` and four test files import these names from HERE. They
// did not change; only the file they live in did. Re-exporting them keeps the
// split a pure relocation, exactly as PR #277's `brain-lint.ts` barrel kept its
// 27 importers. The edges point one way — this module imports its parts, the
// parts import nothing back — so the barrel adds no cycle.
export {
  KB_DRAIN_MAX_ROUNDS, DEFAULT_KB_DRAIN_MAX_COST_USD, KB_DRAIN_HEARTBEAT_MS, KB_DRAIN_DIFF_MAX_LINES,
  // Re-exported from `kb-job-state.ts` through the model, exactly as this file
  // re-exported it before the split — `bridge-studio-kb-drain-w7.test.ts`
  // imports it from here and did not move.
  KB_DRAIN_STALE_MS,
} from './kb-drain-model.ts';
export type {
  KbDrainState, KbDrainProposedChange, KbDrainPerFinding, KbDrainStatus, KbDrainLintFn,
  KbDrainApplyAutoFixesFn,
} from './kb-drain-model.ts';
export {
  writeKbDrainStatus, readKbDrainStatus, findActiveKbDrainRun, latestKbDrainRun, listKbRuns,
  initialKbDrainStatus, requestKbDrainCancel, isKbDrainCancelRequested,
} from './kb-drain-store.ts';
export type { KbRunRow } from './kb-drain-store.ts';
export { finalizeRoundRows } from './kb-drain-model.ts';
export type { KbDrainRoundRow } from './kb-drain-model.ts';

// ---------------------------------------------------------------------------
// The no-spawn stand-in — the only fix-turn implementation left in this package
// ---------------------------------------------------------------------------
//
// M4 ruling 86: the REAL default (`runBrainFixTurn` plus the read-back of its
// `cost_usd` out of `_logs/_brainfix-<runId>/events.jsonl`) moved to
// `apps/forge/routes.ts`, the assembly. It had to: it named
// `@forge/sessions`'s turn AND encoded that turn's own event-log layout, both
// of which are knowledge OF the turn rather than of the drain. What stays here
// is the no-op, which touches no SDK and needs no sessions concept.
//
// The env gate stays here too, and that placement is load-bearing: gating the
// CALL SITE instead (the pre-#164 shape) made every dispatch-counting test
// fail under CI's global FORGE_ARCHITECT_NO_SPAWN=1, and main was red for six
// merges before a tail PR's gate surfaced it.

/**
 * M4 ruling 86 — the refusal for a drain that reaches an agent-tier residual
 * with no turn injected and spawning enabled.
 *
 * LAZY, and that placement was a finding rather than a choice: the first cut
 * threw at SELECTION time, which refused a drain whose findings were all
 * AUTO-tier — drained deterministically, no agent turn ever dispatched. Five
 * of this package's own drain tests failed and were right to: demanding a turn
 * a run will never use is not a safety check, it is a new precondition. Thrown
 * at the CALL, the refusal fires exactly when a turn is actually needed and
 * absent, and an auto-only drain needs no injection at all.
 *
 * A silent fallback here would be worse than either: a caller that forgot to
 * thread `runFixTurn` would get a drain reporting every agent-tier finding
 * uncleared, indistinguishable from a genuinely hard KB.
 */
const refuseUninjectedFixTurn: KbDrainRunFixTurnFn = () => {
  throw new Error(
    'runKbDrain: this drain reached an agent-tier finding but no fix turn was injected ' +
      'and spawning is not disabled — the real brain-fix turn is supplied by the assembly ' +
      '(apps/forge/routes.ts threads it through knowledgeRoutes as `runFixTurn`). Refusing ' +
      'rather than reporting every agent-tier finding uncleared.',
  );
};

/** The no-spawn stand-in for the DEFAULT fix turn under FORGE_ARCHITECT_NO_SPAWN /
 *  dry-bridge: never touches the SDK, leaves the finding uncleared, costs 0. */
async function noSpawnKbDrainFixTurn(input: KbDrainFixTurnInput): Promise<KbDrainFixTurnResult & { costUsd: number }> {
  return { runId: input.runId, cleared: false, costUsd: 0, editAudit: noKbEdits() };
}

// ---------------------------------------------------------------------------
// The drain loop
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The engine's own injectable seams
// ---------------------------------------------------------------------------
//
// These types live HERE, with `runKbDrain`, rather than in `kb-drain-model.ts`
// with the rest of the vocabulary: they describe the fix-turn the engine
// dispatches, which is `runKbDrain`'s own concern.
//
// M4 ruling 86 (amended): THIS PACKAGE DECLARES THE PORT. It used to name
// `@forge/sessions`'s `RunBrainFixInput`/`RunBrainFixResult`, which is an
// upward import — knowledge is rank 2, sessions rank 4 — and carried four
// baseline rows (this file, `bridge-studio-kb-consolidate.ts`, and two of our
// own tests). The first instinct was to lift the shapes into
// `@forge/contracts`, ruling 81's precedent; measured, that was the wrong
// move, because `KbEditGateResult` is OUR type and names `KbEditChange` and
// `KbEditUnsoundness` — so the "lift two types" would have relocated this
// package's brain-edit vocabulary out of it, across six files, for a shape
// only two packages share.
//
// The asymmetry is the answer: sessions importing OUR types is downward and
// legal (`kinds/brain-fix.ts` does exactly that for `KbEditGateResult`), so
// the shared shape needs no neutral home — only the upward DECLARATION has to
// stop. As the consumer we declare what we need from an injected turn, in our
// own vocabulary: findings fields plus our own gate result, no sessions
// concept present. `runKbDrain` never sets `queryFn` or `logsRoot`, so neither
// appears here.
//
// Conformance is enforced where it belongs: `apps/forge/routes.ts` is the one
// place both this port and sessions' real turn are legally visible, and the
// `KnowledgeRouteDeps` typing makes the real function assignable-or-red there
// under the repo-wide build (§15.71 — apps/ is outside every package
// tsconfig, so this only bites in `npm run build`).

/**
 * The fix-turn PORT — `KbDrainFixTurnInput`, `KbDrainFixTurnResult` and
 * `KbDrainRunFixTurnFn` — lives in `kb-drain-model.ts` with the rest of this
 * drain's vocabulary, and is re-exported here because that is where every
 * consumer already looks for the engine's seams.
 *
 * It used to be declared in THIS file for a reason that ruling 86 removed: it
 * named `@forge/sessions`'s input and result, an edge this file carried and
 * the model should not have acquired. The port names no sessions concept any
 * more — findings vocabulary in, this package's own `KbEditGateResult` out —
 * so the vocabulary file is where it belongs.
 */
export type {
  KbDrainFixTurnInput,
  KbDrainFixTurnResult,
  KbDrainRunFixTurnFn,
  GuardedReadSessionStatusFn,
  GuardedWriteSessionStatusFn,
  SessionStatusIoPort,
} from './kb-drain-model.ts';

/** Same signature as the internal `writeKbDrainStatus` (below). Injectable
 *  ONLY so a test can fail a PRECISE persist call (e.g. the very first one)
 *  while later calls to the SAME (forgeRoot, runId) succeed — a filesystem-
 *  level fault (an unwritable dir, a blocked leaf) cannot isolate "first call
 *  fails, second succeeds" because both the initial persist and the
 *  catch-block's crash-recovery persist target the identical on-disk path.
 *  Defaults to the real atomic (temp+rename) writer. */
export type KbDrainPersistFn = (forgeRoot: string, runId: string, status: KbDrainStatus) => void;

export type KbDrainOpts = {
  maxRounds?: number;
  maxCostUsd?: number;
  lint?: KbDrainLintFn;
  applyAutoFixes?: KbDrainApplyAutoFixesFn;
  runFixTurn?: KbDrainRunFixTurnFn;
  /** The guarded session-status IO, as a port (ruling 99) — see
   *  `SessionStatusIoPort` in kb-drain-model.ts. The drain needs it only to
   *  mint a kb-cleanup DRAFT session; absent, that mint refuses by name
   *  rather than writing a status through an unguarded path. */
  sessionStatusIo?: SessionStatusIoPort;
  persistStatus?: KbDrainPersistFn;
  /** Liveness-heartbeat cadence (W7-B2); 0 disables (unit tests). Defaults
   *  to KB_DRAIN_HEARTBEAT_MS. */
  heartbeatMs?: number;
};

/**
 * Drive a single KB's `forge brain lint` findings to a fixed point: drain
 * every AUTO-tier finding deterministically, then dispatch one real agent
 * turn per AGENT-tier residual (sequentially — agent turns share the same
 * on-disk brain corpus, so concurrent turns could race-edit a file), up to
 * `KB_DRAIN_MAX_ROUNDS` rounds or `opts.maxCostUsd`. See the module doc
 * comment above for the full state-machine table.
 *
 * NOT self-serializing — callers (the `POST /drain` route below) MUST
 * dispatch this through `enqueueConsolidate(kbId, …)`, the same per-kbId
 * queue `runBrainConsolidateNow` uses, so a drain and a consolidate against
 * the same kb never race real agent turns on the same files. Calling this
 * directly (as the termination-matrix unit tests do) is fine for a test
 * that owns its own isolated forgeRoot fixture and never runs two drains
 * against the same kb concurrently.
 */
export async function runKbDrain(
  forgeRoot: string,
  kbId: string,
  runId: string,
  opts: KbDrainOpts = {},
): Promise<KbDrainStatus> {
  const lint = opts.lint ?? runBrainLintFullFresh;
  const applyAutoFixes = opts.applyAutoFixes ?? applyAutoFixesUntilStable;
  // CI-safety seam (mirrors runBrainConsolidateNow's own noSpawn guard,
  // packages/knowledge/bridge-studio-kbs.ts:440): under FORGE_ARCHITECT_NO_SPAWN=1 or
  // dry-bridge the DEFAULT fix-turn (a real SDK spawn) is replaced by a no-op
  // that leaves the finding uncleared. A caller-INJECTED opts.runFixTurn is by
  // definition not a real spawn (it is how the termination matrix is unit-
  // tested) and is honored regardless of the env — gating the call site
  // instead (the previous shape) made every dispatch-counting test fail under
  // CI's global FORGE_ARCHITECT_NO_SPAWN=1 (main went red at #164 and stayed
  // red for six merges before the tail PR's gate surfaced it).
  const noSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge();
  // M4 ruling 86 — the real turn is INJECTED, so its absence must be named,
  // not silently tolerated. Before this the fall-through was a real spawn
  // compiled into this package; now a caller that forgot to thread
  // `runFixTurn` would otherwise get a drain that reports every agent-tier
  // finding uncleared and looks like a legitimately hard KB. Fail loud at the
  // seam instead. The no-spawn arm is NOT a fallback for a missing injection:
  // it is the deliberate stand-in when the env forbids spawning at all.
  const runFixTurn: KbDrainRunFixTurnFn =
    opts.runFixTurn ?? (noSpawn ? noSpawnKbDrainFixTurn : refuseUninjectedFixTurn);
  const persistStatus = opts.persistStatus ?? writeKbDrainStatus;
  const maxRounds = opts.maxRounds ?? KB_DRAIN_MAX_ROUNDS;
  const maxCostUsd = opts.maxCostUsd ?? DEFAULT_KB_DRAIN_MAX_COST_USD;
  const heartbeatMs = opts.heartbeatMs ?? KB_DRAIN_HEARTBEAT_MS;

  const cycleId = `_kb-drain-${runId}`;

  // TERMINAL-STATE GUARANTEE (reviewer HIGH finding): everything from the
  // FIRST status write to the LAST emit lives inside the one try below — a
  // throw ANYWHERE in here (createLogger's own mkdirSync, the initial
  // persist, a lint/applyAutoFixes call, …) is caught and converted into an
  // honest 'failed' terminal. Before this fix, the initial persist/emit and
  // the success-path final emit sat OUTSIDE the try: a throw there rejected
  // runKbDrain, enqueueConsolidate's queue continuation SWALLOWS that
  // rejection (packages/knowledge/bridge-studio-kbs.ts's `.catch(() => {})`), and
  // status.json was left at 'running' forever — a silent-forever path no
  // poller could ever resolve out of. `status` is seeded here, BEFORE the
  // try, so the catch block always has a real value to fall back to even if
  // the very first persist inside the try never completed.
  let status: KbDrainStatus = initialKbDrainStatus(kbId, maxRounds, maxCostUsd);
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  try {
    const logger = createLogger(cycleId, join(forgeRoot, '_logs'));

    const persist = (s: KbDrainStatus): KbDrainStatus => {
      persistStatus(forgeRoot, runId, s);
      return s;
    };

    /** W7-B2 (knowledge-01): renderable per-transition progress events onto
     *  the drain's OWN cycle log — the ActivityLog drawer tails these
     *  (`metadata.kind: 'progress'`, apps/studio/lib/activity-log-view.ts). */
    const emitProgress = (message: string, metadata: Record<string, unknown> = {}): void => {
      logger.emit({
        initiative_id: cycleId,
        phase: 'reflection',
        skill: 'kb-drain',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message,
        metadata: { kind: 'progress', kbId, runId, ...metadata },
      });
    };

    logger.emit({
      initiative_id: cycleId,
      phase: 'reflection',
      skill: 'kb-drain',
      event_type: 'start',
      input_refs: [],
      output_refs: [],
      message: 'kb-drain.start',
      metadata: { kbId, runId },
    });

    status = persist(status);

    // W7-B2 (knowledge-14/15): liveness heartbeat — refresh updatedAt while a
    // long agent turn holds the loop, so pollers (and the cancel route's
    // stale check) can tell "in flight" from "dead". Guarded on state so a
    // late tick can never resurrect a terminal status; unref'd so it never
    // keeps the process alive.
    if (heartbeatMs > 0) {
      heartbeat = setInterval(() => {
        if (status.state !== 'running') return;
        try {
          status = persist({ ...status, updatedAt: new Date().toISOString() });
        } catch {
          // best-effort — the next real transition persist is the signal.
        }
      }, heartbeatMs);
      heartbeat.unref?.();
    }

    const brainDir = resolveKbBrainDir(forgeRoot, kbId);
    if (!brainDir) {
      throw new Error(`runKbDrain: kb id "${kbId}" does not resolve to any real brain directory`);
    }
    // W8-F1 — TWO scopes, and the difference is the whole S1-b defect. The
    // agent runs with `cwd = forgeRoot`, so what it CAN write is the whole
    // brain (`brainRoot`); what it MAY write is this KB (`brainDir`). The gate
    // snapshots the former and permits only the latter. Snapshotting the KB
    // alone — what this did before — meant an edit one directory over was
    // never even seen.
    const brainRoot = brainRootDir(forgeRoot);
    const inKb = (f: Finding): boolean => findingUnderDir(forgeRoot, brainDir, f);
    // W7-B2 (knowledge-10): ONE lint lens — the same one buildKbHealth counts
    // from, so the drain can never report green while the health readout on
    // the same screen still counts flags.
    const lintKb = (): Finding[] => collectKbFindings(forgeRoot, kbId, lint(forgeRoot).findings);

    let costUsd = 0;
    let round = 0;
    // Cumulative union of every PRIOR round's post-fix scoped auto+agent
    // finding-KEY set (reviewer MEDIUM finding). Catches a bounded
    // OSCILLATION (A cleared → B appears → A reappears → …) that never
    // within-round-stagnates — `setsEqual(beforeKeys, afterKeys)` below never
    // fires because SOMETHING genuinely changes every single round — but
    // also never converges, without waiting out the full ROUND-CAP budget.
    const everSeenAfterKeys = new Set<string>();
    // W7-B2 (knowledge-12): perFinding accumulates across rounds — every
    // round's work survives to the terminal status, tagged by round.
    const completed: KbDrainPerFinding[] = [];
    // W7-B2 (orch-01): findings whose proposed fix was gated into a draft
    // session this run — never re-dispatched (a second turn would just
    // propose the same prose edit again).
    const draftedKeys = new Map<string, { id: string; project: string }>();
    /** Findings whose agent proposal the edit gate refused (W8-F1) — awaiting
     *  the operator for the same reason a drafted one is. */
    const refusedKeys = new Set<string>();
    /** W8-F1 — every disposal the edit gate could not carry out, across every
     *  round. Non-empty means the tree may not be in the state the gate
     *  intended, so the run may never finish GREEN. */
    const gateErrors: string[] = [];

    const now = (): string => new Date().toISOString();
    const base = { kbId, startedAt: status.startedAt, maxRounds, maxCostUsd };
    const cancelRequested = (): boolean => isKbDrainCancelRequested(forgeRoot, runId);

    for (;;) {
      // Cancel is honored BEFORE any work, not only between agent turns: a run
      // cancelled while it was still QUEUED (the cancel route's forced branch
      // stakes the flag for exactly this case) must terminate without touching
      // a single file — no auto-fix pass, no agent turn.
      if (cancelRequested()) {
        emitProgress('kb-drain.cancelled', { round });
        status = persist({ ...base, state: 'cancelled', round, counts: status.counts, perFinding: [...completed], costUsd, updatedAt: now() });
        break;
      }
      round += 1;
      // Round visible from its START (knowledge-11: no blank round-0 screen).
      emitProgress(`kb-drain.round-start (round ${round}/${maxRounds})`, { round, maxRounds });
      status = persist({ ...base, state: 'running', round, counts: status.counts, perFinding: [...completed], costUsd, updatedAt: now() });

      const before = lintKb();
      const beforeKeys = progressKeySet(before);

      // W8-F1 (ON-3, S2) — the AUTO tier mutates the tree with NO operator
      // approval, and its rows carried no diff at all: a curated
      // `antipatterns.md` was rewritten with the operator's row reading
      // `outcome=cleared` and nothing to inspect. Snapshot around the
      // deterministic fixers and derive each row's diff from what actually
      // changed on disk — the same derivation the agent tier uses, never a
      // description of what a fixer says it did.
      const autoSnapshot = snapshotBrainTree(forgeRoot);
      const autoResult = applyAutoFixes(forgeRoot, { filter: inKb });
      const autoProposals = buildAutoProposedChanges(forgeRoot, brainRoot, diffKbSnapshot(brainRoot, autoSnapshot));
      const autoRows = autoResult.applied.map((x) => autoAppliedEntry(x, round, autoProposals));
      // W8-F1 review round 2 — a mutation NO row claims is a mutation the
      // operator never sees. `autoAppliedEntry` attributes by path, which is
      // as precise as the fixers' flat `applied` list allows, but it is not
      // total: `category.mis-routed` reports `{file: <source>, detail: 'moved
      // to …'}`, so neither the CREATED file's diff nor the index rewrite that
      // follows it matches either clause. Those diffs used to be dropped on
      // the floor. They are collected here instead, on their own row, rather
      // than attributed to a finding that did not cause them.
      const claimed = new Set(autoRows.flatMap((r) => (r.proposedChanges ?? []).map((p) => p.file)));
      const unclaimed = autoProposals.filter((p) => !claimed.has(p.file));
      const roundRows: KbDrainRoundRow[] = [
        ...autoRows,
        ...(unclaimed.length > 0 ? [autoUnattributedEntry(unclaimed, round)] : []),
        ...autoResult.skipped.map((x) => autoSkippedEntry(x, round)),
      ];
      emitProgress(`kb-drain.auto (applied ${autoResult.applied.length}, skipped ${autoResult.skipped.length})`, {
        round, applied: autoResult.applied.length, skipped: autoResult.skipped.length,
      });
      status = persist({ ...base, state: 'running', round, counts: status.counts, perFinding: [...completed, ...pendingRows(roundRows)], costUsd, updatedAt: now() });

      const agentResidual = autoResult.remaining.filter(
        (f): f is Finding & { check: string; kind: string } =>
          f.resolution === 'agent' && typeof f.check === 'string' && typeof f.kind === 'string'
          // W8-F1: a refused proposal is not retried — the next round's agent
          // would propose the same edit and have it refused again, burning
          // cost to reach the same place.
          && !draftedKeys.has(findingKey(f)) && !refusedKeys.has(findingKey(f)),
      );

      let costCeilingHit = false;
      let cancelledMidRound = cancelRequested();
      let turnIndex = 0;
      for (const f of agentResidual) {
        if (cancelledMidRound) break;
        const subRunId = `${runId}__r${round}__${turnIndex}`;
        turnIndex += 1;
        emitProgress(`kb-drain.turn-start (${basename(f.file)} · ${f.check} · ${turnIndex}/${agentResidual.length})`, {
          round, file: f.file, check: f.check, kind: f.kind, turn: turnIndex, turns: agentResidual.length,
        });
        // orch-01 STRUCTURAL GATE — snapshot before the turn, classify after.
        // W8-B2: the slug universe is captured at the SAME instant as the
        // snapshot, so the audit judges the edit against the brain the agent
        // actually saw (auto-fixes and earlier turns in this round have already
        // landed by now).
        const snapshot = snapshotBrainTree(forgeRoot);
        let draftSession: { id: string; project: string } | undefined;
        let turnError: string | undefined;
        // The gate `runBrainFixTurn` ran from the INSIDE. Merged into this
        // call site's own result below, so the row reports "repaired" for what
        // the runner repaired instead of silently calling it "applied".
        let turnAudit: KbEditGateResult | null = null;
        try {
          const result = await runFixTurn({
            runId: subRunId,
            kbId,
            file: f.file,
            check: f.check,
            kind: f.kind,
            fixHint: f.fixHint,
            message: f.message,
            forgeRoot,
          });
          costUsd += result.costUsd;
          turnAudit = result.editAudit ?? null;
        } catch (err) {
          // One turn failing must not abort the rest of the round's queue —
          // mirrors runBrainConsolidateNow's per-group catch. The failure is
          // RECORDED rather than swallowed into the outcome (see `turnError`).
          turnError = sanitizeError(err);
          emitProgress(`kb-drain.turn-failed (${basename(f.file)} · ${turnError})`, {
            round, file: f.file, check: f.check, error: turnError,
          });
        }
        // The turn's `cleared` self-report is DELIBERATELY NOT READ here. It is
        // unreliable by construction: `runBrainFixTurn`'s verification gate
        // re-lints through a forge-only lens, so for a project theme it reports
        // cleared unconditionally for exactly the checks both 2026-08-22 defects
        // involved. The row's outcome is derived from this round's real post-fix
        // lint instead — see `finalizeRoundRows`.
        // The SAME chokepoint `runBrainFixTurn` itself runs. Double-gating is
        // deliberate and idempotent: the real turn is already guarded from the
        // inside, but `runFixTurn` is an INJECTABLE seam (termination-matrix
        // tests drive it with stubs that write files for real), and a gate that
        // an injected implementation can walk around is not a gate.
        const gate: KbEditGateResult = guardAgentKbEdits(forgeRoot, kbId, snapshot);
        // W8-F1 (ON-3) — `turnAudit.changes` is MERGED, not just its verdicts.
        // In production the turn's own gate runs FIRST and reverts what it
        // refuses, so by the time this call diffs the tree there is nothing
        // left to see: `gate.changes` comes back EMPTY and the row lost its
        // proposal diff entirely. "A refused finding SHOWS ITS FIX" only ever
        // looked true because every drain pin drives `runFixTurn` with a stub,
        // which skips the real turn gate. The turn's record holds the agent's
        // original `after`, so it wins on a path collision.
        const changes: KbEditChange[] = [...(turnAudit?.changes ?? [])];
        const seenPaths = new Set(changes.map((c) => c.relPath));
        for (const c of gate.changes) {
          if (!seenPaths.has(c.relPath)) changes.push(c);
        }
        if (turnAudit) {
          gate.unsound.push(...turnAudit.unsound);
          gate.refused.push(...turnAudit.refused);
          gate.repaired.push(...turnAudit.repaired);
          gate.errors.push(...turnAudit.errors);
        }
        // W8-F1 — a REFUSED change may never be drafted. The gate reverts an
        // unsound edit whatever its class now, but the change record still
        // carries the agent's `after`; parking that as a draft would hand the
        // operator a one-click button for exactly the destruction just
        // refused. Approving a draft writes `after` back byte-for-byte.
        // W8-F1 review round 2 — REPAIRED paths are excluded for the same
        // reason refused ones are, and this one bit: removing the class filter
        // means the gate can now REPAIR a `prose` change (write a verified
        // repoint to disk). The change record still carries the agent's
        // original unsound `after`, so leaving it in `proseChanges` made
        // `revertProseChanges` write `before` back over the repair the gate
        // had just written — destroying it — while `buildProposedChanges`
        // still rendered the row `repaired` with a diff of bytes that were no
        // longer on disk. The fix shipping its own defect, third instance.
        const disposedPathSet = new Set([
          ...gate.refused.map((c) => c.relPath),
          ...gate.repaired.map((c) => c.relPath),
        ]);
        const proseChanges = changes.filter((c) => c.klass === 'prose' && !disposedPathSet.has(c.relPath));
        if (gate.unsound.length > 0) {
          for (const u of gate.unsound) {
            emitProgress(`kb-drain.refused (${basename(f.file)} · ${u.kind} · ${u.message})`, {
              round, file: f.file, check: f.check, unsoundKind: u.kind, target: u.target,
              repairTargets: u.repairTargets,
            });
          }
          if (gate.repaired.length > 0) {
            emitProgress(`kb-drain.repaired (${basename(f.file)} · ${gate.repaired.length} file(s) repointed at a target that really exists)`, {
              round, file: f.file, check: f.check, repaired: gate.repaired.map((c) => c.relPath),
            });
          }
        }
        let proseDisposition: 'drafted' | 'refused' = 'refused';
        if (proseChanges.length > 0) {
          // The prose edit NEVER lands directly: restore, then park the
          // proposal as an operator-approved kb-cleanup draft.
          revertProseChanges(brainRoot, proseChanges);
          const minted = mintKbCleanupDraftSession(
            forgeRoot, kbId, brainDir, brainRoot, f, proseChanges, runId, round,
            opts.sessionStatusIo?.write,
          );
          if (minted) {
            proseDisposition = 'drafted';
            draftSession = minted;
            draftedKeys.set(findingKey(f), minted);
            emitProgress(`kb-drain.gated (${basename(f.file)} · prose edit parked as draft ${minted.id})`, {
              round, file: f.file, check: f.check, draftSessionId: minted.id, draftProject: minted.project,
            });
          } else {
            emitProgress(`kb-drain.gated (${basename(f.file)} · prose edit reverted; draft session could NOT be written)`, {
              round, file: f.file, check: f.check,
            });
          }
        }
        for (const err of gate.errors) {
          gateErrors.push(err);
          emitProgress(`kb-drain.gate-error (${basename(f.file)} · ${err})`, {
            round, file: f.file, check: f.check, gateError: err,
          });
        }
        if (gate.refused.length > 0 || gate.errors.length > 0) refusedKeys.add(findingKey(f));
        roundRows.push({
          key: findingKey(f), check: f.check, kind: f.kind, file: f.file, message: f.message,
          tier: 'agent', round,
          ...(draftSession ? { draftSession } : {}),
          ...(turnError ? { turnError } : {}),
          ...(f.fixHint ? { fixHint: f.fixHint } : {}),
          ...(changes.length > 0
            ? { proposedChanges: buildProposedChanges(forgeRoot, brainRoot, changes, gate, proseChanges, proseDisposition) }
            : {}),
        });
        emitProgress(`kb-drain.turn-end (${basename(f.file)} · $${costUsd.toFixed(2)})`, {
          round, file: f.file, check: f.check, costUsd,
        });
        status = persist({ ...base, state: 'running', round, counts: status.counts, perFinding: [...completed, ...pendingRows(roundRows)], costUsd, updatedAt: now() });
        if (costUsd >= maxCostUsd) {
          costCeilingHit = true;
          break;
        }
        if (cancelRequested()) {
          cancelledMidRound = true;
          break;
        }
      }

      const after = lintKb();
      const counts = resolutionCounts(after);
      // W8-B2 (forge-6gu): `afterKeys` is hoisted ABOVE the push so every row
      // this round produced is reconciled against the round's own real lint
      // before it is ever recorded. It used to be computed ~35 lines further
      // down, for the no-progress check alone, while the rows were finalized
      // from the agent's self-report — the whole defect in one ordering.
      const afterKeys = progressKeySet(after);
      completed.push(...finalizeRoundRows(roundRows, afterKeys));
      const withUserRows = (): KbDrainPerFinding[] => {
        const rows = [...completed];
        for (const f of after) {
          if (f.resolution !== 'user') continue;
          rows.push({ key: findingKey(f), check: f.check ?? '', kind: f.kind ?? '', file: f.file, message: f.message, tier: 'user', outcome: 'needs-you', round });
        }
        return rows;
      };

      if (cancelledMidRound || cancelRequested()) {
        emitProgress('kb-drain.cancelled', { round });
        status = persist({ ...base, state: 'cancelled', round, counts, perFinding: withUserRows(), costUsd, updatedAt: now() });
        break;
      }

      if (costCeilingHit) {
        status = persist({ ...base, state: 'cost-ceiling', round, counts, perFinding: withUserRows(), costUsd, updatedAt: now() });
        break;
      }

      // orch-01: every remaining agent finding is parked as a draft → the
      // run is honestly waiting on the OPERATOR, not on more rounds.
      //
      // W8-F1: a REFUSED finding is waiting on the operator too. More rounds
      // cannot help — the agent's proposal was rejected on its merits and only
      // a human can decide what to do instead — so it belongs on the same
      // surface as a draft, not in `no-progress`.
      const remainingAgent = after.filter((f) => f.resolution === 'agent');
      const awaitingOperator = (f: Finding): boolean =>
        draftedKeys.has(findingKey(f)) || refusedKeys.has(findingKey(f));
      if (counts.auto === 0 && remainingAgent.length > 0 && remainingAgent.every(awaitingOperator)) {
        status = persist({ ...base, state: 'needs-you', round, counts, perFinding: withUserRows(), costUsd, updatedAt: now() });
        break;
      }

      if (counts.auto === 0 && counts.agent === 0) {
        // W8-F1: a run whose gate could not dispose of a write has no business
        // reporting GREEN — green is a claim about the tree, and the gate has
        // just said it does not know what state the tree is in.
        const terminalState: KbDrainState =
          counts.user === 0 && gateErrors.length === 0 ? 'green' : 'needs-you';
        status = persist({ ...base, state: terminalState, round, counts, perFinding: withUserRows(), costUsd, updatedAt: now() });
        break;
      }

      const oscillating = afterKeys.size > 0 && [...afterKeys].every((k) => everSeenAfterKeys.has(k));
      if (setsEqual(beforeKeys, afterKeys) || oscillating) {
        status = persist({ ...base, state: 'no-progress', round, counts, perFinding: withUserRows(), costUsd, updatedAt: now() });
        break;
      }
      for (const k of afterKeys) everSeenAfterKeys.add(k);

      if (round >= maxRounds) {
        status = persist({ ...base, state: 'round-cap', round, counts, perFinding: withUserRows(), costUsd, updatedAt: now() });
        break;
      }

      status = persist({ ...base, state: 'running', round, counts, perFinding: [...completed], costUsd, updatedAt: now() });
    }

    logger.emit({
      initiative_id: cycleId,
      phase: 'reflection',
      skill: 'kb-drain',
      event_type: 'end',
      input_refs: [],
      output_refs: [],
      cost_usd: status.costUsd,
      message: `kb-drain.end (state=${status.state})`,
      metadata: { kbId, runId, state: status.state, round: status.round, costUsd: status.costUsd },
    });
    return status;
  } catch (err) {
    const failedStatus: KbDrainStatus = { ...status, state: 'failed', updatedAt: new Date().toISOString() };
    // Best-effort crash event — a FRESH createLogger call (the one inside the
    // try above may never have been reached, or may itself be what threw),
    // wrapped so a second failure here can never mask the original error or
    // block the status persist below (the load-bearing terminal signal).
    try {
      const crashLogger = createLogger(cycleId, join(forgeRoot, '_logs'));
      crashLogger.emit({
        initiative_id: cycleId,
        phase: 'reflection',
        skill: 'kb-drain',
        event_type: 'error',
        input_refs: [],
        output_refs: [],
        message: 'kb-drain.crashed',
        metadata: { kbId, runId, error: err instanceof Error ? err.message : String(err) },
      });
    } catch {
      // best-effort — the persist below is the real terminal signal.
    }
    try {
      persistStatus(forgeRoot, runId, failedStatus);
    } catch (persistErr) {
      // The persist itself failing means NO terminal signal reaches disk at
      // all — the exact silent-forever failure mode this restructure exists
      // to close. Never swallow it: log to stderr and rethrow so it is at
      // least visible (to enqueueConsolidate's caller-side await, and to any
      // process supervisor watching stderr).
      // eslint-disable-next-line no-console
      console.error(
        `runKbDrain: FAILED to persist terminal 'failed' status for ${runId} (kb ${kbId}) after a crash ` +
          `(${err instanceof Error ? err.message : String(err)}) — the status.json write itself threw:`,
        persistErr,
      );
      throw persistErr;
    }
    return failedStatus;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
