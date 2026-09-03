/**
 * THE REGRESSION PROOF (W8-B2).
 *
 * On 2026-08-22 the operator ran drain-to-green by hand across four KBs. It
 * rewrote six `brain/**` themes and left them uncommitted with no surface
 * saying so. Reviewed at the wave-8 open, two of the six were wrong:
 *
 *   1. gitpulse — `2026-06-21-gitignored-scratch-files-recurrence.md` lost the
 *      `related_themes` edge `2026-06-21-gitignored-scratch-files-double-commit`,
 *      whose theme file **exists in the same directory**. Third observed
 *      instance of forge-d8l.
 *   2. trafficGame — `2026-05-23-grading-frontier-infrastructure.md` had a dead
 *      link `../../../forge/themes/eval-driven-development.md` "repaired" to
 *      `../../themes/eval-driven-development.md`, i.e. `brain/projects/themes/`,
 *      **which also does not exist** — and the finding was reported cleared.
 *      A dead link exchanged for a different dead link, glyphed green.
 *
 * Both are replayed here through the REAL `runKbDrain`, with the agent turn
 * stubbed to make exactly the edit the real agent made. The assertions are on
 * the ARTIFACT — the bytes on disk — not on a status code:
 *
 *   - fixture 1: the theme is byte-unchanged. The gate REFUSED the deletion.
 *   - fixture 2: the link points at the theme that really exists. The gate
 *     REPAIRED rather than deleting or accepting the dead-for-dead swap.
 *
 * The diffs these fixtures encode were preserved during the wave-8 open. Their
 * content is copied in here rather than read from that campaign directory:
 * campaign dirs are gitignored, so a test citing one is a dangling reference.
 *
 * PRECISELY what is verbatim, so nobody over-reads this: the EDITS are — the
 * `related_themes` line before and after, and all three
 * `eval-driven-development` link paths (the one that was already dead, the
 * second dead one the drain wrote, and the real target). The surrounding theme
 * prose is synthesized, because these fixtures must lint CLEAN apart from the
 * injected finding or a stray real finding would be mistaken for the fixture's.
 * The byte-for-byte frontmatter of the gitpulse theme is replayed in
 * cli/kb-drain-edit-soundness.test.ts, at the audit level.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runKbDrain } from '../../bridge-studio-kb-drain.ts';
import { noKbEdits } from '../../kb-drain-edit-soundness.ts';
import type { KbDrainFixTurnInput, KbDrainFixTurnResult } from '../../bridge-studio-kb-drain.ts';
// M4 ruling 86 — THE ONE REMAINING knowledge -> sessions edge on the fix turn,
// and it is deliberate. Every other importer took the turn by injection or
// repointed to this package's own port type; this file cannot, because its
// whole purpose is to drive the REAL turn through the seam and prove the edit
// gate runs INSIDE it (see the block comment above `realTurn`). A hand-rolled
// stand-in here would assert that a stand-in behaves, which is what the
// 2026-08-22 defects already did. The row is recorded with this reason rather
// than closed by weakening the test.
import { runBrainFixTurn } from '@forge/sessions/kinds/brain-fix.ts';
import type { Finding } from '../../brain-lint.ts';

// ---------------------------------------------------------------------------
// Fixture scaffolding
// ---------------------------------------------------------------------------

function themeFile(title: string, category: string, extraFrontmatter: string[] = [], body: string[] = []): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} (regression fixture).`,
    `category: ${category}`,
    ...extraFrontmatter,
    'created_at: 2026-06-21T00:00:00.000Z',
    'updated_at: 2026-06-21T00:00:00.000Z',
    '---',
    '',
    `# ${title}`,
    '',
    ...body,
    '',
  ].join('\n');
}

const CATEGORY_INDEX: Record<string, string> = { antipattern: 'antipatterns.md', pattern: 'patterns.md' };

/** A project-bound KB whose own-theme lint is CLEAN apart from what a test
 *  injects — every theme is listed in its category index and every link
 *  resolves, so a stray real finding can never be mistaken for the fixture's. */
function makeKbRoot(kbId: string, themes: Array<{ slug: string; category: string; content: string }>): { root: string; brainDir: string } {
  const root = mkdtempSync(join(tmpdir(), `w8b2-regress-${kbId}-`));
  const brainDir = join(root, 'brain', 'projects', kbId);
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId}\nbinding: { kind: project, ref: ${kbId} }\ndesc: regression fixture.\n`);
  const indexEntries = new Map<string, string[]>();
  for (const t of themes) {
    writeFileSync(join(brainDir, 'themes', `${t.slug}.md`), t.content);
    const idx = CATEGORY_INDEX[t.category];
    if (!idx) continue;
    const list = indexEntries.get(idx) ?? [];
    list.push(`- [${t.slug}](./themes/${t.slug}.md)`);
    indexEntries.set(idx, list);
  }
  for (const [idx, lines] of indexEntries) {
    writeFileSync(join(brainDir, idx), `# ${idx}\n\n${lines.join('\n')}\n`);
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, brainDir };
}

function agentFinding(file: string, check: string, kind: string, message: string): Finding & { check: string; kind: string } {
  return { category: 'flag', file, message, check, kind, resolution: 'agent' };
}

// ===========================================================================
// FIXTURE 1 — the gitpulse related_themes edge deletion.
// ===========================================================================

const GITPULSE_KB = 'gitpulse';
const RECURRENCE_SLUG = '2026-06-21-gitignored-scratch-files-recurrence';
const DOUBLE_COMMIT_SLUG = '2026-06-21-gitignored-scratch-files-double-commit';
const THIRD_CYCLE_SLUG = '2026-06-22-gitignored-scratch-file-third-cycle';

const RECURRENCE_BEFORE = themeFile(
  'Gitignored scratch files, recurrence',
  'antipattern',
  [`related_themes: [${DOUBLE_COMMIT_SLUG}, ${THIRD_CYCLE_SLUG}]`],
  ['The same scratch-file commit happened again.'],
);

/** Byte-for-byte the edit the live drain made on 2026-08-22. */
const RECURRENCE_AFTER_DELETION = RECURRENCE_BEFORE.replace(
  `related_themes: [${DOUBLE_COMMIT_SLUG}, ${THIRD_CYCLE_SLUG}]`,
  `related_themes: [${THIRD_CYCLE_SLUG}]`,
);

test('REGRESSION 1 (gitpulse, 2026-08-22): the drain REFUSES to delete a related_themes edge whose target exists — the theme is byte-unchanged on disk', async () => {
  const { root, brainDir } = makeKbRoot(GITPULSE_KB, [
    { slug: RECURRENCE_SLUG, category: 'antipattern', content: RECURRENCE_BEFORE },
    { slug: DOUBLE_COMMIT_SLUG, category: 'antipattern', content: themeFile('Double commit', 'antipattern') },
    { slug: THIRD_CYCLE_SLUG, category: 'antipattern', content: themeFile('Third cycle', 'antipattern') },
  ]);
  const target = join(brainDir, 'themes', `${RECURRENCE_SLUG}.md`);
  try {
    // The finding the turn was dispatched for is a length flag — NOT an edge
    // finding. Nothing ever asked for the deletion; that is the whole point.
    const finding = agentFinding(target, 'checkLengthSoftCap', 'length.soft-cap', 'theme exceeds the soft line cap');
    let turns = 0;
    const status = await runKbDrain(root, GITPULSE_KB, `${GITPULSE_KB}-drain-r1`, {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: async (input) => {
        turns += 1;
        writeFileSync(target, RECURRENCE_AFTER_DELETION);
        // The agent self-reports success — exactly what the live run did.
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });

    assert.equal(turns > 0, true, 'the turn must actually have run, or this test proves nothing');
    // THE ASSERTION. The artifact, not the status code.
    assert.equal(
      readFileSync(target, 'utf8'),
      RECURRENCE_BEFORE,
      'the valid related_themes edge must survive: the file has to be byte-identical to its pre-turn content',
    );
    assert.notEqual(status.state, 'green', `a refused edit can never end green — got ${JSON.stringify(status)}`);
    // And the row must NOT be glyphed cleared on the agent's say-so.
    const row = status.perFinding.find((f) => f.tier === 'agent');
    assert.ok(row, `expected an agent row — got ${JSON.stringify(status.perFinding)}`);
    assert.notEqual(row.outcome, 'cleared', 'the agent self-reported cleared; the post-fix lint says otherwise');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// FIXTURE 2 — the trafficGame dead-for-dead link "repair".
// ===========================================================================

const TG_KB = 'trafficgame';
const GRADING_SLUG = '2026-05-23-grading-frontier-infrastructure';
const EDD_SLUG = 'eval-driven-development';

/** `brain/forge/` has never existed. */
const TG_DEAD_OLD = `../../../forge/themes/${EDD_SLUG}.md`;
/** `brain/projects/themes/` does not exist either — the live drain's "repair". */
const TG_DEAD_NEW = `../../themes/${EDD_SLUG}.md`;
/** The theme really does exist here. */
const TG_REAL = `../../../cycles/themes/${EDD_SLUG}.md`;

function gradingTheme(target: string): string {
  return themeFile('Grading frontier infrastructure', 'pattern', [], [
    'The grading-frontier layer is the project-local instance of forge\'s',
    `[eval-driven development](${target})`,
    'principle.',
  ]);
}

function makeTrafficGameRoot(): { root: string; brainDir: string } {
  const made = makeKbRoot(TG_KB, [
    { slug: GRADING_SLUG, category: 'pattern', content: gradingTheme(TG_DEAD_OLD) },
  ]);
  // The real target, in a DIFFERENT sub-wiki — the cross-sub-wiki resolution
  // the live drain never performed.
  mkdirSync(join(made.root, 'brain', 'cycles', 'themes'), { recursive: true });
  writeFileSync(join(made.root, 'brain', 'cycles', 'themes', `${EDD_SLUG}.md`), themeFile('Eval-driven development', 'pattern'));
  return made;
}

test('REGRESSION 2 (trafficGame, 2026-08-22): the drain REPAIRS a dead link rather than accepting a dead-for-dead swap — the link resolves after the run', async () => {
  const { root, brainDir } = makeTrafficGameRoot();
  const target = join(brainDir, 'themes', `${GRADING_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkSourceLinks', 'links.broken', `broken link: ${TG_DEAD_OLD}`);
    let turns = 0;
    await runKbDrain(root, TG_KB, `${TG_KB}-drain-r2`, {
      lint: () => ({ findings: turns === 0 ? [finding] : [] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: turns === 0 ? [finding] : [] }),
      runFixTurn: async (input) => {
        turns += 1;
        // The live agent's edit: one dead path for another.
        writeFileSync(target, gradingTheme(TG_DEAD_NEW));
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });

    assert.equal(turns > 0, true, 'the turn must actually have run, or this test proves nothing');
    const finalText = readFileSync(target, 'utf8');
    // THE ASSERTION: repaired, not deleted, not left dead.
    assert.ok(finalText.includes(`[eval-driven development](${TG_REAL})`), `the link must be repaired at the real target — got:\n${finalText}`);
    assert.ok(!finalText.includes(TG_DEAD_NEW), 'the second dead path must not survive');
    assert.ok(finalText.includes('[eval-driven development]'), 'the link must be repaired, never deleted');
    // And the repaired target genuinely resolves from the theme's own dir.
    assert.equal(existsSync(join(brainDir, 'themes', TG_REAL)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ON-3: a refused finding SHOWS ITS FIX — the row carries the proposed diff, its disposition and the audit\'s reason', async () => {
  const { root, brainDir } = makeKbRoot(GITPULSE_KB, [
    { slug: RECURRENCE_SLUG, category: 'antipattern', content: RECURRENCE_BEFORE },
    { slug: DOUBLE_COMMIT_SLUG, category: 'antipattern', content: themeFile('Double commit', 'antipattern') },
    { slug: THIRD_CYCLE_SLUG, category: 'antipattern', content: themeFile('Third cycle', 'antipattern') },
  ]);
  const target = join(brainDir, 'themes', `${RECURRENCE_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkLengthSoftCap', 'length.soft-cap', 'theme exceeds the soft line cap');
    finding.fixHint = 'Condense the theme below the soft cap without losing amendment history.';
    const status = await runKbDrain(root, GITPULSE_KB, `${GITPULSE_KB}-drain-r5`, {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: async (input) => {
        writeFileSync(target, RECURRENCE_AFTER_DELETION);
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    const row = status.perFinding.find((f) => f.tier === 'agent');
    assert.ok(row, JSON.stringify(status.perFinding));
    // The rule and the brief the agent was given.
    assert.equal(row.check, 'checkLengthSoftCap');
    assert.equal(row.fixHint, 'Condense the theme below the soft cap without losing amendment history.');
    // The proposal itself.
    const proposals = row.proposedChanges ?? [];
    assert.equal(proposals.length, 1, `expected one proposal — got ${JSON.stringify(proposals)}`);
    const [p] = proposals;
    assert.equal(p.disposition, 'refused');
    assert.match(p.file, new RegExp(`${RECURRENCE_SLUG}\\.md$`));
    assert.match(p.diff, new RegExp(`^-related_themes: \\[${DOUBLE_COMMIT_SLUG}`, 'm'), `the diff must show the deleted edge — got:\n${p.diff}`);
    assert.equal(p.diffTruncated, false);
    assert.equal(p.reasons.length, 1);
    assert.match(p.reasons[0], /deletes the related_themes edge/);
    assert.match(p.reasons[0], new RegExp(DOUBLE_COMMIT_SLUG));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ON-3: a REPAIRED finding shows the diff of what LANDED, with the rejected proposal named in its reasons', async () => {
  const { root, brainDir } = makeTrafficGameRoot();
  const target = join(brainDir, 'themes', `${GRADING_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkSourceLinks', 'links.broken', `broken link: ${TG_DEAD_OLD}`);
    let turns = 0;
    const status = await runKbDrain(root, TG_KB, `${TG_KB}-drain-r6`, {
      lint: () => ({ findings: turns === 0 ? [finding] : [] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: turns === 0 ? [finding] : [] }),
      runFixTurn: async (input) => {
        turns += 1;
        writeFileSync(target, gradingTheme(TG_DEAD_NEW));
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    const row = status.perFinding.find((f) => f.tier === 'agent');
    const proposals = row?.proposedChanges ?? [];
    assert.equal(proposals.length, 1, JSON.stringify(proposals));
    assert.equal(proposals[0].disposition, 'repaired');
    assert.ok(proposals[0].diff.includes(TG_REAL), `the shown diff must be what landed — got:\n${proposals[0].diff}`);
    assert.ok(!proposals[0].diff.includes(`+[eval-driven development](${TG_DEAD_NEW})`), 'the rejected proposal must not be shown as if it landed');
    assert.match(proposals[0].reasons[0] ?? '', /does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('REGRESSION 2b: with NO resolvable target anywhere, the drain refuses instead of inventing one — the pre-turn bytes stand', async () => {
  const made = makeKbRoot(TG_KB, [
    { slug: GRADING_SLUG, category: 'pattern', content: gradingTheme(TG_DEAD_OLD) },
  ]);
  const target = join(made.brainDir, 'themes', `${GRADING_SLUG}.md`);
  const before = readFileSync(target, 'utf8');
  try {
    const finding = agentFinding(target, 'checkSourceLinks', 'links.broken', `broken link: ${TG_DEAD_OLD}`);
    await runKbDrain(made.root, TG_KB, `${TG_KB}-drain-r3`, {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: async (input) => {
        writeFileSync(target, gradingTheme(TG_DEAD_NEW));
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    assert.equal(readFileSync(target, 'utf8'), before, 'no real target exists, so the swap must be reverted outright');
  } finally {
    rmSync(made.root, { recursive: true, force: true });
  }
});

test('CONTROL: an honest repoint at a target that really resolves still LANDS — the gate refuses unsound edits, not structural ones', async () => {
  const { root, brainDir } = makeTrafficGameRoot();
  const target = join(brainDir, 'themes', `${GRADING_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkSourceLinks', 'links.broken', `broken link: ${TG_DEAD_OLD}`);
    let turns = 0;
    await runKbDrain(root, TG_KB, `${TG_KB}-drain-r4`, {
      lint: () => ({ findings: turns === 0 ? [finding] : [] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: turns === 0 ? [finding] : [] }),
      runFixTurn: async (input) => {
        turns += 1;
        writeFileSync(target, gradingTheme(TG_REAL));
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    assert.equal(readFileSync(target, 'utf8'), gradingTheme(TG_REAL), 'a sound structural repair must land untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// W8-F1 INVERTED (C4 regate, S1-a). This test used to assert the prose+edge
// edit is DRAFTED with the consequence written on the plan page. That is a
// one-click button for exactly the destruction the drain refuses when the
// same edit happens to be structural — and the C4 refuter walked through it:
// `guardAgentKbEdits` opened `if (c.klass !== 'structural') continue`, so the
// two operator-clicked callers that have NO prose gate (`forge brain fix`,
// `runBrainConsolidateNow`) landed it outright. The contract is now strictly
// stronger: an edit that destroys resolvable graph structure is REFUSED,
// whatever its class, and the operator is shown the diff and the reason on
// the row instead of a button that applies it.
test('W8-F1 (was: adversarial round 1): a PROSE rewrite that also deletes a valid edge is REFUSED, not offered for one-click approval', async () => {
  const withEdge = themeFile(
    'Gitignored scratch files, recurrence',
    'antipattern',
    [`related_themes: [${DOUBLE_COMMIT_SLUG}]`],
    ['The same scratch-file commit happened again, at length, over several lines.'],
  );
  const { root, brainDir } = makeKbRoot(GITPULSE_KB, [
    { slug: RECURRENCE_SLUG, category: 'antipattern', content: withEdge },
    { slug: DOUBLE_COMMIT_SLUG, category: 'antipattern', content: themeFile('Double commit', 'antipattern') },
  ]);
  const target = join(brainDir, 'themes', `${RECURRENCE_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkLengthSoftCap', 'length.soft-cap', 'theme exceeds the soft line cap');
    // Prose AND an edge deletion in one edit — `classifyKbEdit` returns
    // 'prose' for the whole file, which is what used to buy it a pass.
    const condensed = withEdge
      .replace('related_themes: [2026-06-21-gitignored-scratch-files-double-commit]', 'related_themes: []')
      .replace('The same scratch-file commit happened again, at length, over several lines.', 'Condensed.');
    const status = await runKbDrain(root, GITPULSE_KB, `${GITPULSE_KB}-drain-r7`, {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: async (input) => {
        writeFileSync(target, condensed);
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    assert.equal(readFileSync(target, 'utf8'), withEdge, 'the edge survives — as before');
    const row = status.perFinding.find((f) => f.tier === 'agent');
    assert.ok(row, `expected an agent row — got ${JSON.stringify(status.perFinding)}`);
    // THE INVERSION: no draft. Approving a draft writes `after` back
    // byte-for-byte, so minting one here hands the operator the deletion.
    assert.equal(
      row.draftSession,
      undefined,
      'an unsound prose edit must NOT be parked as an approvable draft — approving it would destroy the edge',
    );
    assert.ok(!existsSync(join(root, 'projects', GITPULSE_KB, '_kb-cleanup')), 'no kb-cleanup session may be minted at all');
    // …and the operator still SEES what was proposed and why it was refused.
    const proposals = row.proposedChanges ?? [];
    assert.equal(proposals.length, 1, `the refused proposal must still be shown — got ${JSON.stringify(proposals)}`);
    assert.equal(proposals[0].disposition, 'refused');
    assert.ok(
      proposals[0].reasons.some((r) => r.includes(`deletes the related_themes edge "${DOUBLE_COMMIT_SLUG}"`)),
      `the reason must name the edge — got ${JSON.stringify(proposals[0].reasons)}`,
    );
    assert.match(proposals[0].diff, /Condensed\./, 'the diff must still show the prose the agent proposed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// W8-F1 — the C4 regate's drain-level counter-repros.
//
// Reviewer heuristic that produced these: "a test that stubs the gate is not
// a gate test". Every drain pin above drives `runFixTurn` with a stub, so the
// production runner's OWN gate is never exercised by them. The two tests
// below therefore call the REAL `runBrainFixTurn` through the seam, with only
// the SDK query stubbed — the shape the C4 refuter used to prove the class
// still recurs "inside a real drain".
// ===========================================================================

/** The drain seam, wired to the PRODUCTION runner: only the LLM is simulated.
 *  Everything past the agent turn — both gates included — is the real thing. */
function realTurn(write: () => void): (input: KbDrainFixTurnInput) => Promise<KbDrainFixTurnResult & { costUsd: number }> {
  return async (input) => {
    const result = await runBrainFixTurn({
      ...input,
      queryFn: () => {
        async function* gen(): AsyncGenerator<unknown> {
          write();
          yield { type: 'result', subtype: 'success', total_cost_usd: 0 };
        }
        return gen();
      },
    });
    return { ...result, costUsd: 0 };
  };
}

test('W8-F1 S1-b: a real drain of one KB cannot destroy an edge in ANOTHER brain dir — through the production runner, only the SDK stubbed', async () => {
  const { root, brainDir } = makeKbRoot(GITPULSE_KB, [
    { slug: RECURRENCE_SLUG, category: 'antipattern', content: themeFile('Recurrence', 'antipattern', [], ['Body.']) },
  ]);
  // A victim theme in a DIFFERENT sub-wiki, with a resolvable edge. The
  // gitpulse drain has no business here; the agent's cwd is forgeRoot.
  const victimDir = join(root, 'brain', 'cycles', 'themes');
  mkdirSync(victimDir, { recursive: true });
  const victimBefore = themeFile('Victim', 'pattern', ['related_themes: [2026-05-01-partner]']);
  const victimPath = join(victimDir, '2026-05-01-victim.md');
  writeFileSync(victimPath, victimBefore);
  writeFileSync(join(victimDir, '2026-05-01-partner.md'), themeFile('Partner', 'pattern'));
  const target = join(brainDir, 'themes', `${RECURRENCE_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkLengthSoftCap', 'length.soft-cap', 'theme exceeds the soft line cap');
    const status = await runKbDrain(root, GITPULSE_KB, `${GITPULSE_KB}-drain-outside`, {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: realTurn(() => {
        writeFileSync(victimPath, victimBefore.replace('related_themes: [2026-05-01-partner]', 'related_themes: []'));
      }),
    });
    // The drain SEES the out-of-KB write now (its snapshot is the whole brain)
    // and refuses to call the run clean. It does not revert it — see
    // guardAgentKbEdits' own doc and bead forge-ler4: the reflector writes the
    // brain from the daemon with no lock between them, so a revert here would
    // destroy another process's work. The WRITE is stopped at the spawn seam.
    assert.equal(status.state, 'needs-you', `an unattributable brain write puts the run on the operator — got ${JSON.stringify(status.state)}`);
    const row = status.perFinding.find((f) => f.tier === 'agent');
    assert.ok(row, JSON.stringify(status.perFinding));
    // The escape is ON THE ROW, named, with the file it touched — the whole
    // point of ON-3. Its disposition is honestly `applied` (the bytes ARE on
    // disk); what makes it legible is the reason next to it.
    const escape = (row.proposedChanges ?? []).find((c) => c.file.includes('2026-05-01-victim'));
    assert.ok(escape, `the out-of-KB write must be shown — got ${JSON.stringify((row.proposedChanges ?? []).map((c) => c.file))}`);
    assert.ok(
      escape.reasons.some((r) => r.includes('outside the drained KB')),
      `and NAMED as out of scope — got ${JSON.stringify(escape.reasons)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('W8-F1 (ON-3): a structural edit the PRODUCTION turn gate refused still shows its diff and reason on the drain row', async () => {
  const withEdge = themeFile(
    'Gitignored scratch files, recurrence',
    'antipattern',
    [`related_themes: [${DOUBLE_COMMIT_SLUG}]`],
    ['Body.'],
  );
  const { root, brainDir } = makeKbRoot(GITPULSE_KB, [
    { slug: RECURRENCE_SLUG, category: 'antipattern', content: withEdge },
    { slug: DOUBLE_COMMIT_SLUG, category: 'antipattern', content: themeFile('Double commit', 'antipattern') },
  ]);
  const target = join(brainDir, 'themes', `${RECURRENCE_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkLengthSoftCap', 'length.soft-cap', 'theme exceeds the soft line cap');
    // Frontmatter-only: 'structural', so the PRODUCTION runner's own gate
    // reverts it BEFORE the drain diffs the tree. The drain's snapshot then
    // sees no change at all — which is how "a refused finding SHOWS ITS FIX"
    // silently stopped being true on the real path while the stubbed pins
    // above stayed green.
    const status = await runKbDrain(root, GITPULSE_KB, `${GITPULSE_KB}-drain-realgate`, {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: realTurn(() => {
        writeFileSync(target, withEdge.replace(`related_themes: [${DOUBLE_COMMIT_SLUG}]`, 'related_themes: []'));
      }),
    });
    assert.equal(readFileSync(target, 'utf8'), withEdge, 'the edge survives');
    const row = status.perFinding.find((f) => f.tier === 'agent');
    assert.ok(row, JSON.stringify(status.perFinding));
    const proposals = row.proposedChanges ?? [];
    assert.equal(proposals.length, 1, `the refused proposal must reach the row — got ${JSON.stringify(proposals)}`);
    assert.equal(proposals[0].disposition, 'refused');
    assert.match(proposals[0].diff, /related_themes/, 'the diff must show what the agent proposed');
    assert.ok(
      proposals[0].reasons.some((r) => r.includes('deletes the related_themes edge')),
      `and why it was refused — got ${JSON.stringify(proposals[0].reasons)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('W8-F1 (ON-3, S2): an AUTO-tier row carries its diff — the tier that mutates with no approval gate is the one that must show its work', async () => {
  // A theme that is NOT listed in its category index and is reachable from no
  // index at all → a real auto-fixer rewrites the curated `antipatterns.md` to
  // link it. The C4 refuter watched a real drain do exactly this with
  // `outcome=cleared` and no diff on the row. The row is selected by WHAT IT
  // DID (an auto row that rewrote the index), not by a finding kind: for a
  // project brain the same rewrite is now driven by the `orphan` finding the
  // full scan raises, since the scan reads brain/projects/<name>/themes (ADR
  // 035) instead of a second per-KB lens reporting it as index.not-listed.
  const ORPHAN = '2026-06-21-orphan';
  const { root, brainDir } = makeKbRoot(GITPULSE_KB, []);
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'themes', `${ORPHAN}.md`), themeFile('Orphan theme', 'antipattern', [], ['Body.']));
  writeFileSync(join(brainDir, 'antipatterns.md'), '# antipatterns\n\n');
  const indexPath = join(brainDir, 'antipatterns.md');
  const indexBefore = readFileSync(indexPath, 'utf8');
  try {
    const status = await runKbDrain(root, GITPULSE_KB, `${GITPULSE_KB}-drain-auto`, {
      // Real lint, real auto-fixers; the agent turn is a no-op so nothing but
      // the auto tier can be responsible for what lands.
      runFixTurn: async (input) => ({ runId: input.runId, cleared: false, costUsd: 0, editAudit: noKbEdits() }),
    });
    assert.notEqual(readFileSync(indexPath, 'utf8'), indexBefore, 'precondition: the auto tier must really have rewritten the index');
    const autoRow = status.perFinding.find(
      (f) => f.tier === 'auto' && (f.proposedChanges ?? []).some((p) => p.file.endsWith('antipatterns.md')),
    );
    assert.ok(autoRow, `expected an auto row for the index rewrite — got ${JSON.stringify(status.perFinding)}`);
    assert.equal(autoRow.outcome, 'cleared', 'precondition: the row really did land unattended');
    const proposals = autoRow.proposedChanges ?? [];
    assert.ok(proposals.length > 0, `an auto row that MUTATED the tree must carry its diff — got ${JSON.stringify(autoRow)}`);
    const indexProposal = proposals.find((p) => p.file.endsWith('antipatterns.md'));
    assert.ok(indexProposal, `the curated index it rewrote must be in the diff — got ${JSON.stringify(proposals.map((p) => p.file))}`);
    assert.match(indexProposal.diff, new RegExp(ORPHAN), 'the diff must show what the auto-fixer wrote');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// W8-F1, ADVERSARIAL REVIEW ROUND 2 — three defects the FIX itself shipped,
// each found with a runnable repro by a hostile reviewer whose brief was
// "this class has been re-shipped four times; find the fifth before it
// merges". Pinned here so the fifth cannot come back either.
// ===========================================================================

test('W8-F1 r2: a REPAIRED prose change is not reverted-and-destroyed — the row shows what is actually on disk', async () => {
  // Removing the class filter means the gate can now REPAIR a `prose` change.
  // The drain then reverted it as prose, destroying the repair the gate had
  // just written, while still rendering the row `repaired` with a diff of
  // bytes no longer on disk.
  const { root, brainDir } = makeTrafficGameRoot();
  const target = join(brainDir, 'themes', `${GRADING_SLUG}.md`);
  try {
    const finding = agentFinding(target, 'checkSourceLinks', 'links.broken', 'broken link');
    // A dead->dead link repoint (repairable to the REAL target) PLUS a prose
    // reword, so `classifyKbEdit` returns 'prose' for the whole file.
    const proposed = gradingTheme(TG_DEAD_NEW).replace('principle.', 'principle, condensed.');
    const status = await runKbDrain(root, TG_KB, `${TG_KB}-drain-r2repair`, {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: async (input) => {
        writeFileSync(target, proposed);
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    const onDisk = readFileSync(target, 'utf8');
    const row = status.perFinding.find((f) => f.tier === 'agent');
    assert.ok(row, JSON.stringify(status.perFinding));
    const proposals = row.proposedChanges ?? [];
    assert.equal(proposals.length, 1, JSON.stringify(proposals));
    // THE PIN: whatever the row claims, the bytes must match it. A row that
    // says "repaired" while the repair is not on disk is worse than no row.
    if (proposals[0].disposition === 'repaired') {
      assert.ok(
        onDisk.includes(TG_REAL),
        `the row says "repaired" but the repaired target is not on disk:\n${onDisk}`,
      );
    } else {
      assert.equal(onDisk, gradingTheme(TG_DEAD_OLD), 'not repaired ⇒ the pre-turn bytes must stand');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
