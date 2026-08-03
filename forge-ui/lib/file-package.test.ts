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
