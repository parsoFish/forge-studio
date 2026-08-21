/**
 * Pure, kind-agnostic view-state for a file-package tab strip
 * (R3-01-F3/F4, WI-3).
 *
 * SHARED with R2-10-F3 (the interactive session shell's file viewer) — kept
 * deliberately generic: no skill-specific naming, no skill imports, no
 * fetching. A "package" here is just an ordered list of `{path, body}` files;
 * the caller decides what a package means (a skill's SKILL.md + supporting
 * files today, a session's workspace files later).
 *
 * Mirrors the flow-view-state.ts / cycle-grouping.ts testability convention:
 * no DOM, no React, pure functions returning new objects (immutability).
 */

export interface PackageFile {
  path: string;
  body: string;
}

export interface FilePackageTab {
  path: string;
  label: string;
  body: string;
}

export interface FilePackageState {
  tabs: FilePackageTab[];
  activeIndex: number;
}

/** Extension → display-language token map for syntax-hinting the active tab.
 *  Anything not listed (including no-extension files like LICENSE) is 'text'
 *  — never a guess, just the deliberate fallback. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.py': 'python',
  '.rb': 'ruby',
  '.pl': 'perl',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

function labelFor(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] || path;
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return -1;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/** Derive tab view-state from a package's files, in package order (the
 *  backend already orders SKILL.md first for a skill package — this is a
 *  passthrough, never a re-sort).
 *
 *  sessions-kinds-R09 — `preferredPath` (OPTIONAL) selects the tab carrying
 *  THAT path, by VALUE, never by array position. A polling session route
 *  (SessionShell's 3s tick) hands `FilePackage` a brand-new `files` array
 *  every tick, freshly parsed from `res.json()`, even when not one byte
 *  changed — so an operator's tab selection can only survive if it is looked
 *  up by the stable `path` field rather than re-derived from whichever array
 *  reference happened to arrive this tick. Absent, or naming a file no
 *  longer in the package (it was renamed or dropped between ticks), falls
 *  back to the first tab exactly like before — never throws.
 *
 *  This is the same shape as `generationGalleryView`'s already-ratified
 *  `preferredNumber` (lib/session-artifact-view.ts, R4-16 pin 2). */
export function filePackageTabs(files: readonly PackageFile[], preferredPath?: string): FilePackageState {
  const tabs = files.map((f) => ({ path: f.path, label: labelFor(f.path), body: f.body }));
  const preferredIndex = preferredPath === undefined ? -1 : tabs.findIndex((t) => t.path === preferredPath);
  return { tabs, activeIndex: clampIndex(preferredIndex >= 0 ? preferredIndex : 0, tabs.length) };
}

/** Select a tab by index, clamped into range — never throws, and always
 *  returns a NEW state object (immutability). */
export function selectFile(state: FilePackageState, index: number): FilePackageState {
  return { ...state, activeIndex: clampIndex(index, state.tabs.length) };
}

/** Map a file path's extension to a display-language token; unknown → 'text'. */
export function fileLanguage(path: string): string {
  const label = labelFor(path);
  const dot = label.lastIndexOf('.');
  if (dot <= 0) return 'text'; // no extension, or a dotfile with nothing after the leading dot
  const ext = label.slice(dot).toLowerCase();
  return LANGUAGE_BY_EXTENSION[ext] ?? 'text';
}
