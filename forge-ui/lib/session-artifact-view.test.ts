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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NONEMPTY_ROADMAP: RoadmapDraftArtifact = {
  kind: 'roadmap-draft',
  rows: [
    { initiativeId: 'R9-02', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-02.md' },
    { initiativeId: 'R9-01', project: 'gitpulse', phase: 'planned', origin: 'manifests/R9-01.md' },
  ],
  sourcesScanned: ['manifests/*.md (2 file(s) found)'],
};

const EMPTY_ROADMAP: RoadmapDraftArtifact = {
  kind: 'roadmap-draft',
  rows: [],
  sourcesScanned: ['manifests/*.md (0 file(s) found)'],
};

const NO_DRAFT: MarkdownDraftArtifact = { kind: 'markdown-draft', body: null, hasDraft: false };
const EMPTY_DRAFT: MarkdownDraftArtifact = { kind: 'markdown-draft', body: '', hasDraft: true };
const REAL_DRAFT: MarkdownDraftArtifact = { kind: 'markdown-draft', body: '# AGENTS.md\n\nDraft body.\n', hasDraft: true };

const BRAIN_ARTIFACT: BrainStructureArtifact = {
  kind: 'brain-structure',
  themeCount: 2,
  files: [
    { path: 'themes/alpha.md', body: '# Alpha' },
    { path: 'themes/beta.md', body: '# Beta' },
  ],
};

const EMPTY_BRAIN_ARTIFACT: BrainStructureArtifact = { kind: 'brain-structure', themeCount: 0, files: [] };

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
  const differentSource: RoadmapDraftArtifact = { kind: 'roadmap-draft', rows: [], sourcesScanned: ['manifests/*.md (0 file(s) found)', 'a-second-source (3 scanned)'] };
  const view = roadmapDraftView(differentSource);
  expect(view.emptyMessage).toContain('manifests/*.md (0 file(s) found)');
  expect(view.emptyMessage).toContain('a-second-source (3 scanned)'); // multiple scanned sources are never silently truncated to the first
});

test('AT-73: roadmapDraftView: a single-row artifact is never mistaken for empty', () => {
  const oneRow: RoadmapDraftArtifact = { kind: 'roadmap-draft', rows: [NONEMPTY_ROADMAP.rows[0]!], sourcesScanned: ['manifests/*.md (1 file(s) found)'] };
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
  const divergent: BrainStructureArtifact = { kind: 'brain-structure', themeCount: 5, files: BRAIN_ARTIFACT.files };
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
