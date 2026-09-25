/**
 * skill-install-symlink-containment.test.ts — the PROVEN PIN for COMMON §15.19.
 *
 * `approveSkillDraft` and `repinSkillPackage` used to build their target with
 * `skillPath(id, forgeRoot)` — a bare `join()` gated only by `assertSkillSlug`,
 * which checks the id's CHARSET and nothing about the filesystem. A symlink
 * planted at `skills/<id>` is lexically inside `skills/` and resolves anywhere,
 * so both functions read and rewrote a file entirely outside the library while
 * every charset check said fine. Same shape as the sibling lane's HIGH: a guard
 * that is never asked cannot refuse.
 *
 * WHY THIS TEST EXISTS EVEN THOUGH THE ROUTE ALREADY GUARDED. The only
 * production caller, `POST /api/studio/skills/:id/approve`, does call
 * `resolveGuardedPath` before dispatching here — so a single ordinary request
 * could not reach it. That is exactly what makes it worth pinning rather than
 * shrugging at:
 *
 *   1. The route's one guard check was followed by three further raw syscalls
 *      on a RE-DERIVED lexical path, none re-verifying identity. An attacker
 *      with local write access who swaps `skills/<id>` for a symlink inside
 *      that window wins — a wider TOCTOU than the residual one `guardedFile`
 *      documents, because those at least write through the guard's `realPath`.
 *   2. Nothing in either signature said "the caller must guard first". The next
 *      caller — an affordance route, a CLI verb, an automation — reopens it as
 *      a plain, non-racing symlink attack. `installSkillPackage` in this same
 *      file defends itself; these two did not.
 *
 * These assertions MUST FAIL against the pre-fix code. Verified: before the
 * fix both functions rewrote the outside file (`status: draft` stripped and
 * `library: true` added; the provenance `contentHash` overwritten). A pin that
 * was never seen red is a pin of nothing.
 */
import { fixtureAgentFacts } from '../test-fixtures/agent-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { approveSkillDraft, repinSkillPackage } from '../../studio/skill-install.ts';
import { readSkillPackage } from '../../studio/skill-package.ts';
import { listSkillLibrary } from '../../studio/skill-trust.ts';
import { listSkillDirs } from '../../skill-path.ts';

/** A forgeRoot whose `skills/<id>` is a symlink to a directory outside it.
 *  Returns the outside SKILL.md path and the bytes it holds, so a test can
 *  prove those bytes are untouched. */
function plantSymlinkedSkill(frontmatter: string): { forgeRoot: string; outsideMd: string; before: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'forge-skill-containment-'));
  const forgeRoot = join(base, 'root');
  const outside = join(base, 'OUTSIDE');
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(outside, { recursive: true });

  const outsideMd = join(outside, 'SKILL.md');
  writeFileSync(outsideMd, `---\n${frontmatter}---\n\nbody\n`, 'utf8');
  symlinkSync(outside, join(forgeRoot, 'skills', 'evil-id'), 'dir');

  return { forgeRoot, outsideMd, before: readFileSync(outsideMd, 'utf8'), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('approveSkillDraft refuses a symlinked skills/<id> and writes nothing outside the library', () => {
  const { forgeRoot, outsideMd, before, cleanup } = plantSymlinkedSkill('name: evil\nstatus: draft\n');
  try {
    assert.throws(
      () => approveSkillDraft({ forgeRoot, id: 'evil-id' }),
      /evil-id/,
      'a symlinked skills/<id> must be refused by name, not followed',
    );
    assert.equal(readFileSync(outsideMd, 'utf8'), before, 'the file outside the library must be byte-for-byte untouched');
  } finally {
    cleanup();
  }
});

test('repinSkillPackage refuses a symlinked skills/<id> and writes nothing outside the library', () => {
  const { forgeRoot, outsideMd, before, cleanup } = plantSymlinkedSkill(
    'name: evil\nprovenance:\n  source: somewhere\n  contentHash: sha256:0000\n',
  );
  try {
    assert.throws(
      () => repinSkillPackage({ forgeRoot, id: 'evil-id' }),
      /evil-id/,
      'a symlinked skills/<id> must be refused by name, not followed',
    );
    assert.equal(readFileSync(outsideMd, 'utf8'), before, 'the outside provenance block must not be re-hashed in place');
  } finally {
    cleanup();
  }
});

test('both still work on an ordinary, contained skills/<id>', () => {
  // The other half of the pin: a containment fix that refuses EVERYTHING is a
  // regression wearing a security badge. This proves the happy path survives.
  const base = mkdtempSync(join(tmpdir(), 'forge-skill-containment-ok-'));
  try {
    const forgeRoot = join(base, 'root');
    mkdirSync(join(forgeRoot, 'skills', 'good-id'), { recursive: true });
    const md = join(forgeRoot, 'skills', 'good-id', 'SKILL.md');
    writeFileSync(md, '---\nname: good\ndescription: d\nstatus: draft\n---\n\nbody\n', 'utf8');

    approveSkillDraft({ forgeRoot, id: 'good-id' });

    const after = readFileSync(md, 'utf8');
    assert.match(after, /library: true/, 'approve must flip library:true on a contained skill');
    assert.doesNotMatch(after, /status: draft/, 'approve must drop status:draft on a contained skill');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// THE WIRE-REACHABLE HALF — found by the independent security review of the
// fix above, not by the fix's own author.
//
// The first pin covers a symlinked skills/<id> DIRECTORY. There is a second
// shape it does not reach: an ORDINARY directory holding a symlinked SKILL.md
// LEAF. `Dirent.isDirectory()` excludes the first at discovery; `existsSync`
// FOLLOWS the second, so `listSkillMdDirs` used to accept it and every
// consumer then read the link's target.
//
// That one is worse than the approve/repin case, because `GET /api/studio/
// skills` enumerates ids FROM this walk — there is no id for a route to
// pre-guard, so no route-level check can exist, and the outside file's `name`
// and `description` went straight into the API response.
// ---------------------------------------------------------------------------

function plantSymlinkedLeaf(): { forgeRoot: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'forge-skill-leaf-'));
  const forgeRoot = join(base, 'root');
  const outside = join(base, 'OUTSIDE');
  mkdirSync(join(forgeRoot, 'skills', 'leaky-id'), { recursive: true });
  mkdirSync(outside, { recursive: true });

  writeFileSync(join(outside, 'SECRET.md'), '---\nname: exfiltrated\ndescription: from outside the library\n---\n\nbody\n', 'utf8');
  // An ordinary directory — only the LEAF is a link.
  symlinkSync(join(outside, 'SECRET.md'), join(forgeRoot, 'skills', 'leaky-id', 'SKILL.md'), 'file');

  return { forgeRoot, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('listSkillDirs does not discover a skills/<id> whose SKILL.md is a symlink out of the library', () => {
  const { forgeRoot, cleanup } = plantSymlinkedLeaf();
  try {
    assert.deepEqual(listSkillDirs(forgeRoot), [], 'a symlinked SKILL.md leaf must not pass discovery');
  } finally {
    cleanup();
  }
});

test('GET /api/studio/skills cannot leak a file outside the library through a symlinked SKILL.md leaf', () => {
  const { forgeRoot, cleanup } = plantSymlinkedLeaf();
  try {
    // `listSkillLibrary` is what `handleSkillsList` returns. The assertion is on
    // the CONTENT, not just the count: a future change that keeps the entry but
    // blanks its fields would still be a leak of the id, and one that returns
    // the outside file's frontmatter is the leak itself.
    const entries = listSkillLibrary(forgeRoot, fixtureAgentFacts(forgeRoot));
    assert.deepEqual(entries.map((e) => e.id), [], 'no entry may be derived from a symlinked SKILL.md leaf');
    assert.doesNotMatch(JSON.stringify(entries), /exfiltrated|from outside the library/, 'no field of the outside file may appear in the response');
  } finally {
    cleanup();
  }
});

test('readSkillPackage refuses a symlinked skills/<id> — its own pin, not coverage borrowed from a caller', () => {
  // The review's finding 5: readSkillPackage's fix was only covered indirectly,
  // through callers that happen to guard first. It feeds repinSkillPackage's
  // contentHash, so it earns a direct assertion.
  const { forgeRoot, cleanup } = plantSymlinkedSkill('name: evil\n');
  try {
    assert.throws(() => readSkillPackage(forgeRoot, 'evil-id'), /evil-id/, 'a symlinked skills/<id> must be refused, not walked');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// forge-8vfn.5.35 — a symlinked leaf INSIDE an otherwise-contained package.
//
// `skills/<id>` is a real directory and `SKILL.md` is a real file (both
// guards above pass) — but a NON-`SKILL.md` leaf under it is a symlink out
// of the library. `walk()`'s old `Dirent.isFile()`/`isDirectory()` check does
// not follow symlinks, so that entry was neither — silently SKIPPED, dropping
// out of `contentHash` entirely. Not a redirect (the root guard already
// closes that): a silent trust-gate bypass, since `skill-trust.ts`'s
// `needs-review` fires only on a hash difference, and a dropped entry never
// changes the hash.
// ---------------------------------------------------------------------------

function plantSkillWithSymlinkedLeaf(): { forgeRoot: string; outside: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'forge-skill-leaf-escape-'));
  const forgeRoot = join(base, 'root');
  const outside = join(base, 'OUTSIDE');
  mkdirSync(join(forgeRoot, 'skills', 'leafy-id'), { recursive: true });
  mkdirSync(outside, { recursive: true });

  writeFileSync(join(forgeRoot, 'skills', 'leafy-id', 'SKILL.md'), '---\nname: leafy\ndescription: d\n---\n\nbody\n', 'utf8');
  writeFileSync(join(outside, 'exfil.txt'), 'exfiltrated content', 'utf8');
  // An ordinary, contained package — only ONE non-SKILL.md leaf is a link.
  symlinkSync(join(outside, 'exfil.txt'), join(forgeRoot, 'skills', 'leafy-id', 'notes.txt'), 'file');

  return { forgeRoot, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('readSkillPackage refuses a package containing a symlinked non-SKILL.md leaf that escapes the library, rather than silently dropping it from the hash', () => {
  const { forgeRoot, cleanup } = plantSkillWithSymlinkedLeaf();
  try {
    assert.throws(
      () => readSkillPackage(forgeRoot, 'leafy-id'),
      /notes\.txt/,
      'a symlinked leaf escaping the package must be refused BY NAME, not silently skipped',
    );
  } finally {
    cleanup();
  }
});

test('readSkillPackage still reads an ordinary package containing a REAL (non-symlinked) extra leaf, unchanged hash-relevant content', () => {
  const base = mkdtempSync(join(tmpdir(), 'forge-skill-leaf-ok-'));
  try {
    const forgeRoot = join(base, 'root');
    mkdirSync(join(forgeRoot, 'skills', 'plain-id'), { recursive: true });
    writeFileSync(join(forgeRoot, 'skills', 'plain-id', 'SKILL.md'), '---\nname: plain\ndescription: d\n---\n\nbody\n', 'utf8');
    writeFileSync(join(forgeRoot, 'skills', 'plain-id', 'notes.txt'), 'real, ordinary content', 'utf8');

    const files = readSkillPackage(forgeRoot, 'plain-id');
    assert.deepEqual(
      files.map((f) => f.path),
      ['SKILL.md', 'notes.txt'],
      'an ordinary real leaf must still be walked and included, exactly as before this fix',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TOCTOU — the walk's own realpath validation is re-derived from a stale raw
// path at the point of USE, not carried forward from the point of CHECK.
//
// `walk()` in both `readSkillPackage` and `installSkillPackage`'s
// `walkPackageDir` computes `real = realpathSync(absPath)`, checks
// containment against `real`, then re-touches the RAW `absPath` for the
// actual `statSync`/`readFileSync`/recursion. `statSync`/`readFileSync`
// follow whatever a symlink resolves to AT THE MOMENT THEY RUN — so a
// symlink swapped between the two calls sends the classification and the
// bytes to a DIFFERENT target than the one the containment check just
// approved. A validated identity that is never the identity actually
// touched is not a containment guard; it is a check with a gap after it.
//
// NO WIRE-OBSERVABLE ORACLE, NO WORKING SPY. A genuine race is
// non-deterministic and unsuitable for CI. `node:test`'s `mock.method`
// cannot redefine these modules' named ESM imports either — the same
// empirically-verified limitation `apps/forge/tests/regression/
// instructions-start-read-guard.test.ts` and
// `packages/factory/tests/regression/demo-builder-start-read-guard.test.ts`
// document and route around with a SOURCE-STRUCTURAL pin instead. This is
// that same pattern applied here: the only honest RED-at-base assertion is
// that every touch AFTER the containment check goes through the validated
// `real` binding, never a second look at the raw, possibly-swapped
// `absPath`. A wrong implementation — one that re-touches `absPath` after
// validating `real` — is exactly what these assertions fail against today.
// ---------------------------------------------------------------------------

test('readSkillPackage: every touch after realpath validation uses the validated `real` path, never the raw `absPath` again (TOCTOU)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'studio', 'skill-package.ts'), 'utf8');
  assert.match(
    src,
    /if \(real !== rootAbs && !real\.startsWith\(boundary\)\)/,
    'sanity: the containment check this pin sits right after has moved or been renamed — locate it before trusting the assertions below',
  );
  assert.doesNotMatch(
    src,
    /statSync\(absPath\)/,
    'statSync must not re-touch the raw, possibly-symlinked absPath after realpath validation — classify the already-validated `real` path instead (TOCTOU)',
  );
  assert.doesNotMatch(
    src,
    /walk\(absPath, relPath\)/,
    'recursion into a directory entry must descend through the validated `real` path, not the raw absPath (TOCTOU)',
  );
  assert.doesNotMatch(
    src,
    /readFileSync\(absPath, 'utf8'\)/,
    'the file read must not re-touch the raw absPath after realpath validation — read the validated `real` path instead (TOCTOU)',
  );
  assert.match(src, /statSync\(real\)/, 'expected statSync to classify the validated real path');
  assert.match(src, /walk\(real, relPath\)/, 'expected recursion to descend through the validated real path');
  assert.match(src, /readFileSync\(real, 'utf8'\)/, 'expected the file read to read the validated real path');
});

test('installSkillPackage/walkPackageDir: every touch after realpath validation uses the validated `real` path, and the entry it hands back carries that real path, never the raw `absPath` (TOCTOU)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'studio', 'skill-install.ts'), 'utf8');
  assert.match(
    src,
    /if \(real !== rootAbs && !real\.startsWith\(boundary\)\)/,
    'sanity: the containment check this pin sits right after has moved or been renamed — locate it before trusting the assertions below',
  );
  assert.doesNotMatch(
    src,
    /statSync\(absPath\)/,
    'statSync must not re-touch the raw, possibly-symlinked absPath after realpath validation — classify the already-validated `real` path instead (TOCTOU)',
  );
  assert.doesNotMatch(
    src,
    /walk\(absPath, relPath\)/,
    'recursion into a directory entry must descend through the validated `real` path, not the raw absPath (TOCTOU)',
  );
  assert.doesNotMatch(
    src,
    /readFileSync\(entry\.absPath\)/,
    'installSkillPackage\'s file read must not re-touch a raw absPath carried on the walked entry — the entry must carry the validated real path instead (TOCTOU)',
  );
  assert.match(src, /statSync\(real\)/, 'expected statSync to classify the validated real path');
  assert.match(src, /walk\(real, relPath\)/, 'expected recursion to descend through the validated real path');
  assert.match(
    src,
    /readFileSync\(entry\.realPath\)/,
    'expected installSkillPackage to read the walked entry\'s validated real path (RawPackageEntry.realPath), not a raw absPath',
  );
});
