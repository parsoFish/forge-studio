/**
 * Pure view-state derivation for the interactive session shell page
 * (R2-10, PR2) — no DOM, no React, no network. Mirrors the flow-view-state.
 * ts / skill-library-view.ts testability convention: every function returns
 * a NEW object (immutability), and the page component stays thin, calling
 * these directly off `fetchSessionShell`'s result.
 *
 * DESIGN CHOICES made by this T3 pass, flagged for T2 to ratify or overturn
 * (the brief left these open — this module's own test file states the same
 * four points; restated here at the implementation site):
 *
 * 1. Single-stage treatment: `stageSelectorVisible` is `false` iff
 *    `stages.length <= 1`. `selectStage` still FUNCTIONS on a single-stage
 *    session — only the UI's presented CHOICE is suppressed.
 *
 * 2. "Switching stage switches the artifact pane" is interpreted honestly
 *    against PR1's actual contract: the route returns exactly ONE `artifact`
 *    per session, not one per stage. `selectStage` returns a genuinely NEW
 *    state object (so a page keyed on state identity re-renders), while
 *    `artifactKind`/`artifact`/`artifactLabel` are the SAME value across
 *    every stage in the session — never silently swapped, never stale-
 *    looking.
 *
 * 3. Turn grouping is computed ON SELECTION (`turnsForStage`), not
 *    precomputed into a `Record<stage, turns[]>` map. To make that cheap
 *    re-filter possible on every `selectStage` call, the ready state also
 *    carries `allTurns` — the FULL, unfiltered transcript from the payload.
 *    This is additive surface beyond what any AT names directly, needed so
 *    `selectStage` can recompute a DIFFERENT stage's turns without the
 *    payload being threaded back in on every call.
 *
 * 4. OVERTURNED by T2 (2026-08-05, Correction 1): `artifactLabel` is no
 *    longer computed via a client-side closed lookup keyed on `artifact.kind`
 *    — that was a second copy of declared data (the label already lives in
 *    `studio/session-kinds.yaml` via the descriptor) and could never
 *    represent a future kind reusing an existing artifact kind with a
 *    DIFFERENT label. `artifactLabel` is now threaded straight through from
 *    `payload.artifact.label` — a required field on the artifact itself
 *    (session-client.ts's `parseSessionArtifact`, AT-90).
 *
 * 5. `dataAttrs` on the non-"ready" statuses (loading / no-session / error)
 *    carries only `data-session-status` — no stray "ready"-only attribute
 *    keys leak onto those DOM states.
 */

import type {
  SessionArtifactPayload,
  SessionShellErrorKind,
  SessionShellFetchResult,
  SessionShellPayload,
  SessionTurn,
} from './session-client';

// ---------------------------------------------------------------------------
// State shapes — a genuine discriminated union (AT-69: a "no-session" state
// carries no stray "ready"-only fields).
// ---------------------------------------------------------------------------

export type SessionShellDataAttrs = Record<string, string | number | boolean>;

export type SessionShellLoadingState = {
  status: 'loading';
  dataAttrs: SessionShellDataAttrs;
};

export type SessionShellNoSessionState = {
  status: 'no-session';
  error: string;
  dataAttrs: SessionShellDataAttrs;
};

export type SessionShellErrorState = {
  status: 'error';
  errorKind: Exclude<SessionShellErrorKind, 'not-found'>;
  error: string;
  dataAttrs: SessionShellDataAttrs;
};

export type SessionShellReadyState = {
  status: 'ready';
  kind: string;
  sessionId: string;
  project: string;
  phase: string;
  stages: string[];
  defaultStage: string;
  selectedStage: string;
  stageSelectorVisible: boolean;
  /** The FULL, unfiltered transcript — carried so `selectStage` can
   *  recompute a different stage's turns without the payload being threaded
   *  back in (design choice 3 above). */
  allTurns: SessionTurn[];
  turnsForStage: SessionTurn[];
  /** Non-null iff `turnsForStage` is empty — names WHICH stage is empty
   *  (AT-50), never a blank pane. */
  emptyStageMessage: string | null;
  artifactKind: SessionArtifactPayload['kind'];
  artifactLabel: string;
  artifact: SessionArtifactPayload;
  dataAttrs: SessionShellDataAttrs;
};

export type SessionShellViewState =
  | SessionShellLoadingState
  | SessionShellNoSessionState
  | SessionShellErrorState
  | SessionShellReadyState;

// ---------------------------------------------------------------------------
// sessionShellState / selectStage
// ---------------------------------------------------------------------------

function turnsForStage(turns: readonly SessionTurn[], stage: string): SessionTurn[] {
  return turns.filter((t) => t.stage === stage);
}

function emptyStageMessageFor(stage: string, turns: readonly SessionTurn[]): string | null {
  if (turns.length > 0) return null;
  return `No turns recorded yet for stage "${stage}"`;
}

function readyDataAttrs(input: {
  kind: string;
  stage: string;
  stageCount: number;
  selectorVisible: boolean;
  turnCount: number;
  artifactKind: string;
}): SessionShellDataAttrs {
  return {
    'data-session-status': 'ready',
    'data-session-kind': input.kind,
    'data-session-stage': input.stage,
    'data-session-stage-count': input.stageCount,
    'data-session-selector-visible': input.selectorVisible,
    'data-session-turn-count': input.turnCount,
    'data-session-artifact-kind': input.artifactKind,
  };
}

function buildReadyState(payload: SessionShellPayload, stage: string): SessionShellReadyState {
  const turns = turnsForStage(payload.turns, stage);
  const artifactKind = payload.artifact.kind;
  const stageSelectorVisible = payload.stages.length > 1;
  return {
    status: 'ready',
    kind: payload.kind,
    sessionId: payload.sessionId,
    project: payload.project,
    phase: payload.phase,
    stages: [...payload.stages],
    defaultStage: payload.defaultStage,
    selectedStage: stage,
    stageSelectorVisible,
    allTurns: [...payload.turns],
    turnsForStage: turns,
    emptyStageMessage: emptyStageMessageFor(stage, turns),
    artifactKind,
    artifactLabel: payload.artifact.label,
    artifact: payload.artifact,
    dataAttrs: readyDataAttrs({
      kind: payload.kind,
      stage,
      stageCount: payload.stages.length,
      selectorVisible: stageSelectorVisible,
      turnCount: turns.length,
      artifactKind,
    }),
  };
}

/** Derives the initial ready state for a freshly-fetched session payload,
 *  selecting `defaultStage` (never `stages[0]` — AT-48). */
export function sessionShellState(payload: SessionShellPayload): SessionShellReadyState {
  return buildReadyState(payload, payload.defaultStage);
}

export type SelectStageResult =
  | { ok: true; state: SessionShellReadyState }
  | { ok: false; error: string };

/**
 * Switch the selected stage. A stage outside the session's declared `stages`
 * — even a real, globally-known stage token — returns `{ok:false}` naming
 * the offending value and the allowed set, never a silent fallback to the
 * previous or default stage. `kind`/`sessionId`/`project`/`phase`/`stages`/
 * `artifact`/`artifactKind`/`artifactLabel` are UNCHANGED across a switch —
 * only stage-scoped fields move.
 */
export function selectStage(state: SessionShellReadyState, stage: string): SelectStageResult {
  if (!state.stages.includes(stage)) {
    return {
      ok: false,
      error: `stage ${JSON.stringify(stage)} is not a member of this session's declared stages [${state.stages.join(', ')}]`,
    };
  }
  const turns = turnsForStage(state.allTurns, stage);
  return {
    ok: true,
    state: {
      ...state,
      selectedStage: stage,
      turnsForStage: turns,
      emptyStageMessage: emptyStageMessageFor(stage, turns),
      dataAttrs: readyDataAttrs({
        kind: state.kind,
        stage,
        stageCount: state.stages.length,
        selectorVisible: state.stageSelectorVisible,
        turnCount: turns.length,
        artifactKind: state.artifactKind,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// deriveSessionShellViewState — first-class loading / no-session / error /
// ready states, over the client's fetch result.
// ---------------------------------------------------------------------------

/** `result === null` is the pre-fetch state. Only `errorKind: 'not-found'`
 *  maps to the first-class "no-session" state; every OTHER fail-closed
 *  errorKind (bad-request, network-error, malformed-response, non-json-
 *  response, server-error, no-bridge, stage-conflict) maps to "error",
 *  preserving the server's message VERBATIM — a 409 stage-conflict must
 *  reach the operator, never be smoothed into "no-session" or a generic
 *  message. */
export function deriveSessionShellViewState(result: SessionShellFetchResult | null): SessionShellViewState {
  if (result === null) {
    return { status: 'loading', dataAttrs: { 'data-session-status': 'loading' } };
  }
  if (result.ok) {
    return sessionShellState(result.payload);
  }
  if (result.errorKind === 'not-found') {
    return {
      status: 'no-session',
      error: result.error,
      dataAttrs: { 'data-session-status': 'no-session' },
    };
  }
  return {
    status: 'error',
    errorKind: result.errorKind,
    error: result.error,
    dataAttrs: { 'data-session-status': 'error' },
  };
}
