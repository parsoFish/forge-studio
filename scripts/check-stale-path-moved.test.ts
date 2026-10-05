// MOVED-path table of check-stale-path-citations.mjs: a story-owned citation of a
// moved doc is forgiven (ratcheted), every other citation of it is still dead.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-stale-path-citations.mjs');

function fixture(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'stale-moved-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(root: string, baselinePath: string, extra: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(
      'node', [CHECKER, '--root', root, '--baseline', baselinePath, '--retired-stems-baseline', join(root, 'stems.json'), ...extra],
      { encoding: 'utf8' },
    );
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// ---------------------------------------------------------------------------
// MOVED-path table — story-owned citing files only
// ---------------------------------------------------------------------------

describe('MOVED-path table', () => {
  const OLD = 'docs/reference/studio-dom-contract.md';
  const NEW = 'dev/studio-dom-contract.md';
  const STORY = 'tests/stories/S1.story.mjs';
  const CITE = `// see ${OLD} for the handle\n`;

  /** Pins the table through the test seam; the real table applies only to the real tree. */
  function movedRun(files: Record<string, string>, baseline: number): { code: number; out: string } {
    const fx = fixture(files);
    try {
      const table = join(fx.root, 'moved.json');
      writeFileSync(table, JSON.stringify({
        baseline,
        rows: [{ old: OLD, new: NEW, owner: 'stories', retire: "the story's next amendment or recorded run" }],
      }));
      const b = join(fx.root, 'baseline.json');
      writeFileSync(b, '[]\n');
      return run(fx.root, b, ['--moved-table', table]);
    } finally { fx.cleanup(); }
  }

  test('(a) a story-owned citation of a mapped old path is MOVED, not dead', () => {
    const { code, out } = movedRun({ [STORY]: CITE, [NEW]: '# gen\n' }, 1);
    assert.equal(code, 0, out);
    assert.match(out, /MOVED \(1\)/);
    assert.doesNotMatch(out, /dead path citation/);
  });

  test('(a) the same old path cited from a NON-story file is still dead', () => {
    const { code, out } = movedRun({ [STORY]: CITE, 'packages/foo/x.ts': CITE, [NEW]: '# gen\n' }, 1);
    assert.equal(code, 1, out);
    assert.match(out, /packages\/foo\/x\.ts: NEW — a dead path citation/);
  });

  test('(b) a MOVED count above the constant baseline FAILS', () => {
    const { code, out } = movedRun({ [STORY]: `${CITE}${CITE}`, [NEW]: '# gen\n' }, 1);
    assert.equal(code, 1, out);
    assert.match(out, /MOVED \(2\) exceeds baseline 1/);
  });

  test('(c) a missing new target FAILS', () => {
    const { code, out } = movedRun({ [STORY]: CITE }, 1);
    assert.equal(code, 1, out);
    assert.match(out, /MOVED target missing: dev\/studio-dom-contract\.md/);
  });

  test('(d) an old path that exists again FAILS', () => {
    const { code, out } = movedRun({ [STORY]: CITE, [NEW]: '# gen\n', [OLD]: '# back\n' }, 1);
    assert.equal(code, 1, out);
    assert.match(out, /MOVED old path exists again: docs\/reference\/studio-dom-contract\.md/);
  });
});

test('the real tree passes with the committed MOVED table', () => {
  const out = execFileSync('node', [CHECKER], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /PASS/);
  assert.match(out, /MOVED \(\d+\)/);
});
