/**
 * check-stale-path-citations — proof the ratchet BITES.
 *
 * Bead forge-8vfn.13: a code comment or prose sentence that cites a repo path
 * (e.g. a retired `packages/x/legacy-loader.ts`) or a retired module's bare
 * basename (`legacy-loader`), where the path/basename no longer exists
 * anywhere in the tree, is a finding.
 * `historical:` on the line, or a `(now at <path>)` annotation, suppresses.
 * A JSON baseline ratchets today's findings so the lint lands green and only
 * a NEW dead citation fails; `--write` may only ever SHRINK that baseline.
 *
 * Every fixture here is a throwaway `git init` tree (`mkdtempSync`), never the
 * real repo tree, so these tests plant exactly the defect shape they check
 * without touching anything a sibling test file also reads (bead
 * forge-8vfn.5.64's race).
 *
 * RUN: node --test --experimental-strip-types scripts/check-stale-path-citations.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-stale-path-citations.mjs');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

/**
 * A throwaway `git init` tree. `files` are written as plain (untracked, not
 * ignored) files — `git ls-files --others --exclude-standard` sees those with
 * no `git add` needed. `deletedHistory` are committed then `git rm`'d so
 * `git log --diff-filter=D` has real retirement history to curate stems from.
 */
function fixture(
  files: Record<string, string>,
  deletedHistory: Record<string, string> = {},
): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'stale-path-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);

  for (const [path, content] of Object.entries(deletedHistory)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    git(root, ['add', path]);
    git(root, ['commit', '-q', '-m', 'add']);
    git(root, ['rm', '-q', path]);
    git(root, ['commit', '-q', '-m', 'delete']);
  }

  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Always pins `--root` and `--baseline` — the checker's OWN default baseline
 *  path is this real repo's, computed from `import.meta.url`, so a fixture
 *  test that omitted `--baseline` would silently read/write the real file. */
function run(root: string, baselinePath: string, extra: string[] = []): { code: number; out: string } {
  try {
    const out = execFileSync(
      'node', [CHECKER, '--root', root, '--baseline', baselinePath, ...extra],
      { encoding: 'utf8' },
    );
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function noBaseline(root: string): string {
  return join(root, 'no-such-baseline.json');
}

function writeBaseline(root: string, entries: string[]): string {
  const path = join(root, 'baseline.json');
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
  return path;
}

// ---------------------------------------------------------------------------
// Path-shaped citations — comments
// ---------------------------------------------------------------------------

describe('path-shaped citations in code comments', () => {
  test('a comment citing a path that does not exist is a finding', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts for context\nexport const x = 1;\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 1, out);
      assert.match(out, /packages\/foo\/bar\.ts:1/, out);
      assert.match(out, /packages\/ghost\/dead-module\.ts/, out);
    } finally {
      cleanup();
    }
  });

  test('a comment citing a path that DOES exist is not a finding', () => {
    const { root, cleanup } = fixture({
      'packages/foo/real.ts': `export const y = 1;\n`,
      'packages/foo/bar.ts': `// see packages/foo/real.ts for context\nexport const x = 1;\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, out);
      assert.match(out, /PASS/, out);
    } finally {
      cleanup();
    }
  });

  test('only COMMENTS are scanned — the same dead path in live code is not a finding', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `const note = "packages/ghost/dead-module.ts";\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `a string literal in code, not a comment, must not be scanned:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('a block comment spanning lines is scanned on every line it covers', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `/*\n packages/ghost/dead-module.ts\n */\nexport const x = 1;\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 1, out);
      assert.match(out, /packages\/foo\/bar\.ts:2/, out);
    } finally {
      cleanup();
    }
  });

  test('`historical:` on the line suppresses the finding', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// historical: packages/ghost/dead-module.ts was the original home\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, out);
    } finally {
      cleanup();
    }
  });

  test('a "(now at <path>)" annotation suppresses the finding', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// packages/ghost/moved.ts (now at packages/foo/bar.ts)\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, out);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Path-shaped citations — prose
// ---------------------------------------------------------------------------

describe('path-shaped citations in markdown prose', () => {
  test('a dead path cited in prose is a finding', () => {
    const { root, cleanup } = fixture({
      'docs/guide.md': `See packages/ghost/dead-module.ts for details.\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 1, out);
      assert.match(out, /docs\/guide\.md:1/, out);
    } finally {
      cleanup();
    }
  });

  for (const excluded of ['brain/theme.md', 'docs/decisions/0001-x.md', '_1.0/plan.md']) {
    test(`${excluded} is excluded from prose scanning`, () => {
      const { root, cleanup } = fixture({
        [excluded]: `See packages/ghost/dead-module.ts for details.\n`,
      });
      try {
        const { code, out } = run(root, noBaseline(root));
        assert.equal(code, 0, `${excluded} must not be scanned:\n${out}`);
      } finally {
        cleanup();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Retired-module bare-basename stems
// ---------------------------------------------------------------------------

describe('retired-module basename stems in prose', () => {
  test('a bare basename of a deleted, kebab-named module is a finding', () => {
    const { root, cleanup } = fixture(
      { 'docs/guide.md': `The instructions-runner used to own this step.\n` },
      { 'packages/old/instructions-runner.ts': 'export {};\n' },
    );
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 1, out);
      assert.match(out, /docs\/guide\.md:1/, out);
      assert.match(out, /instructions-runner/, out);
    } finally {
      cleanup();
    }
  });

  test('a basename that still exists elsewhere in the tree is NOT curated as retired', () => {
    const { root, cleanup } = fixture(
      {
        'packages/new/agent-runner.ts': 'export {};\n',
        'docs/guide.md': `The agent-runner does this.\n`,
      },
      { 'packages/old/agent-runner.ts': 'export {};\n' },
    );
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `basename still lives at packages/new/ — not retired:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('a short or non-compound deleted basename is never curated (false-positive guard)', () => {
    const { root, cleanup } = fixture(
      { 'docs/guide.md': `See the utils file and the x helper.\n` },
      { 'packages/old/utils.ts': 'export {};\n', 'packages/old/x.ts': 'export {};\n' },
    );
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `"utils" (no hyphen) and "x" (too short) must not be curated:\n${out}`);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The baseline ratchet
// ---------------------------------------------------------------------------

describe('the baseline ratchet', () => {
  test('a finding already in the baseline PASSES', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n`,
    });
    try {
      const key = 'packages/foo/bar.ts|1|path|packages/ghost/dead-module.ts';
      const baseline = writeBaseline(root, [key]);
      const { code, out } = run(root, baseline);
      assert.equal(code, 0, out);
      assert.match(out, /PASS/, out);
    } finally {
      cleanup();
    }
  });

  test('a finding NOT in the baseline FAILS as introduced', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n`,
    });
    try {
      const baseline = writeBaseline(root, []);
      const { code, out } = run(root, baseline);
      assert.equal(code, 1, out);
      assert.match(out, /NEW/, out);
    } finally {
      cleanup();
    }
  });

  test('a baseline entry with no matching current finding FAILS as stale', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `export const x = 1;\n`,
    });
    try {
      const baseline = writeBaseline(root, ['packages/foo/bar.ts|1|path|packages/ghost/gone.ts']);
      const { code, out } = run(root, baseline);
      assert.equal(code, 1, out);
      assert.match(out, /stale baseline entry/, out);
    } finally {
      cleanup();
    }
  });

  test('--write bootstraps a baseline from every current finding when none exists yet', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n`,
    });
    try {
      const baseline = noBaseline(root);
      const { code } = run(root, baseline, ['--write']);
      assert.equal(code, 0);
      assert.ok(existsSync(baseline), 'a baseline file must now exist');
      const written = JSON.parse(readFileSync(baseline, 'utf8')) as string[];
      assert.deepEqual(written, ['packages/foo/bar.ts|1|path|packages/ghost/dead-module.ts']);
    } finally {
      cleanup();
    }
  });

  test('--write only ever SHRINKS — it drops stale entries and never adds a new one', () => {
    const { root, cleanup } = fixture({
      // A: still a current finding. B: a baseline entry with no current match
      // (stale — must be dropped). C: a genuinely NEW current finding that is
      // NOT in the starting baseline (must NOT be added by --write).
      'packages/foo/a.ts': `// see packages/ghost/a-dead.ts\n`,
      'packages/foo/c.ts': `// see packages/ghost/c-dead.ts\n`,
    });
    try {
      const keyA = 'packages/foo/a.ts|1|path|packages/ghost/a-dead.ts';
      const keyB = 'packages/foo/nowhere.ts|1|path|packages/ghost/b-dead.ts';
      const keyC = 'packages/foo/c.ts|1|path|packages/ghost/c-dead.ts';
      const baseline = writeBaseline(root, [keyA, keyB]);

      const { code } = run(root, baseline, ['--write']);
      assert.equal(code, 0);
      const written = (JSON.parse(readFileSync(baseline, 'utf8')) as string[]).sort();
      assert.deepEqual(written, [keyA], `expected only ${keyA} to survive:\n${JSON.stringify(written)}`);
      assert.ok(!written.includes(keyB), 'stale entry B must be dropped');
      assert.ok(!written.includes(keyC), 'new finding C must NOT be added by --write');

      // And a plain check afterward still reds on C, which --write refused to launder.
      const { code: checkCode, out } = run(root, baseline);
      assert.equal(checkCode, 1, out);
      assert.match(out, /c-dead\.ts/, out);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The real tree — smoke check that the checker inspects a real population
// ---------------------------------------------------------------------------

test('it inspects a real population against the real tree (population sanity, not a verdict)', () => {
  const json = JSON.parse(
    execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }),
  ) as { scannedCode: number; scannedProse: number };
  assert.ok(json.scannedCode > 500, `expected the real code-file population, got ${json.scannedCode}`);
  assert.ok(json.scannedProse > 50, `expected the real prose-file population, got ${json.scannedProse}`);
});
