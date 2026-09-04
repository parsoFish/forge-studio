/**
 * Session status and interview IO — the guarded read/write pair every session
 * kind stores its `status.json` through, the sticky-cancel refusal that pair
 * enforces, and the questions/answers handoff files.
 *
 * Split out of `interactive-session.ts` (M4 exit row 5). Sixty files import the
 * parent, so this is a real extraction and not a re-export shim: the parent
 * imports `parseFencedJson` back and nothing here reaches into what stayed.
 *
 * `makeHeartbeatWriter` DELIBERATELY DID NOT COME. It is the only thing in this
 * half that read `HEARTBEAT_THROTTLE_MS`, which the streaming loops in the
 * parent also read — so moving it would have left a leaf importing a constant
 * from its own parent, which is a cycle, and moving the constant too would have
 * repointed its other consumer for nothing. Leaving the writer where the
 * throttle lives makes the seam one-way and costs zero repoints: the cycle
 * probe reports EMPTY from this module back to the parent.
 *
 * THE STICKY-CANCEL REFUSAL IS WHY THIS IS NOT KERNEL. `guardedWriteSessionStatus`
 * carries `cancelledPhaseWins` / `CANCELLED_PHASE`; pushing the pair down into
 * kernel would relocate sessions' lifecycle vocabulary into a rank-0 package,
 * which is ruling 86's mistake through another door. Knowledge reaches these
 * two functions through a port it declares itself, bound at `apps/forge`
 * (ruling 99), not by importing this module.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { guardedFile } from '@forge/kernel';

/** Parse a ```json fenced block (or the raw text) as JSON; null on any failure. */
export function parseFencedJson<T>(text: string): T | null {
  if (!text) return null;
  const m = /```json\s*([\s\S]*?)```/i.exec(text);
  const raw = m ? m[1] : text;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------------------
// SEC-04 — guarded leaf siblings of readSessionStatus / writeSessionStatus.
//
// The raw pair above takes an ALREADY-BUILT `sessionDir` and raw-appends the
// `status.json` leaf with `join(sessionDir, file)` — the exact "guard the dir,
// raw-append the leaf" shape SEC-04 closes. These siblings take the TRUSTED
// `projectsRoot` plus the request-derived directory segments and the leaf name,
// and route the WHOLE path — leaf included — through `guardedFile` so a
// symlinked/hardlinked `status.json` cannot escape. The raw pair is retained
// deliberately; Phase-1 route appliers switch their call sites onto these.
//
// `dirSegments` carries the request-influenced ids (project / kindDir /
// sessionId) as their OWN segments — NEVER folded into `projectsRoot` (see the
// guard's root-trust contract). Returns `null` on a containment rejection so
// the caller fails closed rather than reading/writing an escaped path.
// ---------------------------------------------------------------------------

/** Guarded read of `<projectsRoot>/<dirSegments...>/<leaf>` as JSON; `null` if
 *  the guard rejects it, or it is absent/unparseable. */
export function guardedReadSessionStatus<S>(
  projectsRoot: string,
  dirSegments: readonly string[],
  leaf = 'status.json',
): S | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'read');
  if (p === null) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as S;
  } catch {
    return null;
  }
}

/** W7-A2 (ADR-043 2026-08-19 amendment §1) — the ONE universal, reserved
 *  terminal phase every session kind shares: written by the generic
 *  `POST /api/studio/sessions/:kind/:sessionId/cancel` route
 *  (packages/sessions/bridge-studio-session-cancel.ts) and read as terminal by
 *  `isTerminalPhase` (packages/sessions/bridge-studio-sessions.ts) for EVERY kind BEFORE
 *  the per-kind tables are consulted. Deliberately NOT a per-kind
 *  `{ phase: cancelled, step: terminal }` yaml row: "the operator gave up"
 *  is the same fact for all kinds, and N copies of one fact in N tables is
 *  exactly the drift shape ADR-043's "derived, not authored" discipline
 *  exists to prevent.
 *
 *  W7-FIX-A2 (W7A2-01): defined HERE, at the status-write seam, because the
 *  seam enforces it (`cancelledPhaseWins` below) — cli/bridge-studio.ts
 *  re-exports this same binding so every bridge module keeps its import. */
export const CANCELLED_PHASE = 'cancelled';

/**
 * W7-FIX-A2 (W7A2-01, HIGH) — the sticky-cancel rule, as ONE pure predicate:
 * an on-disk `cancelled` phase WINS over any later write that would move the
 * session to a different phase (or to no phase at all). A late turn
 * completion — onboarding's untracked dispatch child, or a tracked runner
 * already past its SIGTERM — used to spread its STALE pre-turn status object
 * over the terminal phase and resurrect the session into `complete`/`failed`/
 * `awaiting-…`. Re-stamping `cancelled` over `cancelled` is not a
 * resurrection (idempotent), and cancelling a live phase is the normal
 * transition, so both stay allowed. A missing on-disk phase (first write) is
 * never sticky.
 */
export function cancelledPhaseWins(existingPhase: unknown, incomingPhase: unknown): boolean {
  return existingPhase === CANCELLED_PHASE && incomingPhase !== CANCELLED_PHASE;
}

/** W7-FIX-A2 (W7A2-01) — tell the two `guardedWriteSessionStatus` → `null`
 *  causes apart, for the writer's own error message: `'cancelled'` when the
 *  on-disk phase is the reserved terminal and the incoming phase would move
 *  off it (the sticky-cancel refusal — a turn finished after the operator
 *  cancelled; the write is discarded by design), else `'containment'` (the
 *  guard rejected the path). ONE helper for every runner, so no runner
 *  reports a sticky-cancel refusal as a containment failure. */
export function statusWriteRefusalReason(
  projectsRoot: string,
  dirSegments: readonly string[],
  incomingPhase: unknown,
): 'cancelled' | 'containment' {
  const onDisk = guardedReadSessionStatus<{ phase?: unknown }>(projectsRoot, dirSegments);
  return onDisk !== null && cancelledPhaseWins(onDisk.phase, incomingPhase) ? 'cancelled' : 'containment';
}

/** Guarded write of `<projectsRoot>/<dirSegments...>/<leaf>` as pretty JSON,
 *  stamping a fresh `updated_at` and creating the session dir if needed.
 *  Returns the written path, or `null` if the guard rejected the path (the
 *  write never happens — fail closed) — OR if the on-disk phase is the
 *  reserved terminal `cancelled` and `status.phase` is anything else
 *  (`cancelledPhaseWins`: the sticky-cancel rule, enforced at THIS seam so
 *  every writer — the affordance routes, the generic runner, the four legacy
 *  runners, `forge agent dispatch --session-dir` — inherits it without a
 *  per-caller check). The status file is byte-unchanged on refusal. Callers
 *  that need to tell the two refusals apart re-read the on-disk status
 *  (`guardedReadSessionStatus`) and test `cancelledPhaseWins` themselves. */
export function guardedWriteSessionStatus<S extends Record<string, unknown>>(
  projectsRoot: string,
  dirSegments: readonly string[],
  status: S,
  leaf = 'status.json',
): string | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'write');
  if (p === null) return null;
  const existing = guardedReadSessionStatus<Record<string, unknown>>(projectsRoot, dirSegments, leaf);
  if (existing !== null && cancelledPhaseWins(existing.phase, status.phase)) return null;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
  return p;
}

// ---------------------------------------------------------------------------
// Interview handoff (questions.json ↔ answers.json) — shared by interactive
// runners that ask the operator AskUserQuestion-shaped questions between turns.
// ---------------------------------------------------------------------------

/** One operator-facing question — the AskUserQuestion shape the UI renders. */
export type InterviewQuestion = {
  question: string;
  /** ≤12 chars chip label (AskUserQuestion constraint). */
  header: string;
  options: { label: string; description: string }[];
};

/** One resolved Q/A pair. */
export type InterviewAnswer = { question: string; answer: string };

/** One round of answers POSTed by the operator (written by the bridge). */
export type AnswerRound = { round: number; answers: InterviewAnswer[] };

// SEC-04 leaf-tail: `questions.json` / `answers.json` are the interview-handoff
// SIBLINGS of `status.json` — and were the last raw-append leaves on the session
// dir. A caller previously guarded the DIRECTORY (`resolveGuardedPath` →
// `sessionDir` realPath) and then raw-appended the leaf with
// `join(sessionDir, 'questions.json')`; a symlinked/hardlinked `questions.json`
// or `answers.json` inside the genuinely-real, contained session dir therefore
// escaped — proven live: `writeQuestions` wrote the pending questions THROUGH a
// symlinked leaf to an out-of-root file, and `readAnswerRounds` READ an
// out-of-root `answers.json` and surfaced its content into the replayed interview
// prompt. These now route the WHOLE path (leaf included) through `guardedFile`
// exactly like `guarded{Read,Write}SessionStatus` above: TRUSTED `projectsRoot`,
// request-derived kind-dir + sessionId as their own `segments[]` elements (NEVER
// folded into the root — the guard's root-trust contract), leaf last.

/**
 * Write the pending questions for the operator to
 * `<projectsRoot>/<dirSegments...>/questions.json`, routing the leaf through the
 * guard. Returns the written path, or `null` if containment rejected it (the
 * write never happens — the caller fails closed rather than write an escaped
 * leaf).
 */
export function writeQuestions(
  projectsRoot: string,
  dirSegments: readonly string[],
  questions: InterviewQuestion[],
): string | null {
  const p = guardedFile(projectsRoot, [...dirSegments, 'questions.json'], 'write');
  if (p === null) return null;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(questions, null, 2));
  return p;
}

/**
 * Read every `answers.json` round into a flat `InterviewAnswer[]`. The bridge
 * appends rounds as the operator answers; this flattens them into the prior-Q/A
 * list a turn prompt replays. The leaf rides through `guardedFile` (read mode) so
 * a symlinked/escaping `answers.json` collapses to `null` == absent (no oracle)
 * and yields `[]` rather than leaking out-of-root content into the prompt.
 * Best-effort — never throws.
 */
export function readAnswerRounds(projectsRoot: string, dirSegments: readonly string[]): InterviewAnswer[] {
  const p = guardedFile(projectsRoot, [...dirSegments, 'answers.json'], 'read');
  if (p === null) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as AnswerRound[] | AnswerRound;
    const rounds = Array.isArray(parsed) ? parsed : [parsed];
    const out: InterviewAnswer[] = [];
    for (const r of rounds) {
      for (const a of r.answers ?? []) out.push({ question: a.question, answer: a.answer });
    }
    return out;
  } catch {
    return [];
  }
}
