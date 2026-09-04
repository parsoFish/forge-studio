/**
 * The KB drain's VOCABULARY and its PURE DERIVATION: the four tuning
 * constants, every type the state machine and persisted status are written in,
 * and the functions that turn a round's findings and applied edits into the
 * per-finding rows and reviewable diffs an operator sees.
 *
 * Split out of `bridge-studio-kb-drain.ts` in M4 PR 5, which took that file
 * from 1,456 lines to three under the 800-line cap. Nothing here touches the
 * filesystem or the clock: given the same inputs it returns the same rows,
 * which is why it can be the leaf both siblings import.
 *
 * THE SPLIT IS THREE FILES, NOT FIVE, AND THAT WAS A BUDGET DECISION RATHER
 * THAN A DESIGN ONE — see `_1.0/plans/M4-knowledge-park-3.md`. The seams below
 * are real (pure derivation · persistence · the engine), but a five-way split
 * along finer seams would have carried the package past its LOC cap on
 * per-file overhead alone.
 */
import { join, relative } from 'node:path';
import { type AutoFixStableResult, type Finding } from './brain-lint.ts';
import { buildUnifiedDiff, type KbEditChange } from './kb-drain-structural.ts';
import { type KbEditUnsoundness, type KbEditGateResult } from './kb-drain-edit-soundness.ts';
import { KB_DRAIN_STALE_MS } from './kb-job-state.ts';

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
  opts: { maxRounds?: number; filter?: (f: Finding) => boolean },
) => AutoFixStableResult;


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
export type KbDrainRoundRow = Omit<KbDrainPerFinding, 'outcome'>;

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
export function autoAppliedEntry(
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
export function autoUnattributedEntry(proposals: readonly KbDrainProposedChange[], round: number): KbDrainRoundRow {
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
export function buildAutoProposedChanges(
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

export function autoSkippedEntry(item: AutoFixStableResult['skipped'][number], round: number): KbDrainRoundRow {
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
export function rowWasRefused(row: KbDrainRoundRow): boolean {
  return (row.proposedChanges ?? []).some((p) => p.disposition === 'refused');
}

/** One proposal diff, capped and honestly flagged when cut. */
export function renderProposalDiff(label: string, before: string, after: string): { diff: string; diffTruncated: boolean } {
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
export function buildProposedChanges(
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
export function pendingRows(rows: readonly KbDrainRoundRow[]): KbDrainPerFinding[] {
  return rows.map((row) => ({ ...row, outcome: 'pending' as const }));
}

export function findingKey(f: Finding): string {
  return `${f.kind ?? f.check ?? ''}::${f.file}`;
}

export function progressKeySet(findings: readonly Finding[]): Set<string> {
  return new Set(
    findings.filter((f) => f.resolution === 'auto' || f.resolution === 'agent').map(findingKey),
  );
}

export function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** What the drain hands one fix turn. Every field is knowledge's own
 *  vocabulary: the finding being repaired, plus where. */
export type KbDrainFixTurnInput = {
  /** Unique id for this sub-turn; always synthesized by us, never request text. */
  runId: string;
  /** Absolute path to the forge root. */
  forgeRoot: string;
  /** Root for event logs; the turn defaults it to `<forgeRoot>/_logs`. */
  logsRoot?: string;
  /** The KB whose brain this file belongs to. */
  kbId: string;
  /** Absolute path to the theme file to repair. */
  file: string;
  /** The finding's check slug. */
  check: string;
  /** The finding's kind slug. */
  kind: string;
  /** Optional concrete repair hint from `classifyFinding`. */
  fixHint?: string;
  /** The finding's human-readable message. */
  message: string;
};

/** What the drain needs back. `editAudit` is OUR `KbEditGateResult` — the gate
 *  runs inside the turn (W8-B2) and its verdict is folded into `cleared`. */
export type KbDrainFixTurnResult = {
  runId: string;
  cleared: boolean;
  editAudit: KbEditGateResult;
};

/** The injected fix turn. The result additionally carries `costUsd` — the turn
 *  itself does not return cost (it only logs `cost_usd` on its own 'end'
 *  event), so the real implementation reads it back out of that event log
 *  after every turn; that read-back moved to the injection point with ruling
 *  86, because it is knowledge of the turn's log layout, not of the drain.
 *  Injectable so termination-matrix tests (esp. the cost-ceiling case) can
 *  hand back a precise, deterministic cost per call without a real SDK turn. */
export type KbDrainRunFixTurnFn = (
  input: KbDrainFixTurnInput,
) => Promise<KbDrainFixTurnResult & { costUsd: number }>;

/**
 * The guarded session-status IO this package needs but may not import
 * (M4 ruling 99). Same shape and same reason as `KbDrainRunFixTurnFn`: the port
 * is declared HERE in this package's vocabulary and the assembly supplies the
 * implementation. The type parameters are NOT incidental — see `design.md`
 * ("The session-status port, and why it stays generic").
 */
export type GuardedReadSessionStatusFn = <S>(
  projectsRoot: string,
  dirSegments: readonly string[],
  leaf?: string,
) => S | null;

export type GuardedWriteSessionStatusFn = <S extends Record<string, unknown>>(
  projectsRoot: string,
  dirSegments: readonly string[],
  status: S,
  leaf?: string,
) => string | null;

/** The pair, threaded as one value so a caller cannot supply half of it. */
export type SessionStatusIoPort = {
  readonly read: GuardedReadSessionStatusFn;
  readonly write: GuardedWriteSessionStatusFn;
};

/** Refuse BY NAME when the assembly did not supply the port, rather than
 *  writing a session status through an unguarded path. The three call sites
 *  that need it share this one refusal so its wording cannot drift. */
export function requireSessionStatusIo<T>(fn: T | undefined, caller: string): T {
  if (!fn) {
    throw new Error(
      `${caller}: the guarded session-status port is required — it is declared by @forge/knowledge and ` +
      'supplied by the assembly (apps/forge threads it through knowledgeRoutes). Refusing rather than ' +
      'writing a session status through an unguarded path.',
    );
  }
  return fn;
}
