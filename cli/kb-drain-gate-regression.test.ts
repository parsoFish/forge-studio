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
 * CONTENT is copied in here rather than read from that campaign directory:
 * campaign dirs are gitignored, so a test citing one is a dangling reference.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runKbDrain } from './bridge-studio-kb-drain.ts';
import type { Finding } from './brain-lint.ts';

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
        return { runId: input.runId, cleared: true, costUsd: 0.01 };
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
        return { runId: input.runId, cleared: true, costUsd: 0.01 };
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
        return { runId: input.runId, cleared: true, costUsd: 0.01 };
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
        return { runId: input.runId, cleared: true, costUsd: 0.01 };
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
        return { runId: input.runId, cleared: true, costUsd: 0.01 };
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
        return { runId: input.runId, cleared: true, costUsd: 0.01 };
      },
    });
    assert.equal(readFileSync(target, 'utf8'), gradingTheme(TG_REAL), 'a sound structural repair must land untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
