/**
 * kb-drain-view.ts (W6-B13) — pure, DOM-free derivation helpers for
 * `KbDrainPanel.tsx`, extracted the same way `run-panel-view.ts` /
 * `kb-consolidate.ts` extract RunPanel's/the maintenance panel's own async
 * or derivation logic: no jsdom is installed in this repo (see
 * `RunPanel.tsx`'s own header comment), so a `.tsx` file with hooks can only
 * be verified by `tsc` + `next build`; anything decision-shaped belongs in a
 * plain function here instead, where it's directly unit-testable.
 */

import type { KbDrainPerFinding, KbDrainProposedChange, KbDrainState } from './studio-client';

/** Mirrors `packages/knowledge/bridge-studio-kb-drain.ts`'s `KB_DRAIN_MAX_ROUNDS` — a
 *  display-only constant (not imported: that module touches `node:fs` and
 *  forge-ui never cross-imports from `cli/`, this repo's own boundary
 *  convention — see every other client-side type mirror in
 *  `./studio-client.ts`'s header comment). Keep in sync by hand; a drift
 *  only ever shows a wrong "round N/5" label, never a wrong drain decision
 *  (the server is the sole authority on when to stop). */
export const KB_DRAIN_MAX_ROUNDS_DISPLAY = 5;

/** The states this module adds on top of the server's own `KbDrainState`:
 *  `'timed-out'` — the poll gave up watching while the run was still
 *  genuinely running server-side (see `lib/agent-dispatch.ts`'s
 *  `pollKbDrain`); `'unreadable'` (W7-B2) — the bridge ANSWERED the status
 *  read with a 4xx ("unknown drain run"), so there is no run state to show
 *  at all: the one honest fact is the failed read itself, never the
 *  fabricated `'running'` a failed read arrives wrapped in (the wire vocab
 *  has no 'unknown' token — `failedKbDrainStatus`, studio-client.ts). */
export type KbDrainDisplayState = KbDrainState | 'timed-out' | 'unreadable' | 'attaching' | 'idle';

const SERVER_TERMINAL_STATES = new Set<KbDrainState>([
  'green', 'needs-you', 'no-progress', 'round-cap', 'cost-ceiling', 'cancelled', 'failed',
]);

/** True for any state that will never change without a fresh dispatch —
 *  every real server terminal, PLUS this UI's own `'timed-out'` and
 *  `'unreadable'` (nothing here will resolve either further without an
 *  explicit re-check or a fresh dispatch). `'running'`/`'attaching'`/
 *  `'idle'` are the only non-terminal states. */
export function isKbDrainTerminal(state: KbDrainDisplayState): boolean {
  return state === 'timed-out' || state === 'unreadable' || SERVER_TERMINAL_STATES.has(state as KbDrainState);
}

/** W7-B2 (the ledger's deferred "pollKbDrain 'unknown' vocab" item) — the
 *  ONE place a polled/fetched status becomes a display state. A failed read
 *  (`ok:false`) carries a fabricated `state:'running'`; the read's own HTTP
 *  status tells the two failure classes apart (the same A1-10 line
 *  `isStillWatching` draws): a bridge-ANSWERED 4xx is `'unreadable'` — a
 *  terminal fact, the poll has stopped — while a transport blip / 5xx passes
 *  through as `'running'` because the poll genuinely is still watching. */
export function deriveDrainDisplayState(
  status: { ok: boolean; state: KbDrainState | 'timed-out'; status?: number } | null,
  attaching: boolean,
): KbDrainDisplayState {
  if (!status) return attaching ? 'attaching' : 'idle';
  if (status.ok === false && status.status !== undefined && status.status < 500) return 'unreadable';
  return status.state;
}

export type DrainStateCopy = { label: string; detail: string };

/** Operator-facing label + explanation for every state the panel can show.
 *  Pure text derivation — the panel renders this verbatim, never re-deciding
 *  wording at the call site (keeps every terminal's copy in one place). */
export function drainStateCopy(state: KbDrainDisplayState, costUsd: number): DrainStateCopy {
  switch (state) {
    case 'idle':
      return { label: 'not yet run', detail: 'Click "Drain to green" to fix every auto- and agent-tier lint finding, round by round.' };
    case 'attaching':
      return { label: 'checking…', detail: 'Checking for an in-progress or previous drain run.' };
    case 'running':
      return { label: 'running', detail: 'Applying auto-fixes, then one agent turn per residual finding, round by round.' };
    case 'green':
      return { label: 'green ✓', detail: 'Every auto- and agent-tier finding cleared.' };
    case 'needs-you':
      return { label: 'needs you', detail: 'Auto/agent tiers are clean — the finding(s) below need an operator decision the drain loop never makes on its own.' };
    case 'no-progress':
      return { label: 'no progress', detail: 'The last round cleared nothing new (or is oscillating between the same findings) — more rounds would not help. Address what remains manually, or re-run once something has changed.' };
    case 'round-cap':
      return { label: 'round cap', detail: `Ran the full ${KB_DRAIN_MAX_ROUNDS_DISPLAY}-round budget with findings still remaining — re-run to continue with a fresh budget.` };
    case 'cost-ceiling':
      return { label: 'cost ceiling', detail: `Hit this run's cost ceiling ($${costUsd.toFixed(2)} spent) — re-run to continue with a fresh budget.` };
    case 'cancelled':
      return { label: 'cancelled', detail: 'Stopped on your request — the rounds that already ran are kept below; re-run whenever you like.' };
    case 'failed':
      return { label: 'failed', detail: 'The run crashed unexpectedly — see the activity log below for what happened.' };
    case 'timed-out':
      return { label: 'watch timed out', detail: 'The drain keeps running on the server — this browser just stopped watching. Re-check to pick it back up.' };
    case 'unreadable':
      return { label: 'status unreadable', detail: 'The bridge answered this run’s status read with an error — the run’s state can’t be shown (it may have been cleaned up, or never existed). Re-check, or re-run the drain.' };
    default:
      return { label: state, detail: '' };
  }
}

export type KbDrainTiers = {
  auto: KbDrainPerFinding[];
  agent: KbDrainPerFinding[];
  user: KbDrainPerFinding[];
};

/** Split a run's flat `perFinding` list by resolution tier — the panel
 *  renders auto+agent as "this round's progress" and user as the
 *  needs-you walkthrough. */
export function findingsByTier(perFinding: readonly KbDrainPerFinding[]): KbDrainTiers {
  return {
    auto: perFinding.filter((f) => f.tier === 'auto'),
    agent: perFinding.filter((f) => f.tier === 'agent'),
    user: perFinding.filter((f) => f.tier === 'user'),
  };
}

export type UserTierStep = {
  finding: KbDrainPerFinding | null;
  /** True once the operator has stepped past every user-tier finding —
   *  distinct from `finding === null && total === 0` (nothing to review at
   *  all): this is "reviewed all N, none resolved yet," the explicit
   *  completion state sweep finding C9#3 was missing (the old
   *  LintResolutionPanel clamped `idx` to the last item forever instead). */
  done: boolean;
  total: number;
};

/** Resolve which user-tier finding the walkthrough should show for the
 *  operator's current step index. Never clamps back to the last item —
 *  stepping past the end reaches an explicit `done: true` instead. */
export function resolveUserTierStep(userFindings: readonly KbDrainPerFinding[], idx: number): UserTierStep {
  const total = userFindings.length;
  if (total === 0) return { finding: null, done: false, total };
  if (idx >= total) return { finding: null, done: true, total };
  return { finding: userFindings[idx], done: false, total };
}

/** W7-B2 (knowledge-12): the distinct rounds present in an accumulated
 *  `perFinding` list, ascending — the panel groups rows under a per-round
 *  header. A pre-W7 status file without `round` tags yields `[0]`-style
 *  grouping via the `?? 0` default (rendered as one untagged group). */
export function findingRounds(perFinding: readonly KbDrainPerFinding[]): number[] {
  return [...new Set(perFinding.map((f) => f.round ?? 0))].sort((a, b) => a - b);
}

/** W7-B2 (knowledge-14): elapsed-time label for a run — `null` when the
 *  status predates `startedAt` (never a fabricated 0s). */
export function formatDrainElapsed(startedAt: string | undefined, nowMs: number): string | null {
  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs) || nowMs < startMs) return null;
  const totalSec = Math.floor((nowMs - startMs) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// W8-B2 (ON-3) — a finding shows its fix, and links back to Explore
// ---------------------------------------------------------------------------

/** Outcome glyphs, including `pending`'s. Lives here (not in the `.tsx`) so
 *  the vocabulary is exhaustively type-checked against the wire union: a new
 *  outcome that nobody gave a glyph is a compile error, not a blank cell. */
export const KB_DRAIN_OUTCOME_GLYPH: Record<KbDrainPerFinding['outcome'], string> = {
  cleared: '\u2713',
  'not-cleared': '\u26a0',
  'needs-you': '?',
  pending: '\u00b7',
};

/**
 * The ONE disposition token a finding row advertises — DERIVED from the
 * proposals the server recorded, never stored alongside them.
 *
 * `mixed` is real and must not be smoothed away: one turn can land a sound
 * structural edit in one file while another file's edit is refused, and a row
 * claiming a single clean disposition for both would be the fail-open shape
 * this lane exists to close. `none` means the turn changed no files at all.
 */
export function findingDisposition(f: Pick<KbDrainPerFinding, 'proposedChanges'>): KbDrainProposedChange['disposition'] | 'mixed' | 'none' {
  const changes = f.proposedChanges ?? [];
  if (changes.length === 0) return 'none';
  const kinds = new Set(changes.map((c) => c.disposition));
  if (kinds.size > 1) return 'mixed';
  return changes[0].disposition;
}

/** Every reason the drain gave for refusing or repairing this finding's edits,
 *  flattened in proposal order. */
export function findingRefusalReasons(f: Pick<KbDrainPerFinding, 'proposedChanges'>): string[] {
  return (f.proposedChanges ?? []).flatMap((c) => c.reasons ?? []);
}

/** True when this finding has anything for the operator to inspect — a diff,
 *  a refusal reason, a brief, or a crash. Drives whether the row renders a
 *  disclosure at all, so an empty drawer can never be offered. */
export function findingHasDetail(f: Pick<KbDrainPerFinding, 'proposedChanges' | 'fixHint' | 'turnError'>): boolean {
  return (f.proposedChanges ?? []).length > 0 || !!f.fixHint || !!f.turnError;
}

/**
 * W8-B2 (ON-3, second half) — the Explore deep link for a finding's own theme,
 * or `null` when the finding is not about a theme node.
 *
 * DERIVED from the finding's `file` and the KB id; nothing is stored. A theme
 * node's id in `buildKbGraph` IS its slug (the basename without `.md`), which
 * is exactly what `?node=` resolves — so the mapping the drain was missing is a
 * pure function, not a new field on the wire.
 *
 * Fails CLOSED: an index/category page (`README.md`, `patterns.md`, …), a file
 * outside a `themes/` dir, or an empty slug yields `null` and the row renders
 * no link, rather than a link that lands on a shared NotFound.
 */
export function deriveFindingNodeHref(
  f: Pick<KbDrainPerFinding, 'file'>,
  kbId: string,
): string | null {
  if (!kbId) return null;
  const parts = (f.file ?? '').split(/[\\/]/).filter((p) => p !== '');
  const name = parts[parts.length - 1] ?? '';
  if (!name.endsWith('.md')) return null;
  if (parts[parts.length - 2] !== 'themes') return null;
  const slug = name.slice(0, -'.md'.length);
  if (slug === '' || slug === 'README') return null;
  return `/knowledge?id=${encodeURIComponent(kbId)}&node=${encodeURIComponent(slug)}`;
}

/**
 * W8-B2 (ON-4) — the distinct kb-cleanup drafts this run parked, in row order.
 *
 * Derived from `perFinding` alone; nothing on the wire says "a draft is
 * pending". Deduplicated by session id: one gated turn can touch several files
 * but mints ONE session, and a count that double-counted them would overstate
 * how much the operator has to review.
 */
export function pendingDraftSessions(
  perFinding: readonly KbDrainPerFinding[],
): Array<{ id: string; project: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; project: string }> = [];
  for (const f of perFinding) {
    const d = f.draftSession;
    if (!d || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}
