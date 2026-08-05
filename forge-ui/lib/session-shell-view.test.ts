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
 *    acceptance reference `mockups/studio-endstate-v2/views-session.jsx`: a
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
 */
import { test, expect } from 'vitest';
import {
  sessionShellState,
  selectStage,
  deriveSessionShellViewState,
} from './session-shell-view.ts';
import type { SessionShellPayload, SessionShellFetchResult } from './session-client.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SINGLE_STAGE_PAYLOAD: SessionShellPayload = {
  ok: true,
  kind: 'architect',
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
