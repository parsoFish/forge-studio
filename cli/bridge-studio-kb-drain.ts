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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';

import { isSafeRunId } from '../orchestrator/run-agent.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';
import { createLogger } from '../orchestrator/logging.ts';
import { runBrainFixTurn, type RunBrainFixInput, type RunBrainFixResult } from '../orchestrator/brain-fix-runner.ts';
import { KB_ID_RE } from '../orchestrator/studio/validate.ts';
import { guardedWriteSessionStatus } from '../orchestrator/interactive-session.ts';
import { loadConfig, defaultConfigPath, resolveProjectsDir } from '../orchestrator/config.ts';
import { loadKbDescriptor } from '../orchestrator/studio/kb-descriptor.ts';
import {
  applyAutoFixesUntilStable,
  resolutionCounts,
  type AutoFixStableResult,
  type Finding,
} from './brain-lint.ts';
import { collectKbFindings, ownThemeFindingsLens, findingUnderDir, runBrainLintFullFresh } from './kb-lint-summary.ts';
import { enqueueConsolidate, KB_SEEDING_ANCHOR_PREFIX } from './bridge-studio-kbs.ts';
import { diffKbSnapshot, buildUnifiedDiff, type KbEditChange } from './kb-drain-structural.ts';
import {
  guardAgentKbEdits, auditKbEdit, buildKbEditSoundnessCtx, snapshotBrainTree, brainRootDir, noKbEdits,
  type KbEditGateResult, type KbEditUnsoundness,
} from './kb-drain-edit-soundness.ts';
import { deriveKbActiveJob, activeJobReason, KB_DRAIN_STALE_MS, parseKbRunEvents, terminalKbRunEvent, firstKbRunEventTs } from './kb-job-state.ts';
import { guardedWriteFile } from './studio-path-guard.ts';
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

/** W7-B2 (knowledge-14/15): while the loop is inside a long agent turn it
 *  cannot persist a real transition, so it refreshes `status.json`'s
 *  `updatedAt` on this cadence instead — a liveness heartbeat that lets the
 *  UI poll distinguish "long turn in flight" from "bridge died mid-drain"
 *  without any pid bookkeeping (the drain runs in-process on the bridge). */
export const KB_DRAIN_HEARTBEAT_MS = 10_000;

/** Staleness cutoff for a 'running' status — SINGLE-SOURCED in
 *  cli/kb-job-state.ts (the active-job derivation shares it); re-exported
 *  here for this module's own cancel route and its tests. */
export { KB_DRAIN_STALE_MS };

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
  | 'cancelled'
  | 'failed';

/**
 * W8-B2 (ON-3) — what the fix turn actually PROPOSED for one file, and what
 * became of it.
 *
 * Operator note ON-3: "it's very hard to see what changes are being proposed
 * when it raises those up to the operator, and there's no way to drill into
 * what it thinks the issues are and what it's trying to do to fix them."
 * Before this, the entire per-finding UI was a glyph, a filename basename, a
 * rule id and one sentence — the diff existed (the structural gate computes it
 * to render the draft plan) and simply never reached the row.
 */
export type KbDrainProposedChange = {
  /** Path relative to forgeRoot — greppable, and the same label the gated
   *  draft plan uses for the same file. */
  file: string;
  /** Unified diff of the proposal, truncated at `KB_DRAIN_DIFF_MAX_LINES`. */
  diff: string;
  /** True when `diff` was cut short — never a silently shortened diff. */
  diffTruncated: boolean;
  /**
   * What became of the proposal:
   *   - `applied`  — sound and structural; it is on disk.
   *   - `repaired` — unsound; the drain wrote a verified repair instead.
   *   - `refused`  — unsound with no unique repair; reverted, nothing landed.
   *   - `drafted`  — prose; reverted and parked for operator approval.
   */
  disposition: 'applied' | 'repaired' | 'refused' | 'drafted';
  /** The soundness audit's own reasons, verbatim. Empty for `applied`. */
  reasons: string[];
};

/** Line cap for one rendered proposal diff. A theme is lint-capped at 800
 *  lines, but a turn can touch several files and the whole status object is
 *  polled; truncation is DECLARED on the row (`diffTruncated`) so a cut diff
 *  can never read as a small one. */
export const KB_DRAIN_DIFF_MAX_LINES = 200;

export type KbDrainPerFinding = {
  key: string;
  check: string;
  kind: string;
  file: string;
  message: string;
  tier: 'auto' | 'agent' | 'user';
  /** W8-B2 — DERIVED, never stored from a self-report. `pending` is the honest
   *  in-flight value: the turn has run and this round's post-fix lint has not.
   *  `finalizeRoundRows` (below) is the ONLY producer of a terminal value, and
   *  it reads the post-fix lint's own key set. */
  outcome: 'cleared' | 'not-cleared' | 'needs-you' | 'pending';
  /** W7-B2 (knowledge-12): the round this entry was recorded in — perFinding
   *  accumulates across rounds now, so a finished run keeps every round's
   *  work instead of only the last round's list. */
  round: number;
  /** W7-B2 (orch-01): set when this finding's agent fix was GATED — the
   *  proposed prose edit was reverted and parked as a kb-cleanup draft
   *  session the operator approves with a diff. */
  draftSession?: { id: string; project: string };
  /** W8-B2: the fix turn threw. A SEPARATE fact from `outcome`, deliberately:
   *  a turn can crash after writing a valid edit, and the round's post-fix lint
   *  — not the crash — is the authority on whether the finding cleared. Before
   *  this field existed the crash was silently folded into `not-cleared`, which
   *  produced a green run carrying a not-cleared row for a finding its own lint
   *  said was gone. */
  turnError?: string;
  /** W8-B2 (ON-3): every file the turn proposed to change for this finding,
   *  with its diff and its disposition. */
  proposedChanges?: KbDrainProposedChange[];
  /** W8-B2 (ON-3): the targeted instruction the fix turn was given for this
   *  finding (`Finding.fixHint`) — the closest thing to the agent's brief, and
   *  the thing that explains WHY it did what the diff shows. */
  fixHint?: string;
};

export type KbDrainStatus = {
  state: KbDrainState;
  round: number;
  counts: { auto: number; agent: number; user: number };
  perFinding: KbDrainPerFinding[];
  costUsd: number;
  updatedAt: string;
  kbId: string;
  /** W7-B2 (knowledge-14): when the run started — the UI's elapsed ticker. */
  startedAt: string;
  /** W7-B2 (knowledge-14): the run's own budget, so the panel can say what
   *  the ceiling actually is instead of a hardcoded display constant. */
  maxRounds: number;
  maxCostUsd: number;
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
  opts: { maxRounds?: number; filter?: (f: Finding) => boolean; extraFindings?: () => Finding[] },
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
  /** Liveness-heartbeat cadence (W7-B2); 0 disables (unit tests). Defaults
   *  to KB_DRAIN_HEARTBEAT_MS. */
  heartbeatMs?: number;
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
 *  .toString(36)}` `` (kbId already `KB_ID_RE`-gated at that same route
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

// ---------------------------------------------------------------------------
// KB run history (W7-B2, knowledge-20) — every drain / consolidate /
// kb-cleanup run recorded for one KB, for the RecentRuns widget.
// ---------------------------------------------------------------------------

export type KbRunRow = {
  kind: 'drain' | 'consolidate' | 'cleanup';
  id: string;
  /** ISO start stamp, or '' when genuinely unknown (never fabricated). */
  when: string;
  /** drain: KbDrainState · consolidate: running|done|failed · cleanup: the
   *  session's own phase, verbatim. */
  status: string;
  /** null = the cost genuinely is not recorded (never a fabricated 0). */
  costUsd: number | null;
  detail: string | null;
  /** cleanup only — the session's anchor project, for the deep link. */
  project?: string;
};

/** One consolidate run's terminal facts, read from its own events.jsonl
 *  through the SHARED readers in cli/kb-job-state.ts (W7-B2 code-review
 *  round) — the same 'end'=done / 'error'=failed definition the active-job
 *  gate uses, so the RecentRuns status and the gate can never disagree about
 *  whether a run has finished. */
function readConsolidateRunRow(forgeRoot: string, runId: string): { status: string; costUsd: number | null; when: string; detail: string | null } {
  const evPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
  let raw: string | null = null;
  try {
    // Probe and read on separate lines — the raw-fs-guarded allowlist keys
    // one audited entry per (file, line, sink).
    if (existsSync(evPath)) {
      raw = readFileSync(evPath, 'utf8');
    }
  } catch {
    raw = null;
  }
  const events = parseKbRunEvents(raw ?? '');
  const terminal = terminalKbRunEvent(events);
  const when = firstKbRunEventTs(events) ?? '';
  let costUsd: number | null = null;
  let detail: string | null = null;
  if (terminal?.status === 'done') {
    if (typeof terminal.event.cost_usd === 'number') costUsd = terminal.event.cost_usd;
    const md = terminal.event.metadata ?? {};
    if (typeof md['clearedCount'] === 'number' && typeof md['total'] === 'number') {
      detail = `cleared ${md['clearedCount']}/${md['total']}`;
    }
  }
  return { status: terminal?.status ?? 'running', costUsd, when, detail };
}

/** Best-effort ISO stamp from a session id shaped `2026-08-18T12-54-32-…`
 *  (the bridge's own session-id convention). '' when it does not parse. */
function whenFromSessionId(sessionId: string): string {
  const m = sessionId.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`;
}

export function listKbRuns(forgeRoot: string, kbId: string): KbRunRow[] {
  const rows: KbRunRow[] = [];

  // Drain runs — status.json is the record.
  for (const { runId, status } of findKbDrainRuns(forgeRoot, kbId)) {
    rows.push({
      kind: 'drain',
      id: runId,
      when: status.startedAt ?? status.updatedAt ?? '',
      status: status.state,
      costUsd: typeof status.costUsd === 'number' ? status.costUsd : null,
      detail: `round ${status.round}/${status.maxRounds ?? KB_DRAIN_MAX_ROUNDS} · auto ${status.counts?.auto ?? 0} · agent ${status.counts?.agent ?? 0} · you ${status.counts?.user ?? 0}`,
    });
  }

  // Consolidate runs — `_brainfix-<kbId>-consolidate-*` top-level dirs
  // (per-finding `__<i>` sub-runs excluded, mirroring the consolidate/active
  // route's own exclusion in cli/bridge-studio-kbs.ts).
  const logsRoot = join(forgeRoot, '_logs');
  let entries: string[] = [];
  try {
    entries = existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  } catch {
    entries = [];
  }
  const consolidatePrefix = `_brainfix-${kbId}-consolidate-`;
  for (const name of entries) {
    if (!name.startsWith(consolidatePrefix)) continue;
    const runId = name.slice('_brainfix-'.length);
    if (runId.includes('__')) continue;
    const r = readConsolidateRunRow(forgeRoot, runId);
    rows.push({ kind: 'consolidate', id: runId, when: r.when, status: r.status, costUsd: r.costUsd, detail: r.detail });
  }

  // kb-cleanup sessions — anchored under the KB's own session project
  // (binding.ref for a project KB, the `.kb-<id>` anchor otherwise).
  const brainDir = resolveKbBrainDir(forgeRoot, kbId);
  let anchor = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  if (brainDir) {
    try {
      const kb = loadKbDescriptor(join(brainDir, 'kb.yaml'));
      if (kb.binding.kind === 'project') anchor = kb.binding.ref;
    } catch {
      // fall through to the dot anchor
    }
  }
  const projectsRoot = resolveProjectsDir(forgeRoot, loadConfig(defaultConfigPath(forgeRoot)));
  const cleanupDir = join(projectsRoot, anchor, '_kb-cleanup');
  let sids: string[] = [];
  try {
    sids = existsSync(cleanupDir) ? readdirSync(cleanupDir) : [];
  } catch {
    sids = [];
  }
  for (const sid of sids) {
    let phase = 'unknown';
    let sessionKbId: string | null = null;
    try {
      const parsed = JSON.parse(readFileSync(join(cleanupDir, sid, 'status.json'), 'utf8')) as { phase?: unknown; kb_id?: unknown };
      if (typeof parsed.phase === 'string') phase = parsed.phase;
      if (typeof parsed.kb_id === 'string') sessionKbId = parsed.kb_id;
    } catch {
      continue;
    }
    // A project anchor can host cleanup sessions for a DIFFERENT kb id
    // (project-bound KBs share the project dir) — filter on the session's
    // own kb_id when it carries one.
    if (sessionKbId !== null && sessionKbId !== kbId) continue;
    rows.push({ kind: 'cleanup', id: sid, when: whenFromSessionId(sid), status: phase, costUsd: null, detail: null, project: anchor });
  }

  return rows.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
}

function initialKbDrainStatus(
  kbId: string,
  maxRounds: number = KB_DRAIN_MAX_ROUNDS,
  maxCostUsd: number = DEFAULT_KB_DRAIN_MAX_COST_USD,
): KbDrainStatus {
  const now = new Date().toISOString();
  return {
    state: 'running', round: 0, counts: { auto: 0, agent: 0, user: 0 }, perFinding: [],
    costUsd: 0, kbId, updatedAt: now, startedAt: now, maxRounds, maxCostUsd,
  };
}

// ---------------------------------------------------------------------------
// Cancel flag (W7-B2, knowledge-14)
// ---------------------------------------------------------------------------

function kbDrainCancelPath(forgeRoot: string, runId: string): string {
  return join(kbDrainLogDir(forgeRoot, runId), 'cancel.json');
}

/** Ask a live drain run to stop after its current turn. File-based (not
 *  in-memory) so it works across the enqueueConsolidate queue boundary and
 *  survives a bridge restart racing the loop. */
export function requestKbDrainCancel(forgeRoot: string, runId: string): void {
  mkdirSync(kbDrainLogDir(forgeRoot, runId), { recursive: true });
  writeFileSync(kbDrainCancelPath(forgeRoot, runId), JSON.stringify({ requestedAt: new Date().toISOString() }) + '\n', 'utf8');
}

export function isKbDrainCancelRequested(forgeRoot: string, runId: string): boolean {
  return existsSync(kbDrainCancelPath(forgeRoot, runId));
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

/** The no-spawn stand-in for the DEFAULT fix turn under FORGE_ARCHITECT_NO_SPAWN /
 *  dry-bridge: never touches the SDK, leaves the finding uncleared, costs 0. */
async function noSpawnKbDrainFixTurn(input: RunBrainFixInput): Promise<RunBrainFixResult & { costUsd: number }> {
  return { runId: input.runId, cleared: false, costUsd: 0, editAudit: noKbEdits() };
}

// ---------------------------------------------------------------------------
// perFinding builders
// ---------------------------------------------------------------------------

/**
 * A row BEFORE its outcome is known. `Omit<…, 'outcome'>` is load-bearing:
 * the type gives the round loop nowhere to park a self-reported verdict, so a
 * row physically cannot exist with an unreconciled outcome. That is the cure
 * for forge-6gu (rows glyphed cleared for findings the round's own post-fix
 * lint still reports) — the previous shape stored `result.cleared` and nothing
 * ever revisited it.
 */
type KbDrainRoundRow = Omit<KbDrainPerFinding, 'outcome'>;

/**
 * W8-F1 (ON-3, S2) — an APPLIED auto-tier row and the diff it is accountable
 * for, in one constructor. `proposals` is a REQUIRED parameter so a row that
 * mutated the tree has no path to exist without the derivation having been
 * done; before this, auto rows were minted with no `proposedChanges` field at
 * all, so the one tier that lands with NO approval gate was the one tier the
 * operator could not inspect.
 *
 * Attribution is by PATH, which is as precise as the fixers' own report
 * allows: `applyAutoFixesUntilStable` runs several internal rounds and returns
 * one flat `applied` list, so there is no per-fix change set to read. A row
 * claims the diff for its own `file` plus any file its `detail` names (the
 * `index.not-listed` fixer, for instance, edits an INDEX while the finding is
 * keyed by the theme). An idempotent fixer that changed nothing honestly
 * claims nothing.
 */
function autoAppliedEntry(
  item: AutoFixStableResult['applied'][number],
  round: number,
  proposals: readonly KbDrainProposedChange[],
): KbDrainRoundRow {
  const mine = proposals.filter((p) => item.file.endsWith(p.file) || item.detail.includes(p.file));
  return {
    key: `${item.kind}::${item.file}`, check: item.kind, kind: item.kind, file: item.file,
    message: item.detail, tier: 'auto', round,
    ...(mine.length > 0 ? { proposedChanges: [...mine] } : {}),
  };
}

/**
 * W8-F1 review round 2 — the auto tier's mutations that no `applied` item
 * claims, on one honest row rather than silently discarded. Its `outcome` is
 * derived like every other row's (`finalizeRoundRows`): the key is not in the
 * post-fix lint's set, so it reads `cleared` — which is true, these writes did
 * land. What the row adds is that they are VISIBLE.
 */
function autoUnattributedEntry(proposals: readonly KbDrainProposedChange[], round: number): KbDrainRoundRow {
  return {
    key: `auto.unattributed::round-${round}`,
    check: 'auto.unattributed',
    kind: 'auto.unattributed',
    file: proposals[0].file,
    message: `the auto-fix pass also rewrote ${proposals.length} file(s) no single finding accounts for`,
    tier: 'auto',
    round,
    proposedChanges: [...proposals],
  };
}

/** Every file the deterministic auto-tier fixers changed, rendered as
 *  operator-inspectable proposals. Disposition is always `applied`: these
 *  fixers are not agent proposals, they are deterministic repairs that have
 *  already landed — the row's job is to SHOW that, not to re-decide it. */
function buildAutoProposedChanges(
  forgeRoot: string,
  brainRoot: string,
  changes: readonly KbEditChange[],
): KbDrainProposedChange[] {
  return changes.map((c) => {
    const file = relative(forgeRoot, join(brainRoot, c.relPath));
    const { diff, diffTruncated } = renderProposalDiff(file, c.before ?? '', c.after ?? '');
    return { file, diff, diffTruncated, disposition: 'applied' as const, reasons: [] };
  });
}

function autoSkippedEntry(item: AutoFixStableResult['skipped'][number], round: number): KbDrainRoundRow {
  return { key: `${item.kind}::${item.file}`, check: item.kind, kind: item.kind, file: item.file, message: item.reason, tier: 'auto', round };
}

/**
 * The ONE place a round row gets a terminal outcome — derived from this
 * round's real post-fix lint (`afterKeys`, the same set the no-progress and
 * oscillation decisions are made from), never from what a fixer or an agent
 * claimed.
 *
 * A drafted row is the single exception, and it is not an exception to the
 * rule: its finding legitimately still lints (the proposed edit was reverted),
 * so the key IS in `afterKeys`; `needs-you` is the more precise truth about
 * why, not a softer one.
 *
 * W8-F1 extends that exception, on exactly the same reasoning, to a REFUSED
 * row. The gate now reverts an unsound edit whatever its class, so the modal
 * `length.soft-cap` prose-condense that also drops a live link no longer
 * becomes a draft — and without this it would fall through to a bare
 * `not-cleared`, dropping off the operator's attention surface entirely. That
 * would trade the ON-3 fix for an ON-4 regression. The agent tried, the drain
 * refused, and a human has to decide: that is `needs-you`.
 *
 * Derived from the row's own proposals, never a stored flag.
 */
export function finalizeRoundRows(
  rows: readonly KbDrainRoundRow[],
  afterKeys: ReadonlySet<string>,
): KbDrainPerFinding[] {
  return rows.map((row) => ({
    ...row,
    outcome: row.draftSession || rowWasRefused(row)
      ? 'needs-you'
      : afterKeys.has(row.key) ? 'not-cleared' : 'cleared',
  }));
}

/** Did the gate refuse something this row proposed? */
function rowWasRefused(row: KbDrainRoundRow): boolean {
  return (row.proposedChanges ?? []).some((p) => p.disposition === 'refused');
}

/** One proposal diff, capped and honestly flagged when cut. */
function renderProposalDiff(label: string, before: string, after: string): { diff: string; diffTruncated: boolean } {
  const full = buildUnifiedDiff(label, before, after).split('\n');
  if (full.length <= KB_DRAIN_DIFF_MAX_LINES) return { diff: full.join('\n'), diffTruncated: false };
  return {
    diff: [...full.slice(0, KB_DRAIN_DIFF_MAX_LINES), `… ${full.length - KB_DRAIN_DIFF_MAX_LINES} more diff line(s) not shown`].join('\n'),
    diffTruncated: true,
  };
}

/**
 * W8-B2 (ON-3) — turn every file the turn touched into an operator-inspectable
 * proposal row: the diff, what became of it, and why.
 *
 * Derived entirely from the change set the gate already computed. Nothing here
 * re-reads the filesystem or re-decides a disposition — a second derivation of
 * "what happened to this edit" is exactly the drift this lane exists to close.
 */
function buildProposedChanges(
  forgeRoot: string,
  brainDir: string,
  changes: readonly KbEditChange[],
  gate: {
    refused: readonly KbEditChange[];
    repaired: readonly KbEditChange[];
    unsound: readonly KbEditUnsoundness[];
    /** W8-F1 — disposals the gate could not carry out. */
    errors: readonly string[];
  },
  proseChanges: readonly KbEditChange[],
  proseDisposition: 'drafted' | 'refused',
): KbDrainProposedChange[] {
  const refusedPaths = new Set(gate.refused.map((c) => c.relPath));
  const repairedByPath = new Map(gate.repaired.map((c) => [c.relPath, c]));
  const prosePaths = new Set(proseChanges.map((c) => c.relPath));
  const reasonsByPath = new Map<string, string[]>();
  for (const u of gate.unsound) {
    const list = reasonsByPath.get(u.relPath) ?? [];
    list.push(u.message);
    reasonsByPath.set(u.relPath, list);
  }
  // W8-F1 — a disposal the gate could NOT carry out is the most important
  // thing on the row: it means bytes it wanted to revert may still be on disk.
  // `reasons` is already "the audit's own reasons, rendered verbatim", so the
  // failure goes there rather than inventing a second surface. A merged field
  // that no consumer reads is the declared-data-fails-open shape this lane
  // exists to close — it must not be re-shipped by the fix.
  for (const err of gate.errors) {
    for (const c of changes) {
      if (!err.includes(c.relPath)) continue;
      const list = reasonsByPath.get(c.relPath) ?? [];
      list.push(err);
      reasonsByPath.set(c.relPath, list);
    }
  }

  return changes.map((c) => {
    const file = relative(forgeRoot, join(brainDir, c.relPath));
    const repaired = repairedByPath.get(c.relPath);
    const disposition: KbDrainProposedChange['disposition'] =
      repaired ? 'repaired'
      : refusedPaths.has(c.relPath) ? 'refused'
      : prosePaths.has(c.relPath) ? proseDisposition
      : 'applied';
    // A repaired file's diff shows what LANDED, not the rejected proposal —
    // the reasons carry what was rejected and why.
    const after = repaired ? (repaired.after ?? '') : (c.after ?? '');
    const { diff, diffTruncated } = renderProposalDiff(file, c.before ?? '', after);
    return { file, diff, diffTruncated, disposition, reasons: reasonsByPath.get(c.relPath) ?? [] };
  });
}

/** Rows still awaiting this round's post-fix lint — what a mid-round poll sees. */
function pendingRows(rows: readonly KbDrainRoundRow[]): KbDrainPerFinding[] {
  return rows.map((row) => ({ ...row, outcome: 'pending' as const }));
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
// Structural-only gate helpers (W7-B2, orch-01)
// ---------------------------------------------------------------------------

/** Restore every gated change to its pre-turn content — a created file is
 *  removed, an edited/deleted file is written back byte-for-byte. Paths are
 *  snapshot-derived (our OWN walk of the trusted `brainDir`), never
 *  request/agent text. */
function revertProseChanges(brainDir: string, changes: readonly KbEditChange[]): void {
  for (const c of changes) {
    const abs = join(brainDir, c.relPath);
    if (c.before === null) {
      rmSync(abs, { force: true });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, c.before, 'utf8');
  }
}

function newDraftSessionId(): string {
  const iso = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `${iso}-${randomBytes(4).toString('hex')}`;
}

/**
 * Park a gated (prose-touching) agent fix as a kb-cleanup DRAFT session the
 * operator approves with a diff — the EXISTING kb-cleanup session kind
 * (studio/session-kinds.yaml), minted directly in `awaiting-approval` (no
 * agent turn needed; the drain already holds the proposal). `status.json`
 * carries `draft_apply` — `approveKbCleanup` (cli/bridge-studio-kbs.ts)
 * applies exactly those drafts (contained to this KB's own brain dir)
 * instead of running a consolidate. Returns null (and the caller records an
 * honest not-cleared) when the session cannot be written — never a throw
 * that would fail the whole drain over a parking problem.
 */
function mintKbCleanupDraftSession(
  forgeRoot: string,
  kbId: string,
  /** The KB's own dir — for its `kb.yaml` descriptor. */
  brainDir: string,
  /** `<forgeRoot>/brain` — what every `KbEditChange.relPath` is relative to. */
  brainRoot: string,
  finding: { check: string; kind: string; file: string; message: string },
  proseChanges: readonly KbEditChange[],
  runId: string,
  round: number,
): { id: string; project: string } | null {
  try {
    // W8-F1 — FAIL CLOSED, in the second layer. The caller already filters out
    // everything the gate refused; this re-derives the same verdict rather
    // than trusting that filter, because approving a draft writes `after` back
    // byte-for-byte and a single miss here is the whole forge-d8l class handed
    // back as a button. This block used to render the audit's reasons as a
    // WARNING on the plan page and mint the draft anyway — which the C4
    // refuter correctly called a one-click destruction button.
    const guardCtx = buildKbEditSoundnessCtx(forgeRoot, brainRoot);
    const unsound = proseChanges.flatMap((c) => auditKbEdit(c, guardCtx));
    if (unsound.length > 0) return null;
    let binding: unknown = { kind: 'unique' };
    let project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
    try {
      const kb = loadKbDescriptor(join(brainDir, 'kb.yaml'));
      binding = kb.binding;
      if (kb.binding.kind === 'project') project = kb.binding.ref;
    } catch {
      // No/unparseable kb.yaml — the dot-anchor fallback above still works.
    }
    const projectsRoot = resolveProjectsDir(forgeRoot, loadConfig(defaultConfigPath(forgeRoot)));
    // The guarded write realpath-walks projectsRoot itself — which may not
    // exist yet on a fresh install (or an isolated test root).
    mkdirSync(projectsRoot, { recursive: true });
    const sessionId = newDraftSessionId();

    const draftApply: Array<{ file: string; draft: string }> = [];
    const diffs: string[] = [];
    const draftBodies: string[] = [];
    for (const c of proseChanges) {
      if (c.after === null) continue; // a deletion is refused outright, never drafted
      const relFromRoot = relative(forgeRoot, join(brainRoot, c.relPath));
      draftApply.push({ file: relFromRoot, draft: `drafts/${draftBodies.length}.md` });
      diffs.push(buildUnifiedDiff(relFromRoot, c.before ?? '', c.after));
      draftBodies.push(c.after);
    }
    if (draftApply.length === 0) return null;

    const written = guardedWriteSessionStatus(projectsRoot, [project, '_kb-cleanup', sessionId], {
      session_id: sessionId,
      project,
      phase: 'awaiting-approval',
      kb_id: kbId,
      kb_binding: binding,
      findings: [{ kind: finding.kind, check: finding.check, file: finding.file, message: finding.message }],
      draft_apply: draftApply,
      origin: 'kb-drain',
      drain_run_id: runId,
      drain_round: round,
    });
    if (written === null) return null;

    // Session dir now exists (guardedWriteSessionStatus created it); drafts/
    // and plan/ are its own server-minted children. Every write goes through
    // guardedWriteFile — the LEAF included (raw-fs-guarded's leaf-append
    // rule), which also creates the parent dir.
    let draftsOk = true;
    draftBodies.forEach((body, i) => {
      const p = guardedWriteFile(projectsRoot, [project, '_kb-cleanup', sessionId, 'drafts', `${i}.md`], body);
      if (p === null) draftsOk = false;
    });
    if (!draftsOk) return null;

    const plan = [
      '# Drain-gated prose edit',
      '',
      'Drain-to-green applies STRUCTURAL fixes only (frontmatter, links, index',
      "pages). The brain-fix agent's proposed fix for the finding below rewrites",
      'theme PROSE, so it is parked here for your approval instead of landing',
      'silently (wave-7 orch-01).',
      '',
      `Finding: [${finding.kind}] ${relative(forgeRoot, finding.file)} — ${finding.message}`,
      `Drain run: ${runId} (round ${round})`,
      '',
      ...draftApply.map((d) => `- [${finding.kind}] ${d.file} — drain-gated prose edit awaiting approval (approve replaces the file with ${d.draft})`),
      '',
      'Every change below was audited for graph soundness before it was parked',
      '(W8-F1): a prose edit that also deletes a resolvable related_themes edge,',
      'drops a live link or repoints one at a target that does not exist is',
      'REFUSED outright and never reaches this page. The SAME audit runs again',
      'when you approve, against the file as it stands then — so if anything',
      'edits this theme while the session waits, the apply refuses rather than',
      'writing this draft over it. What is left for you to judge is the prose.',
      '',
      'Approving this session applies the draft content below verbatim.',
      '',
      '```diff',
      diffs.join('\n\n'),
      '```',
      '',
    ].join('\n');
    if (guardedWriteFile(projectsRoot, [project, '_kb-cleanup', sessionId, 'plan', 'cleanup-plan.md'], plan) === null) return null;

    return { id: sessionId, project };
  } catch {
    return null;
  }
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
  // CI-safety seam (mirrors runBrainConsolidateNow's own noSpawn guard,
  // cli/bridge-studio-kbs.ts:440): under FORGE_ARCHITECT_NO_SPAWN=1 or
  // dry-bridge the DEFAULT fix-turn (a real SDK spawn) is replaced by a no-op
  // that leaves the finding uncleared. A caller-INJECTED opts.runFixTurn is by
  // definition not a real spawn (it is how the termination matrix is unit-
  // tested) and is honored regardless of the env — gating the call site
  // instead (the previous shape) made every dispatch-counting test fail under
  // CI's global FORGE_ARCHITECT_NO_SPAWN=1 (main went red at #164 and stayed
  // red for six merges before the tail PR's gate surfaced it).
  const noSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge();
  const runFixTurn: KbDrainRunFixTurnFn = opts.runFixTurn
    ?? (noSpawn ? noSpawnKbDrainFixTurn : defaultKbDrainFixTurn);
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
  // rejection (cli/bridge-studio-kbs.ts's `.catch(() => {})`), and
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
     *  (`metadata.kind: 'progress'`, forge-ui/lib/activity-log-view.ts). */
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
    // W7-B2 (knowledge-10): ONE lint lens — the same full-scan ∪ own-theme
    // union buildKbHealth counts from, so the drain can never report green
    // while the health readout on the same screen still counts flags.
    const lintKb = (): Finding[] => collectKbFindings(forgeRoot, kbId, lint(forgeRoot).findings);
    const ownLens = ownThemeFindingsLens(forgeRoot, kbId);

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
      const autoResult = applyAutoFixes(forgeRoot, { filter: inKb, extraFindings: ownLens });
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
          const minted = mintKbCleanupDraftSession(forgeRoot, kbId, brainDir, brainRoot, f, proseChanges, runId, round);
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

  // ---- POST /api/studio/kbs/:id/drain/cancel (W7-B2, knowledge-14) --------
  // Cancels the ACTIVE run for this kb. A live loop (fresh heartbeat) gets a
  // cancel-flag it honors between turns (`mode:'requested'`); a run whose
  // status stopped moving past KB_DRAIN_STALE_MS is DEAD (the in-process
  // loop is gone — e.g. the bridge restarted mid-drain) and is terminated
  // directly (`mode:'forced'`), so a wedged 'running' status is always
  // resolvable from the UI.
  const cancelMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain\/cancel$/);
  if (cancelMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(cancelMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      const active = findActiveKbDrainRun(ctx.forgeRoot, kbId);
      if (!active) {
        // W7 FIX-B-KB (knowledge-14): refuse HONESTLY — when the latest run
        // is already terminal, SAY so (state + runId), so the operator
        // learns why there is nothing to cancel rather than a bare
        // "no active run". No run at all keeps the bare reason (and no
        // fabricated runId).
        const latest = latestKbDrainRun(ctx.forgeRoot, kbId);
        if (latest) {
          sendJson(res, 409, {
            error: `no active drain run for this kb — the latest run "${latest.runId}" is already terminal (state "${latest.status.state}")`,
            runId: latest.runId,
            state: latest.status.state,
          }, origin);
          return true;
        }
        sendJson(res, 409, { error: 'no active drain run for this kb' }, origin);
        return true;
      }
      const updatedMs = new Date(active.status.updatedAt).getTime();
      const stale = !Number.isFinite(updatedMs) || Date.now() - updatedMs > KB_DRAIN_STALE_MS;
      if (stale) {
        // BOTH signals, always (W7-B2 code-review round). A stale status is
        // NOT proof the loop is dead: a drain that sat QUEUED behind another
        // job on the same per-kbId `enqueueConsolidate` lock never heartbeats
        // either, so it reads stale while being perfectly alive. Writing only
        // the terminal status let such a run start late, re-persist 'running'
        // over the operator's 'cancelled', and execute every agent turn to a
        // real terminal AFTER the operator was told it had been terminated.
        // The FLAG is what a late start actually observes (`cancelRequested`).
        requestKbDrainCancel(ctx.forgeRoot, active.runId);
        writeKbDrainStatus(ctx.forgeRoot, active.runId, { ...active.status, state: 'cancelled', updatedAt: new Date().toISOString() });
        sendJson(res, 200, { ok: true, runId: active.runId, mode: 'forced' }, origin);
        return true;
      }
      requestKbDrainCancel(ctx.forgeRoot, active.runId);
      sendJson(res, 200, { ok: true, runId: active.runId, mode: 'requested' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id/active-job (W7-B2, knowledge-05) -----------
  // The KB-level "a job is running" fact the action group gates on — the
  // SAME derivation every mutating route 409s with (kb-job-state.ts).
  const activeJobMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/active-job$/);
  if (activeJobMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(activeJobMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      const job = deriveKbActiveJob(ctx.forgeRoot, kbId);
      sendJson(res, 200, { ok: true, job, ...(job ? { reason: activeJobReason(job) } : {}) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id/runs (W7-B2, knowledge-20) ------------------
  // Every drain / consolidate / kb-cleanup run recorded for this KB — the
  // data source for the KB screen's RecentRuns widget. All names are
  // SERVER-enumerated directory listings (same class as findKbDrainRuns
  // above); the kbId only ever selects among them, never builds a path tail.
  const runsMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/runs$/);
  if (runsMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(runsMatch[1]);
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, runs: listKbRuns(ctx.forgeRoot, kbId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id/drain/:runId — must match BEFORE the bare
  // /drain routes below (more specific path). --------------------------------
  const specificMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/drain\/([^/]+)$/);
  if (specificMatch && method === 'GET') {
    const kbId = decodeURIComponent(specificMatch[1]);
    const runId = decodeURIComponent(specificMatch[2]);
    if (!KB_ID_RE.test(kbId)) {
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
      if (!KB_ID_RE.test(kbId)) {
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
      // W7-B2 (knowledge-05): a live CONSOLIDATE also blocks a new drain —
      // queueing behind it invisibly is exactly the confusion the action
      // group exists to end; the 409 carries the same reason the UI shows.
      const otherJob = deriveKbActiveJob(ctx.forgeRoot, kbId);
      if (otherJob && otherJob.kind !== 'drain') {
        sendJson(res, 409, { error: activeJobReason(otherJob), runId: otherJob.runId }, origin);
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

      // W7-B2 (knowledge-13): create the run's event log SYNCHRONOUSLY too —
      // the UI's one-shot event snapshot fetch fires the instant this route
      // returns a runId, but the queued job (createLogger inside runKbDrain)
      // only writes events.jsonl after the dispatch defer + any queue
      // backlog. Without this the fetch 404s and never retries.
      createLogger(`_kb-drain-${runId}`, join(ctx.forgeRoot, '_logs')).emit({
        initiative_id: `_kb-drain-${runId}`,
        phase: 'reflection',
        skill: 'kb-drain',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'kb-drain.queued',
        metadata: { kind: 'progress', kbId, runId },
      });

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
      if (!KB_ID_RE.test(kbId)) {
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
