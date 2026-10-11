/**
 * forge-nk1y.10 — the preflight BRAIN advisory resolves a theme's cited path against the GROUND's
 * own tree. Capstone A, 2026-10-09: `brain/projects/gitweave/themes/structure.md` cited
 * `tests/test_webhook_signature.py`; the ground held it at `metrics/tests/test_webhook_signature.py`
 * (a package-relative citation), and the advisory flagged it missing. A cited path now passes when it
 * exists at the ground root OR as the tail of a file the ground tracks; a path that exists nowhere is
 * still flagged.
 *
 * Fixtures: the theme as committed on 2026-10-09 (e5e257ee2) and the ground's tracked file list at
 * its then-HEAD 5737e38 (139 files), both copied; the ground is rebuilt as a throwaway git repo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { runPreflight } from '../../preflight.ts';

const FIX = resolve(import.meta.dirname, '..', 'test-fixtures', 'gitweave-brain-stale');
const THEME = readFileSync(join(FIX, 'structure.md.fixture'), 'utf8');
const GROUND_FILES = readFileSync(join(FIX, 'ground-5737e38-files.txt'), 'utf8').split('\n').filter(Boolean);

function setup(theme: string, files: readonly string[] = GROUND_FILES) {
  const root = mkdtempSync(join(tmpdir(), 'preflight-brain-ground-'));
  const forgeRoot = join(root, 'forge');
  const dir = join(root, 'projects', 'gitweave');
  mkdirSync(join(forgeRoot, 'brain', 'projects', 'gitweave', 'themes'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'projects', 'gitweave', 'themes', 'structure.md'), theme);
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), '');
  }
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'ground');
  return { dir, forgeRoot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const brain = (dir: string, forgeRoot: string) => runPreflight(dir, { forgeRoot }).clauses.find((c) => c.clause === 'BRAIN')!;

test('fixture: the theme cites tests/test_webhook_signature.py; the ground has it only under metrics/', () => {
  assert.match(THEME, /`tests\/test_webhook_signature\.py`/);
  assert.ok(GROUND_FILES.includes('metrics/tests/test_webhook_signature.py'));
  assert.ok(!GROUND_FILES.includes('tests/test_webhook_signature.py'));
});

test('the gitweave theme on its own ground: no path flagged (the cited file exists in the ground)', () => {
  const g = setup(THEME);
  try {
    const c = brain(g.dir, g.forgeRoot);
    assert.equal(c.pass, true, c.detail);
  } finally { g.cleanup(); }
});

test('refusal path: a path that exists nowhere in the ground is still flagged, by name', () => {
  const g = setup(`${THEME}\n- \`tests/test_never_written.py\` — a citation of nothing\n`);
  try {
    const c = brain(g.dir, g.forgeRoot);
    assert.equal(c.pass, false);
    assert.match(c.detail, /1 brain-cited source path\(s\) no longer exist/);
    assert.match(c.detail, /tests\/test_never_written\.py \(structure\.md\)/);
    assert.doesNotMatch(c.detail, /test_webhook_signature/);
  } finally { g.cleanup(); }
});

test('the I1 deletion: once metrics/ is gone from the ground, the citation is flagged again', () => {
  const g = setup(THEME, GROUND_FILES.filter((f) => !f.startsWith('metrics/')));
  try {
    const c = brain(g.dir, g.forgeRoot);
    assert.equal(c.pass, false);
    assert.match(c.detail, /tests\/test_webhook_signature\.py/);
  } finally { g.cleanup(); }
});
