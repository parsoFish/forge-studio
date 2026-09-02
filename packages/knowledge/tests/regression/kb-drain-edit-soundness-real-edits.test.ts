/**
 * The two REAL edits, replayed — plus the index-page shapes of the same defect.
 *
 * These cases are why the soundness gate exists: a gitpulse edge deletion and a
 * trafficGame dead-for-dead repoint, both 2026-08-22, both of which the
 * STRUCTURAL gate alone classified as landable. Each test states what the
 * structural gate said and what the audit must say instead.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

import { auditKbEdit, repairKbEdit, isUnsound, buildKbEditSoundnessCtx } from '../../kb-drain-edit-soundness.ts';
import {
  newRoot,
  writeTheme,
  themeStub,
  change,
  plantRealEdit1,
  plantRealEdit2,
  REAL_EDIT_1_BEFORE,
  REAL_EDIT_1_AFTER,
  EDIT_1_REL,
  EDIT_2_REL,
  EDIT_2_BAD_OLD,
  EDIT_2_BAD_NEW,
  EDIT_2_REAL,
  edit2Body,
  REAL_EDIT_2_BEFORE,
  REAL_EDIT_2_AFTER,
} from './test-fixtures/kb-drain-edit-soundness.ts';


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
// W8-F1 INVERTED. This test used to assert `auditKbEdit` returns [] here,
// "because classifyKbEdit already prose-gates it". That reasoning was the
// S1-a escape written down as an acceptance criterion: the prose gate is the
// DRAIN's policy, and the two operator-clicked callers (`forge brain fix`,
// `runBrainConsolidateNow`) do not have it. The audit now answers the
// soundness question for every edit, whatever its class; who reverts and who
// drafts is decided one layer up.
test('W8-F1: a link deletion in a theme BODY is refused by the AUDIT — being prose-classified is not a pass', () => {
  const { ctx } = plantRealEdit2();
  const deleted = REAL_EDIT_2_BEFORE.replace(`[eval-driven development](${EDIT_2_BAD_OLD})`, 'eval-driven development');
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, deleted);
  assert.equal(c.klass, 'prose', 'the fixture is prose-classified — that used to be the whole escape');
  const found = auditKbEdit(c, ctx);
  assert.ok(found.length > 0, `a body link deletion must be audited on its merits — got ${JSON.stringify(found)}`);
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

test('silently repointing a WORKING link at a DIFFERENT real theme is REFUSED — the same destruction is refused in frontmatter, so it must be refused in the body', () => {
  // This expectation CHANGED in adversarial round 1, and the old one was
  // wrong. It asserted that a repoint between two real targets is fine
  // "because the link count never dropped" — but the count is per FILE, and
  // the edge that was destroyed is per SLUG. `related_themes: [beta, gamma]`
  // -> `[gamma, gamma]` was already refused by the frontmatter path; the
  // identical destruction in the body was accepted. One edit, two verdicts,
  // decided by which half of the file it lived in.
  const { forgeRoot, brainDir } = plantRealEdit2();
  writeTheme(forgeRoot, 'cycles/themes/another-real-theme.md', themeStub('Another real theme'));
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const before = edit2Body(EDIT_2_REAL);
  const after = edit2Body('../../../cycles/themes/another-real-theme.md');
  const found = auditKbEdit(change(EDIT_2_REL, before, after), ctx);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].kind, 'link-deleted');
  assert.equal(found[0].target, EDIT_2_REAL);
});

test('INDEX PAGE: dropping every real theme link while adding the same number of self-links is REFUSED — a net-count budget could not see this', () => {
  // Adversarial round 1: the first cut capped deletions at the drop in TOTAL
  // link count, so deleting three real listings and adding three self-links
  // reported nothing at all. Slug pairing sees three lost slugs.
  const { ctx } = plantRealEdit2();
  const after = [
    '# Themes',
    '',
    '- [Eval-driven development](./README.md)',
    '- [Grading frontier infrastructure](./README.md)',
    '',
  ].join('\n');
  const found = auditKbEdit(change(INDEX_REL, INDEX_BEFORE, after), ctx);
  const deleted = found.filter((u) => u.kind === 'link-deleted').map((u) => u.target).sort();
  assert.deepEqual(deleted, [
    '../../../cycles/themes/eval-driven-development.md',
    './2026-05-23-grading-frontier-infrastructure.md',
  ], `both lost listings must be reported — got ${JSON.stringify(found)}`);
});

test('a repoint at a target that DOES resolve is SOUND and needs no repair (the honest fix path stays open)', () => {
  const { ctx } = plantRealEdit2();
  const good = edit2Body(EDIT_2_REAL);
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, good);
  assert.deepEqual(auditKbEdit(c, ctx), []);
  assert.equal(repairKbEdit(c, [], ctx), null);
});

test('an unresolved repoint at a DIFFERENT slug is refused twice over — a dead target written, and a repairable edge destroyed', () => {
  const { ctx } = plantRealEdit2();
  const after = edit2Body('../../../nowhere/themes/no-such-theme.md');
  const c = change(EDIT_2_REL, REAL_EDIT_2_BEFORE, after);
  const found = auditKbEdit(c, ctx);
  const kinds = found.map((u) => u.kind).sort();
  assert.deepEqual(kinds, ['link-deleted', 'link-repoint-unresolved'], JSON.stringify(found));
  const unresolved = found.find((u) => u.kind === 'link-repoint-unresolved');
  assert.deepEqual(unresolved?.repairTargets, [], 'nothing named no-such-theme exists — never a fabricated repair');
  // Not every unsoundness is repointable, so no partial repair is synthesized.
  assert.equal(repairKbEdit(c, found, ctx), null);
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
