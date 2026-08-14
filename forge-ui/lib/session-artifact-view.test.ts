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
  // R4-16: does not exist yet — module-not-found is the expected red for
  // this whole file until generationGalleryView lands.
  generationGalleryView,
  // R4-16 PIN 3, Finding D: `selectGeneration` lost its last real caller in
  // the round-1 fix and is being deleted from production in this round — its
  // three tests (formerly AT-103/104/105) are REMOVED here, not kept green,
  // per the binding ruling: a test file keeping a function's tests green is
  // exactly what keeps dead code "alive" against a repo-wide sweep that found
  // no other caller. Do not re-add.
  // R4-16 PIN 3, Finding C: does not exist yet — module-not-found is the
  // expected red for the tests calling it below (see this file's own
  // esbuild-named-export note above; a missing named export resolves to
  // `undefined`, not a hard import error, so only the tests that actually
  // CALL `preferredGenerationFor` go red).
  preferredGenerationFor,
  // R4-17: does not exist yet — same esbuild-named-export note: an unresolved
  // import resolves to `undefined`, so only the tests that CALL it go red.
  contractBuildoutView,
  // R4-21 (T3 pins, RED-3a/b — OOTB authoring agent / skill-hook package
  // producer): does not exist yet — same esbuild-named-export note as
  // preferredGenerationFor/contractBuildoutView above: an unresolved named
  // import resolves to `undefined`, so only the tests that actually CALL
  // these two go red. `selectFilePackageFile` is a T3 DESIGN DECISION
  // (flagged for T1/T2 to ratify or redirect — see the T3 report): the task
  // brief names `filePackageTabs`/`selectFile` reuse but not a companion
  // selector's export name, so this mirrors `selectBrainStructureFile`'s
  // exact precedent (AT-82/83, below) for the sibling `brain-structure` kind.
  filePackageArtifactView,
  selectFilePackageFile,
  // R4-19-F2 (kb-cleanup's cleanup-plan artifact): does not exist yet — same
  // esbuild-named-export note as contractBuildoutView/generationGalleryView/
  // preferredGenerationFor above: an unresolved named import resolves to
  // `undefined`, so only the tests that actually CALL cleanupPlanView (or
  // dispatch to it through sessionArtifactView) go red. See the AT-123..134
  // block near the end of this file for the fixtures and the full rationale.
  cleanupPlanView,
} from './session-artifact-view.ts';
import { filePackageTabs, selectFile } from './file-package.ts';
import type { RoadmapDraftArtifact, MarkdownDraftArtifact, BrainStructureArtifact, GenerationGalleryArtifact, ContractBuildoutArtifact } from './session-client.ts';
import { sessionShellState, selectStage } from './session-shell-view.ts';
import type { SessionShellPayload } from './session-client.ts';
// R4-19-F2 — reads the REAL r4-19-f2-live-capture fixture's cleanup-plan.md
// off disk for AT-134's end-to-end row, rather than re-typing the captured
// markdown inline (per the task brief: "read them from disk, never inline
// them"). Mirrors knowledge-page-kb-maintenance.test.ts's own
// `resolve(__dirname, ...)` + `readFileSync` precedent for reading a real
// on-disk artifact into a test fixture.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// R4-21 — file-package (creation-agent authoring session, T3 pins RED-3a/b).
// `FilePackageArtifact` is NOT imported from ./session-client.ts — it does
// not declare that shape yet (implementation target, out of scope for this
// test-only file); hand-fixtured here exactly like this file's own
// `fixtureContractStages`-equivalent precedent in session-transcript.test.ts
// (never cross-importing a not-yet-shipped type from the module under test's
// own dependency).
type FilePackageArtifact = { kind: 'file-package'; label: string; files: Array<{ path: string; body: string }> };

const FILE_PACKAGE_ARTIFACT: FilePackageArtifact = {
  kind: 'file-package',
  label: 'Draft package',
  files: [
    { path: 'SKILL.md', body: '# Authored Skill\n\nBody.\n' },
    { path: 'reference.md', body: 'Supporting reference content.\n' },
  ],
};

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

// R4-16: the reserved-kind roster SHRINKS to 2 — "generation-gallery" now has
// a real renderer (generationGalleryView, below) and must no longer throw
// "reserved". This is the required correction to a PRE-EXISTING assertion,
// not a weakening: leaving it looping over 3 kinds would make this test
// permanently, wrongly RED once generation-gallery correctly dispatches (a
// live kind is precisely NOT reserved) — see AT-106/107 below for the
// positive proof that generation-gallery dispatches instead of throwing.
// R4-17: the reserved-kind roster SHRINKS AGAIN, to 1 — "contract-buildout"
// now has a real renderer (contractBuildoutView, below) and must no longer
// throw "reserved" either. Same correction shape as R4-16's; see AT-117/118
// below for the positive proof that contract-buildout dispatches instead of
// throwing.
//
// AT-85/AT-86/AT-88 DELETED here, not kept green (R4-21, documented edit —
// T3; mirrors the R4-17 AT-89 deletion precedent immediately above, and the
// R4-16 AT-103/104/105 deletion precedent for selectGeneration): all three
// used 'file-package' as their "the STILL-RESERVED kind" fixture — but
// file-package is THE row R4-21 flips reserved→live (this file's RED-3a/b,
// below), and it was already the LAST reserved row in the whole vocabulary
// (see AT-2 in session-kinds.test.ts), so after this round
// RESERVED_ARTIFACT_KINDS is EMPTY — there is no reserved kind left anywhere
// to build a "still throws reserved" fixture from. Their premise is not
// weakened, it is now FALSE: keeping them green would require either (a)
// leaving file-package reserved forever (defeats this whole initiative) or
// (b) an implementation quietly leaving SOME other kind reserved just to
// keep these tests passing, which is exactly the "tests keeping a stale
// premise alive" shape the campaign already refused twice above. AT-87
// (totally unknown kind, unrelated to file-package) is UNCHANGED below — the
// "unknown kind throws, message does not claim reserved" contract still
// holds and is still exercised. RED-3a/b (below) are this round's positive
// replacement pins, proving file-package now dispatches to a real renderer
// instead of throwing.

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

// R4-21 — RED-3a/b: file-package flips reserved→live, dispatching to a real
// filePackageArtifactView renderer (reusing filePackageTabs/selectFile from
// file-package.ts, mirroring brainStructureView's own reuse pin exactly).
test('RED-3a (R4-21): sessionArtifactView dispatches "file-package" to filePackageArtifactView, never the reserved-kind throw — file-package is REMOVED from RESERVED_ARTIFACT_KINDS', () => {
  expect(() => sessionArtifactView(FILE_PACKAGE_ARTIFACT), 'file-package must no longer throw "reserved" once it is live').not.toThrow();
  const dispatched = sessionArtifactView(FILE_PACKAGE_ARTIFACT);
  expect(dispatched).toEqual(filePackageArtifactView(FILE_PACKAGE_ARTIFACT));

  // Stage-UNAWARE like every other live kind today (mirrors AT-91's
  // invariance pin exactly) — a file-package draft has no notion of "which
  // stage" any more than a roadmap draft or an AGENTS.md draft does; passing
  // a stage must never make this renderer stage-sensitive.
  const withStage = sessionArtifactView(FILE_PACKAGE_ARTIFACT, 'roadmap');
  expect(withStage).toEqual(dispatched);
});

test('RED-3b (R4-21): filePackageArtifactView reuses filePackageTabs/selectFile from file-package.ts — no bespoke tab-strip state machine', () => {
  const view = filePackageArtifactView(FILE_PACKAGE_ARTIFACT) as { kind: string; filePackage: unknown };
  expect(view.kind).toBe('file-package');
  // Reuse of filePackageTabs: the SAME output the shared helper itself
  // produces for these files, not a parallel reimplementation.
  expect(view.filePackage).toEqual(filePackageTabs(FILE_PACKAGE_ARTIFACT.files));

  // Reuse of selectFile: selectFilePackageFile delegates to the REAL, shared
  // selectFile — mirrors selectBrainStructureFile's AT-82/83 precedent
  // exactly (immutability: a NEW object; delegated clamping behaviour, never
  // a bespoke reimplementation).
  const next = selectFilePackageFile(view as unknown as { kind: 'file-package'; filePackage: ReturnType<typeof filePackageTabs> }, 1);
  expect(next).not.toBe(view);
  expect(next.filePackage).toEqual(selectFile(view.filePackage as ReturnType<typeof filePackageTabs>, 1));
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

// ===========================================================================
// R4-16 (2026-08-06) — generationGalleryView, the NEW renderer for the
// "generation-gallery" artifact kind, plus sessionArtifactView's dispatch
// flip (generation-gallery: reserved → live). TEST-FIRST PIN (at the time):
// the export did not exist yet at branch base (module-not-found on that
// named import specifically — this file's esbuild-based transform resolves a
// missing named export to `undefined` rather than a hard import error, so
// the pre-existing AT-70..99 tests above were unaffected; only the tests
// below, which actually CALL `generationGalleryView`, were red). — AT-100..
// AT-102, AT-106..AT-109 (formerly also AT-103..105 — see the PIN 3, Finding
// D note further down: those three `selectGeneration` tests are REMOVED, not
// renumbered, once `selectGeneration` itself is deleted from production as
// dead code).
// ===========================================================================

const GALLERY_TWO_GENERATIONS: GenerationGalleryArtifact = {
  kind: 'generation-gallery',
  label: 'Demo generations',
  generations: [
    {
      number: 1,
      createdAt: '2026-08-06T10:00:00.000Z',
      feedback: null,
      targetElement: null,
      items: [{ path: 'DEMO.html', kind: 'html', bytes: 512 }],
    },
    {
      number: 3, // deliberately non-contiguous — numbers may have gaps (R4-16's no-renumbering rule)
      createdAt: '2026-08-06T11:00:00.000Z',
      feedback: 'Make it punchier.',
      targetElement: null,
      items: [{ path: 'DEMO.html', kind: 'html', bytes: 700 }],
    },
  ],
  sourcesScanned: ['generations/* (2 generation(s) found)'],
};

const EMPTY_GALLERY: GenerationGalleryArtifact = {
  kind: 'generation-gallery',
  label: 'Demo generations',
  generations: [],
  sourcesScanned: ['generations/* (0 generation(s) found)'],
};

test('AT-100: generationGalleryView: non-empty gallery — generations pass through verbatim, count matches, isEmpty is false, emptyMessage is null', () => {
  const view = generationGalleryView(GALLERY_TWO_GENERATIONS);
  expect(view.generations).toEqual(GALLERY_TWO_GENERATIONS.generations);
  expect(view.count).toBe(2);
  expect(view.isEmpty).toBe(false);
  expect(view.emptyMessage).toBeNull();
});

test('AT-101: generationGalleryView: selectedIndex defaults to the NEWEST generation — the LAST entry in the (ascending-by-number) array, never the first — kills an implementation that defaults to the oldest generation', () => {
  const view = generationGalleryView(GALLERY_TWO_GENERATIONS);
  expect(view.selectedIndex).toBe(1); // index of generation number 3, the newest
  expect(view.generations[view.selectedIndex]!.number).toBe(3);
});

test('AT-102: generationGalleryView: an EMPTY gallery has isEmpty:true, count:0, and a non-null emptyMessage naming what was scanned — never a bare pane', () => {
  const view = generationGalleryView(EMPTY_GALLERY);
  expect(view.isEmpty).toBe(true);
  expect(view.count).toBe(0);
  expect(view.generations).toEqual([]);
  expect(view.emptyMessage).not.toBeNull();
  expect(view.emptyMessage).toContain('generations/* (0 generation(s) found)');
});

// R4-16 PIN 3, Finding D — `selectGeneration`'s tests (formerly AT-103/104/
// 105) are DELETED here, not kept green: a repo-wide sweep found the round-1
// fix removed its last real caller (the component now threads a stored
// generation NUMBER through `generationGalleryView`'s `preferredNumber`
// param, never an index through `selectGeneration`), and `selectGeneration`
// itself is being deleted from production in this same round. Keeping these
// three tests green would be exactly the "tests keeping dead code alive"
// shape this campaign refuses — a passing test suite is not proof a function
// is still needed if nothing outside its own test file calls it.

test('AT-106: sessionArtifactView: dispatches "generation-gallery" to generationGalleryView — the SAME output, proving reuse rather than a parallel reimplementation', () => {
  const dispatched = sessionArtifactView(GALLERY_TWO_GENERATIONS);
  expect(dispatched).toEqual(generationGalleryView(GALLERY_TWO_GENERATIONS));
});

test('AT-107: sessionArtifactView: "generation-gallery" no longer throws "reserved" — the flip this whole round exists to make (mirrors AT-85\'s shrunk 2-kind roster from the OTHER direction: proving the removed kind genuinely dispatches, not merely that the test loop got smaller)', () => {
  expect(() => sessionArtifactView(GALLERY_TWO_GENERATIONS)).not.toThrow();
  const view = sessionArtifactView(GALLERY_TWO_GENERATIONS) as { kind: string };
  expect(view.kind).toBe('generation-gallery');
});

// AT-108 DELETED here, not kept green (R4-21, documented edit — T3; same
// deletion shape as AT-85/86/88 above). This test was a regression guard
// proving the R4-16 generation-gallery flip did NOT also, accidentally,
// touch file-package — it was GREEN both before and after that round's
// implementation landed, by design. R4-21 is the round that intentionally
// flips file-package itself (RED-3a/b, above), so "the surviving reserved
// kind (file-package) still throws reserved" is no longer a true statement
// to guard — keeping it green would mean file-package never actually
// flipped. Its job (catching an implementation that widens a flip's blast
// radius beyond its intended kind) is superseded here by RED-3a's own
// positive assertion that file-package now dispatches cleanly.

test('AT-109: sessionArtifactView: generation-gallery is stage-UNAWARE like every other live kind today — passing a stage argument produces byte-identical output (mirrors AT-91\'s invariance pin for the 3 pre-existing live kinds)', () => {
  const noStage = sessionArtifactView(GALLERY_TWO_GENERATIONS);
  const withStageA = sessionArtifactView(GALLERY_TWO_GENERATIONS, 'demo');
  const withStageB = sessionArtifactView(GALLERY_TWO_GENERATIONS, 'roadmap');
  expect(withStageA).toEqual(noStage);
  expect(withStageB).toEqual(noStage);
});

// ===========================================================================
// R4-16 PIN 2 — Finding D (MAJOR): the operator's generation selection is
// destroyed on every 3s poll. `DemoBuilderPanel` refetches every 3s;
// `fetchSessionShell` builds a brand-new object graph each time;
// `GenerationGallery`'s effect fires on the new artifact reference and
// `generationGalleryView` unconditionally resets `selectedIndex` to the
// newest generation — so a picked generation cannot survive 3 seconds.
// Fix: `generationGalleryView(artifact, preferredNumber?: number)` gains an
// OPTIONAL second argument. TEST-FIRST PIN: the function does not accept a
// second argument yet at HEAD b1f59575 — every AT below is red because the
// (currently ignored) second argument has no effect on `selectedIndex` at
// all; it always falls back to newest.
//
// A gappy generation-number set ([1, 3, 4], not [1, 2, 3]) is used
// throughout so a POSITION-based implementation (treating preferredNumber as
// an array index) is distinguishable from the correct VALUE-based one:
// preferredNumber=3 must select array index 1 (generations[1].number === 3),
// not index 3 (out of bounds for a 3-element array).
// ===========================================================================

function makeGappyGalleryArtifact(): GenerationGalleryArtifact {
  return {
    kind: 'generation-gallery',
    label: 'Demo generations',
    generations: [
      { number: 1, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, items: [{ path: 'DEMO.html', kind: 'html', bytes: 100 }] },
      { number: 3, createdAt: '2026-08-06T11:00:00.000Z', feedback: null, targetElement: null, items: [{ path: 'DEMO.html', kind: 'html', bytes: 200 }] },
      { number: 4, createdAt: '2026-08-06T12:00:00.000Z', feedback: null, targetElement: null, items: [{ path: 'DEMO.html', kind: 'html', bytes: 300 }] },
    ],
    sourcesScanned: ['generations/* (3 generation(s) found)'],
  };
}

test('AT-110: generationGalleryView: an OPTIONAL preferredNumber selects the generation carrying THAT number — by VALUE, never by array position', () => {
  const gappy = makeGappyGalleryArtifact();
  const view = generationGalleryView(gappy, 3);
  expect(view.generations[view.selectedIndex]!.number).toBe(3);
  expect(view.selectedIndex).toBe(1); // index of number:3 in [1,3,4] — NOT index 3 (out of bounds) and NOT index 2
});

// GREEN today, not a defect pin (mirrors AT-46/AT-108's precedent): with
// preferredNumber currently ignored entirely, the view already always falls
// back to newest — so this assertion is trivially true both before AND after
// the fix lands. It earns its place as the regression guard against the
// WRONG fix for AT-110/112: an implementation that THROWS (or otherwise
// misbehaves) on an unrecognised preferredNumber instead of gracefully
// falling back would pass AT-110 while failing here.
test('AT-111: generationGalleryView: a preferredNumber naming a generation that no longer exists on disk falls back to the NEWEST generation, never throws', () => {
  const gappy = makeGappyGalleryArtifact();
  expect(() => generationGalleryView(gappy, 99)).not.toThrow();
  const view = generationGalleryView(gappy, 99);
  expect(view.generations[view.selectedIndex]!.number).toBe(4); // newest — the same fallback as no preferredNumber at all
  expect(view.selectedIndex).toBe(2);
});

// The mandatory adversarial AT for this finding: kills the reference-identity
// reset directly. `artifactA`/`artifactB` are two INDEPENDENTLY built object
// graphs (A !== B by reference, exactly what a fresh 3s poll fetch produces)
// that are structurally identical — the ONLY thing that must matter to
// generationGalleryView's selection is the preferredNumber argument, never
// object identity.
test('AT-112 (mandatory adversarial AT — poll-survival): the SAME preferredNumber selects the SAME generation across two structurally-identical, independently-built artifact objects (A !== B by reference) — the exact shape of a 3s poll rebuilding a fresh object graph', () => {
  const artifactA = makeGappyGalleryArtifact();
  const artifactB = makeGappyGalleryArtifact();
  expect(artifactA).not.toBe(artifactB); // different references...
  expect(artifactA).toEqual(artifactB); // ...but structurally identical, exactly like a re-fetched payload

  // The operator picked generation 3 (not the newest, 4).
  const viewA = generationGalleryView(artifactA, 3);
  expect(viewA.generations[viewA.selectedIndex]!.number).toBe(3);

  // Simulate the 3s poll tick: a BRAND NEW artifact object, SAME preferred number.
  const viewB = generationGalleryView(artifactB, 3);
  expect(viewB.generations[viewB.selectedIndex]!.number).toBe(3); // must NOT silently reset to 4 (newest)
});

// ===========================================================================
// R4-16 PIN 3 — Finding C (MAJOR): the poll-stable selection (AT-110..112
// above) leaks ACROSS A SESSION SWITCH. `GenerationGallery` stores a bare
// `useState<number | null>`; nothing resets it when the panel swaps to a
// different demo session (`projects/[id]/page.tsx`'s `handleDemoSessionStarted`
// swaps `activeDemoSid` without unmounting). Reproduced: pick generation 2 in
// session A, switch to session B, and once B reaches 3 generations the pane
// silently shows B's generation 2 — a stale, out-of-session pick with zero
// operator action, and the finalize button then sends what is displayed.
//
// Ruling on the fix shape (binding, decides where this lives): the selection
// must be stored WITH the session it belongs to, not as a bare number, and
// must NOT be reset via an artifact-identity effect (that is the exact trap
// the round-1 fix escaped for AT-112). A tiny PURE helper decides whether a
// stored selection still applies to the CURRENTLY-DISPLAYED session:
//   preferredGenerationFor(selection: {sessionId: string; number: number} | null, sessionId: string): number | undefined
// — returns `selection.number` iff `selection.sessionId === sessionId`, else
// `undefined` (⇒ generationGalleryView falls back to newest, its existing,
// already-pinned contract — AT-101/111).
//
// TEST-FIRST PIN: `preferredGenerationFor` does not exist at HEAD edb0cfcb —
// every test below is red because the import resolves to `undefined`.
// ===========================================================================

function buildContiguousGalleryArtifact(numbers: number[]): GenerationGalleryArtifact {
  return {
    kind: 'generation-gallery',
    label: 'Demo generations',
    generations: numbers.map((n) => ({
      number: n,
      createdAt: `2026-08-06T${String(10 + n).padStart(2, '0')}:00:00.000Z`,
      feedback: null,
      targetElement: null,
      items: [{ path: 'DEMO.html', kind: 'html', bytes: 100 * n }],
    })),
    sourcesScanned: [`generations/* (${numbers.length} generation(s) found)`],
  };
}

test('AT-113: preferredGenerationFor: the SAME session ⇒ returns the stored number, and threading it through generationGalleryView selects that generation', () => {
  const selection = { sessionId: 'session-A', number: 2 };
  expect(preferredGenerationFor(selection, 'session-A')).toBe(2);

  const sessionAArtifact = buildContiguousGalleryArtifact([1, 2, 3]);
  const view = generationGalleryView(sessionAArtifact, preferredGenerationFor(selection, 'session-A'));
  expect(view.generations[view.selectedIndex]!.number).toBe(2);
});

// The mandatory adversarial AT for this finding — kills the cross-session
// leak directly, reproducing the exact live defect: a selection recorded for
// session A must never apply once the pane is showing session B.
test('AT-114 (mandatory adversarial AT — kills the cross-session leak): a DIFFERENT session ⇒ preferredGenerationFor returns undefined, and generationGalleryView therefore falls back to the NEWEST generation, never the stale cross-session number', () => {
  const selection = { sessionId: 'session-A', number: 2 };
  expect(preferredGenerationFor(selection, 'session-B')).toBeUndefined();

  // Session B reaches 3 generations, exactly the live-reproduction shape.
  const sessionBArtifact = buildContiguousGalleryArtifact([1, 2, 3]);
  const view = generationGalleryView(sessionBArtifact, preferredGenerationFor(selection, 'session-B'));
  expect(view.generations[view.selectedIndex]!.number).toBe(3); // newest — NOT the leaked "2" from session A
});

test('AT-115: preferredGenerationFor: a null selection (nothing picked yet, in any session) ⇒ undefined', () => {
  expect(preferredGenerationFor(null, 'session-A')).toBeUndefined();
});

test('AT-116: an empty gallery combined with a stored SAME-session selection resolves gracefully — no throw, isEmpty stays true, no phantom selection', () => {
  const selection = { sessionId: 'session-A', number: 2 };
  const emptyArtifact = buildContiguousGalleryArtifact([]);
  expect(() => generationGalleryView(emptyArtifact, preferredGenerationFor(selection, 'session-A'))).not.toThrow();
  const view = generationGalleryView(emptyArtifact, preferredGenerationFor(selection, 'session-A'));
  expect(view.isEmpty).toBe(true);
  expect(view.selectedIndex).toBe(-1);
});

// ===========================================================================
// R4-17 — contractBuildoutView + the contract-buildout flip. TEST-FIRST PIN:
// `contractBuildoutView` does not exist yet (esbuild-named-export: an
// unresolved import is `undefined`, so only tests that CALL it go red), and
// `contract-buildout` is still in `RESERVED_ARTIFACT_KINDS` in the real,
// unmodified session-artifact-view.ts today — every `sessionArtifactView`
// dispatch test below currently throws "reserved" instead of dispatching,
// mirroring AT-107's own precedent for generation-gallery at ITS branch base.
//
// DESIGN CHOICE THIS FILE PINS (flagged for T2 — the spec names the
// STAGE-AWARE requirement but not an exact return shape): `contractBuildoutView`
// returns a discriminated union on `activeStage === 'contract'` vs anything
// else — `mode:'checklist'` (all five rows, for the mockup's "which stages
// are present" overview) vs `mode:'detail'` (the ONE row matching
// `activeStage`, for every other stage's own tab). An `activeStage` naming a
// stage with no matching row (never happens for a real 5-stage payload, but a
// malformed/future input might) resolves `row: null` rather than throwing —
// consistent with this module's house style of failing soft on VIEW
// derivation and reserving throws for dispatch-boundary vocabulary errors.
// ===========================================================================

const WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT: ContractBuildoutArtifact = {
  kind: 'contract-buildout',
  label: 'Contract build-out',
  stages: [
    { stage: 'contract', status: 'present', source: '.forge/project.json', detail: ['npm test'], bytes: null },
    { stage: 'instructions', status: 'present', source: 'AGENTS.md', detail: [], bytes: 512 },
    { stage: 'secrets', status: 'absent', source: '.forge/project.json', detail: [], bytes: null },
    { stage: 'demo', status: 'absent', source: '.forge/project.json + .forge/demo/demo.lock.json', detail: [], bytes: null },
    { stage: 'roadmap', status: 'present', source: 'roadmap.md', detail: [], bytes: 2046 },
  ],
  sourcesScanned: ['.forge/project.json', 'AGENTS.md', 'roadmap.md'],
};

test('R4-17 AT-117: sessionArtifactView: "contract-buildout" no longer throws "reserved" — dispatches to contractBuildoutView, the flip this round exists to make', () => {
  expect(() => sessionArtifactView(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, 'contract')).not.toThrow();
  const dispatched = sessionArtifactView(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, 'contract') as { kind: string };
  expect(dispatched.kind).toBe('contract-buildout');
  expect(dispatched).toEqual(contractBuildoutView(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, 'contract'));
});

test('R4-17 AT-118: contractBuildoutView: activeStage "contract" → mode:"checklist" carrying ALL FIVE stage rows verbatim, in server order — the mockup\'s "which stages are present" overview', () => {
  const view = contractBuildoutView(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, 'contract') as { mode: string; checklist: unknown[] };
  expect(view.mode).toBe('checklist');
  expect(view.checklist).toEqual(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages);
});

test('R4-17 AT-119: contractBuildoutView: activeStage "roadmap" (a non-contract stage) → mode:"detail" carrying ONLY that stage\'s own row, never the other four', () => {
  const view = contractBuildoutView(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, 'roadmap') as { mode: string; row: { stage: string } | null };
  expect(view.mode).toBe('detail');
  expect(view.row).toEqual(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages[4]);
});

test('R4-17 AT-120: contractBuildoutView: EVERY non-contract stage (instructions/secrets/demo/roadmap) resolves to its OWN row — kills an implementation that hardcodes a single stage or always returns the first/last row regardless of activeStage', () => {
  for (const row of WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT.stages.filter((r) => r.stage !== 'contract')) {
    const view = contractBuildoutView(WELL_FORMED_CONTRACT_BUILDOUT_ARTIFACT, row.stage) as { mode: string; row: unknown };
    expect(view.mode).toBe('detail');
    expect(view.row).toEqual(row);
  }
});

// R4-17 AT-121 DELETED here, not kept green (R4-21, documented edit — T3;
// same deletion shape as AT-85/86/88/108 above). Was a regression guard
// proving the R4-17 contract-buildout flip did not also touch file-package —
// superseded now that R4-21 is the round that intentionally flips
// file-package itself. RED-3a's positive dispatch assertion (with a `stage`
// argument passed through `sessionArtifactView`'s existing optional second
// parameter — AT-91's stage-unaware invariance applies to file-package too,
// since it is a live kind with no notion of "which stage" any more than
// roadmap-draft/markdown-draft/brain-structure have) is this round's
// replacement coverage.

// ===========================================================================
// R4-17, D10 — SessionArtifactPane.tsx's ternary chain's final `else`
// unconditionally renders `<GenerationGallery>`, so a kind the pane doesn't
// explicitly branch on silently misrenders as a gallery instead of failing
// loudly. Per the T3 task brief's own escape hatch ("if the pane has no pure
// seam, pin it in session-artifact-view.ts and say so in your report" —
// see the T3 report: this repo's vitest config only collects
// `lib/**/*.test.ts`, and no `@testing-library/react`-style component-render
// harness exists anywhere in forge-ui, so SessionArtifactPane.tsx's own JSX
// ternary has no seam this test file can drive). This pins the CORRECTED
// contract at the layer that DOES have a seam: `sessionArtifactView` is the
// single, exhaustive dispatcher every live kind (including contract-buildout,
// as of this round) must resolve through — a kind outside its known set
// throws EXPLICITLY, naming it, rather than resolving to any specific view
// shape (in particular, never silently matching generation-gallery's shape,
// which is what an unconditional-else fallback would functionally do).
// ===========================================================================

test('R4-17 AT-122 (D10): sessionArtifactView: an UNRECOGNISED artifact kind (neither live nor reserved) THROWS an explicit error naming it — never silently resolves to generation-gallery\'s (or any other kind\'s) view shape', () => {
  const bogus = { kind: 'totally-unknown-future-kind-9182' };
  expect(() => sessionArtifactView(bogus)).toThrow(/totally-unknown-future-kind-9182/);
  let thrownMessage = '';
  try {
    sessionArtifactView(bogus);
  } catch (err) {
    thrownMessage = String(err);
  }
  // The failure-mode discrimination this pin cares about: the thrown message
  // must not itself be (or resemble) a generation-gallery view object — i.e.
  // this genuinely throws rather than degrading into SOME view shape that a
  // careless caller could render as if it were valid.
  expect(thrownMessage).not.toContain('"kind":"generation-gallery"');
});

// ===========================================================================
// R4-19-F2 — cleanupPlanView, the NEW renderer for the "cleanup-plan"
// artifact kind (kb-cleanup's brain-maintenance session), plus
// sessionArtifactView's dispatch flip (cleanup-plan is declared LIVE at
// birth in orchestrator/studio/session-kinds.ts — id:'cleanup-plan',
// status:'live' — never reserved, unlike generation-gallery/contract-buildout/
// file-package's reserved->live histories above). TEST-FIRST PIN: the export
// does not exist yet — module-not-found on this one named import resolves to
// `undefined` per this file's esbuild-named-export convention (see the
// header note by the import above), so only the tests below, which actually
// CALL `cleanupPlanView` (directly or via the dispatcher), are red; every
// pre-existing AT-70..122 test above is unaffected. — AT-123..134
//
// `CleanupPlanArtifact`/`CleanupPlanAction` are NOT imported from
// ./session-client.ts -- it does not declare this shape yet (implementation
// target, out of scope for this test-only file); hand-declared here exactly
// like FILE_PACKAGE_ARTIFACT's own `FilePackageArtifact` precedent above
// (RED-3a/b): never cross-importing a not-yet-shipped type from the module
// under test's own dependency. The shape mirrors the AUTHORITATIVE type from
// the concurrently-landing backend (orchestrator/studio/session-transcript.ts's
// CleanupPlanArtifact/CleanupPlanAction) -- three action states, not two:
// 'open' | 'cleared' | 'unknown'. The third state is load-bearing and was won
// the hard way -- a real run once reported every action 'cleared' while
// nothing had been fixed, because absence-of-a-finding was wrongly treated as
// proof of repair. 'unknown' exists precisely so this view can never again
// imply a repair landed when coverage could not be established, which is why
// AT-127 below (not AT-126's simpler all-cleared case) is this section's
// mandatory adversarial pin: it is the one that actually kills a
// `settled = openFindingCount === 0` implementation, the exact shape of the
// original defect re-surfacing at the presentation layer.
//
// DESIGN CHOICE THIS FILE PINS (flagged for T2 -- the task brief names the
// required OUTPUT shape but not an exact field list; this mirrors
// contractBuildoutView's own "DESIGN CHOICE THIS FILE PINS" precedent
// above): `cleanupPlanView` returns
//   { kind: 'cleanup-plan', label, state, plan, actions, openFindingCount, settled }
// -- `label` and `openFindingCount` pass through VERBATIM from the artifact
// (mirrors AT-78's `brainStructureView.themeCount` precedent: a legitimately
// divergent server-reported count must never be "corrected" by a client-side
// recount -- see AT-132 below, this section's version of that exact pin).
// `state` is a NEW three-way pane-level token -- 'no-plan' | 'unparsed-plan' |
// 'has-actions' -- mirroring `markdownDraftView`'s own three-state idiom
// ('no-draft' | 'empty-draft' | 'has-content') exactly, just renamed for this
// kind's own vocabulary (AT-129..131 below mirror AT-74..77's structure
// one-for-one). `settled` is a NEW boolean, true iff every action's `state`
// is 'cleared' AND at least one action exists -- false for a no-plan/
// unparsed-plan pane (vacuous truth over an empty actions[] would itself be
// the "absence treated as proof of repair" bug one layer up) and false the
// instant ANY action is 'open' OR 'unknown' (AT-126..128). Every action row
// in `actions` is threaded through UNCHANGED (kind/target/proposal/state, no
// re-derivation) -- the server already computed `state` once; this view never
// computes a second, potentially-drifting copy.
//
// Every existing live kind's view carries no `label` field of its own -- the
// wrapper (`SessionArtifactPane.tsx`) already reads `artifact.label`
// directly for `data-artifact-label`, so no per-kind view has needed to
// duplicate it. `cleanupPlanView` is the one exception, because the task
// brief for this kind explicitly names "carrying the label" as part of the
// view's job (item 1) -- pinned here as a deliberate, additive divergence
// from the 6 existing kinds' shape, not a signal that they should grow one
// too. Flagged in the report for T2 to ratify or redirect.
// ===========================================================================

const CLEANUP_PLAN_ALL_STATES: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'KB cleanup plan',
  plan: '# Cleanup Plan\n\nThree findings, three different outcomes.\n',
  actions: [
    { kind: 'length.soft-cap', target: 'brain/forge-dev/themes/alpha.md', proposal: 'Condense the theme toward the soft cap.', state: 'open' },
    { kind: 'edge.dangling', target: 'brain/forge-dev/themes/beta.md', proposal: 'Drop the dangling related_themes entry.', state: 'cleared' },
    { kind: 'frontmatter.missing-field', target: 'brain/forge-dev/themes/gamma.md', proposal: 'Add the missing category field.', state: 'unknown' },
  ],
  openFindingCount: 1,
};

const CLEANUP_PLAN_ALL_CLEARED: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'KB cleanup plan',
  plan: '# Cleanup Plan\n\nBoth findings resolved.\n',
  actions: [
    { kind: 'length.soft-cap', target: 'brain/forge-dev/themes/alpha.md', proposal: 'Condense the theme toward the soft cap.', state: 'cleared' },
    { kind: 'edge.dangling', target: 'brain/forge-dev/themes/beta.md', proposal: 'Drop the dangling related_themes entry.', state: 'cleared' },
  ],
  openFindingCount: 0,
};

// The mandatory adversarial fixture (AT-127): zero OPEN rows -- openFindingCount
// is honestly 0 -- yet the plan is NOT settled, because one row's coverage was
// never established. This is the exact shape of the real P1: a naive
// `settled = openFindingCount === 0` (or `actions.every(a => a.state !==
// 'open')`) implementation passes AT-126 but WRONGLY reports settled:true here.
const CLEANUP_PLAN_HAS_UNKNOWN: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'KB cleanup plan',
  plan: '# Cleanup Plan\n\nOne resolved, one unverifiable.\n',
  actions: [
    { kind: 'length.soft-cap', target: 'brain/forge-dev/themes/alpha.md', proposal: 'Condense the theme toward the soft cap.', state: 'cleared' },
    { kind: 'edge.dangling', target: 'brain/forge-dev/themes/beta.md', proposal: 'Drop the dangling related_themes entry.', state: 'unknown' },
  ],
  openFindingCount: 0,
};

const CLEANUP_PLAN_HAS_OPEN: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'KB cleanup plan',
  plan: '# Cleanup Plan\n\nOne resolved, one still outstanding.\n',
  actions: [
    { kind: 'length.soft-cap', target: 'brain/forge-dev/themes/alpha.md', proposal: 'Condense the theme toward the soft cap.', state: 'cleared' },
    { kind: 'edge.dangling', target: 'brain/forge-dev/themes/beta.md', proposal: 'Drop the dangling related_themes entry.', state: 'open' },
  ],
  openFindingCount: 1,
};

const CLEANUP_PLAN_UNPARSED: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'KB cleanup plan',
  // Free-form prose the agent drafted with no bracketed `[kind] target -- proposal`
  // action lines anywhere in it -- nothing for the server-side parser to turn
  // into a row, per session-transcript.ts's parseCleanupPlanActions contract
  // (a non-matching line is silently ignored for actions[], but the raw text
  // still ships in `plan` verbatim).
  plan: 'The KB looked clean on this pass. No structural findings stood out enough to write up as discrete actions, so this draft is closing without an action list.',
  actions: [],
  openFindingCount: 0,
};

const CLEANUP_PLAN_NO_PLAN: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'KB cleanup plan',
  plan: null,
  actions: [],
  openFindingCount: 0,
};

// A server-reported openFindingCount that DISAGREES with the actual count of
// 'open' rows in `actions` (AT-132) -- deliberately: 1 real open row, but the
// server says 4. The view must surface the server's number unchanged.
const CLEANUP_PLAN_DISAGREEING_COUNT: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'KB cleanup plan',
  plan: '# Cleanup Plan\n\nOne row, one deliberately mismatched count.\n',
  actions: [{ kind: 'length.soft-cap', target: 'brain/forge-dev/themes/alpha.md', proposal: 'Condense the theme toward the soft cap.', state: 'open' }],
  openFindingCount: 4,
};

// AT-133's real-capture fixture: the plan text is READ FROM DISK (the real
// r4-19-f2-live-capture fixture's cleanup-plan.md), never re-typed inline.
// The two actions' kind/target are hand-copied VERBATIM from that same real
// file's two `- [<kind>] <target> -- <proposal>` lines (both findings are
// still present, unmatched by any repair, in the fixture's status.json --
// `findings[0].kind === 'length.soft-cap'`, `findings[1].kind ===
// 'edge.dangling'`, both `resolution: 'agent'` -- so both actions carry
// state:'open' here, the state a live join against that same findings[] would
// produce). This is a hand-fixtured CleanupPlanArtifact (the already-derived
// wire shape this view consumes), not a re-run of the server-side markdown
// parser -- this test file has no business importing session-transcript.ts's
// parser (mirrors this whole file's established "never cross the
// orchestrator/forge-ui boundary" rule).
const REAL_CAPTURE_DIR = resolve(__dirname, '../../scripts/journeys/fixtures/r4-19-f2-live-capture');
const REAL_CLEANUP_PLAN_MD = readFileSync(resolve(REAL_CAPTURE_DIR, 'cleanup-plan.md'), 'utf8');

const REAL_CLEANUP_PLAN_ARTIFACT: CleanupPlanArtifact = {
  kind: 'cleanup-plan',
  label: 'Cleanup plan',
  plan: REAL_CLEANUP_PLAN_MD,
  actions: [
    {
      kind: 'length.soft-cap',
      target: 'brain/forge-dev/themes/brain-read-policy.md',
      proposal:
        'Condense the theme from 65 to ≤60 body lines by merging the two near-duplicate source bullets and folding the R1-01 / R1-06 blockquote callouts into a compact inline history note.',
      state: 'open',
    },
    {
      kind: 'edge.dangling',
      target: 'brain/forge-dev/themes/exploration-vs-implementation-initiatives.md',
      proposal:
        'Drop the `related_themes` entry `forge-current-architecture-as-built` because no matching theme file exists anywhere under `brain/**/themes/` and no plausible surviving slug was found.',
      state: 'open',
    },
  ],
  openFindingCount: 2,
};

test('R4-19-F2 AT-123: cleanupPlanView: the view model EXISTS for the "cleanup-plan" kind and carries label, raw plan text, action rows, and the open count through -- kills a kind that falls through to a default/unknown branch and renders nothing', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_ALL_STATES);
  expect(view.kind).toBe('cleanup-plan');
  expect(view.label).toBe(CLEANUP_PLAN_ALL_STATES.label);
  expect(view.plan).toBe(CLEANUP_PLAN_ALL_STATES.plan);
  expect(view.actions).toEqual(CLEANUP_PLAN_ALL_STATES.actions);
  expect(view.openFindingCount).toBe(CLEANUP_PLAN_ALL_STATES.openFindingCount);
  expect(view.state).toBe('has-actions');
});

test('R4-19-F2 AT-124: sessionArtifactView: dispatches "cleanup-plan" to cleanupPlanView -- the kind is LIVE from birth (orchestrator/studio/session-kinds.ts), never reserved, so it must never throw "reserved" OR fall through to the unrecognised-kind throw', () => {
  expect(() => sessionArtifactView(CLEANUP_PLAN_ALL_STATES)).not.toThrow();
  const dispatched = sessionArtifactView(CLEANUP_PLAN_ALL_STATES) as { kind: string };
  expect(dispatched.kind).toBe('cleanup-plan');
  expect(dispatched).toEqual(cleanupPlanView(CLEANUP_PLAN_ALL_STATES));

  // Stage-UNAWARE like every other live kind today (mirrors AT-91/AT-109's
  // invariance pin exactly) -- a KB-cleanup plan has no notion of "which
  // stage" any more than a roadmap draft does; passing a stage must never
  // make this renderer stage-sensitive.
  const withStage = sessionArtifactView(CLEANUP_PLAN_ALL_STATES, 'roadmap');
  expect(withStage).toEqual(dispatched);
});

test('R4-19-F2 AT-125: cleanupPlanView: given one action of EACH state (open/cleared/unknown), every row exposes its OWN state, passed through verbatim (kind/target/proposal unchanged) -- no two states collapse to the same rendered value', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_ALL_STATES);
  expect(view.actions).toHaveLength(3);
  expect(view.actions[0]).toEqual(CLEANUP_PLAN_ALL_STATES.actions[0]);
  expect(view.actions[1]).toEqual(CLEANUP_PLAN_ALL_STATES.actions[1]);
  expect(view.actions[2]).toEqual(CLEANUP_PLAN_ALL_STATES.actions[2]);
  const states = view.actions.map((a) => a.state);
  expect(states).toEqual(['open', 'cleared', 'unknown']);
  // The mandatory pairwise-distinctness check: a Set collapses any two equal
  // values, so this is the direct kill of "unknown renders the same as
  // cleared" (or as open) at the presentation layer.
  expect(new Set(states).size).toBe(3);
});

test('R4-19-F2 AT-126: cleanupPlanView: settled is true when EVERY action is "cleared" -- the fully-resolved case', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_ALL_CLEARED);
  expect(view.settled).toBe(true);
});

test('R4-19-F2 AT-127 (mandatory adversarial AT -- kills the P1 re-surfacing at the presentation layer): cleanupPlanView: settled is FALSE when any action is "unknown", even though openFindingCount is honestly 0 (zero OPEN rows) -- kills a settled=openFindingCount===0 (or any open-only) implementation, the exact "absence of a finding treated as proof of repair" defect one layer up', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_HAS_UNKNOWN);
  expect(view.openFindingCount).toBe(0);
  expect(view.actions.some((a) => a.state === 'unknown')).toBe(true);
  expect(view.actions.some((a) => a.state === 'open')).toBe(false);
  expect(view.settled).toBe(false);
});

test('R4-19-F2 AT-128: cleanupPlanView: settled is false when any action is "open" -- the baseline still-outstanding case, distinguished from AT-127\'s unknown-only case', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_HAS_OPEN);
  expect(view.settled).toBe(false);
});

test('R4-19-F2 AT-129: cleanupPlanView: a drafted-but-unparseable plan (plan non-null, actions: []) still surfaces the raw plan text verbatim and does NOT render as an empty/"nothing here" state -- kills a renderer that shows nothing when the agent wrote prose the parser could not turn into rows', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_UNPARSED);
  expect(view.plan).toBe(CLEANUP_PLAN_UNPARSED.plan);
  expect(view.plan).not.toBeNull();
  expect(view.actions).toEqual([]);
  expect(view.state).toBe('unparsed-plan');
  expect(view.settled).toBe(false); // nothing to settle is not the same as settled
});

test('R4-19-F2 AT-130: cleanupPlanView: NO PLAN YET (plan: null, actions: []) renders an honest empty/pending state, distinct from a drafted-but-unparseable plan -- kills conflating "not drafted yet" with "drafted but unparseable"', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_NO_PLAN);
  expect(view.plan).toBeNull();
  expect(view.actions).toEqual([]);
  expect(view.state).toBe('no-plan');
  expect(view.state).not.toBe(cleanupPlanView(CLEANUP_PLAN_UNPARSED).state);
  expect(view.settled).toBe(false);
});

test('R4-19-F2 AT-131: cleanupPlanView: the three pane states (no-plan, unparsed-plan, has-actions) are pairwise distinct tokens -- mirrors markdownDraftView\'s AT-77 precedent for this kind\'s own three-state idiom', () => {
  const states = [cleanupPlanView(CLEANUP_PLAN_NO_PLAN).state, cleanupPlanView(CLEANUP_PLAN_UNPARSED).state, cleanupPlanView(CLEANUP_PLAN_ALL_STATES).state];
  expect(new Set(states).size).toBe(3);
});

test('R4-19-F2 AT-132: cleanupPlanView: openFindingCount is displayed EXACTLY as the server supplied it, never recomputed from the actions\' own "open" states -- mirrors AT-78\'s brainStructureView.themeCount precedent: a legitimately divergent server-reported count must never be "corrected" client-side', () => {
  const view = cleanupPlanView(CLEANUP_PLAN_DISAGREEING_COUNT);
  const actualOpenRows = CLEANUP_PLAN_DISAGREEING_COUNT.actions.filter((a) => a.state === 'open').length;
  expect(actualOpenRows).toBe(1); // sanity: the fixture really does only have 1 open row...
  expect(CLEANUP_PLAN_DISAGREEING_COUNT.openFindingCount).toBe(4); // ...while the server reports 4
  expect(view.openFindingCount).toBe(4); // the view surfaces the SERVER's number
  expect(view.openFindingCount).not.toBe(actualOpenRows); // never the client-recomputed one
});

test('R4-19-F2 AT-133 (real-capture end-to-end): cleanupPlanView: built from the REAL r4-19-f2-live-capture fixture\'s two actions, both render with their real kinds (length.soft-cap, edge.dangling) and real target paths -- kills a view that only works on tidy hand-made fixtures', () => {
  const view = cleanupPlanView(REAL_CLEANUP_PLAN_ARTIFACT);
  expect(view.actions).toHaveLength(2);
  expect(view.actions.map((a) => a.kind)).toEqual(['length.soft-cap', 'edge.dangling']);
  expect(view.actions.map((a) => a.target)).toEqual([
    'brain/forge-dev/themes/brain-read-policy.md',
    'brain/forge-dev/themes/exploration-vs-implementation-initiatives.md',
  ]);
  expect(view.actions.every((a) => a.state === 'open')).toBe(true);
  // The raw captured markdown, read from disk -- never re-typed inline -- is
  // what `plan` carries, verbatim.
  expect(view.plan).toBe(REAL_CLEANUP_PLAN_MD);
  expect(view.plan).toContain('Cleanup Plan — KB `forge-dev`'); // sanity: genuinely this real file's content, not a lookalike (real em dash, matching the fixture's own heading byte-for-byte)
  expect(view.state).toBe('has-actions');
});
