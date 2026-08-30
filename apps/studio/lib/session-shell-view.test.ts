/**
 * Tests for forge-ui/lib/session-shell-view.ts (R2-10, PR2) — DOES NOT EXIST
 * YET. Vitest cannot even collect this file until it lands (module-not-found
 * is the expected red).
 *
 * PURE view-state derivation for the interactive session shell page — no DOM,
 * no React, no network — mirrors the flow-view-state.ts / skill-library-view.
 * ts testability convention exactly.
 *
 * AT numbers continue the flat PR2 sequence started in session-client.test.ts
 * (that file closes at AT-42).
 *
 * ---------------------------------------------------------------------------
 * DESIGN CHOICES made by this T3 pass, flagged for T2 to ratify or overturn
 * (the brief left these open):
 *
 * 1. Single-stage treatment: `stageSelectorVisible` is `false` iff
 *    `stages.length <= 1`. All three shipped kinds (architect/instructions/
 *    project-brain) are single-stage today, so this is always `false` for
 *    real traffic until R4-15/16/17 land a multi-stage kind — but `selectStage`
 *    still FUNCTIONS on a single-stage session (selecting the one declared
 *    stage is not an error); only the UI's presented CHOICE is suppressed.
 *
 * 2. "Switching stage switches the artifact pane" (per the T3 brief) is
 *    interpreted honestly against PR1's actual contract: the route returns
 *    exactly ONE `artifact` for the whole session, not one per stage — so
 *    there is no "different artifact per stage" to switch TO today. What
 *    `selectStage` pins instead: it returns a genuinely NEW state object
 *    (so a page keyed on state identity re-renders the artifact pane), while
 *    `artifactKind`/`artifact`/`artifactLabel` are the SAME value across every
 *    stage in the session (never silently swapped, never stale-looking).
 *    This is the honest behaviour given today's one-artifact-per-session
 *    contract; a future per-stage artifact model (if R4-17 needs one) would
 *    need the ROUTE to change first, not just this view module.
 *
 *    RATIFIED by T2 (2026-08-05, Correction 2), verified against the
 *    acceptance reference recorded in docs/reference/studio-copy.md: a
 *    session has ONE artifact kind, and a future multi-stage renderer (the
 *    reserved `contract-buildout` row, R4-17) is a STAGE-AWARE renderer that
 *    switches its own sub-view on the selected stage — not a different
 *    artifact per stage. T2 additionally required the SEAM that makes R4-17
 *    a drop-in: `state.selectedStage` (this module) must be a value a caller
 *    can thread into the artifact-view dispatcher as an explicit second
 *    input. That seam — and the invariance-under-stage proof for today's 3
 *    stage-UNAWARE renderers — is pinned in session-artifact-view.test.ts's
 *    `sessionArtifactView(artifact, stage)` ATs (AT-91..95), not here: this
 *    module only needs to keep exposing `selectedStage` on the ready state,
 *    which it already did (AT-54 etc.) before this correction.
 *
 * 3. Turn grouping is computed ON SELECTION (`turnsForStage` on the current
 *    state), not precomputed into a `Record<stage, turns[]>` map up front —
 *    simpler, and `selectStage` recomputing per call is O(turns) which is
 *    trivially cheap for a session transcript.
 *
 * 4. AMENDED by T2 (2026-08-05, Correction 1) — OVERTURNED: `artifactLabel`
 *    is no longer computed via a client-side closed lookup
 *    (`artifactLabelFor`, deleted from this module's contract). It is now
 *    threaded straight through from `payload.artifact.label` — a required
 *    field on the artifact itself (see session-client.test.ts's AT-90 and
 *    its header amendment). A hardcoded kind→label map was a second copy of
 *    declared data (the label already lives in `studio/session-kinds.yaml`
 *    via the descriptor) — exactly the drift this campaign keeps finding,
 *    and it could never represent a future kind reusing an existing artifact
 *    kind with a different label. See AT-45 (amended) and AT-61 (amended,
 *    now proves two payloads with the SAME artifact.kind but DIFFERENT
 *    artifact.label produce different `state.artifactLabel` — exactly what
 *    the old closed lookup could not do).
 *
 *    VERIFIED GAP (flagged, not silently assumed away): as of this
 *    amendment the REAL route (cli/bridge-studio-sessions.ts, unchanged
 *    since PR1 — `git diff --stat HEAD` on it is empty) does not yet put
 *    `label` on the artifact it sends; see session-client.test.ts's header
 *    amendment for the full trace. This module's contract is written
 *    against the CORRECTED payload shape per T2's instruction; the route
 *    needs a small companion change before real traffic satisfies it.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * AMENDMENT (T2 ruling, 2026-08-05): `title` — same story as `artifact.label`
 * above, one layer up. It is now REQUIRED on `SessionShellPayload`
 * (session-client.test.ts's AT-95..97) and threaded verbatim onto the ready
 * state here — never a client-side fallback to the raw `kind` slug (a shipped
 * implementation pass had done exactly that, reasoning from this file's own
 * pre-existing fixtures lacking `title`; T2 ruled a wire-contract decision
 * must never be driven by a fixture gap). Both fixtures now carry a `title`
 * — `SINGLE_STAGE_PAYLOAD` the real YAML value ("Planning session"),
 * `MULTI_STAGE_PAYLOAD` a clearly-synthetic one (that kind is hypothetical).
 * AT-98/99 pin `state.title` threading through verbatim and the same
 * anti-hardcode bite AT-61 pins for `artifactLabel`: two payloads sharing
 * every other field but a different `title` must produce different ready
 * states — the test a reintroduced local heading map would fail.
 * ---------------------------------------------------------------------------
 */
import { test, expect } from 'vitest';
import {
  sessionShellState,
  selectStage,
  deriveSessionShellViewState,
  isPseudoProjectAnchor,
  pseudoProjectAnchorDestination,
  backToProjectLink,
} from './session-shell-view.ts';
import type { SessionShellPayload, SessionShellFetchResult } from './session-client.ts';
// W6-B9 reviewer fix — the real, on-disk SSOT this file's own
// `isPseudoProjectAnchor` mirrors (imported directly, not re-typed/
// re-declared, mirroring trigger-kind-parity.test.ts's precedent — inert at
// module-load time, no I/O until a function is actually called).
import {
  isPseudoProjectAnchor as SSOT_isPseudoProjectAnchor,
  COMMUNITY_REFRESH_PROJECT_ANCHOR as SSOT_COMMUNITY_REFRESH_PROJECT_ANCHOR,
} from '../../cli/bridge-studio-sessions.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SINGLE_STAGE_PAYLOAD: SessionShellPayload = {
  ok: true,
  kind: 'architect',
  title: 'Planning session', // real literal, studio/session-kinds.yaml
  sessionId: '2026-08-05T10-00-00',
  project: 'gitpulse',
  phase: 'awaiting-verdict',
  stages: ['roadmap'],
  defaultStage: 'roadmap',
  turns: [
    { index: 0, role: 'operator', stage: 'roadmap', text: 'Build a thing', source: 'idea.md' },
    { index: 1, role: 'agent', stage: 'roadmap', text: 'Which repo?', source: 'answers.json#round-1' },
    { index: 2, role: 'operator', stage: 'roadmap', text: 'gitpulse', source: 'answers.json#round-1' },
  ],
  artifact: { kind: 'roadmap-draft', label: 'Roadmap draft', rows: [], sourcesScanned: ['manifests/*.md (0 file(s) found)'] },
  affordances: [],
  // W7-C2 (T1 review P0-3/P0-4): both REQUIRED, `null` being the honest
  // value — nothing finalized, and the transcript derivation succeeded.
  finalized: null,
  transcriptError: null,
  modelTier: null,
  // W6-B8 — 'awaiting-verdict' is not a terminal phase for architect.
  terminal: false,
  // W8-B3 (ON-5) — the candidate sources actually on disk for this session.
  transcriptSources: ['idea.md', 'answers.json'],
  // W7-A2 — awaiting-verdict is an operator gate.
  lifecycle: { state: 'awaiting-operator' as const, needsYou: true, error: null, idleMs: null, cancellable: true },
  // F6 (wave-8) — REQUIRED like "terminal": this fixture's session has a
  // real project-side status.json, so its honest value is false.
  legacy: false,
};

// Mandatory multi-stage fixture — no shipped kind is multi-stage today, but
// this is the machinery R4-17 rides, so it must be genuinely exercised here.
// Turns are tagged across all 5 declared stages; 'secrets' is deliberately
// left with ZERO turns (the honest-empty-stage case), and the 'demo' stage's
// two turns are given NON-adjacent, NON-ascending indices (5 then 2) to prove
// this module never re-sorts or re-numbers by index.
const MULTI_STAGE_PAYLOAD: SessionShellPayload = {
  ok: true,
  kind: 'future-multi-stage-kind',
  title: 'Future multi-stage session', // synthetic — this kind is hypothetical (R4-17), no real YAML entry exists yet
  sessionId: '2026-08-05T13-00-00',
  project: 'gitpulse',
  phase: 'in-progress',
  stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
  defaultStage: 'instructions',
  turns: [
    { index: 0, role: 'operator', stage: 'contract', text: 'contract turn 1', source: 'a.md' },
    { index: 1, role: 'operator', stage: 'instructions', text: 'instructions turn 1', source: 'b.md' },
    { index: 2, role: 'agent', stage: 'instructions', text: 'instructions turn 2', source: 'c.md' },
    // 'secrets' — deliberately zero turns.
    { index: 5, role: 'operator', stage: 'demo', text: 'demo turn (index 5, out of ascending order)', source: 'd.md' },
    { index: 2, role: 'agent', stage: 'demo', text: 'demo turn (index 2, appears AFTER index 5 above)', source: 'e.md' },
    { index: 6, role: 'operator', stage: 'roadmap', text: 'roadmap turn 1', source: 'f.md' },
  ],
  artifact: { kind: 'markdown-draft', label: 'AGENTS.md draft', body: '# draft', hasDraft: true },
  affordances: [],
  // W7-C2 (T1 review P0-3/P0-4): both REQUIRED, `null` being the honest
  // value — nothing finalized, and the transcript derivation succeeded.
  finalized: null,
  transcriptError: null,
  modelTier: null,
  // W6-B8 — a synthetic 'in-progress' phase, not terminal.
  terminal: false,
  // W8-B3 (ON-5) — a synthetic session with real sources on disk.
  transcriptSources: ['prompt.md'],
  // W7-A2 — a synthetic working phase.
  lifecycle: { state: 'working' as const, needsYou: false, error: null, idleMs: null, cancellable: true },
  // F6 (wave-8) — REQUIRED like "terminal": this fixture's session has a
  // real project-side status.json, so its honest value is false.
  legacy: false,
};

// ===========================================================================
// sessionShellState — single-stage kind — AT-43..AT-47
// ===========================================================================

test('AT-43: sessionShellState: a single-stage payload selects the ONLY stage (== defaultStage) and hides the stage selector', () => {
  const state = sessionShellState(SINGLE_STAGE_PAYLOAD);
  expect(state.status).toBe('ready');
  expect(state.selectedStage).toBe('roadmap');
  expect(state.stages).toEqual(['roadmap']);
  expect(state.stageSelectorVisible).toBe(false);
});

test('AT-44: sessionShellState: a single-stage session\'s turns still carry their stage, and all appear (no filtering surprise) since every turn shares the one stage', () => {
  const state = sessionShellState(SINGLE_STAGE_PAYLOAD);
  expect(state.turnsForStage.map((t) => t.stage)).toEqual(['roadmap', 'roadmap', 'roadmap']);
  expect(state.turnsForStage).toEqual(SINGLE_STAGE_PAYLOAD.turns);
});

test('AT-45 (amended, T2 Correction 1): sessionShellState: artifactKind/artifactLabel are threaded straight from the payload\'s artifact.kind/artifact.label — never a client-side lookup, never invented', () => {
  const state = sessionShellState(SINGLE_STAGE_PAYLOAD);
  expect(state.artifactKind).toBe('roadmap-draft');
  // Independent expected value AND the fixture's own carried value — both
  // must agree. This is no longer cross-checked against a same-module lookup
  // function (that was the self-referential shape T2 overturned); the ground
  // truth is now the WIRE PAYLOAD itself.
  expect(state.artifactLabel).toBe('Roadmap draft');
  expect(state.artifactLabel).toBe(SINGLE_STAGE_PAYLOAD.artifact.label);
  expect(state.artifact).toEqual(SINGLE_STAGE_PAYLOAD.artifact);
});

test('AT-46: sessionShellState: kind/sessionId/project/phase pass through verbatim', () => {
  const state = sessionShellState(SINGLE_STAGE_PAYLOAD);
  expect(state.kind).toBe('architect');
  expect(state.sessionId).toBe('2026-08-05T10-00-00');
  expect(state.project).toBe('gitpulse');
  expect(state.phase).toBe('awaiting-verdict');
});

test('AT-47: sessionShellState: dataAttrs shape is present and internally consistent with the derived state', () => {
  const state = sessionShellState(SINGLE_STAGE_PAYLOAD);
  expect(state.dataAttrs['data-session-status']).toBe('ready');
  expect(state.dataAttrs['data-session-kind']).toBe('architect');
  expect(state.dataAttrs['data-session-stage']).toBe('roadmap');
  expect(state.dataAttrs['data-session-stage-count']).toBe(1);
  expect(state.dataAttrs['data-session-selector-visible']).toBe(false);
  expect(state.dataAttrs['data-session-turn-count']).toBe(3);
  expect(state.dataAttrs['data-session-artifact-kind']).toBe('roadmap-draft');
});

// ===========================================================================
// sessionShellState — mandatory multi-stage fixture — AT-48..AT-53
// ===========================================================================

test('AT-48: sessionShellState: a multi-stage payload initially selects defaultStage (not stages[0]) and SHOWS the stage selector', () => {
  const state = sessionShellState(MULTI_STAGE_PAYLOAD);
  expect(state.selectedStage).toBe('instructions'); // defaultStage, NOT 'contract' (stages[0])
  expect(state.stages).toEqual(['contract', 'instructions', 'secrets', 'demo', 'roadmap']);
  expect(state.stageSelectorVisible).toBe(true);
});

test('AT-49: sessionShellState: each stage shows EXACTLY its own turns — the initial (instructions) stage\'s turns are isolated from every other stage', () => {
  const state = sessionShellState(MULTI_STAGE_PAYLOAD);
  expect(state.turnsForStage.map((t) => t.text)).toEqual(['instructions turn 1', 'instructions turn 2']);
  expect(state.turnsForStage.every((t) => t.stage === 'instructions')).toBe(true);
});

test('AT-50: sessionShellState: a stage with ZERO turns (secrets) is still selectable and renders an HONEST empty state naming which stage is empty — never a blank pane', () => {
  const secretsSelected = selectStage(sessionShellState(MULTI_STAGE_PAYLOAD), 'secrets');
  expect(secretsSelected.ok).toBe(true);
  if (secretsSelected.ok) {
    expect(secretsSelected.state.turnsForStage).toEqual([]);
    expect(secretsSelected.state.emptyStageMessage).not.toBeNull();
    expect(secretsSelected.state.emptyStageMessage).toContain('secrets');
  }
});

test('AT-51: sessionShellState: a stage WITH turns has a null emptyStageMessage — the honest-empty message never appears alongside real turns', () => {
  const state = sessionShellState(MULTI_STAGE_PAYLOAD); // defaultStage 'instructions' has 2 turns
  expect(state.emptyStageMessage).toBeNull();
});

// ---------------------------------------------------------------------------
// W7-FIX-A2 (W7A2-04) — the empty-transcript copy is keyed on the payload's
// DESCRIPTOR-DERIVED `transcript` flag (bridge: a turnSpec kind rides the
// generic spine, which never writes transcript turns → false), never on the
// lifecycle state alone. The sweep's repro: an instructions/demo session at
// its `briefing` phase (awaiting-operator, zero turns, empty artifact) used to
// read "this session records its work in the artifact pane" — false on both
// counts.
// ---------------------------------------------------------------------------

function emptyMessageFor(over: Partial<SessionShellPayload>): string | null {
  const payload: SessionShellPayload = { ...SINGLE_STAGE_PAYLOAD, turns: [], ...over } as SessionShellPayload;
  return sessionShellState(payload).emptyStageMessage;
}

test('W7A2-04: transcript-bearing kind + working + zero turns → "No turns recorded yet" (an honest not-YET)', () => {
  const msg = emptyMessageFor({ kind: 'instructions', lifecycle: { state: 'working', needsYou: false, error: null, idleMs: null, cancellable: true } });
  expect(msg).toMatch(/No turns recorded yet/);
  expect(msg).not.toMatch(/artifact pane/);
});

test('W7A2-04: transcript-bearing kind at an operator gate / crashed / stalled / terminal with zero turns → a NEUTRAL "no transcript" line that neither promises a turn nor claims the artifact pane (the instructions/demo `briefing` shape)', () => {
  for (const state of ['awaiting-operator', 'crashed', 'stalled', 'terminal'] as const) {
    const msg = emptyMessageFor({ kind: 'instructions', phase: 'briefing', lifecycle: { state, needsYou: state !== 'terminal', error: state === 'crashed' ? 'boom' : null, idleMs: null, cancellable: state !== 'terminal' } });
    expect(msg, state).toMatch(/No transcript/);
    expect(msg, state).toContain('roadmap');
    expect(msg, state).not.toMatch(/artifact pane/);
    expect(msg, state).not.toMatch(/yet/);
  }
});

// W8-B3 (ON-5) SUPERSEDES W7A2-04's third case. That test pinned the exact
// behaviour operator note ON-5 complains about: a kind with no turns still got
// a transcript pane, and the pane's whole job was to apologise for being empty
// ("this session records its work in the artifact pane"). The honest answer is
// not better copy inside the empty pane — it is no pane. The apology string is
// therefore GONE, and what is pinned instead is the pane decision.
test('W8-B3 (ON-5): a session with no turns and no live question-form renders NO transcript pane (the empty apologising pane is gone, not re-worded)', () => {
  for (const state of ['working', 'awaiting-operator', 'crashed', 'stalled', 'terminal'] as const) {
    const state_ = sessionShellState({
      ...SINGLE_STAGE_PAYLOAD,
      kind: 'kb-cleanup',
      turns: [],
      transcriptSources: [],
      affordances: [],
      lifecycle: { state, needsYou: false, error: null, idleMs: null, cancellable: state !== 'terminal' },
    } as SessionShellPayload);
    expect(state_.panes.transcript, state).toBe(false);
    expect(state_.panes.transcriptOmittedReason, state).toBe('nothing-recorded');
    expect(state_.panes.ids, state).toEqual(['artifact']);
    expect(state_.dataAttrs['data-session-panes'], state).toBe('artifact');
    expect(state_.dataAttrs['data-transcript-omitted'], state).toBe('nothing-recorded');
  }
});

test('W8-B3 (ON-5): one real turn is enough to earn the transcript pane — the decision is DERIVED from turns, never from the kind id or a stored per-kind flag', () => {
  // `authoring` is the exact kind the retired `transcript: descriptor.turnSpec
  // === undefined` proxy got WRONG: it declares a turnSpec, so the proxy said
  // "records no turns", while its start route (writeAuthoringSession) writes
  // prompt.md before the generic spine ever runs. Measured against the real
  // writer: turns=1, source=prompt.md.
  const state = sessionShellState({
    ...SINGLE_STAGE_PAYLOAD,
    kind: 'authoring',
    turns: [{ index: 0, role: 'operator', stage: 'roadmap', text: 'Build me a changelog linter', source: 'prompt.md' }],
    transcriptSources: ['prompt.md'],
    affordances: [],
  } as SessionShellPayload);
  expect(state.panes.transcript).toBe(true);
  expect(state.panes.transcriptOmittedReason).toBeNull();
  expect(state.dataAttrs['data-session-panes']).toBe('transcript,artifact');
  expect(state.dataAttrs['data-transcript-omitted']).toBeUndefined();
});

test('W8-B3 (ON-5): a live question-form earns the transcript pane BEFORE the first turn exists — the answer lands there', () => {
  const state = sessionShellState({
    ...SINGLE_STAGE_PAYLOAD,
    kind: 'instructions',
    phase: 'briefing',
    turns: [],
    transcriptSources: [],
    affordances: [{ id: 'briefing-question-form', kind: 'question-form', phase: 'briefing', label: 'Brief', description: null, meta: {} }],
  } as unknown as SessionShellPayload);
  expect(state.panes.transcript).toBe(true);
});

test('W8-B3 (ON-5): a REFUSED transcript derivation keeps its pane even with zero turns — dropping it would hide the only place the refusal is readable', () => {
  const state = sessionShellState({
    ...SINGLE_STAGE_PAYLOAD,
    kind: 'kb-cleanup',
    turns: [],
    transcriptSources: ['verdicts.json'],
    affordances: [],
    transcriptError: 'verdicts.json is not valid JSON — Unexpected token }',
  } as SessionShellPayload);
  expect(state.panes.transcript).toBe(true);
  expect(state.panes.transcriptOmittedReason).toBeNull();
});

test('W8-B3 (ON-5): a quiet stage on a session whose OTHER stages have turns says so, and does not claim nothing was ever recorded', () => {
  const selected = selectStage(sessionShellState(MULTI_STAGE_PAYLOAD), 'secrets');
  expect(selected.ok).toBe(true);
  if (selected.ok) {
    expect(selected.state.emptyStageMessage).toMatch(/turns are on another stage/);
    // The pane SET is session-level and does not move with the stage.
    expect(selected.state.panes.transcript).toBe(true);
  }
});

test('AT-52: sessionShellState: turn ordering within a stage is preserved EXACTLY as the server sent it — never re-sorted by index, never re-numbered', () => {
  const demoSelected = selectStage(sessionShellState(MULTI_STAGE_PAYLOAD), 'demo');
  expect(demoSelected.ok).toBe(true);
  if (demoSelected.ok) {
    // Server order: index 5 first, then index 2 — NOT ascending. A re-sort
    // would flip this to [2, 5]; this pins the passthrough, not a sort.
    expect(demoSelected.state.turnsForStage.map((t) => t.index)).toEqual([5, 2]);
    expect(demoSelected.state.turnsForStage.map((t) => t.text)).toEqual([
      'demo turn (index 5, out of ascending order)',
      'demo turn (index 2, appears AFTER index 5 above)',
    ]);
  }
});

test('AT-53: sessionShellState: every turn across the whole payload preserves its original `index` value untouched (never renumbered per-stage)', () => {
  const state = sessionShellState(MULTI_STAGE_PAYLOAD);
  // contract's lone turn keeps index 0 even though it is stage[0] and turn[0].
  const contractSelected = selectStage(state, 'contract');
  expect(contractSelected.ok).toBe(true);
  if (contractSelected.ok) {
    expect(contractSelected.state.turnsForStage[0]!.index).toBe(0);
  }
  // roadmap's lone turn keeps index 6 (its ORIGINAL server-assigned index),
  // never renumbered to 0 just because it's the only turn in its stage view.
  const roadmapSelected = selectStage(state, 'roadmap');
  expect(roadmapSelected.ok).toBe(true);
  if (roadmapSelected.ok) {
    expect(roadmapSelected.state.turnsForStage[0]!.index).toBe(6);
  }
});

// ===========================================================================
// selectStage — AT-54..AT-60
// ===========================================================================

test('AT-54: selectStage: switching to a declared stage with turns returns ok:true, a NEW state object, with turnsForStage switched to that stage\'s own turns', () => {
  const initial = sessionShellState(MULTI_STAGE_PAYLOAD);
  const result = selectStage(initial, 'demo');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.state).not.toBe(initial); // immutability — new object
    expect(result.state.selectedStage).toBe('demo');
    expect(result.state.turnsForStage.map((t) => t.stage)).toEqual(['demo', 'demo']);
  }
});

test('AT-55: selectStage: the artifact/artifactKind/artifactLabel are UNCHANGED across a stage switch — one artifact per session, never swapped or gone stale-looking', () => {
  const initial = sessionShellState(MULTI_STAGE_PAYLOAD);
  const result = selectStage(initial, 'roadmap');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.state.artifactKind).toBe(initial.artifactKind);
    expect(result.state.artifactLabel).toBe(initial.artifactLabel);
    expect(result.state.artifact).toEqual(initial.artifact);
  }
});

test('AT-56: selectStage: kind/sessionId/project/phase/stages are UNCHANGED across a stage switch — only stage-scoped fields move', () => {
  const initial = sessionShellState(MULTI_STAGE_PAYLOAD);
  const result = selectStage(initial, 'contract');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.state.kind).toBe(initial.kind);
    expect(result.state.sessionId).toBe(initial.sessionId);
    expect(result.state.project).toBe(initial.project);
    expect(result.state.phase).toBe(initial.phase);
    expect(result.state.stages).toEqual(initial.stages);
  }
});

test('AT-57: selectStage: a stage NOT in the session\'s declared stages returns an ERROR state naming the offending value and the allowed set — never a silent default back to the previous or default stage', () => {
  const initial = sessionShellState(MULTI_STAGE_PAYLOAD);
  const result = selectStage(initial, 'brain'); // a REAL global stage token, just not declared by THIS session
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain('brain');
    expect(result.error).toContain('contract');
    expect(result.error).toContain('instructions');
    expect(result.error).toContain('secrets');
    expect(result.error).toContain('demo');
    expect(result.error).toContain('roadmap');
  }
  // The original state is untouched by a failed selection attempt.
  expect(initial.selectedStage).toBe('instructions');
});

test('AT-58: selectStage: a totally bogus stage string returns the same kind of error, never throws', () => {
  const initial = sessionShellState(MULTI_STAGE_PAYLOAD);
  expect(() => selectStage(initial, 'not-a-real-stage')).not.toThrow();
  const result = selectStage(initial, 'not-a-real-stage');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain('not-a-real-stage');
  }
});

test('AT-59: selectStage: on a SINGLE-stage session, selecting the one declared stage still works (ok:true) even though the selector is not presented as a choice', () => {
  const initial = sessionShellState(SINGLE_STAGE_PAYLOAD);
  expect(initial.stageSelectorVisible).toBe(false);
  const result = selectStage(initial, 'roadmap');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.state.selectedStage).toBe('roadmap');
  }
});

test('AT-60: selectStage: selecting the ALREADY-selected stage is a no-op-shaped success (ok:true), still returning consistent turnsForStage — never an error just because nothing "changed"', () => {
  const initial = sessionShellState(MULTI_STAGE_PAYLOAD); // selectedStage: 'instructions'
  const result = selectStage(initial, 'instructions');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.state.selectedStage).toBe('instructions');
    expect(result.state.turnsForStage).toEqual(initial.turnsForStage);
  }
});

// ===========================================================================
// artifactLabel provenance — AT-61 (amended, T2 Correction 1)
// ===========================================================================

test('AT-61 (amended, T2 Correction 1): sessionShellState: two payloads with the SAME artifact.kind but DIFFERENT artifact.label produce DIFFERENT state.artifactLabel — proof this is threaded from the wire, not a closed client-side lookup keyed on kind (which could never do this)', () => {
  const payloadA: SessionShellPayload = {
    ...SINGLE_STAGE_PAYLOAD,
    artifact: { kind: 'roadmap-draft', label: 'Roadmap draft', rows: [], sourcesScanned: ['manifests/*.md (0 file(s) found)'] },
  };
  const payloadB: SessionShellPayload = {
    ...SINGLE_STAGE_PAYLOAD,
    artifact: { kind: 'roadmap-draft', label: 'A future R4-17 kind reusing roadmap-draft with its own label', rows: [], sourcesScanned: ['manifests/*.md (0 file(s) found)'] },
  };

  const stateA = sessionShellState(payloadA);
  const stateB = sessionShellState(payloadB);

  // SAME artifact.kind on both...
  expect(stateA.artifactKind).toBe('roadmap-draft');
  expect(stateB.artifactKind).toBe('roadmap-draft');
  // ...but the label follows the PAYLOAD, not the kind.
  expect(stateA.artifactLabel).toBe('Roadmap draft');
  expect(stateB.artifactLabel).toBe('A future R4-17 kind reusing roadmap-draft with its own label');
  expect(stateA.artifactLabel).not.toBe(stateB.artifactLabel);
});

// ===========================================================================
// deriveSessionShellViewState — first-class loading / no-session / error /
// ready states — AT-62..AT-69
// ===========================================================================

test('AT-62: deriveSessionShellViewState(null): the pre-fetch state is "loading", with its own distinct dataAttrs', () => {
  const state = deriveSessionShellViewState(null);
  expect(state.status).toBe('loading');
  expect(state.dataAttrs['data-session-status']).toBe('loading');
});

test('AT-63: deriveSessionShellViewState: a "not-found" client result maps to the first-class "no-session" state, distinct from "loading" and from a fail-closed "error"', () => {
  const result: SessionShellFetchResult = { ok: false, errorKind: 'not-found', error: 'session not found' };
  const state = deriveSessionShellViewState(result);
  expect(state.status).toBe('no-session');
  expect(state.status).not.toBe('loading');
  expect(state.status).not.toBe('error');
  if (state.status === 'no-session') {
    expect(state.error).toBe('session not found');
  }
  expect(state.dataAttrs['data-session-status']).toBe('no-session');
});

test('AT-64: deriveSessionShellViewState: a "stage-conflict" (409) client result maps to the first-class fail-closed "error" state, preserving the server message VERBATIM — never smoothed into "no-session" or a generic message', () => {
  const message = 'stage "brain" is not a member of this session kind\'s declared stages [roadmap]';
  const result: SessionShellFetchResult = { ok: false, errorKind: 'stage-conflict', error: message };
  const state = deriveSessionShellViewState(result);
  expect(state.status).toBe('error');
  if (state.status === 'error') {
    expect(state.errorKind).toBe('stage-conflict');
    expect(state.error).toBe(message);
  }
  expect(state.dataAttrs['data-session-status']).toBe('error');
});

test('AT-65: deriveSessionShellViewState: every OTHER fail-closed errorKind (bad-request, network-error, malformed-response, non-json-response, server-error, no-bridge) ALSO maps to "error" — ONLY "not-found" maps to "no-session"', () => {
  const otherKinds = ['bad-request', 'network-error', 'malformed-response', 'non-json-response', 'server-error', 'no-bridge'] as const;
  for (const errorKind of otherKinds) {
    const result: SessionShellFetchResult = { ok: false, errorKind, error: `${errorKind} happened` };
    const state = deriveSessionShellViewState(result);
    expect(state.status, `errorKind "${errorKind}" must map to "error"`).toBe('error');
  }
});

test('AT-66: deriveSessionShellViewState: "loading" / "no-session" / "error" each carry a DISTINCT data-session-status token — never collapsing onto the same rendered state', () => {
  const loading = deriveSessionShellViewState(null);
  const noSession = deriveSessionShellViewState({ ok: false, errorKind: 'not-found', error: 'x' });
  const error = deriveSessionShellViewState({ ok: false, errorKind: 'server-error', error: 'x' });
  const statuses = [loading.dataAttrs['data-session-status'], noSession.dataAttrs['data-session-status'], error.dataAttrs['data-session-status']];
  expect(new Set(statuses).size).toBe(3);
});

test('AT-67: deriveSessionShellViewState: an ok:true client result maps to "ready" and matches sessionShellState(payload) exactly', () => {
  const result: SessionShellFetchResult = { ok: true, payload: SINGLE_STAGE_PAYLOAD };
  const state = deriveSessionShellViewState(result);
  expect(state).toEqual(sessionShellState(SINGLE_STAGE_PAYLOAD));
});

test('AT-68: deriveSessionShellViewState: the multi-stage fixture also round-trips end-to-end through the discriminated union', () => {
  const result: SessionShellFetchResult = { ok: true, payload: MULTI_STAGE_PAYLOAD };
  const state = deriveSessionShellViewState(result);
  expect(state.status).toBe('ready');
  if (state.status === 'ready') {
    expect(state.stageSelectorVisible).toBe(true);
    expect(state.selectedStage).toBe('instructions');
  }
});

test('AT-69: deriveSessionShellViewState: a "no-session" state carries NO stray "ready"-only fields (turnsForStage, artifact, etc.) — the discriminated union is not just a loosely-merged bag of optional fields', () => {
  const result: SessionShellFetchResult = { ok: false, errorKind: 'not-found', error: 'x' };
  const state = deriveSessionShellViewState(result);
  expect('turnsForStage' in state).toBe(false);
  expect('artifact' in state).toBe(false);
});

// ===========================================================================
// AT-amendment (T2 ruling, 2026-08-05) — state.title threads through
// verbatim from the payload; never a fallback to the raw kind slug, never a
// client-side heading lookup. — AT-98..AT-99
// ===========================================================================

test('AT-98: sessionShellState: the ready state\'s "title" is the payload\'s "title", verbatim — never the raw "kind" slug, never invented', () => {
  const state = sessionShellState(SINGLE_STAGE_PAYLOAD);
  expect(state.title).toBe('Planning session');
  expect(state.title).toBe(SINGLE_STAGE_PAYLOAD.title);
  expect(state.title).not.toBe(state.kind); // 'Planning session' !== 'architect' — proves it's not a kind-slug fallback

  const multiState = sessionShellState(MULTI_STAGE_PAYLOAD);
  expect(multiState.title).toBe('Future multi-stage session');
  expect(multiState.title).not.toBe(multiState.kind);
});

test('AT-99: sessionShellState: two payloads sharing EVERY OTHER field but a DIFFERENT "title" produce DIFFERENT state.title — the same anti-hardcode bite AT-61 pins for artifactLabel; this is exactly the test a reintroduced local kind→heading map would fail. "title" also survives a selectStage switch unchanged, same as artifactLabel (AT-55).', () => {
  const payloadA: SessionShellPayload = { ...SINGLE_STAGE_PAYLOAD, title: 'Planning session' };
  const payloadB: SessionShellPayload = { ...SINGLE_STAGE_PAYLOAD, title: 'A future kind reusing "architect" with its own title' };

  const stateA = sessionShellState(payloadA);
  const stateB = sessionShellState(payloadB);

  // SAME kind on both...
  expect(stateA.kind).toBe('architect');
  expect(stateB.kind).toBe('architect');
  // ...but the title follows the PAYLOAD, not the kind — a hardcoded
  // kind→title map could never produce this divergence.
  expect(stateA.title).toBe('Planning session');
  expect(stateB.title).toBe('A future kind reusing "architect" with its own title');
  expect(stateA.title).not.toBe(stateB.title);

  // title survives a stage switch unchanged (mirrors AT-55's artifactLabel pin).
  const switched = selectStage(sessionShellState(MULTI_STAGE_PAYLOAD), 'demo');
  expect(switched.ok).toBe(true);
  if (switched.ok) {
    expect(switched.state.title).toBe('Future multi-stage session');
  }
});

// ===========================================================================
// W6-B8 — state.terminal threads through verbatim from payload.terminal, and
// survives a selectStage switch unchanged (same discipline as title/
// artifactLabel above — a phase-scoped, session-level fact, not a
// per-stage one).
// ===========================================================================

test('AT-100: sessionShellState: "terminal" threads through verbatim from the payload, both true and false', () => {
  expect(sessionShellState(SINGLE_STAGE_PAYLOAD).terminal).toBe(false);
  expect(sessionShellState({ ...SINGLE_STAGE_PAYLOAD, terminal: true }).terminal).toBe(true);
});

test('AT-101: selectStage: "terminal" is UNCHANGED across a stage switch — a session-level fact, not a per-stage one', () => {
  const initial = sessionShellState({ ...MULTI_STAGE_PAYLOAD, terminal: true });
  const switched = selectStage(initial, 'demo');
  expect(switched.ok).toBe(true);
  if (switched.ok) {
    expect(switched.state.terminal).toBe(true);
  }
});

// ===========================================================================
// F6 (wave-8, "a linked session must be readable") — the ready state carries
// the payload's own "legacy" fact (mirrors "terminal"/"lifecycle" above:
// session-level, threaded through UNCHANGED, never re-derived here), and the
// shell root's dataAttrs gain "data-session-legacy" so a journey/regression
// test can assert the DECISION rather than scrape copy — see F6 spec section
// 4 (forge-ui) and this file's own header note conventions.
// ===========================================================================

test('F6: sessionShellState: the ready state exposes "legacy" verbatim from the payload, both true and false — the same sibling-fact treatment AT-100 pins for "terminal"', () => {
  expect(sessionShellState(SINGLE_STAGE_PAYLOAD).legacy).toBe(false);
  expect(sessionShellState({ ...SINGLE_STAGE_PAYLOAD, legacy: true } as SessionShellPayload).legacy).toBe(true);
});

// W8-F6 adversarial-review finding 3 — `data-transcript-omitted` is a
// MACHINE-READABLE claim about WHY the transcript pane is absent, and for a
// legacy session (turns [], affordances [], transcriptSources []) the old
// derivation emitted `nothing-recorded`, whose own documented meaning is
// "nothing has happened here yet". That is the opposite of the truth for a
// session whose files were written and then deleted — and it is exactly the
// ambiguity this whole lane exists to remove.
// KILLS: deriving the reason from `transcriptSources.length === 0` alone.
test('F6: a LEGACY session with no turns reports "working-files-gone", never "nothing-recorded" — the files were written and deleted, not never written', () => {
  const legacyPayload = {
    ...SINGLE_STAGE_PAYLOAD,
    legacy: true,
    turns: [],
    affordances: [],
    transcriptSources: [],
    transcriptError: null,
  } as SessionShellPayload;
  const state = sessionShellState(legacyPayload);
  expect(state.panes.transcript).toBe(false);
  expect(state.panes.transcriptOmittedReason).toBe('working-files-gone');
  expect(state.dataAttrs['data-transcript-omitted']).toBe('working-files-gone');
});

test('F6: a NON-legacy session with the same empty shape still reports "nothing-recorded" — the new reason is scoped, not a blanket rename', () => {
  const freshPayload = {
    ...SINGLE_STAGE_PAYLOAD,
    legacy: false,
    turns: [],
    affordances: [],
    transcriptSources: [],
    transcriptError: null,
  } as SessionShellPayload;
  expect(sessionShellState(freshPayload).panes.transcriptOmittedReason).toBe('nothing-recorded');
});

test('F6: sessionShellState: the ready state\'s dataAttrs carry "data-session-legacy" as the string "true"/"false", mirroring how every other data-session-* fact is exposed', () => {
  const legacyTrue = sessionShellState({ ...SINGLE_STAGE_PAYLOAD, legacy: true } as SessionShellPayload);
  expect(legacyTrue.dataAttrs['data-session-legacy']).toBe('true');
  const legacyFalse = sessionShellState({ ...SINGLE_STAGE_PAYLOAD, legacy: false } as SessionShellPayload);
  expect(legacyFalse.dataAttrs['data-session-legacy']).toBe('false');
});

// ===========================================================================
// W6-B9 reviewer fix — pseudo-project anchors: the generic terminal "back to
// project" link must be honest for EVERY value `project` can hold, including
// a pseudo-project session anchor (".kb-<id>", ".community-registry") that
// discoverProjects (orchestrator/studio/registry.ts) categorically filters
// out of the real project list — /projects/.kb-x would be a dead end.
// ===========================================================================

test('AT-102: isPseudoProjectAnchor — a real project slug is NOT a pseudo-anchor', () => {
  expect(isPseudoProjectAnchor('mdtoc')).toBe(false);
  expect(isPseudoProjectAnchor('my-real-project')).toBe(false);
});

test('AT-103: isPseudoProjectAnchor — any leading-"." value IS a pseudo-anchor (the general check, not an enumerated allow-list)', () => {
  expect(isPseudoProjectAnchor('.kb-forge-dev')).toBe(true);
  expect(isPseudoProjectAnchor('.community-registry')).toBe(true);
  expect(isPseudoProjectAnchor('.some-future-anchor')).toBe(true);
});

test('AT-104: PARITY — forge-ui\'s isPseudoProjectAnchor mirror agrees with the real cli/bridge-studio-sessions.ts SSOT for every sampled value, both directions', () => {
  const samples = ['mdtoc', 'my-real-project', '.kb-forge-dev', '.community-registry', '.some-future-anchor', ''];
  for (const s of samples) {
    expect(isPseudoProjectAnchor(s), `sample ${JSON.stringify(s)}`).toBe(SSOT_isPseudoProjectAnchor(s));
  }
});

test('AT-104b: PARITY — forge-ui\'s hardcoded ".community-registry" literal (COMMUNITY_REGISTRY_ANCHOR) matches the real, exported COMMUNITY_REFRESH_PROJECT_ANCHOR SSOT (cli/bridge-studio-sessions.ts, W6-CR-3) byte-for-byte', () => {
  expect(pseudoProjectAnchorDestination(SSOT_COMMUNITY_REFRESH_PROJECT_ANCHOR)).toEqual({ label: 'Community', href: '/community' });
});

test('AT-105: pseudoProjectAnchorDestination — the KB-seeding anchor resolves to Knowledge; the `.community-registry` anchor resolves to Community (it belongs to the SURVIVING registry, not the session kind W8-B5b WI-3 retired); an unrecognised pseudo-anchor resolves to null (never a guessed destination)', () => {
  expect(pseudoProjectAnchorDestination('.kb-forge-dev')).toEqual({ label: 'Knowledge base forge-dev', href: '/knowledge?id=forge-dev' });
  expect(pseudoProjectAnchorDestination('.community-registry')).toEqual({ label: 'Community', href: '/community' });
  expect(pseudoProjectAnchorDestination('.some-future-anchor')).toBeNull();
});

test('AT-106: backToProjectLink — null when project is null, the real /projects/<id> for an honest project, the pseudo-anchor\'s own destination for a pseudo-anchor, and null (not a dead-ended link) for an unrecognised pseudo-anchor', () => {
  // W7-A2 (sessions-kinds-35): the link renders in EVERY phase (the
  // operator most needs a way out mid-flight), and a KB anchor resolves to
  // that KB's own page rather than the bare index — see
  // lib/session-lifecycle-render.test.ts for the full W7-A2 pin. W7A2-07:
  // the dead `_terminal` parameter is gone — one argument.
  expect(backToProjectLink('mdtoc')).toEqual({ label: 'project', href: '/projects/mdtoc' });
  expect(backToProjectLink(null)).toBeNull();
  expect(backToProjectLink('.kb-forge-dev')).toEqual({ label: 'Knowledge base forge-dev', href: '/knowledge?id=forge-dev' });
  expect(backToProjectLink('.community-registry')).toEqual({ label: 'Community', href: '/community' });
  expect(backToProjectLink('.some-future-anchor')).toBeNull();
});

test('AT-107: backToProjectLink — a project id needing URL-encoding is encoded in the href', () => {
  expect(backToProjectLink('my project/weird')).toEqual({ label: 'project', href: '/projects/my%20project%2Fweird' });
});

test('F6: backToProjectLink — an EMPTY STRING project returns null, never the dead "/projects/" link (today\'s behaviour mints {label:"project", href:"/projects/"} — a link to nowhere)', () => {
  expect(backToProjectLink('')).toBeNull();
});

// ---------------------------------------------------------------------------
// W8-B3 adversarial-review finding 2 — `transcriptSources` must be READ, not
// merely carried. It was threaded through four layers (derivation -> bridge ->
// client parse -> ready state) with a doc comment claiming it explained an
// absent pane, and then consumed by nothing: the exact declared-data-fails-open
// shape this lane exists to remove, reintroduced in miniature. These pin the
// two places it now genuinely decides what the operator reads.
// ---------------------------------------------------------------------------

function paneStateWith(over: Partial<SessionShellPayload>) {
  return sessionShellState({ ...SINGLE_STAGE_PAYLOAD, turns: [], affordances: [], ...over } as SessionShellPayload);
}

test('W8-B3: an omitted pane with NO source on disk reads "nothing-recorded" — the writer never ran', () => {
  const state = paneStateWith({ transcriptSources: [] });
  expect(state.panes.transcriptOmittedReason).toBe('nothing-recorded');
  expect(state.dataAttrs['data-transcript-omitted']).toBe('nothing-recorded');
});

test('W8-B3: an omitted pane WITH a source on disk reads "sources-derived-no-turns" — the writer ran and produced nothing (the blank prompt.md shape)', () => {
  const state = paneStateWith({ transcriptSources: ['prompt.md'] });
  expect(state.panes.transcript).toBe(false);
  expect(state.panes.transcriptOmittedReason).toBe('sources-derived-no-turns');
  expect(state.dataAttrs['data-transcript-omitted']).toBe('sources-derived-no-turns');
});

test('W8-B3: a RENDERED but empty pane names the sources that exist — deriveSessionTranscript\'s "scanned N, found M" contract finally reaches the operator', () => {
  // Rendered because a question-form is live; empty because no turn exists yet.
  const askingWithSources = paneStateWith({
    transcriptSources: ['prompt.md', 'verdicts.json'],
    affordances: [{ id: 'q', kind: 'question-form', phase: 'briefing', label: 'Brief', description: null, meta: {} }],
  } as unknown as Partial<SessionShellPayload>);
  expect(askingWithSources.panes.transcript).toBe(true);
  expect(askingWithSources.emptyStageMessage).toContain('prompt.md, verdicts.json');
  expect(askingWithSources.emptyStageMessage).toContain('none of it derived a turn here');

  const askingWithout = paneStateWith({
    transcriptSources: [],
    affordances: [{ id: 'q', kind: 'question-form', phase: 'briefing', label: 'Brief', description: null, meta: {} }],
  } as unknown as Partial<SessionShellPayload>);
  expect(askingWithout.emptyStageMessage).toContain('nothing has been written to this session yet');
  expect(askingWithout.emptyStageMessage).not.toContain('on disk');
});
