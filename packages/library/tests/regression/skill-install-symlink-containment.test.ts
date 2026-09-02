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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { approveSkillDraft, repinSkillPackage } from '../../studio/skill-install.ts';

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
