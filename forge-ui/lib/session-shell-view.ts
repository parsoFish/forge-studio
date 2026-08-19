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
  SessionAffordance,
  SessionArtifactPayload,
  SessionLifecycle,
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
  /** The payload's `title` (session-client.ts), threaded through unchanged —
   *  the session-kind descriptor's declared title, with no client-side
   *  fallback, so it cannot drift from studio/session-kinds.yaml. */
  title: string;
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
  /** W6-B6 — the payload's derived, phase-scoped affordances, carried
   *  through UNCHANGED (never re-derived from `phase` at this layer either —
   *  the "derived, not authored" discipline holds all the way to the
   *  component that finally renders them). */
  affordances: SessionAffordance[];
  /** W6-B6 — the session's own kickoff-selected model tier, or `null` when
   *  none was recorded. Carried through verbatim, never guessed. */
  modelTier: string | null;
  /** W6-B8 — the payload's own `terminal` (server-derived, see session-
   *  client.ts), carried through UNCHANGED across a `selectStage` switch — a
   *  session-level fact (like `phase`), never a per-stage one. */
  terminal: boolean;
  /** W7-FIX-A2 (W7A2-04) — the payload's own `transcript` flag (server-
   *  derived from the descriptor, see session-client.ts): whether this KIND
   *  records turns as a transcript at all. Session-level, carried through
   *  UNCHANGED across a `selectStage` switch; keys `emptyStageMessage`. */
  transcript: boolean;
  /** W7-A2 — the payload's own derived lifecycle (server-derived, see
   *  session-lifecycle-client.ts), carried through UNCHANGED across a
   *  `selectStage` switch — a session-level fact, like `terminal`. */
  lifecycle: SessionLifecycle;
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

/** W7-A2 (knowledge-25) + W7-FIX-A2 (W7A2-04) — keyed on the KIND's own
 *  `transcript` flag (bridge-derived from the descriptor) first, then on
 *  lifecycle:
 *    - a transcript-LESS kind (kb-cleanup / authoring / community-refresh —
 *      the turnSpec spine) records its work in the artifact pane in EVERY
 *      state, so it says so — never a "not yet" promise of a turn that is
 *      not coming;
 *    - a transcript-bearing kind still `working` → an honest "not YET";
 *    - a transcript-bearing kind at an operator gate / crashed / stalled /
 *      terminal with no turns for this stage (the instructions/demo
 *      `briefing` shape) → a NEUTRAL line that neither promises a turn nor
 *      claims the artifact pane holds anything. */
function emptyStageMessageFor(stage: string, turns: readonly SessionTurn[], lifecycle: SessionLifecycle, transcript: boolean): string | null {
  if (turns.length > 0) return null;
  if (!transcript) return `No transcript for stage "${stage}" — this session records its work in the artifact pane`;
  if (lifecycle.state === 'working') return `No turns recorded yet for stage "${stage}"`;
  return `No transcript for stage "${stage}" — nothing was recorded for this stage`;
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
    title: payload.title,
    sessionId: payload.sessionId,
    project: payload.project,
    phase: payload.phase,
    stages: [...payload.stages],
    defaultStage: payload.defaultStage,
    selectedStage: stage,
    stageSelectorVisible,
    allTurns: [...payload.turns],
    turnsForStage: turns,
    emptyStageMessage: emptyStageMessageFor(stage, turns, payload.lifecycle, payload.transcript),
    artifactKind,
    artifactLabel: payload.artifact.label,
    artifact: payload.artifact,
    affordances: payload.affordances,
    modelTier: payload.modelTier,
    terminal: payload.terminal,
    transcript: payload.transcript,
    lifecycle: payload.lifecycle,
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
      emptyStageMessage: emptyStageMessageFor(stage, turns, state.lifecycle, state.transcript),
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

// ---------------------------------------------------------------------------
// Pseudo-project anchors (W6-B9 reviewer fix) — a project id starting with
// "." is NEVER a real registered project: `discoverProjects`
// (orchestrator/studio/registry.ts) categorically filters every dot-prefixed
// directory out of the real project list. ".kb-<id>" (KB_SEEDING_ANCHOR_PREFIX,
// cli/bridge-studio-kbs.ts) and ".community-registry" (W6-CR-3's
// COMMUNITY_REFRESH_PROJECT_ANCHOR, cli/bridge-studio-sessions.ts) are the
// two known anchor shapes today; a THIRD, unrecognised dot-prefixed anchor
// still trips `isPseudoProjectAnchor` (the general leading-"." check), it
// just has no known destination — `pseudoProjectAnchorDestination` returns
// `null` for it rather than guessing, and the caller renders NOTHING rather
// than a dead-ended link.
//
// forge-ui never imports cli/ at runtime (see this repo's SSOT-parity-test
// convention, e.g. forge-ui/lib/trigger-kind-parity.test.ts) — this is a
// small, independently-declared mirror of `isPseudoProjectAnchor` and the
// two anchor literals (cli/bridge-studio-sessions.ts), kept honest by a
// parity test in this file's own .test.ts sibling.
// ---------------------------------------------------------------------------

export function isPseudoProjectAnchor(project: string): boolean {
  return project.startsWith('.');
}

export type PseudoProjectDestination = { readonly label: string; readonly href: string };

// W7A2-09: exported so the kickoff page imports the ONE mirror instead of
// re-spelling the literals (the parity pin in this file's .test.ts sibling
// keeps them honest against cli/).
export const KB_SEEDING_ANCHOR_PREFIX = '.kb-';
export const COMMUNITY_REGISTRY_ANCHOR = '.community-registry';

/** `null` for a project that either isn't a pseudo-anchor at all, or IS one
 *  but of an unrecognised shape (a future anchor this file hasn't been
 *  taught yet) — both cases the caller treats identically: render no link
 *  rather than one to a dead end or a guessed destination. */
export function pseudoProjectAnchorDestination(project: string): PseudoProjectDestination | null {
  // W7-A2 (sessions-kinds-35) — a `.kb-<id>` anchor resolves to THAT KB's
  // own page (`/knowledge?id=<id>`, the Knowledge pillar's detail address),
  // never the bare index; the community anchor to the registry browser.
  if (project.startsWith(KB_SEEDING_ANCHOR_PREFIX)) {
    const kbId = project.slice(KB_SEEDING_ANCHOR_PREFIX.length);
    if (kbId.length === 0) return null;
    return { label: `Knowledge base ${kbId}`, href: `/knowledge?id=${encodeURIComponent(kbId)}` };
  }
  if (project === COMMUNITY_REGISTRY_ANCHOR) return { label: 'Community', href: '/community' };
  return null;
}

/** The one thing `app/sessions/[kind]/[sessionId]/page.tsx`'s generic
 *  terminal "back to project" link actually needs: `null` when nothing
 *  should render (no project known, not yet terminal, or a pseudo-anchor
 *  with no known destination), otherwise the real `{label, href}` to render
 *  — a real project's own `/projects/<id>` for an honest project id, or the
 *  pseudo-anchor's own destination otherwise. Pure and total: never throws,
 *  never fabricates a destination this file hasn't been told about. */
export function backToProjectLink(project: string | null): PseudoProjectDestination | null {
  // W7-A2 (sessions-kinds-35) — rendered in EVERY phase, not only terminal:
  // the operator most needs a way out of a session they are actively
  // working on (W7A2-07: the dead `_terminal` parameter is gone).
  if (project === null) return null;
  if (isPseudoProjectAnchor(project)) return pseudoProjectAnchorDestination(project);
  return { label: 'project', href: `/projects/${encodeURIComponent(project)}` };
}
