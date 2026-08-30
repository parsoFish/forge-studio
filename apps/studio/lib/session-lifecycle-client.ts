/**
 * W7-A2 — the session LIFECYCLE wire vocabulary + the ONE cancel client.
 *
 * Mirrors cli/bridge-studio-lifecycle.ts's `SessionLifecycle` shape (a
 * hand-mirrored copy, never an import — forge-ui never imports cli/ at
 * runtime; kept honest by `parseSessionLifecycle` refusing any token the
 * bridge does not emit). Consumed by the /sessions index rows, Home's
 * active-sessions strip, the session page's `SessionLifecycleBar`, and the
 * generic `SessionInteractivePanel`'s zero-affordance copy — ONE copy
 * helper (`describeLifecycle`) so the same state never reads differently on
 * two surfaces.
 *
 * `cancelStudioSession` POSTs the generic
 * `POST /api/studio/sessions/:kind/:sessionId/cancel`
 * (cli/bridge-studio-session-cancel.ts) — every kind, one route; the
 * server's own error text reaches the caller verbatim (409 already-terminal
 * naming the phase, 404, 400).
 */

import { bridgeFetch } from './bridge-client';
import { SESSION_DONE_PHASES as DONE_PHASES, SESSION_STOPPED_PHASES as STOPPED_PHASES } from './history-ledger';

export const SESSION_LIFECYCLE_STATES = ['working', 'awaiting-operator', 'crashed', 'stalled', 'terminal'] as const;
export type SessionLifecycleState = (typeof SESSION_LIFECYCLE_STATES)[number];

export type SessionLifecycle = {
  state: SessionLifecycleState;
  needsYou: boolean;
  error: string | null;
  idleMs: number | null;
  cancellable: boolean;
};

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Hard parse — every field required and typed; an unknown `state` token
 *  throws naming it AND the allowed set; nothing is coerced to a permissive
 *  default (a missing lifecycle must never quietly read as "working"). */
export function parseSessionLifecycle(raw: unknown): SessionLifecycle {
  if (!isPlainObject(raw)) {
    throw new Error(`missing or invalid "lifecycle": expected an object, got ${JSON.stringify(raw)}`);
  }
  const state = raw['state'];
  if (typeof state !== 'string' || !(SESSION_LIFECYCLE_STATES as readonly string[]).includes(state)) {
    throw new Error(`invalid "lifecycle.state": got ${JSON.stringify(state)}, expected one of ${SESSION_LIFECYCLE_STATES.join(', ')}`);
  }
  const needsYou = raw['needsYou'];
  if (typeof needsYou !== 'boolean') throw new Error(`missing or invalid "lifecycle.needsYou": expected a boolean, got ${JSON.stringify(needsYou)}`);
  const cancellable = raw['cancellable'];
  if (typeof cancellable !== 'boolean') throw new Error(`missing or invalid "lifecycle.cancellable": expected a boolean, got ${JSON.stringify(cancellable)}`);
  const error = raw['error'];
  if (error !== null && typeof error !== 'string') throw new Error(`missing or invalid "lifecycle.error": expected a string or null, got ${JSON.stringify(error)}`);
  const idleMs = raw['idleMs'];
  if (idleMs !== null && typeof idleMs !== 'number') throw new Error(`missing or invalid "lifecycle.idleMs": expected a number or null, got ${JSON.stringify(idleMs)}`);
  return { state: state as SessionLifecycleState, needsYou, error, idleMs, cancellable };
}

/** "3m" / "2h 5m" / "<1m" — operator-facing idle time. */
export function formatIdle(idleMs: number): string {
  const totalMin = Math.floor(idleMs / 60_000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// W7A2-10 — terminal phases that mean "finished successfully" vs "stopped";
// the terminal sentence names which. Anything else terminal (a future
// kind's own token) reads as the neutral "Finished — <phase>". W7-B1: the
// sets live in `./history-ledger` (SESSION_DONE_PHASES /
// SESSION_STOPPED_PHASES — the pure module, shared with the ledger's
// `sessionPhaseRunStatus` map, imported at the top of this file) so the
// lifecycle sentence and the ledger's mapped `data-run-status` can never
// disagree about what counts as done.

function terminalCopy(phase: string): string {
  if (DONE_PHASES.has(phase)) return `Done — ${phase}. Nothing further to do here.`;
  if (STOPPED_PHASES.has(phase)) return `${phase.charAt(0).toUpperCase()}${phase.slice(1)} — nothing further to do here.`;
  return `Finished — ${phase}.`;
}

/** The ONE operator-facing sentence per lifecycle state — shared by the
 *  index chip, the Home card and the session page banner. `error` is the
 *  runner's own message for `crashed`; `idleMs` names the silence for
 *  `stalled`; `phase` (W7A2-10) makes the `terminal` sentence phase-aware
 *  ("Done — committed" vs "Cancelled — …") — the SAME sentence on every
 *  surface; a caller without the phase gets the neutral one. Distinct copy
 *  per state (pinned). */
export function describeLifecycle(state: SessionLifecycleState, error: string | null, idleMs: number | null, phase?: string): string {
  switch (state) {
    case 'crashed':
      return `Crashed — ${error ?? 'the agent turn threw (see stderr.log)'}`;
    case 'stalled':
      return `Stalled — no activity for ${idleMs !== null ? formatIdle(idleMs) : 'a while'}`;
    case 'awaiting-operator':
      return 'Needs you — an operator decision is pending';
    case 'working':
      return 'Agent working — no operator action needed right now';
    case 'terminal':
      return phase !== undefined && phase.length > 0 ? terminalCopy(phase) : 'Finished — nothing further to do';
  }
}

/** W7-FIX-A2 (W7A2-02) — what a successful cancel POST actually did:
 *  `killed` is the bridge's own answer (cli/bridge-studio-session-cancel.ts
 *  → `killTrackedTurn`) — true only when a tracked, provably-ours turn
 *  process was signalled. */
export type CancelOutcome = { killed: boolean; previousPhase: string };

/** The ONE copy helper for a cancel result — DISTINCT sentences for a
 *  confirmed kill and an unconfirmed one (no tracked live turn was found:
 *  the session is marked cancelled and — the terminal phase being sticky —
 *  can never be resurrected by a late completion, but the operator is told
 *  no process was confirmed stopped). Shared by the index, the Home strip
 *  and the session page bar. */
export function describeCancelOutcome(outcome: CancelOutcome): { kind: 'killed' | 'unconfirmed'; text: string } {
  // No quote characters in this copy: it is asserted verbatim against
  // rendered HTML (where `"` would be entity-escaped).
  const at = outcome.previousPhase.length > 0 ? ` at phase ${outcome.previousPhase}` : '';
  if (outcome.killed) {
    return { kind: 'killed', text: `Cancelled${at} — the agent turn was stopped.` };
  }
  return {
    kind: 'unconfirmed',
    text: `Marked cancelled${at} — no live agent turn was found to stop, so no process was confirmed stopped; the session stays cancelled regardless (a late turn completion cannot resurrect it).`,
  };
}

export type CancelStudioSessionResult =
  | { ok: true; killed: boolean; previousPhase: string }
  | { ok: false; error: string };

export async function cancelStudioSession(kind: string, sessionId: string, project: string | null): Promise<CancelStudioSessionResult> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(project !== null ? { project } : {}),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, error: `non-JSON cancel response (HTTP ${res.status}): ${String(err)}` };
  }
  if (!isPlainObject(data)) {
    return { ok: false, error: `malformed cancel response (HTTP ${res.status})` };
  }
  if (!res.ok || data['ok'] !== true) {
    return { ok: false, error: typeof data['error'] === 'string' ? data['error'] : `HTTP ${res.status}` };
  }
  return {
    ok: true,
    killed: data['killed'] === true,
    previousPhase: typeof data['previousPhase'] === 'string' ? data['previousPhase'] : '',
  };
}
