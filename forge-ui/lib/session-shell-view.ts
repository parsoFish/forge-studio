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
  /** W8-B3 (ON-5) — the payload's `transcriptSources`: which candidate
   *  transcript sources actually exist on disk for this session. Session-
   *  level, carried through UNCHANGED across a `selectStage` switch. Used
   *  ONLY to explain a quiet/absent transcript pane — never to decide
   *  whether the pane renders (that is `panes`, derived from real turns). */
  transcriptSources: string[];
  /** W8-B3 (ON-5) — WHICH PANES this session should render, derived from the
   *  session's real shape (its turns and its live affordances), not from a
   *  per-kind list and not from a stored flag. See `deriveSessionPanes`. */
  panes: SessionPaneSet;
  /** W7-A2 — the payload's own derived lifecycle (server-derived, see
   *  session-lifecycle-client.ts), carried through UNCHANGED across a
   *  `selectStage` switch — a session-level fact, like `terminal`. */
  lifecycle: SessionLifecycle;
  /** W7-C2 (sessions-kinds-36) — the payload's own persisted pointer at
   *  the object a committed session produced, carried through verbatim
   *  (session-level, like `terminal`); null for a session that produced
   *  nothing. */
  finalized: { kind: string; id: string; exists: boolean } | null;
  /** W7-C2 T1 review (P0-3) — the payload's own scoped transcript-derivation
   *  error (server-derived, see session-client.ts), carried through verbatim
   *  and UNCHANGED across a `selectStage` switch: a session-level fact about
   *  the whole derivation, not a per-stage one. Non-null means
   *  `turnsForStage` is empty because the derivation REFUSED, not because
   *  the stage is quiet — the transcript pane says which. */
  transcriptError: string | null;
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

/** W8-B3 (ON-5) — re-keyed off the session's REAL turns. This message is now
 *  only ever reached when the transcript pane actually renders (see
 *  `deriveSessionPanes`), so it no longer has to cover "this kind never
 *  records turns" — that case has no pane at all now, instead of an empty
 *  pane carrying an apology.
 *
 *  The three live cases:
 *    - other stages DO have turns, this one is quiet → say exactly that
 *      (onboarding declares five stages and only ever fills `contract`);
 *    - the session is still `working` → an honest "not YET";
 *    - otherwise (an operator gate with no turns yet — the instructions/demo
 *      `briefing` shape) → a NEUTRAL line that promises nothing. */
function emptyStageMessageFor(
  stage: string,
  turns: readonly SessionTurn[],
  allTurns: readonly SessionTurn[],
  lifecycle: SessionLifecycle,
  transcriptSources: readonly string[],
): string | null {
  if (turns.length > 0) return null;
  if (allTurns.length > 0) return `No turns recorded for stage "${stage}" — this session's turns are on another stage`;
  // W8-B3 adversarial-review finding 2 — the source report is the whole point
  // of `deriveSessionTranscript`'s binding rule ("an empty transcript reads
  // 'scanned N sources, none found' — never 'unknown, rendered empty'"), and
  // the UI had never surfaced it. Naming the files that DO exist separates
  // "nothing has happened yet" from "a file is there and derived no turn" —
  // which is exactly the blank-`prompt.md` shape this lane also fixed.
  const sourceNote = transcriptSources.length > 0
    ? ` — ${transcriptSources.join(', ')} on disk, none of it derived a turn here`
    : ' — nothing has been written to this session yet';
  if (lifecycle.state === 'working') return `No turns recorded yet for stage "${stage}"${sourceNote}`;
  return `No transcript for stage "${stage}"${sourceNote}`;
}

// ---------------------------------------------------------------------------
// deriveSessionPanes (W8-B3, operator note ON-5)
//
// "All the review pages being unified for agent artifacts is good, but there
// are still issues with them in terms of actually making sense for the kind of
// thing they are. There is no transcript for many of these sessions."
//
// The session shell used to render a chat pane for EVERY kind unconditionally,
// so a kb-cleanup or community-refresh session — which genuinely has no turns
// until an operator verdict lands — got half the screen occupied by an empty
// box explaining its own emptiness, while the thing the operator came to read
// (the plan, the staged package) was squeezed into the other half.
//
// The decision is DERIVED from the session's own observable shape, and there
// is deliberately no `panes:` field in studio/session-kinds.yaml for it to
// drift from:
//   - turns exist  → a transcript is the honest way to read this session;
//   - a `question-form` affordance is live → the operator is being asked to
//     type right now, and the answer lands in the transcript, so the pane
//     belongs even before the first turn exists;
//   - otherwise    → no transcript pane; the panel and the artifact stand on
//     their own, and `reason` says why in the DOM rather than in prose the
//     operator has to read.
// ---------------------------------------------------------------------------

export type SessionPaneSet = {
  /** Whether the LEFT column renders the chat transcript at all. */
  readonly transcript: boolean;
  /**
   * Why the transcript pane is absent — `null` whenever it renders. A DOM
   * value (`data-transcript-omitted`), so a journey asserts the decision
   * rather than scraping the copy.
   *
   * The two values are genuinely different situations, not a wording nicety:
   *   - `nothing-recorded` — the session dir holds none of the transcript
   *     sources at all. Nothing has happened here yet.
   *   - `sources-derived-no-turns` — a source file IS on disk and produced no
   *     turn. Today that means a blank `prompt.md` (three brief routes write
   *     `body.brief ?? ''`), which used to render as an empty operator bubble.
   *     Worth telling apart, because the second says the writer ran and the
   *     first says it did not.
   */
  readonly transcriptOmittedReason: 'nothing-recorded' | 'sources-derived-no-turns' | null;
  /** The ordered pane ids actually rendered, for `data-session-panes`. */
  readonly ids: readonly string[];
};

const QUESTION_FORM_AFFORDANCE_KIND = 'question-form';

export function deriveSessionPanes(input: {
  readonly allTurns: readonly SessionTurn[];
  readonly affordances: readonly SessionAffordance[];
  readonly transcriptError: string | null;
  /** Which candidate sources actually exist on disk (bridge-derived). Read
   *  ONLY to say WHY the pane is absent — never to decide whether it renders,
   *  which stays a question about real turns. */
  readonly transcriptSources: readonly string[];
}): SessionPaneSet {
  // A derivation that REFUSED must still show its refusal — dropping the pane
  // would hide the one place the operator can read why the transcript is
  // missing, turning a loud failure into a silent one.
  const awaitingOperatorText = input.affordances.some((a) => a.kind === QUESTION_FORM_AFFORDANCE_KIND);
  const transcript = input.transcriptError !== null || input.allTurns.length > 0 || awaitingOperatorText;
  return {
    transcript,
    transcriptOmittedReason: transcript
      ? null
      : input.transcriptSources.length > 0 ? 'sources-derived-no-turns' : 'nothing-recorded',
    ids: transcript ? ['transcript', 'artifact'] : ['artifact'],
  };
}

function readyDataAttrs(input: {
  kind: string;
  stage: string;
  stageCount: number;
  selectorVisible: boolean;
  turnCount: number;
  artifactKind: string;
  panes: SessionPaneSet;
}): SessionShellDataAttrs {
  return {
    'data-session-status': 'ready',
    'data-session-kind': input.kind,
    'data-session-stage': input.stage,
    'data-session-stage-count': input.stageCount,
    'data-session-selector-visible': input.selectorVisible,
    'data-session-turn-count': input.turnCount,
    'data-session-artifact-kind': input.artifactKind,
    // W8-B3 (ON-5) — the derived pane set, in the DOM so a journey asserts
    // WHICH panes a kind renders instead of scraping the copy inside them.
    'data-session-panes': input.panes.ids.join(','),
    ...(input.panes.transcriptOmittedReason !== null
      ? { 'data-transcript-omitted': input.panes.transcriptOmittedReason }
      : {}),
  };
}

function buildReadyState(payload: SessionShellPayload, stage: string): SessionShellReadyState {
  const turns = turnsForStage(payload.turns, stage);
  const artifactKind = payload.artifact.kind;
  const stageSelectorVisible = payload.stages.length > 1;
  const panes = deriveSessionPanes({
    allTurns: payload.turns,
    affordances: payload.affordances,
    transcriptError: payload.transcriptError,
    transcriptSources: payload.transcriptSources,
  });
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
    emptyStageMessage: emptyStageMessageFor(stage, turns, payload.turns, payload.lifecycle, payload.transcriptSources),
    artifactKind,
    artifactLabel: payload.artifact.label,
    artifact: payload.artifact,
    affordances: payload.affordances,
    modelTier: payload.modelTier,
    terminal: payload.terminal,
    transcriptSources: [...payload.transcriptSources],
    panes,
    lifecycle: payload.lifecycle,
    finalized: payload.finalized,
    transcriptError: payload.transcriptError,
    dataAttrs: readyDataAttrs({
      kind: payload.kind,
      stage,
      stageCount: payload.stages.length,
      selectorVisible: stageSelectorVisible,
      turnCount: turns.length,
      artifactKind,
      panes,
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
      emptyStageMessage: emptyStageMessageFor(stage, turns, state.allTurns, state.lifecycle, state.transcriptSources),
      dataAttrs: readyDataAttrs({
        kind: state.kind,
        stage,
        stageCount: state.stages.length,
        selectorVisible: state.stageSelectorVisible,
        turnCount: turns.length,
        artifactKind: state.artifactKind,
        // A stage switch never changes the pane SET — it is a session-level
        // fact (the session's whole transcript), like `terminal`.
        panes: state.panes,
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
