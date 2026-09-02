/**
 * The cross-cutting invariants: prose-vs-structure, aggregation, the slug
 * universe, wikilinks, http/anchor targets, containment, gray-matter failure,
 * repair anchors, and `guardAgentKbEdits`'s totality.
 *
 * Split at the boundary the original file marks itself. Most of these tests
 * still build their world with `plantRealEdit1`/`plantRealEdit2` from the shared
 * fixtures: the two production diffs are this suite's realistic KB, not merely
 * the subject of the sibling file.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';

import {
  auditKbEdit,
  auditKbEdits,
  repairKbEdit,
  isUnsound,
  buildKbEditSoundnessCtx,
  scanRelatedThemesBlock,
  guardAgentKbEdits,
  snapshotBrainTree,
} from '../../kb-drain-edit-soundness.ts';
import { collectThemeSlugTargets } from '../../brain-lint.ts';
import { parseThemeRaw } from '../../theme-frontmatter.ts';
import {
  roots,
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
} from './test-fixtures/kb-drain-edit-soundness.ts';

// ---------------------------------------------------------------------------
// Cross-cutting invariants
// ---------------------------------------------------------------------------

test('W8-F1: a PROSE change that destroys no graph structure is SOUND — the verdict comes from the graph, never from the class', () => {
  const { ctx } = plantRealEdit1();
  const after = REAL_EDIT_1_BEFORE.replace('The same scratch-file commit happened again.', 'Rewritten prose.');
  const c = change(EDIT_1_REL, REAL_EDIT_1_BEFORE, after);
  assert.equal(c.klass, 'prose');
  // Every related_themes entry and every link survives, so there is nothing
  // unsound to report. The reason this passes is now the ABSENCE of graph
  // damage, not the presence of a class filter — which is exactly the
  // difference the S1-a counter-repro turned on.
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

test('a wikilink repointed at a slug that resolves to no theme is refused — and the real wikilink it replaced counts as destroyed', () => {
  const { ctx } = plantRealEdit2();
  const before = edit2Body(EDIT_2_REAL).replace('- Hand-draw each design', '- See [[eval-driven-development]]');
  const after = before.replace('[[eval-driven-development]]', '[[no-such-theme-anywhere]]');
  const found = auditKbEdit(change(EDIT_2_REL, before, after), ctx);
  assert.deepEqual(found.map((u) => u.kind).sort(), ['link-deleted', 'link-repoint-unresolved'], JSON.stringify(found));
  assert.equal(found.find((u) => u.kind === 'link-repoint-unresolved')?.target, 'no-such-theme-anywhere');
});

test('a wikilink silently repointed from one REAL theme to another REAL theme is refused (symmetry with the markdown-link case)', () => {
  const { forgeRoot, brainDir } = plantRealEdit2();
  writeTheme(forgeRoot, 'cycles/themes/another-real-theme.md', themeStub('Another real theme'));
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const before = edit2Body(EDIT_2_REAL).replace('- Hand-draw each design', '- See [[eval-driven-development]]');
  const after = before.replace('[[eval-driven-development]]', '[[another-real-theme]]');
  const found = auditKbEdit(change(EDIT_2_REL, before, after), ctx);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].kind, 'link-deleted');
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
  // (The paired `link-deleted` is the eval-driven-development edge this repoint
  // also destroyed — correct, and not what this test is about.)
  const escaped = found.filter((u) => u.kind === 'link-repoint-unresolved');
  assert.equal(escaped.length, 1, `expected the escape to be refused, got ${JSON.stringify(found)}`);
  assert.equal(escaped[0].target, escape);
  // The guard must have been what rejected it: the file really is there.
  assert.equal(existsSync(secretPath), true);
  // And nothing outside was touched.
  assert.equal(readFileSync(secretPath, 'utf8'), before);
  void forgeRoot;
});

test('[exec] a legitimate repo-internal link that traverses upward still resolves — containment must not be a guard that rejects everything', () => {
  const { forgeRoot, brainDir } = plantRealEdit2();
  // A real repo-internal target OUTSIDE brain/ — themes cite docs/ and _logs/
  // paths for real (checkStaleness exists precisely because they do). Same
  // SLUG as the dead link it replaces, so this is a pure repoint and the
  // edge-destruction arm is deliberately not in play.
  mkdirSync(join(forgeRoot, 'docs'), { recursive: true });
  writeFileSync(join(forgeRoot, 'docs', `${EDD_SLUG_FIXTURE}.md`), '# moved\n');
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const target = relative(dirname(join(brainDir, EDIT_2_REL)), join(forgeRoot, 'docs', `${EDD_SLUG_FIXTURE}.md`)).split(/[\\/]/).join('/');
  assert.match(target, /\.\./, 'the fixture must genuinely traverse upward, or it proves nothing');
  assert.deepEqual(auditKbEdit(change(EDIT_2_REL, REAL_EDIT_2_BEFORE, edit2Body(target)), ctx), []);
});

const EDD_SLUG_FIXTURE = 'eval-driven-development';

// ---------------------------------------------------------------------------
// The lenient-frontmatter path (adversarial round 1, finding 6).
// ---------------------------------------------------------------------------

test('an edge deletion on a theme whose YAML gray-matter REJECTS is still refused — the lenient fallback must not blind the audit', () => {
  const forgeRoot = newRoot();
  // An unquoted `:` in a description is a real, common theme shape and makes
  // gray-matter throw; parseThemeRaw's line-based fallback then decodes a
  // BLOCK list to '' rather than an array. The first cut saw zero edges here
  // and let the deletion land — this lane's own defect one layer over.
  const head = [
    '---',
    'title: Broken YAML theme',
    'description: A theme: with an unquoted colon, which gray-matter rejects.',
    'category: antipattern',
    'related_themes:',
    '  - 2026-06-21-gitignored-scratch-files-double-commit',
    '  - 2026-06-22-gitignored-scratch-file-third-cycle',
    'created_at: 2026-06-21T00:00:00.000Z',
    'updated_at: 2026-06-21T00:00:00.000Z',
    '---',
    '',
    '# Broken YAML theme',
    '',
  ].join('\n');
  const after = head.replace('  - 2026-06-21-gitignored-scratch-files-double-commit\n', '');
  writeTheme(forgeRoot, `projects/gitpulse/${EDIT_1_REL}`, head);
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-21-gitignored-scratch-files-double-commit.md', themeStub('Double commit'));
  writeTheme(forgeRoot, 'projects/gitpulse/themes/2026-06-22-gitignored-scratch-file-third-cycle.md', themeStub('Third cycle'));
  const brainDir = join(forgeRoot, 'brain', 'projects', 'gitpulse');
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  // Prove the premise rather than assuming it: the structured parse really
  // does fail to yield an array here.
  assert.equal(Array.isArray(parseThemeRaw(head).data.related_themes), false);
  const found = auditKbEdit(change(EDIT_1_REL, head, after), ctx);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].kind, 'edge-deleted');
  assert.equal(found[0].target, '2026-06-21-gitignored-scratch-files-double-commit');
});

test('scanRelatedThemesBlock reads both YAML list shapes and stops at the end of the block', () => {
  assert.deepEqual(scanRelatedThemesBlock('---\nrelated_themes: [a, b.md, "c"]\n---\n'), ['a', 'b', 'c']);
  assert.deepEqual(scanRelatedThemesBlock('---\nrelated_themes:\n  - a\n  - b\ncreated_at: x\n  - not-a-member\n---\n'), ['a', 'b']);
  assert.deepEqual(scanRelatedThemesBlock('---\nrelated_themes: []\n---\n'), []);
  assert.deepEqual(scanRelatedThemesBlock('---\ntitle: no edges\n---\n'), []);
});

// ---------------------------------------------------------------------------
// Repair precision (adversarial round 1, findings 10 + 14).
// ---------------------------------------------------------------------------

test('a repair preserves an #anchor tail — extractLinks strips it, so a literal replacement silently missed every anchored link', () => {
  const { ctx } = plantRealEdit2();
  const before = edit2Body(EDIT_2_BAD_OLD);
  const after = edit2Body(`${EDIT_2_BAD_NEW}#why-this-layer-works`);
  const c = change(EDIT_2_REL, before, after);
  const repaired = repairKbEdit(c, auditKbEdit(c, ctx), ctx);
  assert.ok(repaired !== null, 'an anchored link must still be repairable');
  assert.ok(repaired.includes(`](${EDIT_2_REAL}#why-this-layer-works)`), `the anchor must survive — got:\n${repaired}`);
  assert.deepEqual(auditKbEdit(change(EDIT_2_REL, before, repaired), ctx), []);
});

test('no repair is synthesized when the dead target ALSO appears in `before` — rewriting untouched lines would put unjustified changes in the diff', () => {
  const { ctx } = plantRealEdit2();
  // TWO links, both naming the same slug: one ALREADY at the dead `../../themes/`
  // path (untouched by this turn), one at the older dead `../../../forge/` path.
  // The turn repoints the second onto the first's dead path. A literal
  // whole-file replacement would silently rewrite the untouched link too.
  const before = edit2Body(EDIT_2_BAD_OLD).replace(
    'principle.',
    `principle. See also [the same theme](${EDIT_2_BAD_NEW}).`,
  );
  const after = before.replace(`[eval-driven development](${EDIT_2_BAD_OLD})`, `[eval-driven development](${EDIT_2_BAD_NEW})`);
  const c = change(EDIT_2_REL, before, after);
  assert.equal(c.klass, 'structural', 'link-target-only, so the prose gate is not what refuses this');
  const found = auditKbEdit(c, ctx);
  assert.ok(found.some((u) => u.kind === 'link-repoint-unresolved'), JSON.stringify(found));
  assert.equal(repairKbEdit(c, found, ctx), null, 'the target is already in `before`; repairing would rewrite lines the turn never touched');
});

// ===========================================================================
// W8-F1 — the two SCOPE FILTERS wrapped around the audit (C4 regate, 2×S1).
//
// The C4 hostile re-verification refuted "forge-d8l CANNOT RECUR" with one
// command each. Neither escape is in the audit — the audit resisted every
// shape thrown at it. Both are in the filters around it:
//
//   S1-a  CLASS FILTER. `auditKbEdit` opened `if (klass !== 'structural')
//         return []` and `guardAgentKbEdits` opened `if (c.klass !==
//         'structural') continue`. `classifyKbEdit` demotes an edit to
//         'prose' the moment the body changes — so deleting a real
//         related_themes edge AND rewording one line produced
//         `{unsound:0, refused:0}`, an AFFIRMATIVE all-clear, with the edge
//         gone. The modal agent-tier finding is `length.soft-cap`, whose
//         remediation is definitionally "condense the prose": this is the
//         common case, not a corner.
//
//   S1-b  SNAPSHOT FILTER. The gate snapshotted only the drained KB's own
//         brain dir while the agent runs with `cwd=forgeRoot`. An edge
//         deleted one directory over was never audited — reproduced through
//         the REAL `runKbDrain`.
//
// The cure is structural in both directions: the audit no longer asks what
// CLASS an edit is (class decides draft-vs-auto-apply, never whether
// soundness is checked), and the gate's SCOPE is DERIVED from the kbId it is
// given rather than supplied by the caller — so no call site can re-narrow
// it, which is how both escapes were reachable in the first place.
// ===========================================================================

/** A KB the new gate can resolve: `resolveKbBrainDir` requires a `kb.yaml`. */
function plantKbDescriptor(forgeRoot: string, kbId: string): void {
  const abs = join(forgeRoot, 'brain', 'projects', kbId, 'kb.yaml');
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `id: ${kbId}\nname: ${kbId}\nbinding: { kind: project, ref: ${kbId} }\ndesc: W8-F1 fixture.\n`, 'utf8');
}

test('W8-F1 S1-a: an edge deletion hidden inside a PROSE reword is refused — the audit does not ask what class the edit is', () => {
  const { ctx } = plantRealEdit1();
  // Byte-for-byte the 2026-08-22 edge deletion, PLUS one reworded body line.
  // That single extra line is the whole exploit: it flips `classifyKbEdit`
  // to 'prose' and the pre-W8-F1 audit returned [] for it.
  const after = REAL_EDIT_1_AFTER.replace('The same scratch-file commit happened again.', 'Condensed.');
  const c = change(EDIT_1_REL, REAL_EDIT_1_BEFORE, after);
  assert.equal(c.klass, 'prose', 'the fixture must really be prose-classified, or it proves nothing');
  const found = auditKbEdit(c, ctx);
  assert.equal(found.length, 1, `the reworded line must not buy the edge deletion a pass — got ${JSON.stringify(found)}`);
  assert.equal(found[0].kind, 'edge-deleted');
  assert.equal(found[0].target, '2026-06-21-gitignored-scratch-files-double-commit');
});

test('W8-F1 S1-a: `guardAgentKbEdits` REVERTS that prose+edge-delete edit — the turn-level chokepoint no longer skips non-structural changes', () => {
  const { forgeRoot } = plantRealEdit1();
  plantKbDescriptor(forgeRoot, 'gitpulse');
  const target = join(forgeRoot, 'brain', 'projects', 'gitpulse', EDIT_1_REL);
  const snapshot = snapshotBrainTree(forgeRoot);
  // The agent turn: condense the prose AND drop a resolvable edge.
  writeFileSync(target, REAL_EDIT_1_AFTER.replace('The same scratch-file commit happened again.', 'Condensed.'), 'utf8');
  const gate = guardAgentKbEdits(forgeRoot, 'gitpulse', snapshot);
  assert.equal(gate.unsound.length, 1, `the gate must SEE it — got ${JSON.stringify(gate.unsound)}`);
  assert.equal(gate.refused.length, 1, `the gate must REFUSE it — got ${JSON.stringify(gate.refused.map((c) => c.relPath))}`);
  assert.equal(
    readFileSync(target, 'utf8'),
    REAL_EDIT_1_BEFORE,
    'the file must be byte-identical to its pre-turn content — the edge survives',
  );
});

test('W8-F1 S1-b: an edit OUTSIDE the drained KB\'s brain dir is refused and audited — the snapshot is the whole brain, not one KB', () => {
  const { forgeRoot } = plantRealEdit1();
  plantKbDescriptor(forgeRoot, 'gitpulse');
  // A theme in a DIFFERENT sub-wiki, carrying a resolvable edge. Nothing in
  // the gitpulse drain has any business here — but the agent's cwd is
  // forgeRoot and its Edit tool was unfenced.
  const victimRel = 'cycles/themes/2026-05-01-victim.md';
  const victimBefore = [
    '---',
    'title: Victim',
    'category: pattern',
    'related_themes: [2026-05-01-partner]',
    'created_at: 2026-05-01T00:00:00.000Z',
    'updated_at: 2026-05-01T00:00:00.000Z',
    '---',
    '',
    '# Victim',
    '',
  ].join('\n');
  writeTheme(forgeRoot, victimRel, victimBefore);
  writeTheme(forgeRoot, 'cycles/themes/2026-05-01-partner.md', themeStub('Partner'));
  const victimAbs = join(forgeRoot, 'brain', victimRel);

  const snapshot = snapshotBrainTree(forgeRoot);
  writeFileSync(victimAbs, victimBefore.replace('related_themes: [2026-05-01-partner]', 'related_themes: []'), 'utf8');

  const gate = guardAgentKbEdits(forgeRoot, 'gitpulse', snapshot);
  // The gate SEES it — that is the S1-b fix. The snapshot used to be scoped to
  // the drained KB, so this change was invisible and the audit came back
  // `{unsound:0, refused:0, changes:0}`: an affirmative all-clear with a real
  // edge destroyed.
  assert.ok(
    gate.unsound.some((u) => u.kind === 'out-of-scope-edit'),
    `the audit must SEE and NAME the out-of-KB change — got ${JSON.stringify(gate.unsound)}`,
  );
  assert.ok(
    gate.errors.some((e) => e.includes(victimRel)),
    `and DECLARE that it left the bytes alone, naming the file — got ${JSON.stringify(gate.errors)}`,
  );
  // Deliberately NOT reverted: this gate cannot tell a fence bypass from the
  // reflector writing the brain from the daemon at the same time, and
  // reverting on that evidence would destroy the reflector's work. The WRITE
  // is prevented at the spawn seam — see the canUseTool fence pin in
  // orchestrator/brain-fix-runner.test.ts, which asserts an out-of-KB Edit is
  // DENIED before any byte is written. Detection here, enforcement there.
  assert.equal(gate.refused.length, 0, 'an out-of-scope change is reported, never disposed of');
});

test('W8-F1 S1-b: an out-of-scope edit is refused even when it destroys NOTHING — the drained KB is the only place a turn may write', () => {
  const { forgeRoot } = plantRealEdit1();
  plantKbDescriptor(forgeRoot, 'gitpulse');
  // Pure prose, no edges, no links: sound by every soundness rule there is,
  // and still none of this turn's business. Wave-7's orch-01 lost 26 lines of
  // amendment history to exactly this shape.
  const strayRel = 'forge-dev/themes/2026-05-02-stray.md';
  const strayBefore = themeStub('Stray');
  writeTheme(forgeRoot, strayRel, strayBefore);
  const strayAbs = join(forgeRoot, 'brain', strayRel);
  const snapshot = snapshotBrainTree(forgeRoot);
  writeFileSync(strayAbs, `${strayBefore}\nRewritten by a turn that was pointed at another KB.\n`, 'utf8');

  const gate = guardAgentKbEdits(forgeRoot, 'gitpulse', snapshot);
  assert.ok(
    gate.unsound.some((u) => u.kind === 'out-of-scope-edit'),
    `an out-of-KB PROSE rewrite is out of bounds on scope alone, with nothing to audit — got ${JSON.stringify(gate.unsound)}`,
  );
  assert.equal(gate.refused.length, 0, 'reported, not disposed of — see the sibling test for why');
});

test('W8-F1: an unresolvable kbId refuses EVERY brain edit — "no KB to guard" must never mean "nothing to guard"', () => {
  const { forgeRoot } = plantRealEdit1();
  // No kb.yaml planted: resolveKbBrainDir returns null. The pre-W8-F1 runner
  // skipped the gate entirely in this case (`preTurnSnapshot === null`), so a
  // turn dispatched with a bogus kbId ran completely ungated.
  const target = join(forgeRoot, 'brain', 'projects', 'gitpulse', EDIT_1_REL);
  const snapshot = snapshotBrainTree(forgeRoot);
  writeFileSync(target, REAL_EDIT_1_AFTER, 'utf8');
  const gate = guardAgentKbEdits(forgeRoot, 'no-such-kb', snapshot);
  // Nothing is in scope when the KB does not resolve, so EVERY brain change is
  // reported and the turn cannot report success. The write itself is prevented
  // at the spawn seam: an unresolvable kbId yields an EMPTY writeRoots list,
  // and a write matching no root is denied by the fence.
  assert.ok(gate.unsound.length > 0, `an unresolvable KB must fail CLOSED — got ${JSON.stringify(gate)}`);
  assert.ok(gate.errors.length > 0, JSON.stringify(gate.errors));
});

test('W8-F1: `guardAgentKbEdits` is TOTAL — a change it cannot dispose of is recorded in `errors`, never thrown past the caller', () => {
  const { forgeRoot } = plantRealEdit1();
  plantKbDescriptor(forgeRoot, 'gitpulse');
  const target = join(forgeRoot, 'brain', 'projects', 'gitpulse', EDIT_1_REL);
  const snapshot = snapshotBrainTree(forgeRoot);
  // The reachable trigger for a disposal failure: the turn replaces the theme
  // FILE with a DIRECTORY of the same name, so writing `before` back throws
  // EISDIR. The pre-W8-F1 runner caught that throw, returned `undefined` and
  // left the agent's writes on disk with no error surfaced anywhere.
  rmSync(target, { force: true });
  mkdirSync(target, { recursive: true });
  const gate = guardAgentKbEdits(forgeRoot, 'gitpulse', snapshot);
  assert.ok(gate.errors.length > 0, `an undisposable change must be DECLARED — got ${JSON.stringify(gate)}`);
  assert.ok(
    gate.errors.some((e) => e.includes(EDIT_1_REL)),
    `the error must name the file it could not restore — got ${JSON.stringify(gate.errors)}`,
  );
});

test('W8-F1 CONTROL: a sound in-KB structural edit still LANDS through the derived-scope gate', () => {
  const { forgeRoot } = plantRealEdit1();
  plantKbDescriptor(forgeRoot, 'gitpulse');
  const target = join(forgeRoot, 'brain', 'projects', 'gitpulse', EDIT_1_REL);
  const snapshot = snapshotBrainTree(forgeRoot);
  // Adding a keyword destroys no graph structure. The gate refuses unsound
  // edits, not edits.
  const sound = REAL_EDIT_1_BEFORE.replace('  - gitignore\n', '  - gitignore\n  - added-keyword\n');
  writeFileSync(target, sound, 'utf8');
  const gate = guardAgentKbEdits(forgeRoot, 'gitpulse', snapshot);
  assert.deepEqual(gate.unsound, [], JSON.stringify(gate.unsound));
  assert.deepEqual(gate.refused, [], JSON.stringify(gate.refused.map((c) => c.relPath)));
  assert.deepEqual(gate.errors, []);
  assert.equal(readFileSync(target, 'utf8'), sound, 'a sound edit must survive the gate');
});

test('W8-F1 CONTROL: a sound PROSE edit inside the KB is left on disk by the gate — class decides draft-vs-apply, and that is the DRAIN\'s policy, not the gate\'s', () => {
  const { forgeRoot } = plantRealEdit1();
  plantKbDescriptor(forgeRoot, 'gitpulse');
  const target = join(forgeRoot, 'brain', 'projects', 'gitpulse', EDIT_1_REL);
  const snapshot = snapshotBrainTree(forgeRoot);
  // Prose only: every edge and link survives. The gate has no opinion; the
  // drain reverts-and-drafts it one layer up, and `runBrainConsolidateNow`
  // legitimately rewrites prose for a living.
  const prose = REAL_EDIT_1_BEFORE.replace('The same scratch-file commit happened again.', 'Condensed.');
  writeFileSync(target, prose, 'utf8');
  const gate = guardAgentKbEdits(forgeRoot, 'gitpulse', snapshot);
  assert.deepEqual(gate.unsound, [], JSON.stringify(gate.unsound));
  assert.equal(readFileSync(target, 'utf8'), prose);
  assert.equal(gate.changes.length, 1, 'the change is still REPORTED, so the drain can park it as a draft');
  assert.equal(gate.changes[0].klass, 'prose');
});

test('W8-F1 r2: `guardAgentKbEdits` really is TOTAL — an unreadable brain returns an audit, it does not throw', () => {
  // Adversarial review round 2: `buildKbEditSoundnessCtx` and
  // `resolveKbBrainDir` sat OUTSIDE the gate's try while its doc claimed the
  // function never throws. `collectThemeSlugTargets` does `readdirSync` after
  // `existsSync`, so a `themes` path that is a FILE raises ENOTDIR — and the
  // drain calls this gate BARE, on the strength of that "total" claim.
  const { forgeRoot } = plantRealEdit1();
  plantKbDescriptor(forgeRoot, 'gitpulse');
  const snapshot = snapshotBrainTree(forgeRoot);
  // A sibling sub-wiki whose `themes` is a FILE, not a directory.
  mkdirSync(join(forgeRoot, 'brain', 'cycles'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes'), 'not a directory\n', 'utf8');
  const gate = guardAgentKbEdits(forgeRoot, 'gitpulse', snapshot);
  assert.ok(gate.errors.length > 0, `the failure must be DECLARED, not thrown — got ${JSON.stringify(gate)}`);
  assert.ok(
    gate.errors.some((e) => e.includes('NOTHING was audited')),
    `and must not read as a clean audit — got ${JSON.stringify(gate.errors)}`,
  );
});

test('W8-F1 r2: an edge deletion inside an OPERATOR-CREATED KB (brain/<id>) is refused, exactly like a project-bound one', () => {
  // Found by the adversarial review's own follow-up. `POST /api/studio/kbs`
  // scaffolds a new KB at `brain/<id>/themes/` — neither `cycles`,
  // `forge-dev`, nor under `projects/` — and `collectThemeSlugTargets` walked
  // only those three shapes. Its themes were therefore absent from the audit's
  // slug universe, so `repairsFor()` returned [] and a deletion of a REAL edge
  // read as "a genuinely dangling entry may go".
  //
  // The two halves of this test are the SAME fixture in the two layouts. That
  // is the whole point: the KB an operator creates in Studio was the unsafe
  // one.
  for (const kbRel of ['opkb', 'projects/opkb']) {
    const forgeRoot = newRoot();
    const kbDir = join(forgeRoot, 'brain', ...kbRel.split('/'));
    mkdirSync(join(kbDir, 'themes'), { recursive: true });
    writeFileSync(join(kbDir, 'kb.yaml'), 'id: opkb\nname: opkb\nbinding: { kind: unique }\ndesc: W8-F1 fixture.\n', 'utf8');
    writeFileSync(join(kbDir, 'themes', 'partner.md'), themeStub('partner'), 'utf8');
    const victim = join(kbDir, 'themes', 'x.md');
    const before = themeStub('x').replace('category: pattern', 'category: pattern\nrelated_themes: [partner]');
    writeFileSync(victim, before, 'utf8');

    const snapshot = snapshotBrainTree(forgeRoot);
    writeFileSync(victim, before.replace('related_themes: [partner]', 'related_themes: []'), 'utf8');
    const gate = guardAgentKbEdits(forgeRoot, 'opkb', snapshot);

    assert.ok(
      gate.unsound.some((u) => u.kind === 'edge-deleted'),
      `[brain/${kbRel}] a resolvable edge deletion must be refused — got ${JSON.stringify(gate.unsound)}`,
    );
    assert.equal(readFileSync(victim, 'utf8'), before, `[brain/${kbRel}] the edge must survive on disk`);
  }
});
