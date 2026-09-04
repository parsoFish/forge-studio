/**
 * PROOF TESTS — W6-P2 (ADR 044, read-path memoization): memoizing the
 * full-tree brain lint behind `packages/knowledge/kb-lint-summary.ts`'s
 * `runBrainLintFullMemoized`/`runBrainLintFullFresh`.
 *
 * ADR 044's four rules, and where each is proven here:
 *   1. Same derivation      → "rule 1 — output is byte-identical...".
 *   2. Real-input keying    → the fingerprint unit tests below (count/mtime/
 *                              size isolated individually, node_modules/.git
 *                              always skipped, all-extensions outside
 *                              brain/) + the invalidation tests covering
 *                              EVERY check that reaches outside brain/, per
 *                              the completeness table in
 *                              packages/knowledge/kb-lint-summary.ts: `_queue/done`
 *                              (checkReflectorLoss), `docs/`+`orchestrator/`
 *                              (checkStaleness's bounded 4-prefix allowlist),
 *                              and a relative-markdown-link target under
 *                              `scripts/` (checkSourceLinks' UNBOUNDED
 *                              resolution — the reviewer-flagged round-2
 *                              gap that forced the walk from a curated root
 *                              list to the whole forgeRoot tree).
 *   3. Memory only           → implicit: no snapshot file is ever written;
 *                              every test drives the in-process export
 *                              directly.
 *   4. Fail open             → "fails open to a direct runBrainLint call...",
 *                              plus a dedicated `runBrainLintFullFresh` proof
 *                              that a post-mutation re-lint cannot trust a
 *                              memo entry a same-millisecond, size-neutral
 *                              write can collide with.
 *
 * RUN: node --test --experimental-strip-types packages/knowledge/tests/unit/kb-lint-summary-memo.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runBrainLint } from '../../brain-lint.ts';
import { statWalkFingerprint, runBrainLintFullMemoized, runBrainLintFullFresh } from '../../kb-lint-summary.ts';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Two frontmatter variants, BYTE-IDENTICAL IN LENGTH: `valid:true` carries a
 * real `updated_at:` key; `valid:false` renames it to an equal-length
 * placeholder key (`xxxxxxxxxx:`, 10 chars — same as `updated_at`), so
 * gray-matter no longer sees an `updated_at` field at all and
 * checkFrontmatter reports it MISSING. Swapping between the two variants is a
 * REAL content change (`runBrainLint` sees a different error count) that is
 * nonetheless invisible to a stat-walk fingerprint when the mtime is pinned
 * back — exactly the blind spot ADR 044 accepts as inherent to stat-based
 * memoization, and exactly what the "genuine cache hit" test below exploits
 * to prove a hit actually happened (not just that the output is correct).
 */
function themeContent(opts: { title: string; valid: boolean }): string {
  const dateKey = opts.valid ? 'updated_at' : 'xxxxxxxxxx';
  return [
    '---',
    `title: "${opts.title}"`,
    'description: "kb-lint-summary-memo fixture theme."',
    'category: pattern',
    'created_at: "2026-08-01T00:00:00Z"',
    `${dateKey}: "2026-08-01T00:00:00Z"`,
    '---',
    '',
    `# ${opts.title}`,
    '',
    'Fixture body — no links, no keywords.',
    '',
  ].join('\n');
}

/** A minimal, deliberately-clean brain/ tree: one validly-indexed theme, so
 *  every full-scope check starts clean except whatever a test deliberately
 *  breaks. */
function makeCleanRoot(prefix: string): { forgeRoot: string; cyclesDir: string; themeFile: string } {
  const forgeRoot = tmp(prefix);
  const cyclesDir = join(forgeRoot, 'brain', 'cycles');
  mkdirSync(join(cyclesDir, 'themes'), { recursive: true });
  const themeFile = join(cyclesDir, 'themes', 'memo-fixture.md');
  writeFileSync(themeFile, themeContent({ title: 'Memo Fixture Theme', valid: true }));
  writeFileSync(
    join(cyclesDir, 'patterns.md'),
    '# Cycles — Patterns\n\n## Theme pages\n\n- [Memo Fixture Theme](./themes/memo-fixture.md)\n',
  );
  return { forgeRoot, cyclesDir, themeFile };
}

// ---------------------------------------------------------------------------
// statWalkFingerprint — pure stat-walk fingerprint (unit)
// ---------------------------------------------------------------------------

describe('statWalkFingerprint — pure stat-walk fingerprint (unit)', () => {
  test('is stable across repeated calls on an unchanged tree', () => {
    const { forgeRoot } = makeCleanRoot('fp-stable-');
    try {
      assert.deepEqual(statWalkFingerprint(forgeRoot), statWalkFingerprint(forgeRoot));
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('counts only .md files under brain/ — a kb.yaml sibling never changes the fingerprint', () => {
    const { forgeRoot, cyclesDir } = makeCleanRoot('fp-mdonly-');
    try {
      const before = statWalkFingerprint(forgeRoot);
      writeFileSync(join(cyclesDir, 'kb.yaml'), 'id: cycles\nname: Cycles Brain\nbinding: { kind: unique }\n');
      const after = statWalkFingerprint(forgeRoot);
      assert.deepEqual(
        after,
        before,
        'cli/brain-lint.ts never reads kb.yaml (checked) — it must not affect the fingerprint',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('an edit that keeps the same byte length changes maxMtimeMs only (mtime key isolated)', () => {
    const { forgeRoot, themeFile } = makeCleanRoot('fp-mtime-');
    try {
      const before = statWalkFingerprint(forgeRoot);
      const validContent = themeContent({ title: 'Memo Fixture Theme', valid: true });
      const brokenContent = themeContent({ title: 'Memo Fixture Theme', valid: false });
      assert.equal(brokenContent.length, validContent.length, 'fixture precondition: the two variants are byte-identical in length');
      writeFileSync(themeFile, brokenContent);
      // W7-C3 (bead forge-b0n): stamp the mtime forward explicitly instead of
      // trusting that two writes a few microseconds apart land in different
      // filesystem mtime ticks. They frequently did not, and this test was
      // this suite's chronic flake. What it exists to pin is
      // statWalkFingerprint's OWN key isolation — same byte length moves
      // maxMtimeMs and NOTHING else — not the host clock's resolution, which
      // is no contract of forge's. The stamp makes the mtime input
      // deterministic so the assertion measures only what it claims.
      // Math.floor: statfs reports sub-millisecond mtimes, but utimesSync
      // writes whole-millisecond precision — stamping from the raw fractional
      // value would not round-trip.
      const stampedMs = Math.floor(before.maxMtimeMs) + 2000;
      utimesSync(themeFile, new Date(stampedMs), new Date(stampedMs));
      const after = statWalkFingerprint(forgeRoot);
      assert.equal(after.fileCount, before.fileCount);
      assert.equal(after.totalSize, before.totalSize);
      // Sub-millisecond tolerance, stated rather than rounded away: node
      // derives mtimeMs from the inode's NANOSECOND stamp as a float, so a
      // whole-millisecond utimes reads back as e.g. …619.999. The contract is
      // "the fingerprint carries the file's real mtime", not "reads back
      // bit-identical to the number we handed the syscall".
      assert.ok(Math.abs(after.maxMtimeMs - stampedMs) < 1,
        `the fingerprint must carry the file's real mtime (got ${after.maxMtimeMs}, stamped ${stampedMs})`);
      assert.ok(after.maxMtimeMs > before.maxMtimeMs, 'a same-size edit must MOVE the mtime key');
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('adding a zero-byte, backdated file changes fileCount only (count key isolated)', () => {
    const { forgeRoot, cyclesDir } = makeCleanRoot('fp-count-');
    try {
      const before = statWalkFingerprint(forgeRoot);
      const newFile = join(cyclesDir, 'themes', 'zzz-new.md');
      writeFileSync(newFile, ''); // zero bytes — no size contribution
      const older = new Date(before.maxMtimeMs - 60_000); // 60s before the current max
      utimesSync(newFile, older, older);
      const after = statWalkFingerprint(forgeRoot);
      assert.equal(after.fileCount, before.fileCount + 1);
      assert.equal(after.totalSize, before.totalSize, 'a zero-byte file must not move totalSize');
      assert.equal(after.maxMtimeMs, before.maxMtimeMs, 'a backdated file older than the current max must not move maxMtimeMs');
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('a size-changing edit with mtime pinned back to its original value changes totalSize only (size key isolated)', () => {
    const { forgeRoot, themeFile } = makeCleanRoot('fp-size-');
    try {
      // Pin to a clean, deliberately-chosen whole-millisecond Date FIRST —
      // reusing the exact same Date reference for both the pre- and
      // post-edit utimesSync calls sidesteps this platform's fs/utimes
      // sub-millisecond round-trip jitter (a live stat's own mtimeMs can
      // carry a fractional component a Date can't represent, so restoring
      // "the value we just read" isn't bit-exact — restoring "a value we
      // picked" is).
      const pinned = new Date('2026-08-01T00:00:00.000Z');
      utimesSync(themeFile, pinned, pinned);

      const before = statWalkFingerprint(forgeRoot);
      writeFileSync(themeFile, themeContent({ title: 'Memo Fixture Theme — a longer title that changes byte length', valid: true }));
      utimesSync(themeFile, pinned, pinned); // pin mtime back to the SAME literal value
      const after = statWalkFingerprint(forgeRoot);
      assert.equal(after.fileCount, before.fileCount);
      // A small epsilon (not strict equality) absorbs whatever residual
      // sub-millisecond utimes rounding this filesystem exhibits — still
      // orders of magnitude tighter than the real mtime bump a genuine,
      // unpinned edit produces (see the mtime-isolation test above).
      assert.ok(
        Math.abs(after.maxMtimeMs - before.maxMtimeMs) < 5,
        `mtime was pinned back — must read as effectively unchanged, before=${before.maxMtimeMs} after=${after.maxMtimeMs}`,
      );
      assert.notEqual(after.totalSize, before.totalSize, 'the longer title must move totalSize even though mtime looks unchanged');
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('deleting a file decreases fileCount', () => {
    const { forgeRoot, themeFile } = makeCleanRoot('fp-delete-');
    try {
      const before = statWalkFingerprint(forgeRoot);
      rmSync(themeFile);
      const after = statWalkFingerprint(forgeRoot);
      assert.equal(after.fileCount, before.fileCount - 1);
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('a missing _queue/done contributes zero files, not an error', () => {
    const { forgeRoot } = makeCleanRoot('fp-noqueue-');
    try {
      assert.ok(!existsSync(join(forgeRoot, '_queue')), 'fixture precondition: no _queue/ dir at all');
      assert.doesNotThrow(() => statWalkFingerprint(forgeRoot));
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('counts ALL file types OUTSIDE brain/ — a non-.md file under docs/ (checkStaleness/checkSourceLinks domain) DOES change the fingerprint', () => {
    const { forgeRoot } = makeCleanRoot('fp-outside-allext-');
    try {
      const before = statWalkFingerprint(forgeRoot);
      mkdirSync(join(forgeRoot, 'docs'), { recursive: true });
      writeFileSync(join(forgeRoot, 'docs', 'config.json'), '{}');
      const after = statWalkFingerprint(forgeRoot);
      assert.notDeepEqual(
        after,
        before,
        'unlike brain/ (checked: brain-lint.ts only ever reads .md there), docs/ can be cited by checkStaleness with ANY extension — a .json file there must still move the fingerprint',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('skips node_modules and .git anywhere in the tree, even under a walked root', () => {
    const { forgeRoot } = makeCleanRoot('fp-skipdirs-');
    try {
      const before = statWalkFingerprint(forgeRoot);
      mkdirSync(join(forgeRoot, 'docs', 'node_modules', 'some-pkg'), { recursive: true });
      writeFileSync(join(forgeRoot, 'docs', 'node_modules', 'some-pkg', 'index.js'), 'module.exports = {};');
      mkdirSync(join(forgeRoot, '.git'), { recursive: true });
      writeFileSync(join(forgeRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      const after = statWalkFingerprint(forgeRoot);
      assert.deepEqual(
        after,
        before,
        'node_modules/ and .git/ must never be walked, however deep — no check reads them and they can be arbitrarily large',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('skips agent-harness + campaign scratch at top level (.claude, .next anywhere, _dry-bridge, _wave<N>) — a 27-worktree .claude/ tree cost 290ms/fingerprint on the 2026-08-15 wave-6 bridge', () => {
    const { forgeRoot } = makeCleanRoot('fp-skipharness-');
    try {
      const before = statWalkFingerprint(forgeRoot);
      mkdirSync(join(forgeRoot, '.claude', 'worktrees', 'agent-x', 'brain', 'themes'), { recursive: true });
      writeFileSync(join(forgeRoot, '.claude', 'worktrees', 'agent-x', 'brain', 'themes', 'clone.md'), '# a clone of the whole repo\n');
      mkdirSync(join(forgeRoot, '_wave6', 'sweep'), { recursive: true });
      writeFileSync(join(forgeRoot, '_wave6', 'sweep', 'report.md'), '# campaign scratch\n');
      mkdirSync(join(forgeRoot, '_dry-bridge'), { recursive: true });
      writeFileSync(join(forgeRoot, '_dry-bridge', 'events.jsonl'), '{}\n');
      mkdirSync(join(forgeRoot, 'apps', 'studio', '.next', 'server'), { recursive: true });
      writeFileSync(join(forgeRoot, 'apps', 'studio', '.next', 'server', 'chunk.js'), '//');
      const after = statWalkFingerprint(forgeRoot);
      assert.deepEqual(after, before, 'harness/campaign/build dirs must never be walked — no check reads them and they dwarf the repo');
      // and the git-tracked demos/ dir STAYS walked (a theme may cite it)
      mkdirSync(join(forgeRoot, 'demos', 'x'), { recursive: true });
      writeFileSync(join(forgeRoot, 'demos', 'x', 'a.html'), '<p>');
      assert.notDeepEqual(statWalkFingerprint(forgeRoot), before, 'demos/ is citeable and must stay in the fingerprint');
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('throws when forgeRoot itself is not a directory (the fail-open signal runBrainLintFullMemoized/FullFresh rely on)', () => {
    // Under the whole-forgeRoot walk, a single misbehaving CHILD directory
    // (e.g. brain/ replaced by a file) no longer throws — the walker treats
    // whatever readdirSync/Dirent reports each entry as being, generically,
    // rather than assuming any specific child must be a directory. The one
    // thing that DOES still throw is forgeRoot itself being unreadable as a
    // directory, since that is the very first readdirSync call the walk
    // makes.
    const parent = tmp('fp-notdir-');
    try {
      const notAForgeRoot = join(parent, 'not-a-directory.txt');
      writeFileSync(notAForgeRoot, 'i am a file, not a forge root');
      assert.throws(() => statWalkFingerprint(notAForgeRoot));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runBrainLintFullMemoized — ADR 044 read-path memo (proof tests)
// ---------------------------------------------------------------------------

describe('runBrainLintFullMemoized — ADR 044 read-path memo (proof tests)', () => {
  test('rule 1 — output is byte-identical to a direct, uncached runBrainLint call over the same tree', () => {
    const { forgeRoot } = makeCleanRoot('memo-identical-');
    try {
      const memoized = runBrainLintFullMemoized(forgeRoot); // cold miss — populates the memo
      const direct = runBrainLint({ cwd: forgeRoot, scope: 'full' }); // same tree, uncached
      assert.deepEqual(
        memoized,
        direct,
        'the memo must never produce a value runBrainLint itself would not — same derivation either way (ADR 044 rule 1)',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('a genuine cache HIT is served: an on-disk edit invisible to the fingerprint (identical length, mtime pinned back) does NOT change the second call output', () => {
    const { forgeRoot, themeFile } = makeCleanRoot('memo-hit-');
    try {
      // Pin to a clean, literal whole-millisecond Date FIRST and reuse the
      // SAME reference for both utimesSync calls — a live stat's own
      // mtimeMs can carry sub-millisecond fs precision a Date can't
      // represent, so restoring "the value we just read" isn't a reliable
      // bit-exact round-trip on every filesystem; restoring "a value we
      // picked" is (mirrors the same fix in the statWalkFingerprint
      // size-isolation unit test above).
      const pinned = new Date('2026-08-01T00:00:00.000Z');
      utimesSync(themeFile, pinned, pinned);

      const first = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        first.findings.filter((f) => f.check === 'checkFrontmatter').length,
        0,
        'fixture precondition: the theme starts with valid frontmatter',
      );

      const validContent = themeContent({ title: 'Memo Fixture Theme', valid: true });
      const brokenContent = themeContent({ title: 'Memo Fixture Theme', valid: false });
      assert.equal(brokenContent.length, validContent.length, 'fixture precondition: byte-identical length');
      writeFileSync(themeFile, brokenContent); // a REAL change a fresh lint would see
      utimesSync(themeFile, pinned, pinned); // ...but invisible to the fingerprint (mtime restored to the SAME pinned value)

      const second = runBrainLintFullMemoized(forgeRoot);
      assert.deepEqual(
        second,
        first,
        'a change the fingerprint walk cannot see must be served from cache — this is the proof a REAL cache hit occurred, not just that the output happens to be correct',
      );

      // Sanity: an uncached run over the SAME (now-broken) on-disk state DOES
      // see the new error — proving the staleness above came from the memo,
      // not from checkFrontmatter being blind to the edit.
      const direct = runBrainLint({ cwd: forgeRoot, scope: 'full' });
      assert.equal(
        direct.findings.filter((f) => f.check === 'checkFrontmatter').length,
        1,
        'sanity check: an uncached run over the same broken content DOES see the new error',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('invalidates when a theme file is edited (same-length edit — the mtime key alone can carry it, so the mtime is pinned not raced)', () => {
    const { forgeRoot, themeFile } = makeCleanRoot('memo-edit-');
    try {
      const first = runBrainLintFullMemoized(forgeRoot);
      assert.equal(first.findings.filter((f) => f.check === 'checkFrontmatter').length, 0);

      // W8-C2b (bead forge-b0n). This test's former title claimed "real-world
      // edit — mtime and size both move naturally". SIZE DOES NOT MOVE, and
      // that wrong comment is what hid this flake. `themeContent`'s two
      // variants are byte-identical in length BY DELIBERATE DESIGN (see this
      // file's header: valid:false swaps `updated_at` for the equal-length
      // placeholder `xxxxxxxxxx`), so `totalSize` is unchanged by this edit and
      // `maxMtimeMs` is the memo fingerprint's ONLY discriminator here. The
      // test therefore raced the filesystem's mtime tick: whenever
      // makeCleanRoot's write and this edit landed in the SAME tick the
      // fingerprint was identical, the memo served a stale HIT, and
      // checkFrontmatter stayed 0 instead of 1. Reproduced deterministically
      // before this fix by pinning both writes to one mtime — identical
      // fingerprint {fileCount:2,maxMtimeMs:…,totalSize:326}, findings 0.
      //
      // The fix stamps the mtime forward explicitly, exactly as the
      // fingerprint-unit tests above already do, so the invalidation this test
      // pins is measured against a deterministic input instead of the host
      // clock's resolution — which is no contract of forge's. NOTE this does
      // NOT weaken the assertion: the 0 -> 1 findings check below is unchanged,
      // and the precondition immediately below makes the pin load-bearing
      // rather than decorative by failing loudly if a future edit ever makes
      // the two variants differ in size.
      const brokenContent = themeContent({ title: 'Memo Fixture Theme', valid: false });
      assert.equal(
        Buffer.byteLength(brokenContent),
        statSync(themeFile).size,
        'fixture precondition: this edit is byte-identical in SIZE, so mtime is the only fingerprint key that can carry the invalidation — which is exactly why it must be pinned rather than raced',
      );
      writeFileSync(themeFile, brokenContent);
      // Math.floor: as in the mtime-isolation test above — utimesSync writes
      // whole-millisecond precision while statfs reports sub-millisecond, so
      // stamping from the raw fractional value would not round-trip.
      const stampedMs = Math.floor(statSync(themeFile).mtimeMs) + 2000;
      utimesSync(themeFile, new Date(stampedMs), new Date(stampedMs));

      const second = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        second.findings.filter((f) => f.check === 'checkFrontmatter').length,
        1,
        'the memo must pick up a real edit on the very next call',
      );
      assert.notDeepEqual(second, first);
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('invalidates when a new theme file is added', () => {
    const { forgeRoot, cyclesDir } = makeCleanRoot('memo-add-');
    try {
      const first = runBrainLintFullMemoized(forgeRoot);
      const firstCount = first.findings.length;

      writeFileSync(
        join(cyclesDir, 'themes', 'second-theme.md'),
        themeContent({ title: 'Second Theme', valid: false }), // unindexed + broken frontmatter
      );
      const second = runBrainLintFullMemoized(forgeRoot);
      assert.ok(
        second.findings.length > firstCount,
        `adding a broken theme must surface new findings on the very next call — first=${firstCount} second=${second.findings.length}`,
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('invalidates when a theme file is deleted', () => {
    const { forgeRoot, cyclesDir } = makeCleanRoot('memo-delete-');
    try {
      const brokenFile = join(cyclesDir, 'themes', 'broken-extra.md');
      writeFileSync(brokenFile, themeContent({ title: 'Broken Extra', valid: false }));

      const first = runBrainLintFullMemoized(forgeRoot);
      assert.ok(first.findings.some((f) => f.file === brokenFile), 'fixture precondition: the extra theme is actually flagged');

      rmSync(brokenFile);
      const second = runBrainLintFullMemoized(forgeRoot);
      assert.ok(
        !second.findings.some((f) => f.file === brokenFile),
        'deleting the broken theme must clear its findings on the very next call',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('invalidates when a checkStaleness-cited target under docs/ is CREATED (checkStaleness resolves docs/ prefixes — cli/brain-lint.ts:601)', () => {
    const { forgeRoot, cyclesDir } = makeCleanRoot('memo-docs-create-');
    try {
      writeFileSync(
        join(cyclesDir, 'themes', 'cites-docs.md'),
        themeContent({ title: 'Cites Docs', valid: true }).replace(
          'Fixture body — no links, no keywords.',
          'Cites `docs/some-new-doc.md` as a source.',
        ),
      );
      const first = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        first.findings.filter((f) => f.check === 'checkStaleness').length,
        1,
        'fixture precondition: docs/some-new-doc.md does not exist yet, so checkStaleness must flag the citation as stale',
      );

      mkdirSync(join(forgeRoot, 'docs'), { recursive: true });
      writeFileSync(join(forgeRoot, 'docs', 'some-new-doc.md'), '# Some New Doc\n');
      const second = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        second.findings.filter((f) => f.check === 'checkStaleness').length,
        0,
        'creating the cited docs/ target must clear the stale-citation finding on the very next call — a fingerprint scoped to only brain/+_queue/done would miss this',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('invalidates when a checkStaleness-cited target under orchestrator/ is DELETED (checkStaleness resolves orchestrator/ prefixes — cli/brain-lint.ts:601)', () => {
    const { forgeRoot, cyclesDir } = makeCleanRoot('memo-orch-delete-');
    try {
      mkdirSync(join(forgeRoot, 'orchestrator'), { recursive: true });
      writeFileSync(join(forgeRoot, 'orchestrator', 'some-module.ts'), 'export const x = 1;\n');
      writeFileSync(
        join(cyclesDir, 'themes', 'cites-orchestrator.md'),
        themeContent({ title: 'Cites Orchestrator', valid: true }).replace(
          'Fixture body — no links, no keywords.',
          'Cites `orchestrator/some-module.ts` as a source.',
        ),
      );
      const first = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        first.findings.filter((f) => f.check === 'checkStaleness').length,
        0,
        'fixture precondition: orchestrator/some-module.ts exists, so checkStaleness must NOT flag the citation',
      );

      rmSync(join(forgeRoot, 'orchestrator', 'some-module.ts'));
      const second = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        second.findings.filter((f) => f.check === 'checkStaleness').length,
        1,
        'deleting the cited orchestrator/ target must surface a stale-citation finding on the very next call',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test("invalidates when a checkSourceLinks-cited target OUTSIDE brain/ (a relative markdown link, not a checkStaleness backtick citation) is CREATED — the UNBOUNDED domain that forces the whole-forgeRoot walk (cli/brain-lint.ts:525)", () => {
    const { forgeRoot, cyclesDir } = makeCleanRoot('memo-sourcelinks-', );
    try {
      // 3 `../` from brain/cycles/themes/ reaches forgeRoot itself, then
      // descends into scripts/ — a path checkStaleness's 4-prefix allowlist
      // does NOT cover (scripts/ is not docs/orchestrator/skills/loops/) but
      // checkSourceLinks' unbounded relative-link resolution does, and the
      // real corpus already exercises exactly this shape (grep-verified
      // against cli/ and scripts/ citations in brain/cycles/themes/).
      writeFileSync(
        join(cyclesDir, 'themes', 'cites-scripts.md'),
        themeContent({ title: 'Cites Scripts', valid: true }).replace(
          'Fixture body — no links, no keywords.',
          '[a script](../../../scripts/some-new-script.mjs)',
        ),
      );
      const first = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        first.findings.filter((f) => f.check === 'checkSourceLinks').length,
        1,
        'fixture precondition: scripts/some-new-script.mjs does not exist yet, so checkSourceLinks must report a broken link',
      );

      mkdirSync(join(forgeRoot, 'scripts'), { recursive: true });
      writeFileSync(join(forgeRoot, 'scripts', 'some-new-script.mjs'), 'console.log("hi");\n');
      const second = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        second.findings.filter((f) => f.check === 'checkSourceLinks').length,
        0,
        'creating the linked scripts/ target must clear the broken-link finding on the very next call',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test("invalidates when _queue/done changes — checkReflectorLoss's OTHER real input outside brain/ (ADR 044 rule 2)", () => {
    const { forgeRoot } = makeCleanRoot('memo-queue-');
    try {
      mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
      const first = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        first.findings.filter((f) => f.check === 'checkReflectorLoss').length,
        0,
        'fixture precondition: no done manifests yet',
      );

      writeFileSync(join(forgeRoot, '_queue', 'done', 'orphan-initiative.md'), '# orphan-initiative\n');
      const second = runBrainLintFullMemoized(forgeRoot);
      assert.equal(
        second.findings.filter((f) => f.check === 'checkReflectorLoss').length,
        1,
        'a new _queue/done manifest with no matching brain/cycles/_raw archive must surface a checkReflectorLoss finding on the very next call — a fingerprint scoped to only brain/ would miss this',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('fails open to a direct runBrainLint call when the fingerprint walk throws, and does not poison the memo for the next good call', () => {
    // forgeRoot itself is the thing that must be unreadable-as-a-directory to
    // force statWalkFingerprint to throw under the whole-forgeRoot walk (see
    // the matching statWalkFingerprint unit test above for why a misbehaving
    // CHILD like brain/ no longer throws).
    const parent = tmp('memo-failopen-');
    try {
      const brokenForgeRoot = join(parent, 'not-a-directory.txt');
      writeFileSync(brokenForgeRoot, 'i am a file, not a forge root');
      assert.doesNotThrow(
        () => runBrainLintFullMemoized(brokenForgeRoot),
        'a broken fingerprint walk must fall through to an uncached run, never throw (ADR 044 rule 4)',
      );
      const broken = runBrainLintFullMemoized(brokenForgeRoot);
      assert.equal(typeof broken.exitCode, 'number');
      assert.ok(Array.isArray(broken.findings));

      // A DIFFERENT, real forgeRoot (memo is keyed per forgeRoot) confirms the
      // failed fingerprint attempt above never wrote a bogus cache entry that
      // could bleed into a legitimate root.
      const { forgeRoot: goodRoot } = makeCleanRoot('memo-failopen-good-');
      try {
        const recovered = runBrainLintFullMemoized(goodRoot);
        const direct = runBrainLint({ cwd: goodRoot, scope: 'full' });
        assert.deepEqual(
          recovered,
          direct,
          'a broken fingerprint attempt on one forgeRoot must never corrupt the memo for a different, real forgeRoot',
        );
      } finally {
        rmSync(goodRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test('runBrainLintFullFresh bypasses AND replaces a stale memo entry even when a write is invisible to the fingerprint (the exact same-ms/same-size collision runBrainLintFullMemoized cannot see)', () => {
    const { forgeRoot, themeFile } = makeCleanRoot('memo-fresh-');
    try {
      // Same pin-then-edit-then-pin-back technique as the "genuine cache HIT"
      // test above — proven reliable there for making a real content change
      // invisible to the fingerprint on this filesystem.
      const pinned = new Date('2026-08-01T00:00:00.000Z');
      utimesSync(themeFile, pinned, pinned);

      const preMutationRead = runBrainLintFullMemoized(forgeRoot); // seeds the memo
      assert.equal(preMutationRead.findings.filter((f) => f.check === 'checkFrontmatter').length, 0);

      const validContent = themeContent({ title: 'Memo Fixture Theme', valid: true });
      const brokenContent = themeContent({ title: 'Memo Fixture Theme', valid: false });
      assert.equal(brokenContent.length, validContent.length, 'fixture precondition: byte-identical length');
      writeFileSync(themeFile, brokenContent); // the "mutation this same request just made"
      utimesSync(themeFile, pinned, pinned); // ...landing in the same fingerprint bucket as the pre-mutation read

      // Reviewer-named danger: a memoized read right now would still be
      // stale (this mirrors the "genuine cache HIT" test — reconfirmed here
      // as the SETUP this test's real point builds on, not the point itself).
      const staleIfMemoized = runBrainLintFullMemoized(forgeRoot);
      assert.deepEqual(staleIfMemoized, preMutationRead, 'setup precondition: the memoized path would serve stale data here');

      // The fresh path must NOT be fooled by the collision.
      const freshResult = runBrainLintFullFresh(forgeRoot);
      assert.equal(
        freshResult.findings.filter((f) => f.check === 'checkFrontmatter').length,
        1,
        'runBrainLintFullFresh must see the mutation regardless of the fingerprint collision — this is the exact clearedCount-accuracy guarantee runBrainConsolidateNow needs',
      );

      // And it must have RE-SEEDED the memo: a subsequent memoized read (same
      // colliding fingerprint) must now return the FRESH value, not fall back
      // to the old stale one.
      const postFreshMemoizedRead = runBrainLintFullMemoized(forgeRoot);
      assert.deepEqual(
        postFreshMemoizedRead,
        freshResult,
        'runBrainLintFullFresh must replace the memo entry so the NEXT memoized reader sees the fresh value too, despite the unchanged fingerprint key',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
});
