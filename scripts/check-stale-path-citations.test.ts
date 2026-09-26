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

/** Every fixture's default retired-stem-candidates path — see `run` below. */
function retiredStemsPath(root: string): string {
  return join(root, 'retired-stems.json');
}

/**
 * Always pins `--root`, `--baseline` and `--retired-stems-baseline` — the
 * checker's OWN defaults for all three are this real repo's, computed from
 * `import.meta.url`, so a fixture test that omitted any of them would
 * silently read/write the real file. `--retired-stems-baseline` defaults
 * to a per-fixture path that plain `fixture()` never populates (so a test
 * that doesn't plant candidates gets an empty stem set, same as a repo
 * that has never run `--write`), unless `extra` already names the flag.
 */
function run(root: string, baselinePath: string, extra: string[] = []): { code: number; out: string } {
  const stemsFlag = extra.includes('--retired-stems-baseline')
    ? []
    : ['--retired-stems-baseline', retiredStemsPath(root)];
  try {
    const out = execFileSync(
      'node', [CHECKER, '--root', root, '--baseline', baselinePath, ...stemsFlag, ...extra],
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

type BaselineRow = { file: string; kind: string; cited: string; count: number };

function writeBaseline(root: string, rows: BaselineRow[]): string {
  const path = join(root, 'baseline.json');
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
  return path;
}

/** Plants a COMMITTED retired-stem candidate set directly, at the exact
 *  path `run()` defaults `--retired-stems-baseline` to — simulating a repo
 *  where `--write` already ran and the result was committed, with NO git
 *  history required at check time. This is the mechanism DETERMINISM in
 *  the header describes: the check reads this file, never `git log`. */
function writeRetiredStemCandidates(root: string, stems: string[]): void {
  writeFileSync(retiredStemsPath(root), `${JSON.stringify(stems, null, 2)}\n`);
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
      assert.match(out, /packages\/foo\/bar\.ts: NEW/, out);
      assert.match(out, /packages\/ghost\/dead-module\.ts/, out);
      assert.match(out, /\(line 1\)/, out);
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

  test('a KNOWN_ROOT name one level INSIDE another path is not a false-positive citation', () => {
    // historical: the fixture's `components/…/X.tsx` path is not a recognised
    // citation at all (`components` is not a KNOWN_ROOT) — a checker that
    // anchored the root with a plain `\b` would still match the nested
    // `studio/…/X.tsx` substring (preceded by `/`, which still satisfies
    // `\b`) and flag it as a dead citation of its own. Regression for exactly
    // that defect, found via this guard's own sweep of the real tree.
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see components/studio/artifact/X.tsx for the component\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `must not misread a nested root as its own citation:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('a markdown-relative-link prefix ("./cli/foo.ts") still matches — not the same shape as nesting', () => {
    // A `/` right before the root is not ALWAYS a nested path — a markdown
    // relative link puts one there too, and the fix for the nesting
    // false-positive above must not blind the checker to this, by far the
    // more common shape of citation in this repo's own docs (see the fixture
    // below for the exact shape).
    const { root, cleanup } = fixture({
      'docs/guide.md': `See [it](./packages/ghost/dead-module.ts) for details.\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 1, `a ./-relative citation of a dead path must still be caught:\n${out}`);
      assert.match(out, /packages\/ghost\/dead-module\.ts/, out);
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
      assert.match(out, /packages\/foo\/bar\.ts: NEW/, out);
      assert.match(out, /\(line 2\)/, out);
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

  test('`example:` on the line suppresses a fictional illustrative path', () => {
    // packages/forge-docs/skills/docs-review/SKILL.md:77 explains what a
    // finding looks like by citing two invented paths as an
    // example: (`docs/foo.md:42` claiming X against `packages/bar/baz.ts:17`) —
    // never real repo paths at any point in time, so `historical:` would
    // be inaccurate; `example:` is the marker for "this was never real".
    const { root, cleanup } = fixture({
      'skills/docs-review/SKILL.md': `// example: see docs/foo.md:42 claiming X against packages/bar/baz.ts:17\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, out);
    } finally {
      cleanup();
    }
  });

  test('`project:` on the line suppresses a target-project-repo path', () => {
    // packages/forge-docs/skills/docs-writer/SKILL.md tells an agent to
    // project: invoke `loops/ralph/runner.ts` — a real path, but in the MANAGED
    // PROJECT's repo the skill operates on, never this repo (forge has no
    // loops/ tree at all). `project:` names that distinction.
    const { root, cleanup } = fixture({
      'skills/docs-writer/SKILL.md': `// project: invoke the platform's loops/ralph/runner.ts\n`,
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
      assert.match(out, /docs\/guide\.md: NEW/, out);
      assert.match(out, /\(line 1\)/, out);
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

  test('a story fixture ground SEED is excluded, prose and code alike — its citations are the source project\'s, not this repo\'s (forge-1rk5.1)', () => {
    const { root, cleanup } = fixture({
      'tests/stories/grounds/node-cli-with-tests/seed/README.md': `See packages/ghost/dead-module.ts for details.\n`,
      'tests/stories/grounds/node-cli-with-tests/seed/test/x.test.ts': `// see packages/ghost/dead-module.ts\nexport const x = 1;\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `a vendored seed must not be scanned:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('a story fixture ground BRAIN profile is excluded — a verbatim copy of a real project\'s Brain 3, citing that project\'s paths (forge-1rk5.1)', () => {
    const { root, cleanup } = fixture({
      'tests/stories/grounds/go-provider-old-contract/brain/profile.md': `See docs/official-provider-codemap.md for details.\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `a vendored fixture brain profile must not be scanned:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('POSITIVE CONTROL — a grounds file OUTSIDE seed/ (its PROVENANCE.md) is still scanned', () => {
    const { root, cleanup } = fixture({
      'tests/stories/grounds/node-cli-with-tests/PROVENANCE.md': `See packages/ghost/dead-module.ts for details.\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 1, out);
      assert.match(out, /PROVENANCE\.md: NEW/, out);
    } finally {
      cleanup();
    }
  });

  test('QUARRY.md (EXCLUDED_PROSE_FILES) is excluded from prose scanning — dated cap-table history', () => {
    // QUARRY.md's cap-table cells are an append-only log of dated "Raised
    // X -> Y (…)" notes every lane writes into, citing files as they stood
    // on that date. A main merge lands a new dated note on nearly every PR,
    // so without a file-level exclusion (mirroring check-identity.mjs's
    // EXCLUDED_FILES) this guard would red almost any merge that carved or
    // moved a file an old note once named — found for real on this guard's
    // own PR. QUARRY.md's LIVE claims (the ownership table's rows) are a
    // different concern, verified by check-owner.mjs, not this guard.
    const { root, cleanup } = fixture({
      'QUARRY.md': `Raised 2026-01-01 -> 2026-02-01 (packages/ghost/dead-module.ts moved on).\n`,
    });
    try {
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `QUARRY.md must not be scanned:\n${out}`);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Retired-module bare-basename stems
// ---------------------------------------------------------------------------

describe('retired-module basename stems in prose (committed candidates — never git log at check time)', () => {
  test('a candidate stem absent from the current tree is a finding', () => {
    const { root, cleanup } = fixture({
      'docs/guide.md': `The instructions-runner used to own this step.\n`,
    });
    try {
      writeRetiredStemCandidates(root, ['instructions-runner']);
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 1, out);
      assert.match(out, /docs\/guide\.md: NEW/, out);
      assert.match(out, /\(line 1\)/, out);
      assert.match(out, /instructions-runner/, out);
    } finally {
      cleanup();
    }
  });

  test('a candidate stem still present as a FILE elsewhere is NOT curated as retired', () => {
    const { root, cleanup } = fixture({
      'packages/new/agent-runner.ts': 'export {};\n',
      'docs/guide.md': `The agent-runner does this.\n`,
    });
    try {
      writeRetiredStemCandidates(root, ['agent-runner']);
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `basename still lives at packages/new/ — not retired:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('a candidate stem living on as a DIRECTORY name is NOT curated as retired', () => {
    // The real defect: `demo-agent.ts` (a file) was deleted, but
    // `skills/demo-agent/` (a directory — the concept lives on as a skill)
    // still exists. A basename-only presence check couldn't see the
    // directory and kept flagging `demo-agent` as retired at every site
    // that mentioned it, across three separate merges, until the presence
    // check was widened to directory segments too.
    const { root, cleanup } = fixture({
      'skills/demo-agent/SKILL.md': '# demo-agent\n',
      'docs/guide.md': `The demo-agent slug is intentional.\n`,
    });
    try {
      writeRetiredStemCandidates(root, ['demo-agent']);
      const { code, out } = run(root, noBaseline(root));
      assert.equal(code, 0, `demo-agent lives on as a directory — not retired:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('DETERMINISM: the check gets the IDENTICAL verdict with NO git history as with full history', () => {
    // The CI incident this guards against (bead forge-8vfn.13, 2026-09-25):
    // actions/checkout defaults to a depth-1 (shallow) clone, so
    // `git log --diff-filter=D` sees nothing and every stem baseline row
    // read as stale. `withHistory` recomputes the candidate file for real,
    // from real deleted-file history, via --write. `noHistory` has ZERO
    // commits (this file's own `fixture()` never commits unless given
    // deletedHistory, so it is already the depth-1 shape) and gets the
    // identical candidate planted directly, as committed data would arrive
    // in a shallow checkout. Both then get the SAME check and must produce
    // the SAME verdict.
    const prose = { 'docs/guide.md': `The example-stem module handled this.\n` };
    const withHistory = fixture(prose, { 'packages/old/example-stem.ts': 'export {};\n' });
    const noHistory = fixture(prose);
    try {
      const writeResult = run(withHistory.root, join(withHistory.root, 'throwaway-baseline.json'), ['--write']);
      assert.equal(writeResult.code, 0, writeResult.out);

      writeRetiredStemCandidates(noHistory.root, ['example-stem']);

      const a = run(withHistory.root, noBaseline(withHistory.root));
      const b = run(noHistory.root, noBaseline(noHistory.root));
      assert.equal(a.code, 1, `expected a finding with real history:\n${a.out}`);
      assert.equal(a.code, b.code, `verdict must not depend on clone depth:\nwith-history: ${a.out}\nno-history: ${b.out}`);
      assert.match(a.out, /example-stem/, a.out);
      assert.match(b.out, /example-stem/, b.out);
    } finally {
      withHistory.cleanup();
      noHistory.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// --write's own candidate-regeneration (the ONLY place this script calls
// `git log`)
// ---------------------------------------------------------------------------

describe('--write regenerates the retired-stem candidate set from git history', () => {
  test('a compound, 6+ char, code-extension deletion becomes a candidate', () => {
    const { root, cleanup } = fixture({}, { 'packages/old/instructions-runner.ts': 'export {};\n' });
    try {
      const result = run(root, noBaseline(root), ['--write']);
      assert.equal(result.code, 0, result.out);
      const candidates = JSON.parse(readFileSync(retiredStemsPath(root), 'utf8')) as string[];
      assert.ok(candidates.includes('instructions-runner'), `expected it in ${JSON.stringify(candidates)}`);
    } finally {
      cleanup();
    }
  });

  test('a short or non-compound deleted basename is never a candidate (false-positive guard)', () => {
    const { root, cleanup } = fixture(
      {},
      { 'packages/old/utils.ts': 'export {};\n', 'packages/old/x.ts': 'export {};\n' },
    );
    try {
      const result = run(root, noBaseline(root), ['--write']);
      assert.equal(result.code, 0, result.out);
      const candidates = JSON.parse(readFileSync(retiredStemsPath(root), 'utf8')) as string[];
      assert.ok(!candidates.includes('utils'), `"utils" has no hyphen: ${JSON.stringify(candidates)}`);
      assert.ok(!candidates.includes('x'), `"x" is too short: ${JSON.stringify(candidates)}`);
    } finally {
      cleanup();
    }
  });

  test('a non-code-extension deletion is never a candidate', () => {
    const { root, cleanup } = fixture({}, { 'docs/old/legacy-notes.md': '# gone\n' });
    try {
      const result = run(root, noBaseline(root), ['--write']);
      assert.equal(result.code, 0, result.out);
      const candidates = JSON.parse(readFileSync(retiredStemsPath(root), 'utf8')) as string[];
      assert.ok(!candidates.includes('legacy-notes'), `a deleted .md is not a retired MODULE: ${JSON.stringify(candidates)}`);
    } finally {
      cleanup();
    }
  });

  test('--write regenerates the candidate file as a FULL overwrite, not shrink-only', () => {
    // Unlike the citations baseline, this file caches a FACT (what git
    // history shows was deleted), not a debt budget — a stale leftover
    // candidate must not survive a regeneration by merging forward.
    const { root, cleanup } = fixture({}, { 'packages/old/instructions-runner.ts': 'export {};\n' });
    try {
      writeRetiredStemCandidates(root, ['stale-leftover-candidate']);
      const result = run(root, noBaseline(root), ['--write']);
      assert.equal(result.code, 0, result.out);
      const candidates = JSON.parse(readFileSync(retiredStemsPath(root), 'utf8')) as string[];
      assert.ok(!candidates.includes('stale-leftover-candidate'), `must be overwritten, not merged: ${JSON.stringify(candidates)}`);
      assert.ok(candidates.includes('instructions-runner'), JSON.stringify(candidates));
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The baseline ratchet
// ---------------------------------------------------------------------------

describe('the baseline ratchet — content-keyed (file, kind, cited) + an occurrence budget, never a line', () => {
  test('a finding already in the baseline, at its budgeted count, PASSES', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n`,
    });
    try {
      const baseline = writeBaseline(root, [
        { file: 'packages/foo/bar.ts', kind: 'path', cited: 'packages/ghost/dead-module.ts', count: 1 },
      ]);
      const { code, out } = run(root, baseline);
      assert.equal(code, 0, out);
      assert.match(out, /PASS/, out);
    } finally {
      cleanup();
    }
  });

  test('a finding NOT in the baseline FAILS as new (implicit budget 0)', () => {
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

  test('a baseline row with no matching current finding FAILS as stale', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `export const x = 1;\n`,
    });
    try {
      const baseline = writeBaseline(root, [
        { file: 'packages/foo/bar.ts', kind: 'path', cited: 'packages/ghost/gone.ts', count: 1 },
      ]);
      const { code, out } = run(root, baseline);
      assert.equal(code, 1, out);
      assert.match(out, /stale baseline entry/, out);
    } finally {
      cleanup();
    }
  });

  test('LINE NUMBERS ARE DISPLAY-ONLY: a line inserted ABOVE a baselined citation stays GREEN', () => {
    // The defect this content-keyed scheme exists to fix: a LINE-keyed
    // baseline reds the moment anything moves the citation to a new line
    // number, including an unrelated insertion above it — measured for
    // real when a parsoFish/main merge shifted lines under this guard's own
    // first baseline. The key here is (file, kind, cited) with a COUNT,
    // never the line, so inserting an unrelated line above the citation —
    // moving it from line 1 to line 2 — must not change the verdict. Red
    // under the original line-keyed design; green under this one.
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n`,
    });
    try {
      const baseline = writeBaseline(root, [
        { file: 'packages/foo/bar.ts', kind: 'path', cited: 'packages/ghost/dead-module.ts', count: 1 },
      ]);
      assert.equal(run(root, baseline).code, 0, 'sanity: green before the insertion');

      writeFileSync(
        join(root, 'packages/foo/bar.ts'),
        `// an unrelated new line, inserted above\n// see packages/ghost/dead-module.ts\n`,
      );
      const { code, out } = run(root, baseline);
      assert.equal(code, 0, `an insertion above the citation must not red the ratchet:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('a SECOND occurrence of a baselined token in the same file EXCEEDS its budget and FAILS', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n`,
    });
    try {
      const baseline = writeBaseline(root, [
        { file: 'packages/foo/bar.ts', kind: 'path', cited: 'packages/ghost/dead-module.ts', count: 1 },
      ]);
      assert.equal(run(root, baseline).code, 0, 'sanity: green with one occurrence');

      writeFileSync(
        join(root, 'packages/foo/bar.ts'),
        `// see packages/ghost/dead-module.ts\n// again: packages/ghost/dead-module.ts\n`,
      );
      const { code, out } = run(root, baseline);
      assert.equal(code, 1, `a second, un-audited occurrence must exceed the budget:\n${out}`);
      assert.match(out, /EXCEEDED budget/, out);
      assert.match(out, /audited 1, now 2/, out);
    } finally {
      cleanup();
    }
  });

  test('--write bootstraps a baseline from every current row when none exists yet', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n`,
    });
    try {
      const baseline = noBaseline(root);
      const { code } = run(root, baseline, ['--write']);
      assert.equal(code, 0);
      assert.ok(existsSync(baseline), 'a baseline file must now exist');
      const written = JSON.parse(readFileSync(baseline, 'utf8')) as BaselineRow[];
      assert.deepEqual(written, [
        { file: 'packages/foo/bar.ts', kind: 'path', cited: 'packages/ghost/dead-module.ts', count: 1 },
      ]);
    } finally {
      cleanup();
    }
  });

  test('--write only ever SHRINKS budgets — it drops stale rows and never adds one', () => {
    const { root, cleanup } = fixture({
      // A: still a current finding at its budgeted count (unchanged). B: a
      // baseline row with no current match (stale — must be dropped). C: a
      // genuinely NEW current finding, not in the starting baseline (must
      // NOT be added by --write).
      'packages/foo/a.ts': `// see packages/ghost/a-dead.ts\n`,
      'packages/foo/c.ts': `// see packages/ghost/c-dead.ts\n`,
    });
    try {
      const rowA = { file: 'packages/foo/a.ts', kind: 'path', cited: 'packages/ghost/a-dead.ts', count: 1 };
      const rowB = { file: 'packages/foo/nowhere.ts', kind: 'path', cited: 'packages/ghost/b-dead.ts', count: 1 };
      const baseline = writeBaseline(root, [rowA, rowB]);

      const { code } = run(root, baseline, ['--write']);
      assert.equal(code, 0);
      const written = JSON.parse(readFileSync(baseline, 'utf8')) as BaselineRow[];
      assert.deepEqual(written, [rowA], `expected only row A to survive:\n${JSON.stringify(written)}`);

      // And a plain check afterward still reds on C, which --write refused to launder.
      const { code: checkCode, out } = run(root, baseline);
      assert.equal(checkCode, 1, out);
      assert.match(out, /c-dead\.ts/, out);
    } finally {
      cleanup();
    }
  });

  test('--write shrinks an OVER-budget row only down to its live count, never launders growth by raising it', () => {
    const { root, cleanup } = fixture({
      'packages/foo/bar.ts': `// see packages/ghost/dead-module.ts\n// again: packages/ghost/dead-module.ts\n`,
    });
    try {
      const baseline = writeBaseline(root, [
        { file: 'packages/foo/bar.ts', kind: 'path', cited: 'packages/ghost/dead-module.ts', count: 1 },
      ]);
      assert.equal(run(root, baseline).code, 1, 'sanity: this is a FAIL state before --write');

      const { code } = run(root, baseline, ['--write']);
      assert.equal(code, 0, '--write itself always exits 0');
      const written = JSON.parse(readFileSync(baseline, 'utf8')) as BaselineRow[];
      assert.equal(written[0]!.count, 1, 'the budget must stay at 1, never rise to match the live count of 2');

      const { code: checkCode, out } = run(root, baseline);
      assert.equal(checkCode, 1, `--write must not have silently accepted the growth:\n${out}`);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The real tree — smoke check that the checker inspects a real population
// ---------------------------------------------------------------------------

test('it inspects a real population against the real tree (population sanity, not a verdict)', () => {
  // Population sanity only — NOT a verdict. `execFileSync` throws on a
  // non-zero exit, and the checker legitimately exits 1 whenever the real
  // tree carries an un-baselined finding, which this test must not depend
  // on either way. Measured for real: a CI run after `update-branch`
  // caught a fresh violation main had just introduced, between this
  // branch's last green local run and CI's own checkout, and this test
  // threw instead of ever reading the JSON it exists to check. Catches the
  // throw and reads `err.stdout` — identical bytes to a clean exit's
  // stdout — so only a crash that emits no parseable JSON at all (not a
  // FAIL verdict) fails this test.
  let stdout: string;
  try {
    stdout = execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    const e = err as { stdout?: string };
    stdout = e.stdout ?? '';
  }
  const json = JSON.parse(stdout) as { scannedCode: number; scannedProse: number };
  assert.ok(json.scannedCode > 500, `expected the real code-file population, got ${json.scannedCode}`);
  assert.ok(json.scannedProse > 50, `expected the real prose-file population, got ${json.scannedProse}`);
});
