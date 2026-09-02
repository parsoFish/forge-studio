/**
 * Shared fixtures for the `kb-drain-edit-soundness` regression suite.
 *
 * Split out of `kb-drain-edit-soundness.test.ts` (866 lines) in M4, and the
 * reason it exists is what a line-range cut would have got wrong. The file marks
 * its own boundary with a "Cross-cutting invariants" comment, and that boundary
 * is right — but `plantRealEdit1` and `plantRealEdit2` are NOT confined to the
 * half they are named after. They are the suite's general-purpose KB fixtures,
 * realistic precisely because they are the two literal 2026-08-22 production
 * diffs, and roughly nine in ten of the INVARIANTS tests build their world with
 * them. Cutting at the section comment and leaving them behind breaks thirteen
 * tests on the other side.
 *
 * `roots` and its `process.on('exit')` cleanup live here once. Duplicated per
 * file, whichever copy lacked the handler would leak every tmpdir its tests
 * create — no crash, no red test, just an accumulating `/tmp`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { classifyKbEdit, type KbEditChange } from '../../../kb-drain-structural.ts';
import { buildKbEditSoundnessCtx, type KbEditSoundnessCtx } from '../../../kb-drain-edit-soundness.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

export const roots: string[] = [];

export function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'w8b2-soundness-'));
  roots.push(root);
  return root;
}

process.on('exit', () => {
  for (const r of roots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

export function writeTheme(forgeRoot: string, relFromBrain: string, body: string): string {
  const abs = join(forgeRoot, 'brain', relFromBrain);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
  return abs;
}

export function themeStub(title: string): string {
  return [
    '---',
    `title: ${title}`,
    'category: pattern',
    'created_at: 2026-01-01T00:00:00.000Z',
    'updated_at: 2026-01-01T00:00:00.000Z',
    '---',
    '',
    `# ${title}`,
    '',
  ].join('\n');
}

export function change(relPath: string, before: string | null, after: string | null): KbEditChange {
  return { relPath, before, after, klass: classifyKbEdit(relPath, before, after) };
}

// ===========================================================================
// REAL EDIT 1 — the gitpulse `related_themes` edge deletion (2026-08-22).
//
// Verbatim from the operator's own tree:
//   brain/projects/gitpulse/themes/2026-06-21-gitignored-scratch-files-recurrence.md
//   -related_themes: [2026-06-21-gitignored-scratch-files-double-commit, 2026-06-22-gitignored-scratch-file-third-cycle]
//   +related_themes: [2026-06-22-gitignored-scratch-file-third-cycle]
//
// The removed target EXISTS, in the same directory, and has since 2026-06-21.
// `checkDanglingEdges` never asked for this deletion — its slug universe is
// brain-wide and resolves the target fine. The drain deleted it anyway and the
// structural gate waved it through as "frontmatter-only".
// ===========================================================================

export const REAL_EDIT_1_BEFORE = [
  '---',
  'title: Gitignored scratch files, recurrence',
  'category: antipattern',
  'keywords:',
  '  - gitignore',
  '  - scratch-files',
  '  - chore-commit',
  '  - repeated-actions',
  '  - skill-fix-not-applied',
  'related_themes: [2026-06-21-gitignored-scratch-files-double-commit, 2026-06-22-gitignored-scratch-file-third-cycle]',
  'created_at: 2026-06-21T00:00:00.000Z',
  'updated_at: 2026-06-21T00:00:00.000Z',
  '---',
  '',
  '# Gitignored scratch files, recurrence',
  '',
  'The same scratch-file commit happened again.',
  '',
].join('\n');

export const REAL_EDIT_1_AFTER = REAL_EDIT_1_BEFORE.replace(
  'related_themes: [2026-06-21-gitignored-scratch-files-double-commit, 2026-06-22-gitignored-scratch-file-third-cycle]',
  'related_themes: [2026-06-22-gitignored-scratch-file-third-cycle]',
);

export const EDIT_1_REL = 'themes/2026-06-21-gitignored-scratch-files-recurrence.md';

/** Plants the gitpulse KB exactly as it stood: the edited theme plus BOTH
 *  related targets as real files in the same directory. */
export function plantRealEdit1(): { forgeRoot: string; brainDir: string; ctx: KbEditSoundnessCtx } {
  const forgeRoot = newRoot();
  writeTheme(forgeRoot, `projects/gitpulse/${EDIT_1_REL}`, REAL_EDIT_1_BEFORE);
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-21-gitignored-scratch-files-double-commit.md', themeStub('Double commit'));
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-22-gitignored-scratch-file-third-cycle.md', themeStub('Third cycle'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'gitpulse');
  return { forgeRoot, brainDir, ctx: buildKbEditSoundnessCtx(forgeRoot, brainDir) };
}

// ===========================================================================
// REAL EDIT 2 — the trafficGame dead-link "repair" (2026-08-22).
//
// Verbatim from the operator's own tree:
//   brain/projects/trafficGame/themes/2026-05-23-grading-frontier-infrastructure.md
//   -[eval-driven development](../../../forge/themes/eval-driven-development.md)
//   +[eval-driven development](../../themes/eval-driven-development.md)
//
// `brain/forge/` does not exist — and neither does `brain/projects/themes/`.
// A dead link was exchanged for a DIFFERENT dead link and the finding was
// reported cleared. The real target is brain/cycles/themes/eval-driven-development.md,
// i.e. `../../../cycles/themes/eval-driven-development.md` from this file.
// ===========================================================================

export const EDIT_2_REL = 'themes/2026-05-23-grading-frontier-infrastructure.md';
export const EDIT_2_BAD_OLD = '../../../forge/themes/eval-driven-development.md';
export const EDIT_2_BAD_NEW = '../../themes/eval-driven-development.md';
export const EDIT_2_REAL = '../../../cycles/themes/eval-driven-development.md';

export function edit2Body(target: string): string {
  return [
    '---',
    'title: Grading frontier infrastructure',
    'category: pattern',
    'created_at: 2026-05-23T00:00:00.000Z',
    'updated_at: 2026-05-23T00:00:00.000Z',
    '---',
    '',
    '# Grading frontier infrastructure',
    '',
    '## Why this layer works',
    '',
    'The grading-frontier layer is the project-local instance of forge\'s',
    `[eval-driven development](${target})`,
    'principle. Before it existed, the operator had to:',
    '',
    '- Hand-draw each design',
    '',
  ].join('\n');
}

export const REAL_EDIT_2_BEFORE = edit2Body(EDIT_2_BAD_OLD);
export const REAL_EDIT_2_AFTER = edit2Body(EDIT_2_BAD_NEW);

export function plantRealEdit2(): { forgeRoot: string; brainDir: string; ctx: KbEditSoundnessCtx } {
  const forgeRoot = newRoot();
  writeTheme(forgeRoot, `projects/trafficGame/${EDIT_2_REL}`, REAL_EDIT_2_BEFORE);
  writeTheme(forgeRoot, 'cycles/themes/eval-driven-development.md', themeStub('Eval-driven development'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'trafficGame');
  return { forgeRoot, brainDir, ctx: buildKbEditSoundnessCtx(forgeRoot, brainDir) };
}
