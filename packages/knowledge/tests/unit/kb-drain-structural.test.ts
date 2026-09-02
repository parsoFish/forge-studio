/**
 * W7-B2 pinned tests — structural-only auto-apply (orch-01).
 *
 * The wave-7 walkthrough's S1 orchestrator finding: Drain-to-green's
 * brain-fix agent lossy-rewrote theme PROSE to clear lint flags
 * (brain/forge-dev/themes/brain-read-policy.md lost 26 lines of amendment
 * history — reverted by hand, recorded in _wave7/ledger.md). The contract
 * this file pins:
 *
 *   - `classifyKbEdit` — frontmatter / link-target / index-page edits are
 *     'structural'; any body-prose change is 'prose'.
 *   - `runKbDrain` NEVER lands a prose edit directly: the file is restored
 *     byte-for-byte and the agent's proposal becomes a kb-cleanup DRAFT
 *     session (phase awaiting-approval) carrying a reviewable diff.
 *   - `approveKbCleanup` applies a draft-carrying session's files (contained
 *     to the KB's own brain dir) instead of running a consolidate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { classifyKbEdit, buildUnifiedDiff, snapshotKbFiles, diffKbSnapshot } from '../../kb-drain-structural.ts';
import { runKbDrain } from '../../bridge-studio-kb-drain.ts';
import { noKbEdits } from '../../kb-drain-edit-soundness.ts';
import { approveKbCleanup } from '../../bridge-studio-kbs.ts';
import { deriveKbActiveJob } from '../../kb-job-state.ts';
import type { Finding } from '../../brain-lint.ts';

// ---------------------------------------------------------------------------
// classifyKbEdit matrix
// ---------------------------------------------------------------------------

const THEME_BEFORE = [
  '---',
  'title: Brain read policy',
  'description: who reads what',
  'category: decision',
  'created_at: 2026-05-26',
  'updated_at: 2026-07-17',
  '---',
  '',
  '## Policy',
  '',
  'Planners read Brain 2 plus the cycle Brain 3. The reviewer additionally',
  'gains a per-KB advisory read of any review-band flow KB (amended',
  '2026-08-09, ADR 010 / ADR 027 R1-06).',
  '',
  'See [ADR 010](../../docs/decisions/010-brain-first.md).',
  '',
].join('\n');

test('classifyKbEdit — frontmatter-only change is structural', () => {
  const after = THEME_BEFORE.replace('updated_at: 2026-07-17', 'updated_at: 2026-08-20');
  assert.equal(classifyKbEdit('themes/brain-read-policy.md', THEME_BEFORE, after), 'structural');
});

test('classifyKbEdit — related_themes change is structural', () => {
  const before = THEME_BEFORE.replace('updated_at: 2026-07-17', 'updated_at: 2026-07-17\nrelated_themes: [dev-loop-zero-brain-reads]');
  const after = before.replace(
    'related_themes: [dev-loop-zero-brain-reads]',
    'related_themes: [dev-loop-zero-brain-reads, brain-read-policy-amendments]',
  );
  assert.equal(classifyKbEdit('themes/brain-read-policy.md', before, after), 'structural');
});

test('classifyKbEdit — link-target-only change is structural', () => {
  const after = THEME_BEFORE.replace('../../docs/decisions/010-brain-first.md', '../../docs/decisions/010-brain-first-amended.md');
  assert.equal(classifyKbEdit('themes/brain-read-policy.md', THEME_BEFORE, after), 'structural');
});

test('classifyKbEdit — the orch-01 shape (prose lines deleted/condensed) is prose', () => {
  // Mirrors the recorded forge-dev rewrite: amendment history condensed away.
  const after = THEME_BEFORE
    .replace('Planners read Brain 2 plus the cycle Brain 3. The reviewer additionally', 'Planners read Brain 2.')
    .replace('gains a per-KB advisory read of any review-band flow KB (amended', '')
    .replace('2026-08-09, ADR 010 / ADR 027 R1-06).', '');
  assert.equal(classifyKbEdit('themes/brain-read-policy.md', THEME_BEFORE, after), 'prose');
});

test('classifyKbEdit — category index page edits are structural', () => {
  assert.equal(classifyKbEdit('patterns.md', '# Patterns\n', '# Patterns\n\n- [x](./themes/x.md)\n'), 'structural');
});

test('classifyKbEdit — a NEW non-index file is prose (gated)', () => {
  assert.equal(classifyKbEdit('themes/invented.md', null, '---\ntitle: t\n---\nbody'), 'prose');
});

test('classifyKbEdit — a deleted file is prose (gated)', () => {
  assert.equal(classifyKbEdit('themes/gone.md', THEME_BEFORE, null), 'prose');
});

// ---------------------------------------------------------------------------
// W7-B2 code-review round — three holes in the structural-only gate.
// ---------------------------------------------------------------------------

test('classifyKbEdit — DELETING an index/category page is prose (gated, never a silent destruction)', () => {
  // The index-page rule used to be checked BEFORE the created/deleted rule, so
  // an agent removing a curated listing page (ordering + annotations) had its
  // deletion classified 'structural' and landed with no draft, no approval and
  // no undo — the exact destructive-edit class orch-01 exists to stop.
  assert.equal(classifyKbEdit('patterns.md', '# Patterns\n\n- [x](./themes/x.md)\n', null), 'prose');
  assert.equal(classifyKbEdit('themes/README.md', '# Themes\n', null), 'prose');
});

test('classifyKbEdit — CREATING an index/category page is prose (gated)', () => {
  assert.equal(classifyKbEdit('decisions.md', null, '# Decisions\n\n- [d](./themes/d.md)\n'), 'prose');
});

test('classifyKbEdit — rewriting a wikilink ALIAS (the reader-visible half) is prose', () => {
  // normalizeLinkTargets replaced the WHOLE wikilink body, so an inverted
  // meaning behind an unchanged target normalized to the same string and
  // landed ungated — contradicting the function's own contract that link TEXT
  // is prose and is deliberately not normalized away.
  const before = THEME_BEFORE.replace('## Policy', '## Policy\n\nSee [[dev-loop-zero-brain-reads|the dev-loop never reads the brain]].');
  const after = before.replace('the dev-loop never reads the brain', 'dev-loop reads allowed');
  assert.equal(classifyKbEdit('themes/brain-read-policy.md', before, after), 'prose');
});

test('classifyKbEdit — a wikilink TARGET-only change (alias untouched) stays structural', () => {
  const before = THEME_BEFORE.replace('## Policy', '## Policy\n\nSee [[old-slug|the dev-loop never reads the brain]].');
  const after = before.replace('[[old-slug|', '[[new-slug|');
  assert.equal(classifyKbEdit('themes/brain-read-policy.md', before, after), 'structural');
});

test('classifyKbEdit — a bare wikilink target change stays structural', () => {
  const before = THEME_BEFORE.replace('## Policy', '## Policy\n\nSee [[old-slug]].');
  const after = before.replace('[[old-slug]]', '[[new-slug]]');
  assert.equal(classifyKbEdit('themes/brain-read-policy.md', before, after), 'structural');
});

test('diffKbSnapshot — a kb.yaml rewrite is DETECTED and gates as prose (declared-data-fails-open)', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-snapshot-'));
  try {
    const brainDir = join(root, 'brain', 'skb');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'kb.yaml'), 'id: skb\nname: skb\nbinding: { kind: unique }\ndesc: before.\n');
    writeFileSync(join(brainDir, 'themes', 'a.md'), THEME_BEFORE);
    const snapshot = snapshotKbFiles(brainDir);
    // The agent turn rewrites the KB's own identity/obligation descriptor —
    // more dangerous than any theme prose, and previously invisible to the
    // gate because only `*.md` was ever walked.
    writeFileSync(join(brainDir, 'kb.yaml'), 'id: skb\nname: skb\nbinding: { kind: project, ref: elsewhere }\ndesc: after.\n');
    const changes = diffKbSnapshot(brainDir, snapshot);
    const kbYaml = changes.find((c) => c.relPath === 'kb.yaml');
    assert.ok(kbYaml, `kb.yaml change must be detected, got ${JSON.stringify(changes.map((c) => c.relPath))}`);
    assert.equal(kbYaml.klass, 'prose');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diffKbSnapshot — a stray non-markdown file dropped into the KB gates as prose', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-snapshot-stray-'));
  try {
    const brainDir = join(root, 'brain', 'skb');
    mkdirSync(join(brainDir, '_raw'), { recursive: true });
    writeFileSync(join(brainDir, 'kb.yaml'), 'id: skb\nname: skb\nbinding: { kind: unique }\ndesc: fixture.\n');
    const snapshot = snapshotKbFiles(brainDir);
    writeFileSync(join(brainDir, '_raw', 'helper.sh'), '#!/bin/sh\necho hi\n');
    const changes = diffKbSnapshot(brainDir, snapshot);
    const stray = changes.find((c) => c.relPath === '_raw/helper.sh');
    assert.ok(stray, `stray file must be detected, got ${JSON.stringify(changes.map((c) => c.relPath))}`);
    assert.equal(stray.klass, 'prose');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildUnifiedDiff — carries removed and added lines', () => {
  const diff = buildUnifiedDiff('themes/x.md', 'a\nb\nc\n', 'a\nB\nc\n');
  assert.match(diff, /^-b$/m);
  assert.match(diff, /^\+B$/m);
});

// ---------------------------------------------------------------------------
// runKbDrain — the gate itself (orch-01)
// ---------------------------------------------------------------------------

function makeGateRoot(): { root: string; brainDir: string; themeFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-gate-'));
  // A PROJECT-bound KB (brain/projects/<id>) — lintThemeFiles applies the
  // forge category→sub-wiki routing rule to non-project themes, which would
  // pollute a unique-KB fixture with a category.mis-routed auto finding.
  const brainDir = join(root, 'brain', 'projects', 'gated-kb');
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), 'id: gated-kb\nname: gated-kb\nbinding: { kind: project, ref: gated-kb }\ndesc: gate fixture.\n');
  const themeFile = join(brainDir, 'themes', 'brain-read-policy.md');
  writeFileSync(themeFile, THEME_BEFORE);
  // Keep the on-disk fixture lint-CLEAN apart from the injected finding: the
  // drain's own-theme lens (collectKbFindings) runs the REAL lintThemeFiles
  // over this file, so its link target and category index must exist.
  mkdirSync(join(root, 'brain', 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(root, 'brain', 'docs', 'decisions', '010-brain-first.md'), '# ADR 010 (fixture)\n');
  // NOTE: link target resolves ../../ from brain/projects/gated-kb/themes →
  // brain/projects/docs — create that too so checkSourceLinks stays clean.
  mkdirSync(join(root, 'brain', 'projects', 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(root, 'brain', 'projects', 'docs', 'decisions', '010-brain-first.md'), '# ADR 010 (fixture)\n');
  writeFileSync(join(brainDir, 'decisions.md'), '# Decisions\n\n- [brain-read-policy](./themes/brain-read-policy.md)\n');
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, brainDir, themeFile };
}

test('runKbDrain — a prose-touching agent fix NEVER lands directly: reverted + drafted as a kb-cleanup session (orch-01)', async () => {
  const { root, themeFile } = makeGateRoot();
  try {
    const finding: Finding & { check: string; kind: string } = {
      category: 'flag', file: themeFile,
      message: 'theme exceeds the soft line cap', check: 'checkLengthSoftCap',
      kind: 'length.soft-cap', resolution: 'agent',
    };
    // W8-F1: the condense KEEPS the ADR link. The original fixture truncated
    // at line 10, which also deleted a markdown link whose target exists — so
    // it was really testing two things at once, and under W8-F1's
    // class-independent audit the link deletion (not the prose loss) is what
    // decides the outcome. The lossy prose rewrite orch-01 is about is
    // preserved exactly; the graph destruction gets its own test below.
    const condensed = [
      ...THEME_BEFORE.split('\n').slice(0, 10),
      '',
      'See [ADR 010](../../docs/decisions/010-brain-first.md).',
      '',
    ].join('\n');
    const status = await runKbDrain(root, 'gated-kb', 'gated-kb-drain-t1', {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: async (input) => {
        // The agent "condenses" the theme — the exact orch-01 lossy rewrite.
        writeFileSync(themeFile, condensed);
        return { runId: input.runId, cleared: true, costUsd: 0.03, editAudit: noKbEdits() };
      },
    });

    // 1. The prose rewrite must NOT be on disk.
    assert.equal(readFileSync(themeFile, 'utf8'), THEME_BEFORE, 'the theme must be restored byte-for-byte');

    // 2. The run ends needs-you (a draft awaits the operator), not green.
    assert.equal(status.state, 'needs-you', JSON.stringify(status));

    // 3. The gated finding is recorded with a draft session reference.
    const gated = status.perFinding.find((f) => f.outcome === 'needs-you' && f.tier === 'agent');
    assert.ok(gated, `expected a needs-you agent entry — got ${JSON.stringify(status.perFinding)}`);
    assert.ok(gated?.draftSession?.id, 'the gated entry must name the draft kb-cleanup session');

    // 4. The draft session exists on disk: awaiting-approval + draft_apply +
    //    a plan carrying a reviewable diff.
    const anchor = join(root, 'projects', 'gated-kb', '_kb-cleanup');
    const sids = readdirSync(anchor);
    assert.equal(sids.length, 1, `expected exactly one draft session — got ${JSON.stringify(sids)}`);
    const sessionDir = join(anchor, sids[0]);
    const sessionStatus = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(sessionStatus['phase'], 'awaiting-approval');
    assert.equal(sessionStatus['kb_id'], 'gated-kb');
    const draftApply = sessionStatus['draft_apply'] as Array<{ file: string; draft: string }>;
    assert.ok(Array.isArray(draftApply) && draftApply.length === 1, JSON.stringify(sessionStatus));
    const plan = readFileSync(join(sessionDir, 'plan', 'cleanup-plan.md'), 'utf8');
    assert.match(plan, /```diff/, 'the plan must carry a reviewable diff');
    const draftContent = readFileSync(join(sessionDir, draftApply[0].draft), 'utf8');
    assert.equal(draftContent, condensed, 'the draft must hold the agent\'s proposed content verbatim');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W8-F1 — the other half of what the orch-01 fixture used to conflate.
//
// A prose rewrite that ALSO destroys resolvable graph structure is not a
// draftable proposal: approving a draft writes `after` back byte-for-byte, so
// parking it would hand the operator a one-click button for exactly the
// deletion the drain refuses when the same edit happens to be structural. It
// is refused instead — and still surfaced, because a refused finding is
// waiting on a human just as much as a drafted one is.
// ---------------------------------------------------------------------------

test('W8-F1 — a prose rewrite that ALSO deletes a live link is REFUSED, not drafted, and still reaches the operator', async () => {
  const { root, themeFile } = makeGateRoot();
  try {
    const finding: Finding & { check: string; kind: string } = {
      category: 'flag', file: themeFile,
      message: 'theme exceeds the soft line cap', check: 'checkLengthSoftCap',
      kind: 'length.soft-cap', resolution: 'agent',
    };
    // The original orch-01 truncation: condenses the prose AND drops the ADR
    // link, whose target exists.
    const condensed = THEME_BEFORE.split('\n').slice(0, 10).join('\n') + '\n';
    const status = await runKbDrain(root, 'gated-kb', 'gated-kb-drain-w8f1', {
      lint: () => ({ findings: [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: [finding] }),
      runFixTurn: async (input) => {
        writeFileSync(themeFile, condensed);
        return { runId: input.runId, cleared: true, costUsd: 0.03, editAudit: noKbEdits() };
      },
    });

    // 1. The bytes are safe — the orch-01 guarantee, unchanged.
    assert.equal(readFileSync(themeFile, 'utf8'), THEME_BEFORE, 'the theme must be restored byte-for-byte');

    // 2. NO draft session: approving one would re-apply the link deletion.
    const row = status.perFinding.find((f) => f.tier === 'agent');
    assert.ok(row, JSON.stringify(status.perFinding));
    assert.equal(row.draftSession, undefined, 'an unsound edit must not become an approvable draft');
    assert.ok(!existsSync(join(root, 'projects', 'gated-kb', '_kb-cleanup')), 'no kb-cleanup session may be minted');

    // 3. …and it still reaches the operator, with the proposal and the reason.
    assert.equal(row.outcome, 'needs-you', 'a refused proposal is waiting on a human, not silently not-cleared');
    assert.equal(status.state, 'needs-you', JSON.stringify(status.state));
    const proposals = row.proposedChanges ?? [];
    assert.equal(proposals.length, 1, JSON.stringify(proposals));
    assert.equal(proposals[0].disposition, 'refused');
    assert.ok(
      proposals[0].reasons.some((r) => r.includes('010-brain-first.md')),
      `the reason must name what was destroyed — got ${JSON.stringify(proposals[0].reasons)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runKbDrain — structural edit within the KB dir is applied, drain reaches green', async () => {
  const { root, themeFile } = makeGateRoot();
  try {
    const finding: Finding & { check: string; kind: string } = {
      category: 'flag', file: themeFile,
      message: 'missing required frontmatter field: updated_at', check: 'checkFrontmatter',
      kind: 'staleness.missing', resolution: 'agent',
    };
    const fixed = THEME_BEFORE.replace('updated_at: 2026-07-17', 'updated_at: 2026-08-20');
    let turnRan = false;
    const status = await runKbDrain(root, 'gated-kb', 'gated-kb-drain-t2', {
      lint: () => ({ findings: turnRan ? [] : [finding] }),
      applyAutoFixes: () => ({ applied: [], skipped: [], rounds: 0, remaining: turnRan ? [] : [finding] }),
      runFixTurn: async (input) => {
        writeFileSync(themeFile, fixed);
        turnRan = true;
        return { runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    assert.equal(status.state, 'green', JSON.stringify(status));
    assert.equal(readFileSync(themeFile, 'utf8'), fixed, 'the structural edit must land');
    assert.ok(!existsSync(join(root, 'projects', 'gated-kb')), 'no draft session for a structural edit');
    assert.ok(!existsSync(join(root, 'projects', '.kb-gated-kb')), 'no draft session for a structural edit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// approveKbCleanup — the draft-apply path
// ---------------------------------------------------------------------------

function makeDraftSessionRoot(opts: { targetRel: string; blockWritesAt?: string }): {
  root: string; projectsRoot: string; sid: string; themeFile: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'kb-draft-apply-'));
  const brainDir = join(root, 'brain', 'dkb');
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), 'id: dkb\nname: dkb\nbinding: { kind: unique }\ndesc: draft fixture.\n');
  const themeFile = join(brainDir, 'themes', 'x.md');
  writeFileSync(themeFile, 'original content\n');
  // A second KB dir the containment case targets.
  mkdirSync(join(root, 'brain', 'other', 'themes'), { recursive: true });
  writeFileSync(join(root, 'brain', 'other', 'themes', 'y.md'), 'other kb content\n');

  const projectsRoot = join(root, 'projects');
  const sid = '2026-08-20T10-00-00-w7b2test';
  const sessionDir = join(projectsRoot, '.kb-dkb', '_kb-cleanup', sid);
  mkdirSync(join(sessionDir, 'drafts'), { recursive: true });
  mkdirSync(join(sessionDir, 'plan'), { recursive: true });
  writeFileSync(join(sessionDir, 'drafts', '0.md'), 'proposed content\n');
  writeFileSync(join(sessionDir, 'plan', 'cleanup-plan.md'), '- [length.soft-cap] brain/dkb/themes/x.md — drain-gated prose edit\n');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({
    session_id: sid,
    project: '.kb-dkb',
    phase: 'awaiting-approval',
    kb_id: 'dkb',
    draft_apply: [{ file: opts.targetRel, draft: 'drafts/0.md' }],
  }, null, 2));
  // A REGULAR FILE where the draft target's parent directory should be, so
  // the apply's own `mkdirSync(dirname(target))` throws ENOTDIR — a real,
  // un-mocked write failure inside the queued callback.
  if (opts.blockWritesAt) writeFileSync(join(root, opts.blockWritesAt), 'not a directory\n');
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, projectsRoot, sid, themeFile };
}

test('approveKbCleanup — a draft-carrying session applies the DRAFT files, not a consolidate', async () => {
  const { root, projectsRoot, sid, themeFile } = makeDraftSessionRoot({ targetRel: 'brain/dkb/themes/x.md' });
  try {
    const outcome = await approveKbCleanup(root, projectsRoot, ['.kb-dkb', '_kb-cleanup', sid]);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.equal(readFileSync(themeFile, 'utf8'), 'proposed content\n');
    const status = JSON.parse(readFileSync(join(projectsRoot, '.kb-dkb', '_kb-cleanup', sid, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(status.phase, 'applied');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('approveKbCleanup — a draft target OUTSIDE the session\'s own KB dir is refused, nothing written', async () => {
  const { root, projectsRoot, sid } = makeDraftSessionRoot({ targetRel: 'brain/other/themes/y.md' });
  try {
    const outcome = await approveKbCleanup(root, projectsRoot, ['.kb-dkb', '_kb-cleanup', sid]);
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.equal(readFileSync(join(root, 'brain', 'other', 'themes', 'y.md'), 'utf8'), 'other kb content\n', 'the foreign KB file must be untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('approveKbCleanup — a traversal-shaped draft target is refused', async () => {
  const { root, projectsRoot, sid } = makeDraftSessionRoot({ targetRel: '../outside.md' });
  try {
    const outcome = await approveKbCleanup(root, projectsRoot, ['.kb-dkb', '_kb-cleanup', sid]);
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.ok(!existsSync(join(root, '..', 'outside.md')), 'nothing may be written outside the root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W7-B2 code-review round — approveKbCleanup's two dispatch paths.
// ---------------------------------------------------------------------------

test('approveKbCleanup — a draft WRITE failure is never swallowed: ok:false, session not marked applied', async () => {
  // `enqueueConsolidate` always RESOLVES (its queue continuation swallows the
  // run's own rejection by contract), so a callback with no internal error
  // handling made every write failure vanish: the session was stamped
  // phase:'applied' and ok:true returned while nothing had landed on disk.
  const { root, projectsRoot, sid } = makeDraftSessionRoot({
    targetRel: 'brain/dkb/blocked/x.md',
    blockWritesAt: 'brain/dkb/blocked',
  });
  try {
    const outcome = await approveKbCleanup(root, projectsRoot, ['.kb-dkb', '_kb-cleanup', sid]);
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    const status = JSON.parse(readFileSync(join(projectsRoot, '.kb-dkb', '_kb-cleanup', sid, 'status.json'), 'utf8')) as {
      phase: string; apply_error?: string;
    };
    assert.notEqual(status.phase, 'applied', 'a failed apply must NEVER be recorded as applied');
    assert.equal(status.phase, 'awaiting-approval', 'the session stays approvable so the operator can retry after the fix');
    assert.ok(typeof status.apply_error === 'string' && status.apply_error.length > 0, 'the failure must be recorded on the session');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('approveKbCleanup — a draft target that IS the kb brain dir itself is refused', async () => {
  const { root, projectsRoot, sid } = makeDraftSessionRoot({ targetRel: 'brain/dkb' });
  try {
    const outcome = await approveKbCleanup(root, projectsRoot, ['.kb-dkb', '_kb-cleanup', sid]);
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.equal(outcome.ok === false ? outcome.status : 0, 422);
    const status = JSON.parse(readFileSync(join(projectsRoot, '.kb-dkb', '_kb-cleanup', sid, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(status.phase, 'awaiting-approval', 'a pre-claim refusal leaves the session approvable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('approveKbCleanup — the consolidate path stakes its log dir SYNCHRONOUSLY, so deriveKbActiveJob sees it', async () => {
  // Without the synchronous stake-out, runBrainConsolidateNow only creates
  // `_logs/_brainfix-<runId>/` at its own terminal write — minutes of real
  // agent turns during which the knowledge-05 mutual gate reported NO active
  // job for this KB, so index/delete/drain were all still dispatchable
  // against the files this run was editing.
  const root = mkdtempSync(join(tmpdir(), 'kb-approve-consolidate-'));
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    const brainDir = join(root, 'brain', 'ckb');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'kb.yaml'), 'id: ckb\nname: ckb\nbinding: { kind: unique }\ndesc: consolidate fixture.\n');
    mkdirSync(join(root, '_logs'), { recursive: true });

    const projectsRoot = join(root, 'projects');
    const sid = '2026-08-21T09-00-00-w7b2rev';
    const sessionDir = join(projectsRoot, '.kb-ckb', '_kb-cleanup', sid);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({
      session_id: sid, project: '.kb-ckb', phase: 'awaiting-approval', kb_id: 'ckb',
    }, null, 2));

    // NOT awaited: everything up to the first `await` runs in this tick, which
    // is exactly the window the gate was blind in.
    const pending = approveKbCleanup(root, projectsRoot, ['.kb-ckb', '_kb-cleanup', sid]);
    const job = deriveKbActiveJob(root, 'ckb');
    assert.ok(job, 'the just-dispatched consolidate must be visible to deriveKbActiveJob immediately');
    assert.equal(job.kind, 'consolidate');

    const outcome = await pending;
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.equal(job.runId, outcome.ok === true ? outcome.runId : '', 'the visible job is THIS dispatch, not some other run');
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W8-F1, ADVERSARIAL REVIEW ROUND 2 (S1) — forge-d8l, fifth instance, one click.
//
// The drain audits a proposal when it MINTS the draft, against the file as it
// stood then. `approveKbCleanup` writes the agent's `after` back byte-for-byte
// over whatever the file holds at APPROVE time — minutes or days later — so
// every edge added to that theme in between died silently, with `ok:true` and
// the session stamped `applied`. Nothing in the draft-apply arm looked at the
// graph at all.
//
// Reachable with no external actor: a later round of the SAME drain run can
// land a sound structural edit on the same file (`draftedKeys` only blocks
// re-dispatch of that one finding), and `runBrainConsolidateNow`, `forge brain
// fix` and the reflector can all touch it while the session waits.
// ---------------------------------------------------------------------------

/** A draft session whose target theme is a REAL theme carrying a REAL edge. */
function makeGraphDraftRoot(): { root: string; projectsRoot: string; sid: string; themeFile: string; partnerSlug: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-draft-graph-'));
  const brainDir = join(root, 'brain', 'dkb');
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), 'id: dkb\nname: dkb\nbinding: { kind: unique }\ndesc: draft graph fixture.\n');
  const theme = (title: string, extra: string[] = []): string => [
    '---', `title: ${title}`, 'description: d.', 'category: pattern',
    ...extra,
    'created_at: 2026-01-01T00:00:00Z', 'updated_at: 2026-01-01T00:00:00Z',
    '---', '', `# ${title}`, '', 'Long prose line that the agent proposes to condense.', '',
  ].join('\n');
  const partnerSlug = 'partner';
  writeFileSync(join(brainDir, 'themes', `${partnerSlug}.md`), theme('partner'));
  const themeFile = join(brainDir, 'themes', 'x.md');
  // At MINT time the theme carries NO edge, so the drain's audit is clean and
  // the draft is legitimately parked.
  writeFileSync(themeFile, theme('x'));

  const projectsRoot = join(root, 'projects');
  const sid = '2026-08-28T10-00-00-w8f1graph';
  const sessionDir = join(projectsRoot, '.kb-dkb', '_kb-cleanup', sid);
  mkdirSync(join(sessionDir, 'drafts'), { recursive: true });
  mkdirSync(join(sessionDir, 'plan'), { recursive: true });
  // The parked proposal: the same theme with the prose condensed. It does not
  // mention `related_themes` at all — which is exactly the problem.
  writeFileSync(join(sessionDir, 'drafts', '0.md'), theme('x').replace('Long prose line that the agent proposes to condense.', 'Condensed.'));
  writeFileSync(join(sessionDir, 'plan', 'cleanup-plan.md'), '- [length.soft-cap] brain/dkb/themes/x.md — drain-gated prose edit\n');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({
    session_id: sid, project: '.kb-dkb', phase: 'awaiting-approval', kb_id: 'dkb',
    draft_apply: [{ file: 'brain/dkb/themes/x.md', draft: 'drafts/0.md' }],
  }, null, 2));
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, projectsRoot, sid, themeFile, partnerSlug };
}

test('W8-F1 r2 (S1): approving a parked draft REFUSES when the theme gained a real edge since it was minted', async () => {
  const { root, projectsRoot, sid, themeFile, partnerSlug } = makeGraphDraftRoot();
  try {
    // Between mint and approve, the theme gains a resolvable related_themes
    // edge — a later drain round, a consolidate, the reflector, or a human.
    const withEdge = readFileSync(themeFile, 'utf8').replace('category: pattern', `category: pattern\nrelated_themes: [${partnerSlug}]`);
    writeFileSync(themeFile, withEdge);

    const outcome = await approveKbCleanup(root, projectsRoot, ['.kb-dkb', '_kb-cleanup', sid]);

    // THE ASSERTION IS THE ARTIFACT: the edge survives.
    const after = readFileSync(themeFile, 'utf8');
    assert.match(after, new RegExp(`related_themes: \\[${partnerSlug}\\]`), `approving the stale draft destroyed a real edge:\n${after}`);
    assert.equal(outcome.ok, false, `and the operator is told, not given ok:true — got ${JSON.stringify(outcome)}`);
    const status = JSON.parse(readFileSync(join(projectsRoot, '.kb-dkb', '_kb-cleanup', sid, 'status.json'), 'utf8')) as { phase: string };
    assert.notEqual(status.phase, 'applied', 'a refused apply must not stamp the session applied');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('W8-F1 r2 CONTROL: a draft that is still sound at approve time applies exactly as before', async () => {
  const { root, projectsRoot, sid, themeFile } = makeGraphDraftRoot();
  try {
    const outcome = await approveKbCleanup(root, projectsRoot, ['.kb-dkb', '_kb-cleanup', sid]);
    assert.equal(outcome.ok, true, `the re-audit must refuse stale drafts, not all drafts — got ${JSON.stringify(outcome)}`);
    assert.match(readFileSync(themeFile, 'utf8'), /Condensed\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
