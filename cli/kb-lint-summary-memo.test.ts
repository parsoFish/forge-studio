/**
 * PROOF TESTS — W6-P2 (ADR 044, read-path memoization): memoizing the
 * full-tree brain lint behind `cli/kb-lint-summary.ts`'s
 * `runBrainLintFullMemoized`.
 *
 * ADR 044's four rules, and where each is proven here:
 *   1. Same derivation      → "rule 1 — output is byte-identical..."
 *   2. Real-input keying    → the fingerprint unit tests below (count/mtime/
 *                              size isolated individually) + the `_queue/done`
 *                              invalidation test (checkReflectorLoss's OTHER
 *                              real input, outside `brain/`).
 *   3. Memory only           → implicit: no snapshot file is ever written;
 *                              every test drives the in-process export
 *                              directly.
 *   4. Fail open             → "fails open to a direct runBrainLint call...".
 *
 * RUN: node --test --experimental-strip-types cli/kb-lint-summary-memo.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runBrainLint } from './brain-lint.ts';
import { statWalkFingerprint, runBrainLintFullMemoized } from './kb-lint-summary.ts';

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
      const after = statWalkFingerprint(forgeRoot);
      assert.equal(after.fileCount, before.fileCount);
      assert.equal(after.totalSize, before.totalSize);
      assert.notEqual(after.maxMtimeMs, before.maxMtimeMs, 'a fresh write must bump mtime even when size is unchanged');
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

  test('throws when brain/ is not a directory (the fail-open signal runBrainLintFullMemoized relies on)', () => {
    const forgeRoot = tmp('fp-notdir-');
    try {
      writeFileSync(join(forgeRoot, 'brain'), 'not a directory');
      assert.throws(() => statWalkFingerprint(forgeRoot));
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
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

  test('invalidates when a theme file is edited (real-world edit — mtime and size both move naturally)', () => {
    const { forgeRoot, themeFile } = makeCleanRoot('memo-edit-');
    try {
      const first = runBrainLintFullMemoized(forgeRoot);
      assert.equal(first.findings.filter((f) => f.check === 'checkFrontmatter').length, 0);

      writeFileSync(themeFile, themeContent({ title: 'Memo Fixture Theme', valid: false }));
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
    const forgeRoot = tmp('memo-failopen-');
    try {
      writeFileSync(join(forgeRoot, 'brain'), 'not a directory'); // forces statWalkFingerprint to throw (ENOTDIR)
      assert.doesNotThrow(
        () => runBrainLintFullMemoized(forgeRoot),
        'a broken fingerprint walk must fall through to an uncached run, never throw (ADR 044 rule 4)',
      );
      const broken = runBrainLintFullMemoized(forgeRoot);
      assert.equal(typeof broken.exitCode, 'number');
      assert.ok(Array.isArray(broken.findings));

      // Fix the tree and confirm the NEXT call reflects the real state —
      // proves the failed fingerprint attempt never wrote a bogus cache entry.
      rmSync(join(forgeRoot, 'brain'));
      mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
      writeFileSync(
        join(forgeRoot, 'brain', 'cycles', 'themes', 'ok.md'),
        themeContent({ title: 'Recovered Theme', valid: true }),
      );
      writeFileSync(
        join(forgeRoot, 'brain', 'cycles', 'patterns.md'),
        '# Cycles — Patterns\n\n## Theme pages\n\n- [Recovered Theme](./themes/ok.md)\n',
      );
      const recovered = runBrainLintFullMemoized(forgeRoot);
      const direct = runBrainLint({ cwd: forgeRoot, scope: 'full' });
      assert.deepEqual(
        recovered,
        direct,
        'after recovery the memo must reflect the real tree, not a value cached from the broken attempt',
      );
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
});
