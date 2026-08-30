/**
 * Acceptance tests for forge-ui/lib/file-package.ts (R3-01-F3/F4, WI-0).
 *
 * The module under test does not exist yet — vitest cannot even collect this
 * file until it lands (module-not-found is the expected red).
 *
 * This module is SHARED with R2-10-F3 (the interactive session shell's file
 * viewer) — kept kind-agnostic: no skill-specific naming, no skill imports,
 * pure functions only (mirrors the flow-view-state.ts / cycle-grouping.ts
 * testability convention).
 *
 * AT numbers map 1:1 onto _wave5/specs/R3-01-F3F4.md's
 * "AT set — forge-ui/lib/file-package.test.ts".
 */
import { test, expect } from 'vitest';
import { filePackageTabs, selectFile, fileLanguage } from './file-package.ts';

type PackageFile = { path: string; body: string };

function files(...paths: string[]): PackageFile[] {
  return paths.map((path) => ({ path, body: `content of ${path}` }));
}

// AT-56 -----------------------------------------------------------------

test('AT-56: filePackageTabs(files) returns tabs in package order with path labels', () => {
  const state = filePackageTabs(files('SKILL.md', 'docs/help.md', 'scripts/run.sh'));
  expect(state.tabs.map((t) => t.path)).toEqual(['SKILL.md', 'docs/help.md', 'scripts/run.sh']);
  // Package order preserved — NOT re-sorted by this module (the backend already
  // orders SKILL.md first; this is a pure passthrough view derivation).
  expect(state.tabs[0].label).toBe('SKILL.md');
  expect(state.tabs[1].label).toBe('help.md');
  expect(state.tabs[2].label).toBe('run.sh');
});

// AT-57 -----------------------------------------------------------------

test('AT-57: default active index is 0 (SKILL.md first for a skill package)', () => {
  const state = filePackageTabs(files('SKILL.md', 'reference.md'));
  expect(state.activeIndex).toBe(0);
});

// AT-58 -----------------------------------------------------------------

test('AT-58: selectFile(state, index) returns a NEW state with the selected index', () => {
  const state = filePackageTabs(files('SKILL.md', 'a.md', 'b.md'));
  const next = selectFile(state, 2);

  expect(next).not.toBe(state); // new object — immutability
  expect(next.activeIndex).toBe(2);
  expect(state.activeIndex, 'the original state must be unchanged').toBe(0);
});

test('AT-58: an out-of-range index is clamped, never throws', () => {
  const state = filePackageTabs(files('SKILL.md', 'a.md', 'b.md'));

  expect(() => selectFile(state, 999)).not.toThrow();
  expect(selectFile(state, 999).activeIndex, 'clamped to the last valid tab').toBe(2);

  expect(() => selectFile(state, -50)).not.toThrow();
  expect(selectFile(state, -50).activeIndex, 'clamped to the first valid tab, never negative').toBe(0);
});

// AT-59 -----------------------------------------------------------------

test('AT-59: fileLanguage(path) maps extension to a display language token; unknown → text', () => {
  expect(fileLanguage('SKILL.md')).toBe('markdown');
  expect(fileLanguage('docs/notes.md')).toBe('markdown');
  expect(fileLanguage('scripts/run.sh')).toBe('shell');
  expect(fileLanguage('scripts/run.bash')).toBe('shell');
  expect(fileLanguage('scripts/tool.py')).toBe('python');
  expect(fileLanguage('lib/util.ts')).toBe('typescript');
  expect(fileLanguage('lib/util.js')).toBe('javascript');
  expect(fileLanguage('config.json')).toBe('json');
  expect(fileLanguage('LICENSE')).toBe('text');
  expect(fileLanguage('data.bin')).toBe('text');
});

// AT-60 -----------------------------------------------------------------

test('AT-60: an empty file list yields a state with activeIndex: -1 and no crash', () => {
  const state = filePackageTabs([]);
  expect(state.tabs).toEqual([]);
  expect(state.activeIndex).toBe(-1);

  expect(() => selectFile(state, 0)).not.toThrow();
});

// ===========================================================================
// sessions-kinds-R09 (S1) — the operator's tab selection is destroyed on
// every ~3s poll tick of a session route.
//
// `FilePackage` is handed `artifact.files` straight off the session shell
// payload; `SessionShell` refetches every SHELL_POLL_MS (3000) and calls
// `setShellResult` unconditionally with a freshly `res.json()`-parsed graph,
// so `files` arrives as a BRAND-NEW array reference every tick even when
// not one byte changed. `filePackageTabs(files)` unconditionally returns
// `activeIndex: 0`, so any operator selection past the first tab is wiped
// within 3 seconds and the pane sticks on file[0] forever — a review gating
// an irreversible brain-write or registry commit cannot be completed for
// any file past the first.
//
// The fix mirrors `generationGalleryView`'s already-ratified R4-16 pin 2
// (Finding D) shape EXACTLY: an OPTIONAL second argument that selects BY
// VALUE (here the file PATH, there the generation NUMBER), never by array
// position, so the selection survives a re-fetched object graph. See
// lib/session-artifact-view.test.ts's AT-110/111/112 — these pins are the
// same three shapes, transposed onto the file-package tab strip.
//
// TEST-FIRST: `filePackageTabs` takes exactly one argument today, so the
// second argument below is ignored entirely and every activeIndex falls
// back to 0 — that is the red.
// ===========================================================================

// A package whose files are deliberately NOT in an order where the preferred
// path's index could be confused with anything positional, and whose paths
// share a directory prefix (the real project-brain shape: themes/*.md).
function brainPackage(): PackageFile[] {
  return files(
    'themes/acceptance-gate-design.md',
    'themes/antipatterns.md',
    'themes/build-and-test.md',
    'themes/conventions.md',
  );
}

test('R09: filePackageTabs(files, preferredPath) selects the tab carrying THAT path — by VALUE, never by array position', () => {
  const state = filePackageTabs(brainPackage(), 'themes/conventions.md');
  expect(state.tabs[state.activeIndex]!.path).toBe('themes/conventions.md');
  expect(state.activeIndex).toBe(3);

  const middle = filePackageTabs(brainPackage(), 'themes/antipatterns.md');
  expect(middle.tabs[middle.activeIndex]!.path).toBe('themes/antipatterns.md');
  expect(middle.activeIndex).toBe(1);
});

test('R09 (mandatory adversarial AT — poll-survival): the SAME preferredPath selects the SAME file across two structurally-identical, independently-built files arrays (A !== B by reference) — the exact shape of a 3s poll rebuilding a fresh object graph', () => {
  const filesA = brainPackage();
  const filesB = brainPackage();
  expect(filesA).not.toBe(filesB); // different references...
  expect(filesA).toEqual(filesB); // ...but structurally identical, exactly like a re-fetched payload

  // The operator clicked the second tab (not the default first).
  const viewA = filePackageTabs(filesA, 'themes/antipatterns.md');
  const viewB = filePackageTabs(filesB, 'themes/antipatterns.md');

  expect(viewB.activeIndex, 'the next poll tick must NOT snap the strip back to file[0]').toBe(viewA.activeIndex);
  expect(viewB.tabs[viewB.activeIndex]!.path).toBe('themes/antipatterns.md');
});

test('R09: a preferredPath naming a file no longer in the package falls back to the FIRST tab, never throws', () => {
  expect(() => filePackageTabs(brainPackage(), 'themes/deleted.md')).not.toThrow();
  const state = filePackageTabs(brainPackage(), 'themes/deleted.md');
  expect(state.activeIndex).toBe(0);
  expect(state.tabs[0]!.path).toBe('themes/acceptance-gate-design.md');
});

test('R09: no preferredPath at all is unchanged — activeIndex 0 (AT-57 still holds), and an empty package with a preferredPath is still -1 and still does not throw', () => {
  expect(filePackageTabs(brainPackage()).activeIndex).toBe(0);
  expect(() => filePackageTabs([], 'themes/antipatterns.md')).not.toThrow();
  expect(filePackageTabs([], 'themes/antipatterns.md').activeIndex).toBe(-1);
});
