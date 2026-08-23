/**
 * Acceptance tests for the drain's EDIT-SOUNDNESS audit (W8-B2, forge-d8l /
 * knowledge-36 / forge-6gu).
 *
 * WHICH WRONG IMPLEMENTATION THESE KILL. Before this module existed, the
 * drain's only gate was `classifyKbEdit` (cli/kb-drain-structural.ts) — a
 * purely SYNTACTIC class:
 *
 *   - `frontmatter-only change → structural`  ⇒ a `related_themes` edge
 *     DELETION landed unattended, no diff, no draft, no undo;
 *   - `body change that is link-target-only → structural` ⇒ a link repointed
 *     at a target that ALSO does not exist landed unattended and was reported
 *     cleared.
 *
 * Both shapes were observed on the operator's real tree on 2026-08-22 and are
 * replayed verbatim below as `REAL_EDIT_1` / `REAL_EDIT_2`. A test that only
 * asserted "the change classifies structural" would look identical whether or
 * not the soundness audit exists — so every assertion here is on the AUDIT's
 * verdict and, for the drain-level pins (cli/bridge-studio-kb-drain.test.ts),
 * on the on-disk ARTIFACT being byte-unchanged.
 *
 * The two real diffs are COPIED IN as literal fixtures. They are deliberately
 * NOT read from the campaign directory that preserved them: campaign dirs are
 * gitignored, so a test citing one is a dangling reference the moment the
 * campaign is archived.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';

import { classifyKbEdit, type KbEditChange } from './kb-drain-structural.ts';
import {
  auditKbEdit,
  auditKbEdits,
  repairKbEdit,
  isUnsound,
  buildKbEditSoundnessCtx,
  type KbEditSoundnessCtx,
} from './kb-drain-edit-soundness.ts';
import { collectThemeSlugTargets } from './brain-lint.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const roots: string[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'w8b2-soundness-'));
  roots.push(root);
  return root;
}

process.on('exit', () => {
  for (const r of roots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function writeTheme(forgeRoot: string, relFromBrain: string, body: string): string {
  const abs = join(forgeRoot, 'brain', relFromBrain);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
  return abs;
}

function themeStub(title: string): string {
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

function change(relPath: string, before: string | null, after: string | null): KbEditChange {
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

const REAL_EDIT_1_BEFORE = [
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

const REAL_EDIT_1_AFTER = REAL_EDIT_1_BEFORE.replace(
  'related_themes: [2026-06-21-gitignored-scratch-files-double-commit, 2026-06-22-gitignored-scratch-file-third-cycle]',
  'related_themes: [2026-06-22-gitignored-scratch-file-third-cycle]',
);

const EDIT_1_REL = 'themes/2026-06-21-gitignored-scratch-files-recurrence.md';

/** Plants the gitpulse KB exactly as it stood: the edited theme plus BOTH
 *  related targets as real files in the same directory. */
function plantRealEdit1(): { forgeRoot: string; brainDir: string; ctx: KbEditSoundnessCtx } {
  const forgeRoot = newRoot();
  writeTheme(forgeRoot, `projects/gitpulse/${EDIT_1_REL}`, REAL_EDIT_1_BEFORE);
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-21-gitignored-scratch-files-double-commit.md', themeStub('Double commit'));
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-22-gitignored-scratch-file-third-cycle.md', themeStub('Third cycle'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'gitpulse');
  return { forgeRoot, brainDir, ctx: buildKbEditSoundnessCtx(forgeRoot, brainDir) };
}

test('REAL EDIT 1 (gitpulse, 2026-08-22): the structural gate ALONE classifies the edge deletion as structural — which is exactly how it landed', () => {
  const c = change(EDIT_1_REL, REAL_EDIT_1_BEFORE, REAL_EDIT_1_AFTER);
  assert.equal(c.klass, 'structural', 'pins the pre-fix behaviour this lane exists to close');
});

test('REAL EDIT 1: the soundness audit REFUSES it — a related_themes entry whose target resolves may not be deleted', () => {
  const { ctx } = plantRealEdit1();
  const found = auditKbEdit(change(EDIT_1_REL, REAL_EDIT_1_BEFORE, REAL_EDIT_1_AFTER), ctx);
  assert.equal(found.length, 1, `expected exactly one unsoundness, got ${JSON.stringify(found)}`);
  assert.equal(found[0].kind, 'edge-deleted');
  assert.equal(found[0].target, '2026-06-21-gitignored-scratch-files-double-commit');
  assert.equal(found[0].repairTargets.length, 1);
  assert.match(found[0].repairTargets[0], /2026-06-21-gitignored-scratch-files-double-commit\.md$/);
  assert.equal(isUnsound(found), true);
});

test('REAL EDIT 1: refusal PRESERVES the edge — there is nothing to synthesize, `before` already carries it', () => {
  const { ctx } = plantRealEdit1();
  const c = change(EDIT_1_REL, REAL_EDIT_1_BEFORE, REAL_EDIT_1_AFTER);
  const found = auditKbEdit(c, ctx);
  // A repair is only ever synthesized where reverting alone would leave a
  // genuinely dead link. Reverting an edge deletion restores the edge, so the
  // audit deliberately offers no synthesized content here.
  assert.equal(repairKbEdit(c, found, ctx), null);
});

test('a related_themes deletion whose target resolves NOWHERE is SOUND (the 2026-08-22 forge-dev deletion was correct)', () => {
  const forgeRoot = newRoot();
  const before = REAL_EDIT_1_BEFORE.replace(
    '2026-06-21-gitignored-scratch-files-double-commit',
    'forge-current-architecture-as-built',
  );
  const after = before.replace('related_themes: [forge-current-architecture-as-built, 2026-06-22-gitignored-scratch-file-third-cycle]', 'related_themes: [2026-06-22-gitignored-scratch-file-third-cycle]');
  writeTheme(forgeRoot, `projects/gitpulse/${EDIT_1_REL}`, before);
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-22-gitignored-scratch-file-third-cycle.md', themeStub('Third cycle'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'gitpulse');
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  assert.deepEqual(auditKbEdit(change(EDIT_1_REL, before, after), ctx), []);
});

test('the edge-deletion audit resolves BRAIN-WIDE, not per-sub-wiki — a cycles target for a projects theme is still a valid edge', () => {
  const forgeRoot = newRoot();
  const before = REAL_EDIT_1_BEFORE.replace(
    '2026-06-21-gitignored-scratch-files-double-commit',
    'eval-driven-development',
  );
  const after = before.replace(/related_themes: \[[^\]]*\]/, 'related_themes: [2026-06-22-gitignored-scratch-file-third-cycle]');
  writeTheme(forgeRoot, `projects/gitpulse/${EDIT_1_REL}`, before);
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-22-gitignored-scratch-file-third-cycle.md', themeStub('Third cycle'));
  writeTheme(forgeRoot, 'cycles/themes/eval-driven-development.md', themeStub('Eval-driven development'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'gitpulse');
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const found = auditKbEdit(change(EDIT_1_REL, before, after), ctx);
  assert.equal(found.length, 1);
  assert.equal(found[0].target, 'eval-driven-development');
});

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

const EDIT_2_REL = 'themes/2026-05-23-grading-frontier-infrastructure.md';
const EDIT_2_BAD_OLD = '../../../forge/themes/eval-driven-development.md';
const EDIT_2_BAD_NEW = '../../themes/eval-driven-development.md';
const EDIT_2_REAL = '../../../cycles/themes/eval-driven-development.md';

function edit2Body(target: string): string {
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

const REAL_EDIT_2_BEFORE = edit2Body(EDIT_2_BAD_OLD);
const REAL_EDIT_2_AFTER = edit2Body(EDIT_2_BAD_NEW);

function plantRealEdit2(): { forgeRoot: string; brainDir: string; ctx: KbEditSoundnessCtx } {
  const forgeRoot = newRoot();
  writeTheme(forgeRoot, `projects/trafficGame/${EDIT_2_REL}`, REAL_EDIT_2_BEFORE);
  writeTheme(forgeRoot, 'cycles/themes/eval-driven-development.md', themeStub('Eval-driven development'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'trafficGame');
  return { forgeRoot, brainDir, ctx: buildKbEditSoundnessCtx(forgeRoot, brainDir) };
}

test('REAL EDIT 2 (trafficGame, 2026-08-22): the structural gate ALONE classifies the dead-for-dead repoint as structural', () => {
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, REAL_EDIT_2_AFTER);
  assert.equal(c.klass, 'structural', 'pins the pre-fix behaviour: link-target-only ⇒ structural ⇒ landed');
});

test('REAL EDIT 2: the audit REFUSES a repoint whose new target does not resolve', () => {
  const { ctx } = plantRealEdit2();
  const found = auditKbEdit(change(EDIT_2_REL, REAL_EDIT_2_BEFORE, REAL_EDIT_2_AFTER), ctx);
  assert.equal(found.length, 1, `expected exactly one unsoundness, got ${JSON.stringify(found)}`);
  assert.equal(found[0].kind, 'link-repoint-unresolved');
  assert.equal(found[0].target, EDIT_2_BAD_NEW);
  assert.equal(found[0].repairTargets.length, 1);
  assert.match(found[0].repairTargets[0], /brain[/\\]cycles[/\\]themes[/\\]eval-driven-development\.md$/);
});

test('REAL EDIT 2: the audit REPAIRS rather than deletes — the synthesized content points at the theme that really exists', () => {
  const { brainDir, ctx } = plantRealEdit2();
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, REAL_EDIT_2_AFTER);
  const repaired = repairKbEdit(c, auditKbEdit(c, ctx), ctx);
  assert.ok(repaired !== null, 'a unique resolvable target exists, so a repair must be synthesized');
  assert.ok(repaired.includes(`[eval-driven development](${EDIT_2_REAL})`), `repaired body should point at ${EDIT_2_REAL}, got:\n${repaired}`);
  assert.ok(!repaired.includes(EDIT_2_BAD_NEW), 'the dead target must be gone');
  // The link the repair produced must actually resolve on disk from the
  // edited file's own directory — the assertion the drain never made.
  const abs = resolve(dirname(join(brainDir, EDIT_2_REL)), EDIT_2_REAL);
  assert.equal(existsSync(abs), true);
  // And the repair is SOUND by re-audit: the fix may not re-ship the defect.
  assert.deepEqual(auditKbEdit(change(EDIT_2_REL, REAL_EDIT_2_BEFORE, repaired), ctx), []);
});

// A link DELETION inside a theme BODY is already refused one layer up: it
// changes the normalized body (`[t](#)` → `t`), so `classifyKbEdit` calls it
// prose and the pre-existing gate reverts it. Naming that explicitly, so the
// pass below is not mistaken for the soundness audit doing the work — the
// REACHABLE structural link deletion is on an INDEX page, which
// `classifyKbEdit` waves through unconditionally, and that is what the two
// tests after it pin.
test('a link deletion in a theme BODY is already prose-gated by classifyKbEdit — the audit deliberately adds nothing there', () => {
  const { ctx } = plantRealEdit2();
  const deleted = REAL_EDIT_2_BEFORE.replace(`[eval-driven development](${EDIT_2_BAD_OLD})`, 'eval-driven development');
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, deleted);
  assert.equal(c.klass, 'prose', 'the pre-existing gate, not the audit, is what refuses this shape');
  assert.deepEqual(auditKbEdit(c, ctx), []);
});

const INDEX_REL = 'themes/README.md';
const INDEX_BEFORE = [
  '# Themes',
  '',
  '- [Eval-driven development](../../../cycles/themes/eval-driven-development.md)',
  '- [Grading frontier infrastructure](./2026-05-23-grading-frontier-infrastructure.md)',
  '',
].join('\n');

test('INDEX PAGE: deleting a listing link whose target resolves is REFUSED — classifyKbEdit calls every index edit structural, so nothing else catches it', () => {
  const { ctx } = plantRealEdit2();
  const after = INDEX_BEFORE.replace('- [Eval-driven development](../../../cycles/themes/eval-driven-development.md)\n', '');
  const c = change(INDEX_REL, INDEX_BEFORE, after);
  assert.equal(c.klass, 'structural', 'index pages bypass the body comparison entirely');
  const found = auditKbEdit(c, ctx);
  assert.equal(found.length, 1, `expected exactly one unsoundness, got ${JSON.stringify(found)}`);
  assert.equal(found[0].kind, 'link-deleted');
  assert.equal(found[0].target, '../../../cycles/themes/eval-driven-development.md');
  assert.equal(found[0].repairTargets.length, 1);
});

test('INDEX PAGE: deleting a listing link whose target resolves NOWHERE is SOUND (a genuinely dead listing may go)', () => {
  const { ctx } = plantRealEdit2();
  const before = INDEX_BEFORE.replace('../../../cycles/themes/eval-driven-development.md', '../../../gone/themes/deleted-theme.md');
  const after = before.replace(/^- \[Eval-driven development\].*\n/m, '');
  assert.deepEqual(auditKbEdit(change(INDEX_REL, before, after), ctx), []);
});

test('a repoint between two targets that BOTH resolve is not reported as a deletion — the link count never dropped', () => {
  const { forgeRoot, brainDir } = plantRealEdit2();
  writeTheme(forgeRoot, 'cycles/themes/another-real-theme.md', themeStub('Another real theme'));
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const before = edit2Body(EDIT_2_REAL);
  const after = edit2Body('../../../cycles/themes/another-real-theme.md');
  assert.deepEqual(auditKbEdit(change(EDIT_2_REL, before, after), ctx), []);
});

test('a repoint at a target that DOES resolve is SOUND and needs no repair (the honest fix path stays open)', () => {
  const { ctx } = plantRealEdit2();
  const good = edit2Body(EDIT_2_REAL);
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, good);
  assert.deepEqual(auditKbEdit(c, ctx), []);
  assert.equal(repairKbEdit(c, [], ctx), null);
});

test('an unresolved repoint with NO resolvable target anywhere is refused with an empty repair set (never a fabricated repair)', () => {
  const { ctx } = plantRealEdit2();
  const after = edit2Body('../../../nowhere/themes/no-such-theme.md');
  const found = auditKbEdit(change(EDIT_2_REL, REAL_EDIT_2_BEFORE, after), ctx);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'link-repoint-unresolved');
  assert.deepEqual(found[0].repairTargets, []);
  assert.equal(repairKbEdit(change(EDIT_2_REL, REAL_EDIT_2_BEFORE, after), found, ctx), null);
});

test('an unresolved repoint with TWO candidate targets is refused and NOT auto-repaired — the drain never guesses between them', () => {
  const forgeRoot = newRoot();
  writeTheme(forgeRoot, `projects/trafficGame/${EDIT_2_REL}`, REAL_EDIT_2_BEFORE);
  writeTheme(forgeRoot, 'cycles/themes/eval-driven-development.md', themeStub('Eval-driven development'));
  writeTheme(forgeRoot, 'forge-dev/themes/eval-driven-development.md', themeStub('Eval-driven development'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'trafficGame');
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, REAL_EDIT_2_AFTER);
  const found = auditKbEdit(c, ctx);
  assert.equal(found.length, 1);
  assert.equal(found[0].repairTargets.length, 2);
  assert.equal(repairKbEdit(c, found, ctx), null, 'two candidates ⇒ no unique repair ⇒ refuse, do not guess');
});

// ---------------------------------------------------------------------------
// Cross-cutting invariants
// ---------------------------------------------------------------------------

test('a PROSE change is out of the audit\'s remit — the structural gate already refuses it (no double-handling)', () => {
  const { ctx } = plantRealEdit1();
  const after = REAL_EDIT_1_BEFORE.replace('The same scratch-file commit happened again.', 'Rewritten prose.');
  const c = change(EDIT_1_REL, REAL_EDIT_1_BEFORE, after);
  assert.equal(c.klass, 'prose');
  // The audit still reports nothing UNSOUND — prose is gated by class, and a
  // finding must never be double-counted as both prose and unsound.
  assert.deepEqual(auditKbEdit(c, ctx), []);
});

test('a created or deleted FILE is never audited for soundness (the structural gate already refuses both)', () => {
  const { ctx } = plantRealEdit1();
  assert.deepEqual(auditKbEdit(change(EDIT_1_REL, null, REAL_EDIT_1_AFTER), ctx), []);
  assert.deepEqual(auditKbEdit(change(EDIT_1_REL, REAL_EDIT_1_BEFORE, null), ctx), []);
});

test('auditKbEdits aggregates across changes and isUnsound is true iff at least one row is present', () => {
  const { ctx } = plantRealEdit1();
  const sound = change(EDIT_1_REL, REAL_EDIT_1_BEFORE, REAL_EDIT_1_BEFORE.replace('Rewritten', 'x'));
  const unsoundChange = change(EDIT_1_REL, REAL_EDIT_1_BEFORE, REAL_EDIT_1_AFTER);
  assert.equal(isUnsound(auditKbEdits([sound], ctx)), false);
  assert.equal(isUnsound(auditKbEdits([sound, unsoundChange], ctx)), true);
  assert.equal(auditKbEdits([unsoundChange, unsoundChange], ctx).length, 2);
});

test('the audit\'s slug universe is the SAME derivation checkDanglingEdges lints against — one walk, not two', () => {
  const { forgeRoot, brainDir } = plantRealEdit1();
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const lintUniverse = collectThemeSlugTargets(join(forgeRoot, 'brain'));
  assert.deepEqual([...ctx.themeTargets.keys()].sort(), [...lintUniverse.keys()].sort());
});

test('a wikilink repointed at a slug that resolves to no theme is refused', () => {
  const { ctx } = plantRealEdit2();
  const before = edit2Body(EDIT_2_REAL).replace('- Hand-draw each design', '- See [[eval-driven-development]]');
  const after = before.replace('[[eval-driven-development]]', '[[no-such-theme-anywhere]]');
  const found = auditKbEdit(change(EDIT_2_REL, before, after), ctx);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'link-repoint-unresolved');
  assert.equal(found[0].target, 'no-such-theme-anywhere');
});

test('http(s) and anchor-only link targets are never audited (they resolve off-disk by construction)', () => {
  const { ctx } = plantRealEdit2();
  const before = edit2Body(EDIT_2_REAL);
  const after = before.replace(`(${EDIT_2_REAL})`, '(https://example.invalid/eval)');
  // Repointing an on-disk link at an external URL is a CONTENT decision the
  // drain has no basis to make, but it is not a resolution failure — the audit
  // reports the removal of the on-disk link it can still repair, and nothing
  // about the http target itself.
  const found = auditKbEdit(change(EDIT_2_REL, before, after), ctx);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'link-deleted');
  assert.equal(found[0].target, EDIT_2_REAL);
});

// ---------------------------------------------------------------------------
// Containment — a link target is text an AGENT wrote.
//
// [exec] escapes, executed, with byte-level assertions on the outside file.
// A theme legitimately links anywhere inside the repo, so `forgeRoot` is the
// containment root, not `brain/`.
// ---------------------------------------------------------------------------

test('[exec] a link target that climbs OUT of forgeRoot is treated as unresolvable — the probe is contained, not trusted', () => {
  const { forgeRoot, brainDir, ctx } = plantRealEdit2();
  // A real file OUTSIDE the repo, which genuinely exists.
  const outside = mkdtempSync(join(tmpdir(), 'w8b2-outside-'));
  roots.push(outside);
  const secretPath = join(outside, 'secret.md');
  writeFileSync(secretPath, 'outside content\n', 'utf8');
  const before = readFileSync(secretPath, 'utf8');

  const escape = relative(dirname(join(brainDir, EDIT_2_REL)), secretPath).split(/[\\/]/).join('/');
  const after = edit2Body(escape);
  const found = auditKbEdit(change(EDIT_2_REL, REAL_EDIT_2_BEFORE, after), ctx);
  // The escaping target must be REFUSED, not accepted because the file exists.
  assert.equal(found.length, 1, `expected the escape to be refused, got ${JSON.stringify(found)}`);
  assert.equal(found[0].kind, 'link-repoint-unresolved');
  assert.equal(found[0].target, escape);
  // The guard must have been what rejected it: the file really is there.
  assert.equal(existsSync(secretPath), true);
  // And nothing outside was touched.
  assert.equal(readFileSync(secretPath, 'utf8'), before);
  void forgeRoot;
});

test('[exec] escape-and-return still resolves — containment must not reject a legitimate repo-internal link that uses ..', () => {
  const { forgeRoot, brainDir } = plantRealEdit2();
  // A real repo-internal target OUTSIDE brain/ — themes cite docs/ and _logs/
  // paths for real (checkStaleness exists precisely because they do).
  mkdirSync(join(forgeRoot, 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(forgeRoot, 'docs', 'decisions', '035-x.md'), '# adr\n');
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const target = relative(dirname(join(brainDir, EDIT_2_REL)), join(forgeRoot, 'docs', 'decisions', '035-x.md')).split(/[\\/]/).join('/');
  assert.match(target, /\.\./, 'the fixture must genuinely traverse upward, or it proves nothing');
  assert.deepEqual(auditKbEdit(change(EDIT_2_REL, REAL_EDIT_2_BEFORE, edit2Body(target)), ctx), []);
});
