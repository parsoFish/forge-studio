/**
 * check-docs-shape ratchet — proof the gate BITES.
 *
 * Spec §4 "Docs" + §7 clause 4 and ruling 392: `docs/` is a Diátaxis tree of
 * four quadrants plus three planning directories, and the ≤ 25 budget counts
 * HAND-WRITTEN pages only — every `docs/**\/*.md` minus `decisions/`,
 * `roadmaps/`, `superpowers/` and `product/`, minus every file the story
 * runner generates (identified by its `generated_from:` frontmatter).
 *
 * These tests run the REAL checker as a subprocess (the same path CI runs)
 * against fabricated trees, one per rule, plus the real repo for the two
 * structural rules. A checker only ever run on a clean tree proves nothing.
 *
 * The count rule is proven on fixtures with KNOWN contents, never against the
 * live tree: an expectation that moves with what it measures measures nothing
 * (§15.192/.195). The live tree's count is CI's gate, not this file's.
 *
 * RUN: node --test --experimental-strip-types scripts/check-docs-shape.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-docs-shape.mjs');

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, root], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** A generated story doc, exactly as `npm run stories` writes its header. */
function generated(kind: 'tutorial' | 'how-to', id: string): string {
  return `---\nkind: ${kind}\nstory: ${id}\ngenerated_from: tests/stories/${id}.story.mjs\n---\n\n# ${id}\n`;
}

function page(title: string): string {
  return `# ${title}\n\nA hand-written page.\n`;
}

/**
 * Builds a docs tree plus the `tests/stories/` files whose ids the checker
 * reads. `index` is `docs/README.md`'s body; when omitted, every hand-written
 * page in `files` is linked from it, so a fixture only fails rule 4 on purpose.
 */
function fixture(files: Record<string, string>, storyIds: string[], index?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-shape-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  for (const id of storyIds) {
    const abs = join(root, `tests/stories/${id}.story.mjs`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `export const story = { id: '${id}' };\n`, 'utf8');
  }
  const readme =
    index ??
    `# Docs index\n\n${Object.keys(files)
      .filter((f) => f.startsWith('docs/') && f !== 'docs/README.md' && !files[f].includes('generated_from:'))
      .map((f) => `- [${f}](./${f.replace(/^docs\//, '')})`)
      .join('\n')}\n`;
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs/README.md'), readme, 'utf8');
  // Every fixture is a git repo: rule 4b enumerates `git ls-files docs/`, the
  // retired guard's own enumeration, chosen because it correctly ignores
  // gitignored local notes (docs/investigations/) that a plain walk would flag.
  trackAll(root);
  return root;
}

/**
 * Make the fixture a real git repo and track everything in it. The superset
 * half of rule 4 enumerates `git ls-files docs/` — the retired
 * check-docs-claims.mjs's own enumeration — so an untracked fixture would
 * measure nothing and pass for the wrong reason.
 */
function trackAll(root: string): void {
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  };
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
}

test('rule 1: a page outside the four quadrants and the three planning dirs FAILS, naming the file and the allowed set', () => {
  const root = fixture({ 'docs/misc/x.md': page('Stray'), 'docs/reference/cli.md': page('CLI') }, []);
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `expected a non-zero exit, got:\n${out}`);
  assert.match(out, /docs\/misc\/x\.md/, 'the violation must name the offending file');
  assert.match(out, /tutorials/, 'the violation must name the allowed set so the fix is obvious');
  assert.match(out, /explanation/, 'the violation must name the allowed set so the fix is obvious');
});

test('rule 1: docs/README.md is the one allowed top-level page', () => {
  const root = fixture({ 'docs/reference/cli.md': page('CLI') }, []);
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `docs/README.md must not be reported as misplaced:\n${out}`);
});

test('rule 2: 26 hand-written pages FAIL the cap of 25, printing the measured count', () => {
  // 25 pages + docs/README.md — the index is itself a hand-written page.
  const files: Record<string, string> = {};
  for (let i = 0; i < 25; i++) files[`docs/reference/page-${i}.md`] = page(`Page ${i}`);
  const root = fixture(files, []);
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `26 hand-written pages must breach the cap, got:\n${out}`);
  assert.match(out, /\b26\b/, 'the measured count must be printed, not just "too many"');
  assert.match(out, /\b25\b/, 'the cap must be printed beside it');
});

test('rule 2: generated pages and the planning directories do NOT count toward the cap', () => {
  // 24 pages + docs/README.md = exactly the cap; the six below must not add to it.
  const files: Record<string, string> = {};
  for (let i = 0; i < 24; i++) files[`docs/reference/page-${i}.md`] = page(`Page ${i}`);
  files['docs/tutorials/S1.md'] = generated('tutorial', 'S1');
  files['docs/how-to/S3.md'] = generated('how-to', 'S3');
  files['docs/decisions/001-a.md'] = page('ADR 1');
  files['docs/roadmaps/1.0.md'] = page('Roadmap');
  files['docs/superpowers/specs/spec.md'] = page('Spec');
  files['docs/product/user-stories.md'] = page('Catalogue');
  // The index must reach the planning directories too — rule 4b, the retired
  // guard's own two-tier rule. The real docs/README.md does exactly this.
  const index = `# Docs index\n\n${Object.keys(files)
    .filter((f) => f.startsWith('docs/reference/'))
    .map((f) => `- [${f}](./${f.replace(/^docs\//, '')})`)
    .join('\n')}\n- [Decisions](./decisions/)\n- [Roadmaps](./roadmaps/)\n- [Spec](./superpowers/)\n- [Product](./product/)\n`;
  const root = fixture(files, ['S1', 'S3'], index);
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `25 hand-written + 2 generated + 4 planning pages must pass:\n${out}`);
  assert.match(out, /\b25\b/, 'the PASS line states the hand-written count');
});

test('rule 3: a generated page whose generated_from header was stripped FAILS, naming the story', () => {
  const root = fixture(
    { 'docs/tutorials/S1.md': '---\nkind: tutorial\nstory: S1\n---\n\n# Onboard\n' },
    ['S1'],
  );
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a story page without generated_from must fail, got:\n${out}`);
  assert.match(out, /S1/, 'the violation must name the story');
  assert.match(out, /generated_from/, 'the violation must name the missing header');
});

test('rule 3: a generated page whose generated_from points at the wrong story FAILS', () => {
  const root = fixture(
    {
      'docs/tutorials/S1.md': '---\nkind: tutorial\nstory: S1\ngenerated_from: tests/stories/S2.story.mjs\n---\n\n# Onboard\n',
    },
    ['S1', 'S2'],
  );
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a mismatched generated_from must fail, got:\n${out}`);
  assert.match(out, /S1/, 'the violation must name the page whose header is wrong');
});

test('rule 4: a hand-written page missing from the docs index FAILS, naming the page', () => {
  const root = fixture(
    { 'docs/reference/cli.md': page('CLI'), 'docs/explanation/security-model.md': page('Security') },
    [],
    '# Docs index\n\n- [CLI](./reference/cli.md)\n',
  );
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `an unlinked page must fail, got:\n${out}`);
  assert.match(out, /explanation\/security-model\.md/, 'the violation must name the unlinked page');
  assert.doesNotMatch(out, /reference\/cli\.md is not/, 'the linked page must not be reported');
});

test('rule 4: a generated page needs no index link — the quadrant README is the story runner’s', () => {
  const root = fixture(
    { 'docs/reference/cli.md': page('CLI'), 'docs/how-to/S3.md': generated('how-to', 'S3') },
    ['S3'],
    '# Docs index\n\n- [CLI](./reference/cli.md)\n',
  );
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `a generated page must not be required in the index:\n${out}`);
});

test('every generated page in the real repo carries its own story header (rule 3)', () => {
  // Rules 1, 2 and 4 are what M6-B's tree lands; asserting them here would make
  // this file a duplicate of the CI gate that moves with it. Rule 3 is
  // different: it is true today and must STAY true through every move, so it
  // is the one live-tree invariant worth pinning here.
  const { out } = run(ROOT);
  // Proof the checker actually ran: only it prints the count line. Without
  // this the doesNotMatch below passes on a missing module.
  assert.match(out, /hand-written \d+/, `the checker did not run:\n${out}`);
  assert.doesNotMatch(out, /generated_from/, `a real generated page has a broken header:\n${out}`);
});
// APPEND to scripts/check-docs-shape.test.ts in the ci: PR — red first.
// Proves the superset BEFORE check-docs-claims.mjs is deleted (§15.236: a fold
// is a fold only when the surviving guard fails on everything the retired one
// failed on). The retired guard enumerated `git ls-files docs/` — 92 files,
// four of them not .md — while rule 4 walked hand-written .md pages only.

test('rule 4: a tracked NON-markdown file under docs/ must be covered by the index', () => {
  // The exact regression the retired check-docs-claims.mjs caught for real:
  // a docs/ index rewrite dropped the mention covering docs/schemas/*.json,
  // and the shape check was blind to it.
  const root = fixture({ 'docs/reference/cli.md': page('CLI') }, [], '# Docs index\n\n- [CLI](./reference/cli.md)\n');
  mkdirSync(join(root, 'docs/schemas'), { recursive: true });
  writeFileSync(join(root, 'docs/schemas/project-config.schema.json'), '{}\n', 'utf8');
  trackAll(root);
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `an uncovered non-markdown docs file must fail, got:\n${out}`);
  assert.match(out, /schemas\/project-config\.schema\.json/, 'the violation names the uncovered file');
});

test('rule 4: a DIRECTORY-level mention covers the files beneath it', () => {
  // check-docs-claims' two-tier rule, preserved: the index cannot be made to
  // enumerate every ADR, and a link to the directory is the honest unit for
  // a subtree. Hand-written PAGES still need their own direct link (above).
  const root = fixture({ 'docs/reference/cli.md': page('CLI') }, [],
    '# Docs index\n\n- [CLI](./reference/cli.md)\n- [Schemas](./schemas/)\n');
  mkdirSync(join(root, 'docs/schemas/examples'), { recursive: true });
  writeFileSync(join(root, 'docs/schemas/project-config.schema.json'), '{}\n', 'utf8');
  writeFileSync(join(root, 'docs/schemas/examples/project.mdtoc.json'), '{}\n', 'utf8');
  trackAll(root);
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `a directory-level mention must cover its subtree, got:\n${out}`);
  // Without this the test passes when the rule is ABSENT: no rule, no violation.
  // 2, not 3: cli.md is hand-written and answered by rule 4a's direct-link tier.
  assert.match(out, /2 tracked docs files covered/, `the coverage rule did not run:\n${out}`);
});

test('rule 4: a link to ONE file does not cover its siblings', () => {
  // The precise trap check-docs-claims documented: linking
  // ./operations/serve-supervision.md must NOT be read as covering all of
  // operations/, or the second file added there is silently unreachable.
  const root = fixture({ 'docs/reference/cli.md': page('CLI') }, [],
    '# Docs index\n\n- [CLI](./reference/cli.md)\n- [one schema](./schemas/project-config.schema.json)\n');
  mkdirSync(join(root, 'docs/schemas'), { recursive: true });
  writeFileSync(join(root, 'docs/schemas/project-config.schema.json'), '{}\n', 'utf8');
  writeFileSync(join(root, 'docs/schemas/other.json'), '{}\n', 'utf8');
  trackAll(root);
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a sibling of a linked file must still need cover, got:\n${out}`);
  assert.match(out, /schemas\/other\.json/, 'the violation names the uncovered sibling');
});

test('the real repo: every tracked docs file is covered — the retired guard’s whole job', () => {
  // Runs the surviving guard over the live tree, which is what makes the
  // deletion of check-docs-claims.mjs safe rather than merely tidy.
  const { out } = run(ROOT);
  // Proof the rule ran at all — otherwise the doesNotMatch below is vacuous.
  assert.match(out, /\d+ tracked docs files covered/, `the coverage rule did not run:\n${out}`);
  assert.doesNotMatch(out, /is not covered by docs\/README\.md/, `a tracked docs file is unreachable from the index:\n${out}`);
});
