/**
 * KB drain-to-green bridge job (W6-B12).
 *
 * Operator intent: ONE button on KB health → forge iteratively remedies ALL
 * lint issues for a KB until it is green, or honestly stops and says why. This
 * module is the BRIDGE JOB + its routes; W6-B13 adds the Studio button/UI that
 * dispatches it. Nothing here is imported by forge-ui — no UI wiring in this file.
 *
 * New file (not folded into cli/bridge-studio-kbs.ts, already at the 800-line
 * cap) — follows that module's conventions: never imports ./ui-bridge.ts,
 * reuses its shared helpers (sendJson/allowedOrigin/sanitizeError/pathOnly/
 * StudioContext from ./bridge-studio.ts), and reuses ITS per-kbId serialization
 * queue (`enqueueConsolidate`, exported from cli/bridge-studio-kbs.ts precisely
 * so a second caller can share the same lock — see that export's own doc
 * comment) so a drain run and a consolidate run against the SAME kb can never
 * race real agent turns against each other's files.
 *
 * THE STATE MACHINE. `runKbDrain` loops (max `KB_DRAIN_MAX_ROUNDS` rounds):
 * fresh-lint → scope to kb → drain the AUTO tier to a fixed point
 * (`applyAutoFixesUntilStable`) → sequentially dispatch ONE `runBrainFixTurn`
 * per AGENT-tier residual (same per-finding prompt shape
 * `LintResolutionPanel.tsx`'s `fixAllAgent` already dispatches, forge-ui/
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

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isSafeRunId } from '../orchestrator/run-agent.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';
import { createLogger } from '../orchestrator/logging.ts';
import { runBrainFixTurn, type RunBrainFixInput, type RunBrainFixResult } from '../orchestrator/brain-fix-runner.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import {
  applyAutoFixesUntilStable,
  resolutionCounts,
  type AutoFixStableResult,
  type Finding,
} from './brain-lint.ts';
import { scopeFindingsToKb, findingUnderDir, runBrainLintFullFresh } from './kb-lint-summary.ts';
import { enqueueConsolidate } from './bridge-studio-kbs.ts';
import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext } from './bridge-studio.ts';
import { isDryBridge } from './dry-bridge.ts';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** "max 5 rounds" per the initiative brief — a round is a full
 *  fresh-lint→auto-drain→agent-turns→fresh-lint cycle. */
export const KB_DRAIN_MAX_ROUNDS = 5;

/** Operator-confirmable default cost ceiling for one drain RUN (not one
 *  turn) — proposed at 2.00 USD, sized against a real per-finding
 *  `brain-fix` turn's typical cost (a handful of cents to low tens of
 *  cents per turn observed on the consolidate path) times a KB's realistic
 *  worst-case agent-tier finding count. Overridable per-run via
 *  `opts.maxCostUsd`. */
export const DEFAULT_KB_DRAIN_MAX_COST_USD = 2.0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type KbDrainState =
  | 'running'
  | 'green'
  | 'needs-you'
  | 'no-progress'
  | 'round-cap'
  | 'cost-ceiling'
  | 'failed';

export type KbDrainPerFinding = {
  key: string;
  check: string;
  kind: string;
  file: string;
  message: string;
  tier: 'auto' | 'agent' | 'user';
  outcome: 'cleared' | 'not-cleared' | 'needs-you';
};

export type KbDrainStatus = {
  state: KbDrainState;
  round: number;
  counts: { auto: number; agent: number; user: number };
  perFinding: KbDrainPerFinding[];
  costUsd: number;
  updatedAt: string;
  kbId: string;
};

/** Same fresh-lint shape `runBrainLintFullFresh` (cli/kb-lint-summary.ts)
 *  returns — injectable so termination-matrix tests can drive the state
 *  machine with a synthetic finding sequence instead of a real brain-lint
 *  scan. */
export type KbDrainLintFn = (forgeRoot: string) => { findings: Finding[] };

/** Same signature as `applyAutoFixesUntilStable` (cli/brain-lint.ts) —
 *  injectable for the same reason as `KbDrainLintFn`. */
export type KbDrainApplyAutoFixesFn = (
  forgeRoot: string,
  opts: { maxRounds?: number; filter?: (f: Finding) => boolean },
) => AutoFixStableResult;

/** Same input as `runBrainFixTurn` (orchestrator/brain-fix-runner.ts), but
 *  the result additionally carries `costUsd` — `RunBrainFixResult` itself
 *  does not return cost (it only logs `cost_usd` on the turn's own 'end'
 *  event), so the default implementation reads it back out of that event
 *  log (`readBrainFixTurnCostUsd` below) after every real turn. Injectable
 *  so termination-matrix tests (esp. the cost-ceiling case) can hand back a
 *  precise, deterministic cost per call without a real SDK turn. */
export type KbDrainRunFixTurnFn = (
  input: RunBrainFixInput,
) => Promise<RunBrainFixResult & { costUsd: number }>;

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
  persistStatus?: KbDrainPersistFn;
};

// ---------------------------------------------------------------------------
// Status-file persistence (_logs/_kb-drain-<runId>/status.json)
// ---------------------------------------------------------------------------

/** `_logs/_kb-drain-<runId>` — same construction class as
 *  `writeConsolidateTerminalEvent`'s `_logs/_brainfix-<runId>`
 *  (cli/bridge-studio-kbs.ts): a bare `runId` parameter matches the
 *  raw-fs-guarded lint's curated taint-list name, but at every real call
 *  site the value is TRUSTED AT CONSTRUCTION — either freshly minted by
 *  `POST /api/studio/kbs/:id/drain` as `` `${kbId}-drain-${Date.now()
 *  .toString(36)}` `` (kbId already `SLUG_RE`-gated at that same route
 *  strictly before this is ever called), or read back via `isSafeRunId` +
 *  an explicit `${kbId}-drain-` PREFIX check at the two GET routes below
 *  (never trusted on charset alone). Documented in
 *  docs/security-request-path-audit.md's "Extended in W6-B12" section;
 *  allowlisted in scripts/check-raw-fs-guarded.mjs. */
function kbDrainLogDir(forgeRoot: string, runId: string): string {
  return join(forgeRoot, '_logs', `_kb-drain-${runId}`);
}

/** Atomic write (temp + rename) — mirrors this repo's own convention
 *  (cli/bridge-studio-runs.ts's manifest-move: `writeFileSync(tmpPath, …)`
 *  then `renameSync(tmpPath, toPath)`). `status.json` is read by a SEPARATE
 *  process turn (the GET routes, polled every ~100-250ms by a caller) while
 *  this function is called repeatedly (once per round) by the in-flight
 *  drain — a plain `writeFileSync` on the final path would let a concurrent
 *  reader observe a PARTIALLY-written file (the write is not one syscall for
 *  a multi-KB JSON blob); `renameSync` on the same filesystem is atomic, so
 *  a reader only ever sees the FULLY-written prior version or the
 *  FULLY-written new one, never a truncated/interleaved one. */
function writeKbDrainStatus(forgeRoot: string, runId: string, status: KbDrainStatus): void {
  const logDir = kbDrainLogDir(forgeRoot, runId);
  mkdirSync(logDir, { recursive: true });
  const finalPath = join(logDir, 'status.json');
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(status, null, 2), 'utf8');
  renameSync(tmpPath, finalPath);
}

/** Mirrors `readBrainFixState`'s (cli/bridge-studio-kbs.ts) LOG-READ shape:
 *  a boolean-existence probe plus a single scoped read, never a directory
 *  walk keyed off caller input. Returns `null` on any missing/unparseable
 *  status file — a genuinely unknown or not-yet-started run, never a thrown
 *  500. */
function readKbDrainStatus(forgeRoot: string, runId: string): KbDrainStatus | null {
  const statusPath = join(kbDrainLogDir(forgeRoot, runId), 'status.json');
  if (!existsSync(statusPath)) return null;
  try {
    return JSON.parse(readFileSync(statusPath, 'utf8')) as KbDrainStatus;
  } catch {
    return null;
  }
}

/** Every drain run recorded for `kbId`, discovered by enumerating `_logs/`
 *  (SERVER-enumerated directory names, never a caller-supplied path — same
 *  "server-enumerated names, holding no client string" class as
 *  `cli/metrics.ts`'s `listCycles`) and filtering to this kb's own
 *  `_kb-drain-<kbId>-drain-*` prefix. Used by BOTH the 409-active check
 *  (`POST /drain`) and the active-or-latest reattach route
 *  (`GET /drain`). */
function findKbDrainRuns(forgeRoot: string, kbId: string): Array<{ runId: string; status: KbDrainStatus }> {
  const logsRoot = join(forgeRoot, '_logs');
  if (!existsSync(logsRoot)) return [];
  let entries: string[];
  try {
    entries = readdirSync(logsRoot);
  } catch {
    return [];
  }
  const dirPrefix = '_kb-drain-';
  const runIdPrefix = `${kbId}-drain-`;
  const runs: Array<{ runId: string; status: KbDrainStatus }> = [];
  for (const name of entries) {
    if (!name.startsWith(dirPrefix)) continue;
    const runId = name.slice(dirPrefix.length);
    if (!runId.startsWith(runIdPrefix)) continue;
    const status = readKbDrainStatus(forgeRoot, runId);
    if (status) runs.push({ runId, status });
  }
  return runs;
}

function findActiveKbDrainRun(forgeRoot: string, kbId: string): { runId: string; status: KbDrainStatus } | null {
  return findKbDrainRuns(forgeRoot, kbId).find((r) => r.status.state === 'running') ?? null;
}

function latestKbDrainRun(forgeRoot: string, kbId: string): { runId: string; status: KbDrainStatus } | null {
  const runs = findKbDrainRuns(forgeRoot, kbId);
  if (runs.length === 0) return null;
  return runs.reduce((a, b) => (a.status.updatedAt >= b.status.updatedAt ? a : b));
}

function initialKbDrainStatus(kbId: string): KbDrainStatus {
  return { state: 'running', round: 0, counts: { auto: 0, agent: 0, user: 0 }, perFinding: [], costUsd: 0, kbId, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Default fix-turn: runBrainFixTurn + its cost read back from its own log
// ---------------------------------------------------------------------------

/** Reads a brain-fix SUB-turn's own terminal `cost_usd` back out of its event
 *  log. `subRunId` is NEVER request-derived — it is always synthesized here
 *  as `` `${runId}__r${round}__${i}` ``, never the route's own `runId` — so
 *  unlike the drain run's own log helpers above this needs no allowlist
 *  entry (no curated taint-list name reaches it). Mirrors
 *  `readBrainFixState`'s scan-backward shape but extracts `cost_usd`
 *  (a top-level field `runBrainFixTurn` emits on its 'end' event, per
 *  orchestrator/brain-fix-runner.ts) instead of the cleared/failed state.
 *  Returns 0 on any read/parse failure or a crashed turn — a failed turn
 *  accrues zero cost toward the ceiling, matching `runBrainFixTurn`'s own
 *  crash path (it never reaches the cost-bearing 'end' event). */
function readBrainFixTurnCostUsd(forgeRoot: string, subRunId: string): number {
  const evPath = join(forgeRoot, '_logs', `_brainfix-${subRunId}`, 'events.jsonl');
  if (!existsSync(evPath)) return 0;
  let raw: string;
  try {
    raw = readFileSync(evPath, 'utf8');
  } catch {
    return 0;
  }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; cost_usd?: number };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.event_type === 'end' || ev.message?.startsWith('brain-fix.end')) {
      return typeof ev.cost_usd === 'number' ? ev.cost_usd : 0;
    }
    if (ev.event_type === 'error' || ev.message === 'brain-fix.crashed') return 0;
  }
  return 0;
}

async function defaultKbDrainFixTurn(input: RunBrainFixInput): Promise<RunBrainFixResult & { costUsd: number }> {
  const result = await runBrainFixTurn(input);
  const costUsd = readBrainFixTurnCostUsd(input.forgeRoot, input.runId);
  return { ...result, costUsd };
}

// ---------------------------------------------------------------------------
// perFinding builders
// ---------------------------------------------------------------------------

function autoAppliedEntry(item: AutoFixStableResult['applied'][number]): KbDrainPerFinding {
  return { key: `${item.kind}::${item.file}`, check: item.kind, kind: item.kind, file: item.file, message: item.detail, tier: 'auto', outcome: 'cleared' };
}

function autoSkippedEntry(item: AutoFixStableResult['skipped'][number]): KbDrainPerFinding {
  return { key: `${item.kind}::${item.file}`, check: item.kind, kind: item.kind, file: item.file, message: item.reason, tier: 'auto', outcome: 'not-cleared' };
}

function findingKey(f: Finding): string {
  return `${f.kind ?? f.check ?? ''}::${f.file}`;
}

function progressKeySet(findings: readonly Finding[]): Set<string> {
  return new Set(
    findings.filter((f) => f.resolution === 'auto' || f.resolution === 'agent').map(findingKey),
  );
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The drain loop
// ---------------------------------------------------------------------------

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
  const noSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge();
  const runFixTurn = opts.runFixTurn ?? defaultKbDrainFixTurn;
  const persistStatus = opts.persistStatus ?? writeKbDrainStatus;
  const maxRounds = opts.maxRounds ?? KB_DRAIN_MAX_ROUNDS;
  const maxCostUsd = opts.maxCostUsd ?? DEFAULT_KB_DRAIN_MAX_COST_USD;

  const cycleId = `_kb-drain-${runId}`;

  // TERMINAL-STATE GUARANTEE (reviewer HIGH finding): everything from the
  // FIRST status write to the LAST emit lives inside the one try below — a
  // throw ANYWHERE in here (createLogger's own mkdirSync, the initial
  // persist, a lint/applyAutoFixes call, …) is caught and converted into an
  // honest 'failed' terminal. Before this fix, the initial persist/emit and
  // the success-path final emit sat OUTSIDE the try: a throw there rejected
  // runKbDrain, enqueueConsolidate's queue continuation SWALLOWS that
  // rejection (cli/bridge-studio-kbs.ts's `.catch(() => {})`), and
  // status.json was left at 'running' forever — a silent-forever path no
  // poller could ever resolve out of. `status` is seeded here, BEFORE the
  // try, so the catch block always has a real value to fall back to even if
  // the very first persist inside the try never completed.
  let status: KbDrainStatus = initialKbDrainStatus(kbId);

  try {
    const logger = createLogger(cycleId, join(forgeRoot, '_logs'));

    const persist = (s: KbDrainStatus): KbDrainStatus => {
      persistStatus(forgeRoot, runId, s);
      return s;
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

    const brainDir = resolveKbBrainDir(forgeRoot, kbId);
    if (!brainDir) {
      throw new Error(`runKbDrain: kb id "${kbId}" does not resolve to any real brain directory`);
    }
    const inKb = (f: Finding): boolean => findingUnderDir(forgeRoot, brainDir, f);

    let costUsd = 0;
    let round = 0;
    // Cumulative union of every PRIOR round's post-fix scoped auto+agent
    // finding-KEY set (reviewer MEDIUM finding). Catches a bounded
    // OSCILLATION (A cleared → B appears → A reappears → …) that never
    // within-round-stagnates — `setsEqual(beforeKeys, afterKeys)` below never
    // fires because SOMETHING genuinely changes every single round — but
    // also never converges, without waiting out the full ROUND-CAP budget.
    const everSeenAfterKeys = new Set<string>();

    for (;;) {
      round += 1;

      const before = scopeFindingsToKb(forgeRoot, kbId, lint(forgeRoot).findings);
      const beforeKeys = progressKeySet(before);

      const autoResult = applyAutoFixes(forgeRoot, { filter: inKb });
      const agentResidual = autoResult.remaining.filter(
        (f): f is Finding & { check: string; kind: string } =>
          f.resolution === 'agent' && typeof f.check === 'string' && typeof f.kind === 'string',
      );

      const perFinding: KbDrainPerFinding[] = [
        ...autoResult.applied.map(autoAppliedEntry),
        ...autoResult.skipped.map(autoSkippedEntry),
      ];

      let costCeilingHit = false;
      let turnIndex = 0;
      for (const f of agentResidual) {
        const subRunId = `${runId}__r${round}__${turnIndex}`;
        turnIndex += 1;
        let outcome: 'cleared' | 'not-cleared' = 'not-cleared';
        if (noSpawn) {
          // CI-safety seam (mirrors runBrainConsolidateNow's own noSpawn
          // guard, cli/bridge-studio-kbs.ts): under FORGE_ARCHITECT_NO_SPAWN=1
          // or dry-bridge, the CONFIGURED runFixTurn — default OR
          // test-injected — is never actually called; the finding is left
          // uncleared so a CI/dry-bridge run against a KB that happens to
          // carry a genuine agent-tier residual still reaches an honest
          // terminal instead of making (or even risking) a real SDK call.
          // Gating the CALL SITE rather than the implementation SELECTION
          // means this holds even for a caller-supplied opts.runFixTurn —
          // defense in depth, and what makes the seam directly spy-able in a
          // unit test (inject a call-counting spy + set FORGE_DRY_BRIDGE=1 →
          // expect zero calls).
          outcome = 'not-cleared';
        } else {
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
            outcome = result.cleared ? 'cleared' : 'not-cleared';
          } catch {
            // One turn failing must not abort the rest of the round's queue —
            // mirrors runBrainConsolidateNow's per-group catch.
          }
        }
        perFinding.push({ key: findingKey(f), check: f.check, kind: f.kind, file: f.file, message: f.message, tier: 'agent', outcome });
        if (costUsd >= maxCostUsd) {
          costCeilingHit = true;
          break;
        }
      }

      const after = scopeFindingsToKb(forgeRoot, kbId, lint(forgeRoot).findings);
      const counts = resolutionCounts(after);
      for (const f of after) {
        if (f.resolution !== 'user') continue;
        perFinding.push({ key: findingKey(f), check: f.check ?? '', kind: f.kind ?? '', file: f.file, message: f.message, tier: 'user', outcome: 'needs-you' });
      }

      if (costCeilingHit) {
        status = persist({ state: 'cost-ceiling', round, counts, perFinding, costUsd, kbId, updatedAt: new Date().toISOString() });
        break;
      }

      if (counts.auto === 0 && counts.agent === 0) {
        const terminalState: KbDrainState = counts.user === 0 ? 'green' : 'needs-you';
        status = persist({ state: terminalState, round, counts, perFinding, costUsd, kbId, updatedAt: new Date().toISOString() });
        break;
      }

      const afterKeys = progressKeySet(after);
      const oscillating = afterKeys.size > 0 && [...afterKeys].every((k) => everSeenAfterKeys.has(k));
      if (setsEqual(beforeKeys, afterKeys) || oscillating) {
        status = persist({ state: 'no-progress', round, counts, perFinding, costUsd, kbId, updatedAt: new Date().toISOString() });
        break;
      }
      for (const k of afterKeys) everSeenAfterKeys.add(k);

      if (round >= maxRounds) {
        status = persist({ state: 'round-cap', round, counts, perFinding, costUsd, kbId, updatedAt: new Date().toISOString() });
        break;
      }

      status = persist({ state: 'running', round, counts, perFinding, costUsd, kbId, updatedAt: new Date().toISOString() });
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
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Handle the KB drain-to-green routes:
 *   POST /api/studio/kbs/:id/drain             → dispatch, { ok, runId } (409 if active)
 *   GET  /api/studio/kbs/:id/drain/:runId      → a specific run's status
 *   GET  /api/studio/kbs/:id/drain             → the active run, or the latest terminal one
 *
 * Returns false for non-matching URLs (passthrough), never throws.
 */
export async function handleStudioKbDrainRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/drain/:runId — must match BEFORE the bare
  // /drain routes below (more specific path). --------------------------------
  const specificMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain\/([^/]+)$/);
  if (specificMatch && method === 'GET') {
    const kbId = decodeURIComponent(specificMatch[1]);
    const runId = decodeURIComponent(specificMatch[2]);
    if (!SLUG_RE.test(kbId)) {
      sendJson(res, 400, { error: 'invalid kb id' }, origin);
      return true;
    }
    // Never trust runId alone to reach a dir: charset-gated (isSafeRunId,
    // blocks '/' and '..') AND kbId-prefix-checked (a syntactically valid but
    // foreign-kb runId is treated identically to an unknown one — same
    // "unknown drain run" 404, no information about WHICH check failed).
    if (!isSafeRunId(runId) || !runId.startsWith(`${kbId}-drain-`)) {
      sendJson(res, 404, { error: 'unknown drain run' }, origin);
      return true;
    }
    const status = readKbDrainStatus(ctx.forgeRoot, runId);
    if (!status) {
      sendJson(res, 404, { error: 'unknown drain run' }, origin);
      return true;
    }
    sendJson(res, 200, { ok: true, runId, ...status }, origin);
    return true;
  }

  const baseMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain$/);

  // ---- POST /api/studio/kbs/:id/drain — dispatch ---------------------------
  if (baseMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(baseMatch[1]);
      if (!SLUG_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      if (!resolveKbBrainDir(ctx.forgeRoot, kbId)) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      const active = findActiveKbDrainRun(ctx.forgeRoot, kbId);
      if (active) {
        sendJson(res, 409, { error: 'a drain run is already active for this kb', runId: active.runId }, origin);
        return true;
      }

      // Server-minted, kbId-prefixed — mirrors consolidate's own
      // `${kbId}-consolidate-${Date.now().toString(36)}` runId shape
      // (cli/bridge-studio-kbs.ts).
      const runId = `${kbId}-drain-${Date.now().toString(36)}`;

      // Write the initial 'running' snapshot SYNCHRONOUSLY, before queuing —
      // enqueueConsolidate defers real execution (CONSOLIDATE_DISPATCH_DEFER_MS),
      // so without this an immediate second POST would race past the 409
      // check above and see no status file yet. runKbDrain also (re-)writes
      // this same snapshot as its own first step, so a caller that invokes it
      // directly (unit tests) still gets a real initial status.
      writeKbDrainStatus(ctx.forgeRoot, runId, initialKbDrainStatus(kbId));

      enqueueConsolidate(kbId, async () => {
        await runKbDrain(ctx.forgeRoot, kbId, runId);
      });
      sendJson(res, 200, { ok: true, runId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id/drain — active-or-latest (page reattach) ---
  if (baseMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(baseMatch[1]);
      if (!SLUG_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      const chosen = findActiveKbDrainRun(ctx.forgeRoot, kbId) ?? latestKbDrainRun(ctx.forgeRoot, kbId);
      if (!chosen) {
        sendJson(res, 200, { ok: true, runId: null }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, runId: chosen.runId, ...chosen.status }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
