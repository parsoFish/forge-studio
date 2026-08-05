/**
 * Tests for forge-ui/lib/session-artifact-view.ts (R2-10, PR2) — DOES NOT
 * EXIST YET. Vitest cannot even collect this file until it lands
 * (module-not-found is the expected red).
 *
 * PURE, per-renderer view-state for the session shell's artifact pane — one
 * module covering all three LIVE artifact kinds (roadmap-draft, markdown-
 * draft, brain-structure), rather than three separate files: they are three
 * tightly-related renderers for the SAME pane of the SAME page, and the
 * combined module comfortably stays well under this repo's file-size
 * discipline (see the module's own header for the exact line count). T2: a
 * later split is cheap if any one renderer grows real complexity of its own.
 *
 * AT numbers continue the flat PR2 sequence started in session-client.test.ts
 * / session-shell-view.test.ts (that file closes at AT-69).
 *
 * No DOM, no React, no network — mirrors file-package.ts's / skill-library-
 * view.ts's testability convention exactly.
 *
 * ---------------------------------------------------------------------------
 * AMENDMENTS (T2 review, 2026-08-05):
 *
 * Correction 1 — every artifact fixture below now carries a required `label`
 * field (see session-client.test.ts's AT-90 / header amendment for the full
 * rationale: `label` is threaded from the wire, never a client-side lookup).
 * Mechanical only here — no existing assertion in AT-70..89 changes.
 *
 * Correction 2 — `sessionArtifactView` gains an OPTIONAL second parameter,
 * `stage?: string`: the currently-selected stage (`session-shell-view.ts`'s
 * `state.selectedStage`), threaded to the dispatch boundary so a future
 * stage-aware renderer (R4-17's reserved `contract-buildout` row) can be a
 * drop-in without changing the wire, the client, or this dispatcher's
 * signature again. Made OPTIONAL specifically so every existing AT-70..89
 * call site is untouched (T2: "do not renumber existing ATs... do not weaken
 * any assertion") — AT-91..94 below are strictly additive.
 *
 * Every real, LIVE kind today (roadmap-draft/markdown-draft/brain-structure)
 * is stage-UNAWARE by nature — a roadmap draft or an AGENTS.md draft has no
 * notion of "which stage" — so `stage` reaching them is a no-op (AT-91 pins
 * this invariance explicitly, so nobody later makes them accidentally
 * stage-sensitive). Every kind that WOULD be stage-aware (contract-buildout)
 * is still a RESERVED row with zero renderer implementation anywhere — per
 * the brief's "zero stubs" rule, this file does not invent one. Instead the
 * dispatch-boundary proof rides the RESERVED/unknown-kind error paths that
 * already exist (AT-85..89): the thrown message now names the REQUESTED
 * stage when one was passed, which is only possible if the dispatcher
 * genuinely received and threaded the argument through to where it builds
 * that error (AT-92/93). AT-94 closes the loop end-to-end against
 * session-shell-view.ts's real `selectStage`, proving the INPUT changes
 * while the OUTPUT for a stage-unaware live kind stays byte-identical — the
 * exact seam R4-17 needs, pinned without a fake renderer.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * R4-15 (2026-08-06) — `RoadmapDraftView` gains `dag: DependencyDagView<
 * RoadmapDraftRow>`, built via the SHARED `dependencyDagView` (forge-ui/lib/
 * dependency-dag.ts, new module, its own test file). AT-95..97 pin the
 * reuse (not a bespoke reimplementation), that the 4 pre-existing fields are
 * unchanged, and that the dispatcher still surfaces it. Mechanical-only
 * elsewhere: `NONEMPTY_ROADMAP`'s rows now carry `dependsOn: []` (a required
 * parsed-row field as of session-client.test.ts's AT-98..101) — no existing
 * assertion's behaviour changes.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Adversarial-review round 2 (2026-08-06), Amendment A — AT-99, a
 * REGRESSION GUARD (green today, not a defect pin — see its own comment for
 * why it still earns its place): `dependencyDagView` emits exactly one node
 * per input row, positionally, even when two rows share an `initiativeId` —
 * the invariant `SessionArtifactPane.tsx`'s positional-zip fix now depends
 * on, replacing an earlier id-keyed Map lookup that cross-contaminated two
 * same-id rows' dependency lists.
 * ---------------------------------------------------------------------------
 */
import { test, expect } from 'vitest';
import {
  roadmapDraftView,
  markdownDraftView,
  brainStructureView,
  selectBrainStructureFile,
  sessionArtifactView,
} from './session-artifact-view.ts';
import { filePackageTabs, selectFile } from './file-package.ts';
import type { RoadmapDraftArtifact, MarkdownDraftArtifact, BrainStructureArtifact } from './session-client.ts';
import { sessionShellState, selectStage } from './session-shell-view.ts';
import type { SessionShellPayload } from './session-client.ts';
// R4-15: the SHARED dependency-DAG view model roadmapDraftView's new "dag"
// field is built through — imported here so AT-95..97 can assert against the
// REAL, shared function rather than a hand-rolled expected shape (proving
// reuse, mirroring AT-79's `filePackageTabs` reuse pin). This module does
// not exist yet — module-not-found is the expected red for this whole file
// until it lands (see this file's own header + dependency-dag.test.ts's).
import { dependencyDagView } from './dependency-dag.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// R4-15 mechanical fixture plumbing: `dependsOn` is now a required field on
// a parsed RoadmapDraftRow (session-client.test.ts AT-98..101) — set to []
// here since this fixture's row ordering/reuse behaviour (AT-70..73, AT-84,
// AT-91) is not about dependency edges; see ROADMAP_WITH_DEPS below for the
// fixture dedicated to exercising real edges.
const NONEMPTY_ROADMAP: RoadmapDraftArtifact = {
  kind: 'roadmap-draft',
  label: 'Roadmap draft',
  rows: [
    { initiativeId: 'R9-02', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-02.md', dependsOn: [] },
    { initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-01.md', dependsOn: [] },
  ],
  sourcesScanned: ['manifests/*.md (2 file(s) found)'],
};

const EMPTY_ROADMAP: RoadmapDraftArtifact = {
  kind: 'roadmap-draft',
  label: 'Roadmap draft',
  rows: [],
  sourcesScanned: ['manifests/*.md (0 file(s) found)'],
};

const NO_DRAFT: MarkdownDraftArtifact = { kind: 'markdown-draft', label: 'AGENTS.md draft', body: null, hasDraft: false };
const EMPTY_DRAFT: MarkdownDraftArtifact = { kind: 'markdown-draft', label: 'AGENTS.md draft', body: '', hasDraft: true };
const REAL_DRAFT: MarkdownDraftArtifact = { kind: 'markdown-draft', label: 'AGENTS.md draft', body: '# AGENTS.md\n\nDraft body.\n', hasDraft: true };

const BRAIN_ARTIFACT: BrainStructureArtifact = {
  kind: 'brain-structure',
  label: 'Seeded structure',
  themeCount: 2,
  files: [
    { path: 'themes/alpha.md', body: '# Alpha' },
    { path: 'themes/beta.md', body: '# Beta' },
  ],
};

const EMPTY_BRAIN_ARTIFACT: BrainStructureArtifact = { kind: 'brain-structure', label: 'Seeded structure', themeCount: 0, files: [] };

// ===========================================================================
// roadmapDraftView — AT-70..AT-73
// ===========================================================================

test('AT-70: roadmapDraftView: non-empty rows pass through in SERVER order, verbatim — never re-sorted, never a fabricated row added or dropped', () => {
  const view = roadmapDraftView(NONEMPTY_ROADMAP);
  expect(view.rows).toEqual(NONEMPTY_ROADMAP.rows);
  expect(view.rows.map((r) => r.initiativeId)).toEqual(['R9-02', 'R9-01']);
  expect(view.isEmpty).toBe(false);
  expect(view.emptyMessage).toBeNull();
});

test('AT-71: roadmapDraftView: zero rows is an HONEST empty state naming what was scanned ("scanned manifests/*.md (0 file(s) found)") — never a bare/blank pane', () => {
  const view = roadmapDraftView(EMPTY_ROADMAP);
  expect(view.isEmpty).toBe(true);
  expect(view.rows).toEqual([]);
  expect(view.emptyMessage).not.toBeNull();
  expect(view.emptyMessage).toContain('manifests/*.md (0 file(s) found)');
});

test('AT-72: roadmapDraftView: the empty message is derived from sourcesScanned, not a generic hardcoded string — a different scanned source is reflected verbatim', () => {
  const differentSource: RoadmapDraftArtifact = { kind: 'roadmap-draft', label: 'Roadmap draft', rows: [], sourcesScanned: ['manifests/*.md (0 file(s) found)', 'a-second-source (3 scanned)'] };
  const view = roadmapDraftView(differentSource);
  expect(view.emptyMessage).toContain('manifests/*.md (0 file(s) found)');
  expect(view.emptyMessage).toContain('a-second-source (3 scanned)'); // multiple scanned sources are never silently truncated to the first
});

test('AT-73: roadmapDraftView: a single-row artifact is never mistaken for empty', () => {
  const oneRow: RoadmapDraftArtifact = { kind: 'roadmap-draft', label: 'Roadmap draft', rows: [NONEMPTY_ROADMAP.rows[0]!], sourcesScanned: ['manifests/*.md (1 file(s) found)'] };
  const view = roadmapDraftView(oneRow);
  expect(view.isEmpty).toBe(false);
  expect(view.emptyMessage).toBeNull();
  expect(view.rows).toHaveLength(1);
});

// ===========================================================================
// markdownDraftView — AT-74..AT-77
// ===========================================================================

test('AT-74: markdownDraftView: "no draft yet" (missing file) is its own state, distinct from an empty draft', () => {
  const view = markdownDraftView(NO_DRAFT);
  expect(view.state).toBe('no-draft');
  expect(view.body).toBeNull();
});

test('AT-75: markdownDraftView: "an empty draft" (file exists, empty body) is its own state, distinct from "no draft yet" — the server already distinguishes them; this view must not collapse them', () => {
  const view = markdownDraftView(EMPTY_DRAFT);
  expect(view.state).toBe('empty-draft');
  expect(view.body).toBe('');
  expect(view.state).not.toBe(markdownDraftView(NO_DRAFT).state);
});

test('AT-76: markdownDraftView: a real draft body renders as "has-content" with the body preserved byte-for-byte, including trailing newlines', () => {
  const view = markdownDraftView(REAL_DRAFT);
  expect(view.state).toBe('has-content');
  expect(view.body).toBe('# AGENTS.md\n\nDraft body.\n');
});

test('AT-77: markdownDraftView: the three states (no-draft, empty-draft, has-content) are pairwise distinct tokens', () => {
  const states = [markdownDraftView(NO_DRAFT).state, markdownDraftView(EMPTY_DRAFT).state, markdownDraftView(REAL_DRAFT).state];
  expect(new Set(states).size).toBe(3);
});

// ===========================================================================
// brainStructureView / selectBrainStructureFile — REUSE pin (the SHARED
// FilePackage machinery, forge-ui/lib/file-package.ts) — AT-78..AT-83
// ===========================================================================

test('AT-78: brainStructureView: themeCount passes through VERBATIM from the artifact — never re-derived from files.length (a legitimately divergent count, e.g. some theme files failed server-side parsing, must not be "corrected")', () => {
  const divergent: BrainStructureArtifact = { kind: 'brain-structure', label: 'Seeded structure', themeCount: 5, files: BRAIN_ARTIFACT.files };
  const view = brainStructureView(divergent);
  expect(view.themeCount).toBe(5);
  expect(view.themeCount).not.toBe(divergent.files.length);
});

test('AT-79: brainStructureView: files are shaped as PackageFile {path, body} and fed to the REAL, imported filePackageTabs — this pins REUSE, so a future fork of the tab-strip logic into a bespoke implementation fails this test', () => {
  const view = brainStructureView(BRAIN_ARTIFACT);
  const expected = filePackageTabs(BRAIN_ARTIFACT.files);
  expect(view.filePackage).toEqual(expected);
});

test('AT-80: brainStructureView: an empty files:[] artifact produces the SAME empty-tab-strip shape file-package.ts itself defines (activeIndex:-1, tabs:[]) — proving reuse, not a parallel reimplementation with different edge-case behaviour', () => {
  const view = brainStructureView(EMPTY_BRAIN_ARTIFACT);
  expect(view.filePackage).toEqual(filePackageTabs([]));
  expect(view.filePackage.tabs).toEqual([]);
  expect(view.filePackage.activeIndex).toBe(-1);
});

test('AT-81: selectBrainStructureFile: selecting a file index delegates to the REAL, imported selectFile — result matches calling selectFile directly on the same filePackageTabs output', () => {
  const view = brainStructureView(BRAIN_ARTIFACT);
  const next = selectBrainStructureFile(view, 1);
  const expectedFilePackage = selectFile(filePackageTabs(BRAIN_ARTIFACT.files), 1);
  expect(next.filePackage).toEqual(expectedFilePackage);
});

test('AT-82: selectBrainStructureFile: an out-of-range index is clamped (never throws) — the SAME clamping behaviour file-package.ts itself defines, not a bespoke reimplementation', () => {
  const view = brainStructureView(BRAIN_ARTIFACT);
  expect(() => selectBrainStructureFile(view, 999)).not.toThrow();
  const clamped = selectBrainStructureFile(view, 999);
  expect(clamped.filePackage.activeIndex).toBe(selectFile(filePackageTabs(BRAIN_ARTIFACT.files), 999).activeIndex);
});

test('AT-83: selectBrainStructureFile: returns a NEW view object (immutability) and preserves themeCount unchanged', () => {
  const view = brainStructureView(BRAIN_ARTIFACT);
  const next = selectBrainStructureFile(view, 1);
  expect(next).not.toBe(view);
  expect(next.themeCount).toBe(view.themeCount);
});

// ===========================================================================
// sessionArtifactView — dispatcher + reserved/unknown kind guards — AT-84..AT-89
// ===========================================================================

test('AT-84: sessionArtifactView: dispatches each of the 3 live kinds to its matching renderer', () => {
  expect(sessionArtifactView(NONEMPTY_ROADMAP)).toEqual(roadmapDraftView(NONEMPTY_ROADMAP));
  expect(sessionArtifactView(REAL_DRAFT)).toEqual(markdownDraftView(REAL_DRAFT));
  expect(sessionArtifactView(BRAIN_ARTIFACT)).toEqual(brainStructureView(BRAIN_ARTIFACT));
});

test('AT-85: sessionArtifactView: a RESERVED artifact kind (file-package, contract-buildout, generation-gallery) reaching the view THROWS an explicit error naming the reserved kind — zero stub renderers', () => {
  for (const reservedKind of ['file-package', 'contract-buildout', 'generation-gallery']) {
    expect(() => sessionArtifactView({ kind: reservedKind }), `reserved kind "${reservedKind}" must throw`).toThrow(new RegExp(reservedKind));
  }
});

test('AT-86: sessionArtifactView: the reserved-kind error message says "reserved" — distinguishable from a totally unknown kind\'s message', () => {
  try {
    sessionArtifactView({ kind: 'file-package' });
    throw new Error('expected sessionArtifactView to throw');
  } catch (err) {
    expect(String(err)).toMatch(/reserved/i);
  }
});

test('AT-87: sessionArtifactView: a totally UNKNOWN artifact kind also throws, naming it — but its message does NOT claim "reserved" (the two failure modes are distinguishable)', () => {
  try {
    sessionArtifactView({ kind: 'totally-bogus-kind' });
    throw new Error('expected sessionArtifactView to throw');
  } catch (err) {
    const message = String(err);
    expect(message).toContain('totally-bogus-kind');
    expect(message).not.toMatch(/reserved/i);
  }
});

test('AT-88: sessionArtifactView: the reserved-kind and unknown-kind error messages are themselves distinct strings', () => {
  let reservedMessage = '';
  let unknownMessage = '';
  try {
    sessionArtifactView({ kind: 'contract-buildout' });
  } catch (err) {
    reservedMessage = String(err);
  }
  try {
    sessionArtifactView({ kind: 'nonsense' });
  } catch (err) {
    unknownMessage = String(err);
  }
  expect(reservedMessage).not.toBe('');
  expect(unknownMessage).not.toBe('');
  expect(reservedMessage).not.toBe(unknownMessage);
});

test('AT-89: sessionArtifactView: all three reserved kinds produce pairwise-distinct messages (each names ITS OWN kind, never a copy-pasted generic reserved-kind string)', () => {
  const messages = ['file-package', 'contract-buildout', 'generation-gallery'].map((kind) => {
    try {
      sessionArtifactView({ kind });
      return '';
    } catch (err) {
      return String(err);
    }
  });
  expect(new Set(messages).size).toBe(3);
});

// ===========================================================================
// AT-amendment (T2 Correction 2, 2026-08-05) — the selected-stage seam:
// `sessionArtifactView(artifact, stage?)` threads the currently-selected
// stage to the dispatch boundary. Today's 3 live renderers are stage-
// UNAWARE (invariant); the seam itself — the argument reaching dispatch — is
// pinned via the RESERVED/unknown-kind error paths (no stub renderer
// invented) and via an end-to-end check against session-shell-view.ts's real
// `selectStage`. — AT-91..94
// ===========================================================================

test('AT-91: sessionArtifactView: for each of the 3 LIVE (stage-unaware) kinds, the output is IDENTICAL regardless of which stage is passed — the stage argument must never make an already-shipped renderer stage-sensitive', () => {
  const roadmapNoStage = sessionArtifactView(NONEMPTY_ROADMAP);
  const roadmapStageA = sessionArtifactView(NONEMPTY_ROADMAP, 'contract');
  const roadmapStageB = sessionArtifactView(NONEMPTY_ROADMAP, 'roadmap');
  expect(roadmapStageA).toEqual(roadmapNoStage);
  expect(roadmapStageB).toEqual(roadmapNoStage);

  const markdownNoStage = sessionArtifactView(REAL_DRAFT);
  const markdownStageA = sessionArtifactView(REAL_DRAFT, 'instructions');
  const markdownStageB = sessionArtifactView(REAL_DRAFT, 'demo');
  expect(markdownStageA).toEqual(markdownNoStage);
  expect(markdownStageB).toEqual(markdownNoStage);

  const brainNoStage = sessionArtifactView(BRAIN_ARTIFACT);
  const brainStageA = sessionArtifactView(BRAIN_ARTIFACT, 'brain');
  const brainStageB = sessionArtifactView(BRAIN_ARTIFACT, 'secrets');
  expect(brainStageA).toEqual(brainNoStage);
  expect(brainStageB).toEqual(brainNoStage);
});

test('AT-92: sessionArtifactView: a RESERVED kind\'s thrown message NAMES the requested stage when one is passed — proof the stage argument genuinely reaches the dispatch boundary, not a fake/unused parameter', () => {
  let noStageMessage = '';
  let withStageMessage = '';
  try {
    sessionArtifactView({ kind: 'contract-buildout' });
  } catch (err) {
    noStageMessage = String(err);
  }
  try {
    sessionArtifactView({ kind: 'contract-buildout' }, 'demo');
  } catch (err) {
    withStageMessage = String(err);
  }
  expect(withStageMessage).toContain('demo');
  expect(withStageMessage).not.toBe(noStageMessage); // the two call shapes are observably different
  expect(withStageMessage).toContain('contract-buildout'); // still names the reserved kind too
});

test('AT-93: sessionArtifactView: an UNKNOWN kind\'s thrown message also names the requested stage when one is passed, and differs per stage value (not a hardcoded suffix)', () => {
  let stageX = '';
  let stageY = '';
  try {
    sessionArtifactView({ kind: 'totally-bogus-kind' }, 'contract');
  } catch (err) {
    stageX = String(err);
  }
  try {
    sessionArtifactView({ kind: 'totally-bogus-kind' }, 'roadmap');
  } catch (err) {
    stageY = String(err);
  }
  expect(stageX).toContain('contract');
  expect(stageY).toContain('roadmap');
  expect(stageX).not.toBe(stageY);
});

test('AT-94: END-TO-END seam: session-shell-view.ts\'s real selectStage() changes state.selectedStage, and that CHANGED value is exactly what a caller threads into sessionArtifactView as its stage input — while a stage-unaware live kind\'s OUTPUT stays byte-identical across the switch. This is the drop-in seam R4-17 needs, pinned without inventing a stub renderer.', () => {
  const payload: SessionShellPayload = {
    ok: true,
    kind: 'future-multi-stage-kind',
    title: 'Future multi-stage session', // synthetic — this kind is hypothetical (R4-17)
    sessionId: '2026-08-05T14-00-00',
    project: 'gitpulse',
    phase: 'in-progress',
    stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    defaultStage: 'instructions',
    turns: [],
    artifact: NONEMPTY_ROADMAP, // today's live, stage-unaware kind, reused for this fixture
  };

  const initial = sessionShellState(payload);
  expect(initial.selectedStage).toBe('instructions');
  const viewAtInitial = sessionArtifactView(initial.artifact, initial.selectedStage);

  const switched = selectStage(initial, 'demo');
  expect(switched.ok).toBe(true);
  if (!switched.ok) return;
  expect(switched.state.selectedStage).toBe('demo');
  expect(switched.state.selectedStage).not.toBe(initial.selectedStage); // the INPUT genuinely changed

  const viewAfterSwitch = sessionArtifactView(switched.state.artifact, switched.state.selectedStage);

  // The dispatcher received a DIFFERENT stage value on the second call...
  expect(initial.selectedStage).not.toBe(switched.state.selectedStage);
  // ...yet the OUTPUT is unchanged, because roadmap-draft is stage-unaware —
  // exactly the invariance AT-91 pins, now proven through the real state
  // machinery rather than a hand-built stage string.
  expect(viewAfterSwitch).toEqual(viewAtInitial);
});

// ===========================================================================
// R4-15 — roadmapDraftView gains "dag", a SHARED dependency-DAG view model
// built via the REAL, imported `dependencyDagView` (forge-ui/lib/dependency-
// dag.ts) — mirrors AT-79's REUSE pin (brainStructureView/filePackageTabs)
// exactly: no bespoke DAG-building logic is written in session-artifact-
// view.ts itself. — AT-95..97
// ===========================================================================

const ROADMAP_WITH_DEPS: RoadmapDraftArtifact = {
  kind: 'roadmap-draft',
  label: 'Roadmap draft',
  rows: [
    { initiativeId: 'R9-02', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-02.md', dependsOn: ['R9-01'] },
    { initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-01.md', dependsOn: [] },
  ],
  sourcesScanned: ['manifests/*.md (2 file(s) found)'],
};

test('AT-95: roadmapDraftView: "dag" is built via the SHARED dependencyDagView(artifact.rows, r => r.initiativeId, r => r.dependsOn) — matches calling it directly, proving reuse rather than a bespoke reimplementation', () => {
  const view = roadmapDraftView(ROADMAP_WITH_DEPS) as unknown as { dag: unknown };
  const expectedDag = dependencyDagView(
    ROADMAP_WITH_DEPS.rows,
    (r) => r.initiativeId,
    (r) => r.dependsOn,
  );
  expect(view.dag).toEqual(expectedDag);
  // Concretely: R9-02 declares dependsOn:['R9-01'] — the edge must exist,
  // "R9-01 must complete before R9-02" (dependency-dag.test.ts's AT-1 edge-
  // direction rule, exercised end-to-end through this view).
  expect((view.dag as { edges: unknown }).edges).toEqual([{ from: 'R9-01', to: 'R9-02', resolved: true }]);
});

test('AT-96: roadmapDraftView: adding "dag" leaves the EXISTING fields (kind, rows, isEmpty, emptyMessage) byte-for-byte UNCHANGED — a regression guard against the dag feature silently altering the pre-existing contract', () => {
  const view = roadmapDraftView(ROADMAP_WITH_DEPS);
  expect(view.kind).toBe('roadmap-draft');
  expect(view.rows).toEqual(ROADMAP_WITH_DEPS.rows);
  expect(view.isEmpty).toBe(false);
  expect(view.emptyMessage).toBeNull();

  const emptyView = roadmapDraftView(EMPTY_ROADMAP);
  expect(emptyView.isEmpty).toBe(true);
  expect(emptyView.rows).toEqual([]);
  expect(emptyView.emptyMessage).toContain('manifests/*.md (0 file(s) found)');
});

test('AT-97: sessionArtifactView: the dispatcher still returns "dag" for kind:"roadmap-draft" — the shared view model reaches the SAME dispatch boundary every other artifact kind goes through', () => {
  const dispatched = sessionArtifactView(ROADMAP_WITH_DEPS) as unknown as { kind: string; dag: unknown };
  expect(dispatched.kind).toBe('roadmap-draft');
  expect(dispatched.dag).toEqual(
    dependencyDagView(
      ROADMAP_WITH_DEPS.rows,
      (r) => r.initiativeId,
      (r) => r.dependsOn,
    ),
  );
});

// ===========================================================================
// Adversarial-review round 2 (2026-08-06), Amendment A — REGRESSION GUARD,
// green today, not a defect pin. `SessionArtifactPane.tsx`'s table used to
// zip its "depends on" column onto `view.dag.nodes` through an id-keyed Map,
// which is last-write-wins: two roadmap-draft rows sharing an `initiativeId`
// (legitimately reachable — `deriveRoadmapDraft` reads `initiative_id` from
// each manifest's FRONTMATTER, not its filename, so two files under one
// session's manifests/ can declare the same id) cross-contaminated, one
// initiative's dependency list rendering as another's. The fix zips
// `view.rows` and `view.dag.nodes` POSITIONALLY instead. That positional fix
// depends on exactly one property of `dependencyDagView`, pinned here: it
// emits ONE node per INPUT ROW, in input order, even when two rows share an
// id — it must never collapse/dedupe rows by id. This is a characterization
// pin of already-correct behaviour (the implementation already iterates
// `for (const item of items) { ... nodes.push(...) }` with no id-based
// dedup or Map lookup anywhere in `dependencyDagView` — verified by reading
// it), not a defect pin — it earns its place because it guards the EXACT
// invariant the component fix now structurally depends on: a "helpful"
// future change that dedupes-by-id INSIDE `dependencyDagView` (e.g. to
// "clean up" duplicate ids before leveling) would silently re-introduce the
// cross-contamination the positional-zip fix just removed, one layer away
// from where anyone would think to look for it. — AT-99
// ===========================================================================

test('AT-99 (regression guard, green today): roadmapDraftView: two rows sharing the SAME initiativeId with DIFFERENT dependsOn produce TWO distinct dag nodes, positionally aligned with the rows — never collapsed/deduped by id, and never cross-contaminated', () => {
  const duplicateIdArtifact: RoadmapDraftArtifact = {
    kind: 'roadmap-draft',
    label: 'Roadmap draft',
    rows: [
      { initiativeId: 'DUP-1', project: 'gitpulse', phase: 'planned', origin: 'manifests/a.md', dependsOn: ['SOMETHING-A'] },
      { initiativeId: 'DUP-1', project: 'gitpulse', phase: 'in-flight', origin: 'manifests/b.md', dependsOn: ['SOMETHING-B'] },
    ],
    sourcesScanned: ['manifests/*.md (2 file(s) found)'],
  };

  const view = roadmapDraftView(duplicateIdArtifact);

  // Never collapsed: exactly one node per row, both carrying the SAME id.
  expect(view.dag.nodes.length).toBe(2);
  expect(view.dag.nodes[0].id).toBe('DUP-1');
  expect(view.dag.nodes[1].id).toBe('DUP-1');

  // Positionally aligned with rows — node[i] IS row[i]'s node.
  expect(view.dag.nodes[0].item).toEqual(duplicateIdArtifact.rows[0]);
  expect(view.dag.nodes[1].item).toEqual(duplicateIdArtifact.rows[1]);

  // Never cross-contaminated: each node's own deps, not the other row's.
  expect(view.dag.nodes[0].deps).toEqual(['SOMETHING-A']);
  expect(view.dag.nodes[1].deps).toEqual(['SOMETHING-B']);
  expect(view.dag.nodes[0].deps).not.toEqual(view.dag.nodes[1].deps);
});
